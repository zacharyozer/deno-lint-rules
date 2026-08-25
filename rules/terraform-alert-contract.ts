import {
  hasExactKeys,
  objectAfter,
  simpleProperties,
  stripComments,
} from "./terraform-alert-contract-text.ts";

const BODY_FIELDS = [
  "kind",
  "trigger",
  "repository",
  "root",
  "runId",
  "totalResources",
  "resources",
  "runUrl",
  "pullRequestUrl",
] as const;
const SAFE_ACTIONS = ["create", "delete", "replace", "update"] as const;

function hasSafeActionEnum(source: string): boolean {
  const values = source.match(/\baction\s*:\s*z\.enum\s*\(\s*\[([^\]]*)\]/)?.[1];
  if (values === undefined) return false;
  const actions = [...values.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]).toSorted();
  return actions.length === SAFE_ACTIONS.length &&
    actions.every((action, index) => action === SAFE_ACTIONS[index]);
}

/** Returns the first failed file-local F3 predicate, or undefined for a valid target. */
export function firstTerraformAlertContractViolation(source: string): string | undefined {
  const code = stripComments(source);
  const schema = objectAfter(code, "const SafeResourceSchema = z.object(");
  if (
    schema === undefined ||
    !/^\s*\)\s*\.strict\s*\(\s*\)/.test(code.slice(schema.end + 1)) ||
    !/\baddress\s*:\s*z\.string\s*\(\s*\)[\s\S]*?\.min\s*\(\s*1\s*\)[\s\S]*?\.max\s*\([\s\S]*?\)[\s\S]*?\.refine\s*\(/
      .test(
        schema.body,
      ) ||
    !hasSafeActionEnum(schema.body)
  ) {
    return "the strict SafeResourceSchema does not enforce safe address and action values";
  }

  if (!/\bconst\s+SafeResourcesSchema\s*=\s*z\.array\s*\(\s*SafeResourceSchema\s*\)/.test(code)) {
    return "SafeResourcesSchema must be an array of SafeResourceSchema";
  }
  if (
    !/\bfunction\s+parseSafeResources\b[\s\S]*?SafeResourcesSchema\.(?:parse|safeParse)\s*\(/.test(
      code,
    ) ||
    !/\bfunction\s+readAlertResources\b[\s\S]*?parseSafeResources\s*\(\s*await\s+Deno\.readTextFile\s*\(/
      .test(
        code,
      )
  ) {
    return "the resources sent in the alert must come from SafeResourcesSchema validation";
  }

  if (
    !/\bconst\s+root\s*=\s*options\.root\s*;/.test(code) ||
    !/\bconst\s+identity\s*=\s*parseAlertIdentity\s*\(\s*env\s*,\s*root\s*\)\s*;/.test(code) ||
    !/\bif\s*\(\s*identity\s*===\s*undefined\s*\)\s*return\s+failedAlert\s*\(\s*["']notify-identity["']\s*\)/
      .test(
        code,
      ) ||
    !/parseAlertIdentity[\s\S]*GITHUB_REPOSITORY[\s\S]*AlertRepositorySchema\.safeParse[\s\S]*ALLOWED_REPOSITORY_ROOTS[\s\S]*GITHUB_RUN_ID[\s\S]*GITHUB_EVENT_NAME/
      .test(
        code,
      )
  ) {
    return "the alert identity must be validated before it supplies payload fields";
  }
  if (
    !/\bconst\s+runUrl\s*=\s*[\s\S]{0,300}identity\.fullRepository[\s\S]{0,180}(?:identity\.runId|linkEnvironment\.GITHUB_RUN_ID)/
      .test(
        code,
      ) ||
    !/\bpullRequestUrl\s*=\s*await\s+readPullRequestUrl\s*\([\s\S]{0,300}identity\.fullRepository/
      .test(
        code,
      )
  ) {
    return "alert links must be derived from the validated identity";
  }

  const payload = objectAfter(code, "const body = JSON.stringify(");
  if (payload === undefined) return "the actual fetch body must be the safe alert payload";
  const properties = simpleProperties(payload.body);
  if (!hasExactKeys(properties, BODY_FIELDS)) {
    return "the sent payload must contain exactly the safe alert fields";
  }
  const expectedValues: Readonly<Record<string, string>> = {
    kind: '"terraform-alert"',
    trigger: "identity.trigger",
    repository: "identity.repository",
    root: "root",
    runId: "identity.runId",
    totalResources: "totalResources",
    resources: "resources",
    runUrl: "runUrl",
    pullRequestUrl: "pullRequestUrl",
  };
  if (BODY_FIELDS.some((field) => properties.get(field) !== expectedValues[field])) {
    return "the sent payload must carry validated identity and resource values";
  }
  if (
    !/new\s+TextEncoder\s*\(\s*\)\.encode\s*\(\s*body\s*\)\.length\s*>\s*MAX_ALERT_REQUEST_BYTES[\s\S]{0,180}return\s+failedAlert/
      .test(
        code,
      )
  ) {
    return "the request body must be bounded before sending";
  }

  const fetchOptions = objectAfter(code, "dependencies.fetch ?? fetch");
  if (
    fetchOptions === undefined ||
    !/\bmethod\s*:\s*["']POST["']/.test(fetchOptions.body) ||
    !/"x-repo-hygiene-terraform-trigger"\s*:\s*identity\.trigger/.test(fetchOptions.body) ||
    !/"x-repo-hygiene-terraform-repository"\s*:\s*identity\.repository/.test(fetchOptions.body) ||
    !/\bbody\s*,/.test(fetchOptions.body)
  ) {
    return "the actual fetch must bind routing headers and body to validated values";
  }
}
