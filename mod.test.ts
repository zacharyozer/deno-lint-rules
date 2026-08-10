import { deepStrictEqual, strictEqual } from "node:assert";

import plugin from "./mod.ts";

const NO_BARE = "theozer/no-bare-cross-package-specifier";
const NO_SERVICE_RELATIVE = "theozer/no-service-relative-package-import";

function diagnosticIds(filename: string, source: string): string[] {
  return Deno.lint.runPlugin(plugin, filename, source).map((diagnostic) => diagnostic.id);
}

Deno.test("the aggregate enables every rule by default", () => {
  deepStrictEqual(Object.keys(plugin.rules).sort(), [
    "no-bare-cross-package-specifier",
    "no-service-relative-package-import",
  ]);
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
