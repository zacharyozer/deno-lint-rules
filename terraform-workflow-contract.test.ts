import { deepStrictEqual, ok, strictEqual } from "node:assert";

import plugin from "./mod.ts";

const C3 = "theozer/no-terraform-content-gate";
const F1 = "theozer/no-terraform-alert-placement";
const F4 = "theozer/no-terraform-alert-env";

const GATE = `
if [ -n "$(git ls-files '*.tf')" ]; then
  echo "terraform gate: in (tracked .tf files present)"
  echo "terraform=true" >> "$GITHUB_OUTPUT"
else
  echo "terraform gate: skip (no tracked .tf files)"
  echo "terraform=false" >> "$GITHUB_OUTPUT"
fi
`;

const ALERT = `deno run --allow-env=ALERT_URL,GITHUB_REPOSITORY \\
  scripts/terraform-destroy-guard.ts \\
  --send-alert \\
  --root infra/terraform/main \\
  --resources /tmp/resources.json`;

async function writeFixture(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, source] of Object.entries(files)) {
    const path = `${root}/${name}`;
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, source);
  }
}

async function makeFixture(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "deno-lint-terraform-contract-" });
  await writeFixture(root, {
    "infra/terraform/main/main.tf": "terraform {}\n",
    "scripts/terraform-plan-gate.ts": "export const gate = true;\n",
    "scripts/terraform-destroy-guard.test.ts": "Deno.test('guard', () => {});\n",
    "scripts/terraform-destroy-guard.ts": [
      'const url = Deno.env.get("ALERT_URL");',
      'const repository = Deno.env["GITHUB_REPOSITORY"];',
      "void url; void repository;",
    ].join("\n"),
    ".github/workflows/checks.yml": `
name: checks
on:
  pull_request:
jobs:
  terraform:
    steps:
      - id: gates
        run: |
${GATE.split("\n").map((line) => `          ${line}`).join("\n")}
      - id: plan
        if: github.event_name == 'pull_request' && steps.gates.outputs.terraform == 'true'
        run: terraform plan
      - uses: ./.github/actions/terraform-gate
`,
    ".github/actions/terraform-gate/action.yml": `
name: terraform gate
inputs: {}
runs:
  using: composite
  steps:
    - run: |
${ALERT.split("\n").map((line) => `        ${line}`).join("\n")}
      shell: bash
`,
    ".github/workflows/infra.yml": `
name: infra
on:
  schedule:
    - cron: '0 0 * * *'
jobs:
  drift:
    steps:
      - run: |
${ALERT.split("\n").map((line) => `          ${line}`).join("\n")}
`,
  });
  return root;
}

function ids(
  root: string,
  anchorRelativePath = "scripts/terraform-destroy-guard.test.ts",
): string[] {
  const anchor = `${root}/${anchorRelativePath}`;
  return Deno.lint.runPlugin(plugin, anchor, Deno.readTextFileSync(anchor)).map((diagnostic) =>
    diagnostic.id
  );
}

function count(idsToCount: string[], id: string): number {
  return idsToCount.filter((candidate) => candidate === id).length;
}

Deno.test("whole-tree Terraform rules accept a real complete contract once at the anchor", async () => {
  const root = await makeFixture();
  try {
    deepStrictEqual(ids(root), []);
    deepStrictEqual(
      Deno.lint.runPlugin(plugin, `${root}/scripts/other.ts`, "export const other = true;")
        .map((diagnostic) => diagnostic.id),
      [],
      "non-anchor files are genuinely inapplicable",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("content-gate mutation is red, and reverting it is green", async () => {
  const root = await makeFixture();
  const workflow = `${root}/.github/workflows/checks.yml`;
  const original = await Deno.readTextFile(workflow);
  try {
    const mutated = original.replace(
      "steps.gates.outputs.terraform == 'true'",
      "steps.gates.outputs.terraform == 'false'",
    );
    strictEqual(mutated === original, false, "content-gate mutation must change bytes");
    await Deno.writeTextFile(workflow, mutated);
    ok(ids(root).includes(C3));
    await Deno.writeTextFile(workflow, original);
    deepStrictEqual(ids(root), []);
  } finally {
    await Deno.writeTextFile(workflow, original);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("content gate and plan must stay in the same workflow job", async () => {
  const root = await makeFixture();
  const workflow = `${root}/.github/workflows/checks.yml`;
  try {
    await Deno.writeTextFile(
      workflow,
      `
name: checks
on:
  pull_request:
jobs:
  gate:
    steps:
      - id: gates
        run: |
${GATE.split("\n").map((line) => `          ${line}`).join("\n")}
  plan:
    steps:
      - id: plan
        if: github.event_name == 'pull_request' && steps.gates.outputs.terraform == 'true'
        run: terraform plan
      - uses: ./.github/actions/terraform-gate
`,
    );
    ok(ids(root).includes(C3), "cross-job steps.gates dataflow must fail closed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("alert placement mutation is red, and reverting it is green", async () => {
  const root = await makeFixture();
  const workflow = `${root}/.github/workflows/infra.yml`;
  const original = await Deno.readTextFile(workflow);
  try {
    const mutated = original.replace(
      "--root infra/terraform/main",
      "--root=infra/terraform/bootstrap",
    );
    strictEqual(mutated === original, false, "placement mutation must change bytes");
    await Deno.writeTextFile(workflow, mutated);
    ok(ids(root).includes(F1));
    await Deno.writeTextFile(workflow, original);
    strictEqual(ids(root).length, 0);
  } finally {
    await Deno.writeTextFile(workflow, original);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("only the root canonical anchor reports whole-tree findings", async () => {
  const root = await makeFixture();
  try {
    await writeFixture(root, {
      "nested/scripts/terraform-destroy-guard.test.ts": "Deno.test('nested', () => {});\n",
    });
    strictEqual(ids(root).length, 0);
    deepStrictEqual(ids(root, "nested/scripts/terraform-destroy-guard.test.ts"), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("applicable empty workflow evidence fails closed for every whole-tree rule", async () => {
  const root = await makeFixture();
  const workflowDirectory = `${root}/.github/workflows`;
  const saved = await Deno.readTextFile(`${workflowDirectory}/checks.yml`);
  try {
    await Deno.writeTextFile(`${workflowDirectory}/checks.yml`, "name: malformed\n: [\n");
    const findings = ids(root);
    strictEqual(count(findings, C3), 1);
    strictEqual(count(findings, F1), 1);
    strictEqual(count(findings, F4), 1);
  } finally {
    await Deno.writeTextFile(`${workflowDirectory}/checks.yml`, saved);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("exact environment grants and module reads are enforced", async () => {
  const root = await makeFixture();
  const action = `${root}/.github/actions/terraform-gate/action.yml`;
  const original = await Deno.readTextFile(action);
  try {
    const mutated = original.replace("ALERT_URL,GITHUB_REPOSITORY", "ALERT_URL");
    strictEqual(mutated === original, false, "env mutation must change bytes");
    await Deno.writeTextFile(action, mutated);
    const findings = ids(root);
    strictEqual(count(findings, F4), 1);
    await Deno.writeTextFile(action, original);
    deepStrictEqual(ids(root), []);
  } finally {
    await Deno.writeTextFile(action, original);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("broad environment permissions do not satisfy exact grants", async () => {
  const root = await makeFixture();
  const action = `${root}/.github/actions/terraform-gate/action.yml`;
  const original = await Deno.readTextFile(action);
  try {
    const mutated = original.replace(
      "--allow-env=ALERT_URL,GITHUB_REPOSITORY",
      "--allow-all --allow-env=ALERT_URL,GITHUB_REPOSITORY",
    );
    strictEqual(mutated === original, false, "broad permission mutation must change bytes");
    await Deno.writeTextFile(action, mutated);
    ok(ids(root).includes(F4));
  } finally {
    await Deno.writeTextFile(action, original);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a checkout without Terraform is inapplicable, not vacuously green evidence", async () => {
  const root = await Deno.makeTempDir({ prefix: "deno-lint-no-terraform-" });
  try {
    await writeFixture(root, {
      "scripts/terraform-plan-gate.ts": "export const gate = true;\n",
      "scripts/terraform-destroy-guard.test.ts": "Deno.test('guard', () => {});\n",
    });
    deepStrictEqual(ids(root), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
