import { deepStrictEqual, strictEqual } from "node:assert";

import plugin from "./mod.ts";
import packagesPlugin from "./packages.ts";

const NO_BARE = "theozer/no-bare-cross-package-specifier";
const NO_RELATIVE = "theozer/no-relative-cross-package-import";
const NO_SERVICE_RELATIVE = "theozer/no-service-relative-package-import";
const NO_UNSAFE_TERRAFORM_ALERT_PAYLOAD = "theozer/no-unsafe-terraform-alert-payload";

function diagnosticIds(filename: string, source: string): string[] {
  return Deno.lint.runPlugin(plugin, filename, source).map((diagnostic) => diagnostic.id);
}

Deno.test("the aggregate enables every rule by default", () => {
  deepStrictEqual(Object.keys(plugin.rules).sort(), [
    "no-bare-cross-package-specifier",
    "no-service-relative-package-import",
    "no-unsafe-terraform-alert-payload",
  ]);
});

Deno.test("no-unsafe-terraform-alert-payload is target-scoped and non-vacuous", () => {
  deepStrictEqual(
    diagnosticIds("scripts/other.ts", "export const value = true;"),
    [],
    "non-target files are genuinely inapplicable",
  );
  deepStrictEqual(
    diagnosticIds("scripts/terraform-destroy-guard.ts", "export const value = true;"),
    [NO_UNSAFE_TERRAFORM_ALERT_PAYLOAD],
    "the target file cannot pass without an examined contract",
  );
});

const SAFE_TERRAFORM_ALERT_SOURCE = [
  "const SafeResourceSchema = z.object({",
  "  address: z.string().min(1).max(256).refine(isSafeTerraformAddress),",
  '  action: z.enum(["create", "update", "delete", "replace"]),',
  "}).strict();",
  "const SafeResourcesSchema = z.array(SafeResourceSchema);",
  "function parseSafeResources(input: string) {",
  "  return SafeResourcesSchema.parse(JSON.parse(input));",
  "}",
  "async function readAlertResources() {",
  '  const resources = parseSafeResources(await Deno.readTextFile("resources.json"));',
  "  return { resources, totalResources: resources.length };",
  "}",
  "function parseAlertIdentity(env: Record<string, string>, root: string) {",
  "  const repository = env.GITHUB_REPOSITORY;",
  "  const parsed = AlertRepositorySchema.safeParse(repository);",
  "  if (ALLOWED_REPOSITORY_ROOTS[parsed.data] !== root) return;",
  "  const runId = env.GITHUB_RUN_ID;",
  "  const eventName = env.GITHUB_EVENT_NAME;",
  "  return { fullRepository: repository, runId, trigger: eventName };",
  "}",
  "async function executeTerraformAlert(args: string[], dependencies: Record<string, unknown>) {",
  "  const options = parseSendArgs(args);",
  "  const root = options.root;",
  "  const identity = parseAlertIdentity(env, root);",
  '  if (identity === undefined) return failedAlert("notify-identity");',
  "  const runUrl = identity.fullRepository + identity.runId;",
  "  const pullRequestUrl = await readPullRequestUrl(env, identity.fullRepository);",
  "  const { resources, totalResources } = await readAlertResources();",
  "  const body = JSON.stringify({",
  '    kind: "terraform-alert",',
  "    trigger: identity.trigger,",
  "    repository: identity.repository,",
  "    root,",
  "    runId: identity.runId,",
  "    totalResources,",
  "    resources,",
  "    runUrl,",
  "    pullRequestUrl,",
  "  });",
  '  if (new TextEncoder().encode(body).length > MAX_ALERT_REQUEST_BYTES) return failedAlert("notify-resources");',
  "  await (dependencies.fetch ?? fetch)(notifyUrl, {",
  '    method: "POST",',
  "    headers: {",
  '      "x-repo-hygiene-terraform-trigger": identity.trigger,',
  '      "x-repo-hygiene-terraform-repository": identity.repository,',
  "    },",
  "    body,",
  "  });",
  "}",
].join("\n");

Deno.test("no-unsafe-terraform-alert-payload follows the actual body and fetch path", () => {
  deepStrictEqual(
    diagnosticIds("scripts/terraform-destroy-guard.ts", SAFE_TERRAFORM_ALERT_SOURCE),
    [],
  );
  const mutations = [
    SAFE_TERRAFORM_ALERT_SOURCE.replace(
      '"x-repo-hygiene-terraform-trigger": identity.trigger',
      '"x-repo-hygiene-terraform-trigger": "drift"',
    ),
    SAFE_TERRAFORM_ALERT_SOURCE.replace(
      "const SafeResourcesSchema = z.array(SafeResourceSchema);",
      "",
    ),
    SAFE_TERRAFORM_ALERT_SOURCE.replace(
      'if (new TextEncoder().encode(body).length > MAX_ALERT_REQUEST_BYTES) return failedAlert("notify-resources");',
      "void body;",
    ),
  ];
  strictEqual(mutations.length, 3, "F3 mutation cases must not be empty");
  for (const mutated of mutations) {
    strictEqual(mutated === SAFE_TERRAFORM_ALERT_SOURCE, false, "mutation changed no bytes");
    deepStrictEqual(
      diagnosticIds("scripts/terraform-destroy-guard.ts", mutated),
      [NO_UNSAFE_TERRAFORM_ALERT_PAYLOAD],
    );
  }
});

Deno.test("no-bare-cross-package-specifier reports violations", () => {
  const diagnostics = Deno.lint.runPlugin(
    plugin,
    "packages/example/src/mod.ts",
    [
      'import { one } from "@example/one";',
      'export * from "@example/two";',
      'export { three } from "@example/three";',
      'export { assert } from "@std/assert";',
    ].join("\n"),
  );

  deepStrictEqual(diagnostics.map((diagnostic) => diagnostic.id), [
    NO_BARE,
    NO_BARE,
    NO_BARE,
    NO_BARE,
  ]);
  strictEqual(
    diagnostics[0]?.message,
    "Packages must not import another package through a bare workspace specifier. Use that package's permitted boundary instead.",
  );
});

Deno.test("no-bare-cross-package-specifier accepts compliant source", () => {
  deepStrictEqual(
    diagnosticIds(
      "packages/example/src/mod.ts",
      [
        'import { local } from "./local.ts";',
        'export * from "jsr:@std/assert";',
        'export { join } from "node:path";',
      ].join("\n"),
    ),
    [],
  );
  deepStrictEqual(
    diagnosticIds(
      "packages/example/src/mod.test.ts",
      'import { helper } from "@example/test-helpers";',
    ),
    [],
  );
});

Deno.test("no-service-relative-package-import reports violations", () => {
  const diagnostics = Deno.lint.runPlugin(
    plugin,
    "services/example/src/mod.ts",
    [
      'import { one } from "../../../packages/one/mod.ts";',
      'export * from "../../../packages/two/mod.ts";',
      'export { three } from "../../../packages/three/mod.ts";',
    ].join("\n"),
  );

  deepStrictEqual(diagnostics.map((diagnostic) => diagnostic.id), [
    NO_SERVICE_RELATIVE,
    NO_SERVICE_RELATIVE,
    NO_SERVICE_RELATIVE,
  ]);
  strictEqual(
    diagnostics[0]?.message,
    "Services and apps must import packages through their declared package names, not relative paths into `packages/`.",
  );
});

Deno.test("no-service-relative-package-import accepts compliant source", () => {
  deepStrictEqual(
    diagnosticIds(
      "apps/example/src/mod.ts",
      [
        'import { local } from "../local.ts";',
        'export * from "@example/shared";',
        'export { join } from "node:path";',
      ].join("\n"),
    ),
    [],
  );
});

type ImportFormCase = {
  name: string;
  plugin: Deno.lint.Plugin;
  diagnostic: string;
  filename: string;
  specifier: string;
  staticSource: string;
  staticRanges: Array<[number, number]>;
};

const IMPORT_FORM_CASES: ImportFormCase[] = [
  {
    name: "no-bare-cross-package-specifier",
    plugin,
    diagnostic: NO_BARE,
    filename: "packages/example/src/mod.ts",
    specifier: "@example/one",
    staticSource:
      'import { one } from "@example/one";\nexport * from "@example/two";\nexport { three } from "@example/three";',
    staticRanges: [[20, 34], [50, 64], [88, 104]],
  },
  {
    name: "no-relative-cross-package-import",
    plugin: packagesPlugin,
    diagnostic: NO_RELATIVE,
    filename: "packages/one/src/mod.ts",
    specifier: "../../two/mod.ts",
    staticSource:
      'import { one } from "../../two/mod.ts";\nexport * from "../../three/mod.ts";\nexport { four } from "../../four/mod.ts";',
    staticRanges: [[20, 38], [54, 74], [97, 116]],
  },
  {
    name: "no-service-relative-package-import",
    plugin,
    diagnostic: NO_SERVICE_RELATIVE,
    filename: "services/example/src/mod.ts",
    specifier: "../../../packages/one/mod.ts",
    staticSource:
      'import { one } from "../../../packages/one/mod.ts";\nexport * from "../../../packages/two/mod.ts";\nexport { three } from "../../../packages/three/mod.ts";',
    staticRanges: [[20, 50], [66, 96], [120, 152]],
  },
];

Deno.test("the import-form rule matrix covers all three import-specifier rules", () => {
  strictEqual(IMPORT_FORM_CASES.length, 3, "import-form matrix must contain exactly three cases");
});

for (const testCase of IMPORT_FORM_CASES) {
  Deno.test(`${testCase.name} preserves static import and export diagnostics`, () => {
    const diagnostics = Deno.lint.runPlugin(
      testCase.plugin,
      testCase.filename,
      testCase.staticSource,
    );

    deepStrictEqual(
      diagnostics.map((diagnostic) => diagnostic.id),
      [testCase.diagnostic, testCase.diagnostic, testCase.diagnostic],
    );
    deepStrictEqual(
      diagnostics.map((diagnostic) => diagnostic.range),
      testCase.staticRanges,
    );
  });

  Deno.test(`${testCase.name} reports a literal dynamic import`, () => {
    deepStrictEqual(
      Deno.lint.runPlugin(
        testCase.plugin,
        testCase.filename,
        `await import("${testCase.specifier}");`,
      ).map((diagnostic) => diagnostic.id),
      [testCase.diagnostic],
    );
  });

  Deno.test(`${testCase.name} reports one type-position import diagnostic`, () => {
    const diagnostics = Deno.lint.runPlugin(
      testCase.plugin,
      testCase.filename,
      `type Imported = import("${testCase.specifier}").Thing;`,
    );
    deepStrictEqual(diagnostics.map((diagnostic) => diagnostic.id), [testCase.diagnostic]);
  });

  Deno.test(`${testCase.name} skips non-literal dynamic imports`, () => {
    deepStrictEqual(
      Deno.lint.runPlugin(
        testCase.plugin,
        testCase.filename,
        [
          "declare const specifier: string;",
          "await import(specifier);",
          `await import(\`${testCase.specifier}\`);`,
        ].join("\n"),
      ),
      [],
    );
  });
}

const PACKAGE_EXEMPTION_CASES = [
  {
    name: "no-bare-cross-package-specifier",
    plugin,
    diagnostic: NO_BARE,
    directory: "packages/example/src",
    specifier: "@example/one",
  },
  {
    name: "no-relative-cross-package-import",
    plugin: packagesPlugin,
    diagnostic: NO_RELATIVE,
    directory: "packages/one/src",
    specifier: "../../two/mod.ts",
  },
];

Deno.test("the package-rule exemption matrix covers both package rules", () => {
  strictEqual(
    PACKAGE_EXEMPTION_CASES.length,
    2,
    "package-rule exemption matrix must contain exactly two cases",
  );
});

for (const testCase of PACKAGE_EXEMPTION_CASES) {
  Deno.test(`${testCase.name} exempts both test suffixes for new import forms`, () => {
    const source = [
      `await import("${testCase.specifier}");`,
      `type Imported = import("${testCase.specifier}").Thing;`,
    ].join("\n");
    const filenames: Array<[string, string[]]> = [
      ["violation.ts", [testCase.diagnostic, testCase.diagnostic]],
      ["violation.test.ts", []],
      ["violation_test.ts", []],
    ];
    strictEqual(filenames.length, 3, "suffix matrix must contain exactly three cases");

    for (const [filename, expected] of filenames) {
      deepStrictEqual(
        Deno.lint.runPlugin(testCase.plugin, `${testCase.directory}/${filename}`, source)
          .map((diagnostic) => diagnostic.id),
        expected,
        filename,
      );
    }
  });
}
