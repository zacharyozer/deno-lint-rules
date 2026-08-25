import { deepStrictEqual, match, ok, strictEqual } from "node:assert";

import packagesPlugin from "./packages.ts";

const PLUGIN_DIAGNOSTIC = /theozer\/[^\s)]+/;
const ROOT = new URL(".", import.meta.url);

type Entry = "plain" | "packages";

type FixtureCase = {
  entry: Entry;
  fixture: string;
  diagnostic: string | null;
};

const CASES: FixtureCase[] = [
  {
    entry: "plain",
    fixture: "relative-cross-package.ts",
    diagnostic: null,
  },
  {
    entry: "packages",
    fixture: "relative-cross-package.ts",
    diagnostic: "theozer/no-relative-cross-package-import",
  },
  {
    entry: "plain",
    fixture: "bare-cross-package.ts",
    diagnostic: "theozer/no-bare-cross-package-specifier",
  },
  {
    entry: "packages",
    fixture: "bare-cross-package.ts",
    diagnostic: null,
  },
  {
    entry: "plain",
    fixture: "intra-package-relative.ts",
    diagnostic: null,
  },
  {
    entry: "packages",
    fixture: "intra-package-relative.ts",
    diagnostic: null,
  },
  {
    entry: "plain",
    fixture: "service-relative-package.ts",
    diagnostic: "theozer/no-service-relative-package-import",
  },
  {
    entry: "packages",
    fixture: "service-relative-package.ts",
    diagnostic: "theozer/no-service-relative-package-import",
  },
  {
    entry: "plain",
    fixture: "service-declared-package.ts",
    diagnostic: null,
  },
  {
    entry: "packages",
    fixture: "service-declared-package.ts",
    diagnostic: null,
  },
];

Deno.test("the packages aggregate enables every rule by default", () => {
  deepStrictEqual(Object.keys(packagesPlugin.rules).sort(), [
    "no-relative-cross-package-import",
    "no-service-relative-package-import",
    "no-unsafe-terraform-alert-payload",
  ]);
});

function fixturePath(fixture: string): string {
  const directory = fixture.startsWith("service-")
    ? "testdata/fixtures/services/example/"
    : "testdata/fixtures/packages/one/src/";
  return new URL(directory + fixture, ROOT).pathname;
}

async function lint(testCase: FixtureCase): Promise<{
  code: number;
  output: string;
}> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "lint",
      `--config=${new URL(`testdata/configs/${testCase.entry}.json`, ROOT).pathname}`,
      fixturePath(testCase.fixture),
    ],
    cwd: ROOT,
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    output: decoder.decode(result.stdout) + decoder.decode(result.stderr),
  };
}

Deno.test("the CLI fixture matrix is non-vacuous", () => {
  strictEqual(CASES.length, 10);
  strictEqual(new Set(CASES.map((testCase) => testCase.fixture)).size, 5);
});

for (const testCase of CASES) {
  Deno.test({
    name: `${testCase.entry} entry ${
      testCase.diagnostic === null ? "accepts" : "flags"
    } ${testCase.fixture}`,
    permissions: { run: true },
    async fn() {
      ok(CASES.length > 0, "fixture matrix must examine at least one case");
      const result = await lint(testCase);

      if (testCase.diagnostic === null) {
        strictEqual(result.code, 0, result.output);
        strictEqual(PLUGIN_DIAGNOSTIC.test(result.output), false, result.output);
        return;
      }

      ok(result.code !== 0, result.output);
      match(result.output, new RegExp(`\\b${testCase.diagnostic}\\b`));
    },
  });
}

Deno.test("both conventional Deno test suffixes are exempt, non-test still flags", async () => {
  // Exempting only ".test.ts" missed "_test.ts", the more common convention.
  // That was 157 of one repository's 296 diagnostics, and repo-hygiene — which
  // ships these rules — names all 204 of its test files "_test.ts".
  const cases: Array<[string, boolean]> = [
    ["violation.ts", true],
    ["violation.test.ts", false],
    ["violation_test.ts", false],
  ];
  strictEqual(cases.length, 3, "exemption fixture list must not be empty");

  const root = await Deno.makeTempDir({ prefix: "lint-exempt-" });
  try {
    await Deno.mkdir(`${root}/packages/alpha/src`, { recursive: true });
    await Deno.mkdir(`${root}/packages/beta`, { recursive: true });
    await Deno.writeTextFile(`${root}/packages/beta/mod.ts`, "export const b = 1;\n");
    for (const [name] of cases) {
      await Deno.writeTextFile(
        `${root}/packages/alpha/src/${name}`,
        'import { b } from "../../beta/mod.ts";\nexport const c = b;\n',
      );
    }
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        lint: { plugins: [new URL("./packages.ts", import.meta.url).href] },
      }),
    );
    const out = await new Deno.Command("deno", {
      args: ["lint", "--json"],
      cwd: root,
      stdout: "piped",
      stderr: "null",
    }).output();
    const flagged = new Set(
      (JSON.parse(new TextDecoder().decode(out.stdout)).diagnostics ?? [])
        .map((d: { filename: string }) => d.filename.split("/").pop()),
    );
    for (const [name, shouldFlag] of cases) {
      strictEqual(flagged.has(name), shouldFlag, `${name} flagged=${flagged.has(name)}`);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
