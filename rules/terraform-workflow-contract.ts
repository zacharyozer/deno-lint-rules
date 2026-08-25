import { dirname, extname, join, normalize, relative, resolve } from "node:path";

import { parse as parseYaml } from "jsr:@std/yaml@1";

type RecordValue = Record<string, unknown>;

export type TerraformContractFindings = {
  c3?: string;
  f1?: string;
  f4?: string;
};

type Step = RecordValue & {
  if?: string;
  run?: string;
  uses?: string;
};

type Workflow = {
  path: string;
  triggers: Set<string>;
  jobs: Job[];
  steps: Step[];
};

type Job = {
  steps: Step[];
};

type AlertSender = {
  path: string;
  run: string;
  root: string;
  kind: "pull_request" | "schedule" | "unknown";
};

type Scan = {
  root: string;
  terraformRoots: string[];
  workflows: Workflow[];
  senders: AlertSender[];
  envReads: Set<string>;
  envGraphError?: string;
  yamlError?: string;
  configError?: string;
  planGate: { producer: boolean; plan: boolean };
};

const TERRAFORM_EXTENSIONS = new Set([".tf"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];
const WORKFLOW_DIR = [".github", "workflows"];
const ACTION_DIR = [".github", "actions"];
const ANCHOR = "/scripts/terraform-destroy-guard.test.ts";
const GUARD = "scripts/terraform-destroy-guard.ts";

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asSteps(value: unknown): Step[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const step = asRecord(item);
    return step === undefined ? [] : [step as Step];
  });
}

function normalized(path: string): string {
  return normalize(path.replaceAll("\\", "/"));
}

function filesystemPath(filename: string): string {
  if (!filename.startsWith("file://")) return filename;
  try {
    return decodeURIComponent(new URL(filename).pathname);
  } catch {
    return filename;
  }
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${"/"}`) && !rel.startsWith("../"));
}

function listFiles(directory: string): string[] {
  const result: string[] = [];
  const visit = (current: string) => {
    for (const entry of Deno.readDirSync(current)) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".deno") {
        continue;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory) visit(path);
      else if (entry.isFile) result.push(path);
    }
  };
  visit(directory);
  return result;
}

function findRoot(anchorFilename: string): string {
  let current = dirname(resolve(anchorFilename));
  while (current !== dirname(current)) {
    for (const marker of [".git", "deno.json", "deno.jsonc"]) {
      try {
        if (
          Deno.statSync(join(current, marker)).isFile ||
          Deno.statSync(join(current, marker)).isDirectory
        ) {
          return current;
        }
      } catch {
        // Try the next root marker.
      }
    }
    current = dirname(current);
  }
  return dirname(resolve(anchorFilename, ".."));
}

function yamlTriggerValue(document: RecordValue): unknown {
  if ("on" in document) return document.on;
  // YAML 1.1 parsers may resolve the unquoted key `on` to boolean true.
  if ("true" in document) return document.true;
  return undefined;
}

function triggersOf(document: RecordValue): Set<string> {
  const result = new Set<string>();
  const value = yamlTriggerValue(document);
  if (typeof value === "string") result.add(value);
  else if (Array.isArray(value)) {
    for (const item of value) if (typeof item === "string") result.add(item);
  } else if (asRecord(value) !== undefined) {
    for (const key of Object.keys(asRecord(value)!)) result.add(key);
  }
  return result;
}

function yamlFiles(root: string, directoryParts: string[]): string[] {
  const directory = join(root, ...directoryParts);
  try {
    return listFiles(directory).filter((path) => [".yml", ".yaml"].includes(extname(path)));
  } catch {
    return [];
  }
}

function parseDocument(path: string): RecordValue {
  const parsed = parseYaml(Deno.readTextFileSync(path));
  return asRecord(parsed) ?? {};
}

function workflowJobs(document: RecordValue): Job[] {
  const jobs = asRecord(document.jobs);
  if (jobs === undefined) return [];
  return Object.values(jobs).flatMap((job) => {
    const jobRecord = asRecord(job);
    const jobIf = asString(jobRecord?.if);
    const steps = asSteps(jobRecord?.steps).map((step) => {
      const stepIf = asString(step.if);
      if (jobIf === undefined) return step;
      return { ...step, if: stepIf === undefined ? jobIf : `${jobIf} && (${stepIf})` };
    });
    return steps.length === 0 ? [] : [{ steps }];
  });
}

function actionSteps(root: string, uses: string): Step[] {
  if (!uses.startsWith("./.github/actions/")) return [];
  const actionDirectory = join(root, uses.slice(2));
  for (
    const candidate of [join(actionDirectory, "action.yml"), join(actionDirectory, "action.yaml")]
  ) {
    try {
      if (!Deno.statSync(candidate).isFile) continue;
      return asSteps(asRecord(parseDocument(candidate)?.runs)?.steps);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  return [];
}

function senderRoot(run: string): string | undefined {
  const match = run.match(/--root(?:\s+|=)([^\s\\]+)/);
  return match?.[1];
}

function senderKind(workflow: Workflow, step: Step): AlertSender["kind"] {
  const condition = asString(step.if) ?? "";
  if (/github\.event_name\s*==\s*['"]pull_request['"]/.test(condition)) {
    return workflow.triggers.has("pull_request") ? "pull_request" : "unknown";
  }
  if (/github\.event_name\s*==\s*['"]schedule['"]/.test(condition)) {
    return workflow.triggers.has("schedule") ? "schedule" : "unknown";
  }
  if (workflow.triggers.has("schedule") && !workflow.triggers.has("pull_request")) {
    return "schedule";
  }
  if (workflow.triggers.has("pull_request")) return "pull_request";
  return "unknown";
}

function collectWorkflows(root: string): Workflow[] {
  return yamlFiles(root, WORKFLOW_DIR).map((path) => {
    const document = parseDocument(path);
    const jobs = workflowJobs(document);
    return { path, triggers: triggersOf(document), jobs, steps: jobs.flatMap((job) => job.steps) };
  });
}

function collectSenders(root: string, workflows: Workflow[]): AlertSender[] {
  const senders: AlertSender[] = [];
  const invokedActions = new Set<string>();
  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      const uses = asString(step.uses);
      const expanded = uses ? actionSteps(root, uses) : [];
      if (uses?.startsWith("./.github/actions/")) {
        const directory = join(root, uses.slice(2));
        for (const candidate of [join(directory, "action.yml"), join(directory, "action.yaml")]) {
          try {
            if (Deno.statSync(candidate).isFile) invokedActions.add(resolve(candidate));
          } catch {
            // Missing local action definitions are handled by the sender cardinality check.
          }
        }
      }
      const candidates = expanded.length > 0 ? expanded : [step];
      for (const candidate of candidates) {
        const run = asString(candidate.run);
        if (run === undefined || !run.includes("--send-alert")) continue;
        const rootPath = senderRoot(run);
        const contextStep = expanded.length > 0
          ? { ...candidate, if: `${asString(step.if) ?? ""} ${asString(candidate.if) ?? ""}` }
          : candidate;
        senders.push({
          path: expanded.length > 0 ? asString(step.uses)! : workflow.path,
          run,
          root: rootPath ?? "",
          kind: senderKind(workflow, contextStep),
        });
      }
    }
  }
  for (
    const path of yamlFiles(root, ACTION_DIR).filter((candidate) =>
      candidate.endsWith("/action.yml") || candidate.endsWith("/action.yaml")
    )
  ) {
    if (invokedActions.has(resolve(path))) continue;
    const steps = asSteps(asRecord(parseDocument(path)?.runs)?.steps);
    for (const step of steps) {
      const run = asString(step.run);
      if (run?.includes("--send-alert")) {
        senders.push({
          path,
          run,
          root: senderRoot(run) ?? "",
          kind: "unknown",
        });
      }
    }
  }
  return senders;
}

function excludedRoots(root: string): { roots: Set<string>; error?: string } {
  const path = join(root, ".github", "terraform-plan-gating.json");
  try {
    const value = JSON.parse(Deno.readTextFileSync(path)) as RecordValue;
    const excluded = Array.isArray(value.excludedRoots) ? value.excludedRoots : [];
    return {
      roots: new Set(excluded.flatMap((entry) => {
        const path = asString(asRecord(entry)?.path);
        return path === undefined ? [] : [normalized(path)];
      })),
    };
  } catch (error) {
    try {
      if (!Deno.statSync(path).isFile) return { roots: new Set() };
    } catch (statError) {
      if (statError instanceof Deno.errors.NotFound) return { roots: new Set() };
    }
    return { roots: new Set(), error: error instanceof Error ? error.message : String(error) };
  }
}

function terraformRoots(root: string): { roots: string[]; error?: string } {
  const files = listFiles(root).filter((path) =>
    TERRAFORM_EXTENSIONS.has(extname(path)) && isWithin(path, root)
  );
  const excluded = excludedRoots(root);
  return {
    roots: [...new Set(files.map((path) => normalized(relative(root, dirname(path)))))]
      .filter((path) => path !== "." && !path.split("/").includes("modules"))
      .filter((path) => !excluded.roots.has(path))
      .sort(),
    error: excluded.error,
  };
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function resolveLocalImport(path: string, specifier: string): string | undefined {
  const base = resolve(dirname(path), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (Deno.statSync(candidate).isFile) return candidate;
    } catch {
      // Try the next supported extension.
    }
  }
  return undefined;
}

function moduleGraph(root: string): { reads: Set<string>; error?: string } {
  const entry = join(root, GUARD);
  const reads = new Set<string>();
  const visited = new Set<string>();
  const visit = (path: string): string | undefined => {
    if (visited.has(path)) return;
    visited.add(path);
    let source: string;
    try {
      source = stripComments(Deno.readTextFileSync(path));
    } catch {
      return `cannot read module ${relative(root, path)}`;
    }
    for (const match of source.matchAll(/\bDeno\.env\.get\s*\(\s*(["'])([^"']+)\1\s*\)/g)) {
      reads.add(match[2]);
    }
    for (const match of source.matchAll(/\bDeno\.env\s*\[\s*(["'])([^"']+)\1\s*\]/g)) {
      reads.add(match[2]);
    }
    if (
      /\bDeno\.env\.(?:get|has)\s*\(\s*(?!["'])/.test(source) ||
      /\bDeno\.env\s*\[\s*(?!["'])/.test(source)
    ) {
      return `non-literal Deno.env access in ${relative(root, path)}`;
    }
    for (const match of source.matchAll(/\bimport\s*\(([^)]*)\)/g)) {
      if (!/^\s*["'][^"']+["']\s*$/.test(match[1])) {
        return `non-literal dynamic import in ${relative(root, path)}`;
      }
    }
    const imports = new Set<string>();
    for (const match of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
      imports.add(match[1]);
    }
    for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      imports.add(match[1]);
    }
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) continue;
      const imported = resolveLocalImport(path, specifier);
      if (imported === undefined || !isWithin(imported, root)) {
        return `unresolved local import ${specifier} from ${relative(root, path)}`;
      }
      const error = visit(imported);
      if (error !== undefined) return error;
    }
    return undefined;
  };
  const error = visit(entry);
  return { reads, error };
}

function hasTerraformPlan(step: Step): boolean {
  return (asString(step.run) ?? "").includes("terraform plan");
}

function analyze(root: string): Scan {
  const scan: Scan = {
    root,
    terraformRoots: [],
    workflows: [],
    senders: [],
    envReads: new Set(),
    planGate: { producer: false, plan: false },
  };
  try {
    const roots = terraformRoots(root);
    scan.terraformRoots = roots.roots;
    scan.configError = roots.error;
    if (scan.terraformRoots.length === 0) return scan;
    const workflowPaths = yamlFiles(root, WORKFLOW_DIR);
    if (workflowPaths.length === 0) {
      scan.yamlError = "no .github/workflows YAML files found";
      return scan;
    }
    scan.workflows = collectWorkflows(root);
    scan.senders = collectSenders(root, scan.workflows);
    for (const workflow of scan.workflows) {
      for (const job of workflow.jobs) {
        const producer = job.steps.some((step) => {
          const run = asString(step.run) ?? "";
          return asString(step.id) === "gates" && run.includes("git ls-files") &&
            run.includes("'*.tf'") && run.includes("terraform=true") &&
            run.includes("terraform=false");
        });
        const plan = job.steps.some((step) => {
          if (
            hasTerraformPlan(step) &&
            (asString(step.if) ?? "").includes("steps.gates.outputs.terraform == 'true'")
          ) return true;
          const expanded = asString(step.uses) ? actionSteps(root, asString(step.uses)!) : [];
          return expanded.some((actionStep) =>
            hasTerraformPlan(actionStep) &&
            `${asString(step.if) ?? ""} ${asString(actionStep.if) ?? ""}`.includes(
              "steps.gates.outputs.terraform == 'true'",
            )
          );
        });
        if (producer) scan.planGate.producer = true;
        if (producer && plan) scan.planGate.plan = true;
      }
    }
    const graph = moduleGraph(root);
    scan.envReads = graph.reads;
    scan.envGraphError = graph.error;
  } catch (error) {
    scan.yamlError = error instanceof Error ? error.message : String(error);
  }
  return scan;
}

function envGrant(run: string): Set<string> | undefined {
  if (/--allow-all(?:\s|\\|$)/.test(run)) return undefined;
  const matches = [...run.matchAll(/--allow-env(?:=([^\s\\]+))?/g)];
  if (matches.length !== 1 || matches[0][1] === undefined) return undefined;
  return new Set(matches[0][1].split(",").filter(Boolean));
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function terraformWorkflowContract(anchorFilename: string): TerraformContractFindings {
  const filename = filesystemPath(anchorFilename);
  const normalizedAnchor = normalized(resolve(filename));
  if (!normalizedAnchor.endsWith(ANCHOR)) return {};
  const root = findRoot(filename);
  if (normalizedAnchor !== normalized(join(root, ANCHOR.slice(1)))) return {};
  const scan = analyze(root);
  // A checkout without Terraform is explicitly outside these rules' domain.
  if (scan.terraformRoots.length === 0) return {};

  const findings: TerraformContractFindings = {};
  if (
    scan.yamlError !== undefined || scan.configError !== undefined || scan.workflows.length === 0
  ) {
    findings.c3 =
      `examined ${scan.terraformRoots.length} Terraform root(s), but workflow YAML could not be analyzed`;
  } else if (!scan.planGate.producer || !scan.planGate.plan) {
    findings.c3 =
      `examined ${scan.terraformRoots.length} Terraform root(s) and ${scan.workflows.length} workflow(s), but the canonical content gate/dataflow is incomplete`;
  }

  const included = new Set(scan.terraformRoots);
  const pull = scan.senders.filter((sender) => sender.kind === "pull_request");
  const schedule = scan.senders.filter((sender) => sender.kind === "schedule");
  const validSender = (sender: AlertSender) =>
    included.has(normalized(sender.root)) &&
    sender.run.includes("--resources");
  if (
    scan.yamlError !== undefined || scan.configError !== undefined || scan.workflows.length === 0 ||
    scan.senders.length === 0 || scan.senders.some((sender) => sender.kind === "unknown")
  ) {
    findings.f1 =
      `examined ${scan.terraformRoots.length} Terraform root(s) and ${scan.workflows.length} workflow(s), but found no alert sender contract`;
  } else if (
    pull.length !== included.size || schedule.length !== included.size ||
    pull.some((sender) => !validSender(sender)) ||
    schedule.some((sender) => !validSender(sender)) ||
    new Set([...pull, ...schedule].map((sender) => `${sender.kind}:${normalized(sender.root)}`))
        .size !== included.size * 2
  ) {
    findings.f1 =
      `examined ${scan.terraformRoots.length} Terraform root(s) and ${scan.senders.length} alert sender(s), but alert placement/cardinality is invalid`;
  }

  if (
    scan.yamlError !== undefined || scan.configError !== undefined ||
    scan.envGraphError !== undefined || scan.envReads.size === 0
  ) {
    findings.f4 =
      `examined the Terraform alert module graph, but found no literal environment reads`;
  } else if (
    scan.senders.length === 0 || scan.senders.some((sender) => {
      const granted = envGrant(sender.run);
      return granted === undefined || !sameSet(granted, scan.envReads);
    })
  ) {
    findings.f4 =
      `examined ${scan.envReads.size} module-graph environment read(s) and ${scan.senders.length} sender(s), but --allow-env does not match exactly`;
  }
  return findings;
}

export const TERRAFORM_WORKFLOW_ANCHOR = ANCHOR;
