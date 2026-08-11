/** The rule implementation for `theozer/no-bare-cross-package-specifier`. */

import { extractLiteralImportSpecifier } from "./import-specifier.ts";

const MESSAGE = "Packages must not import another package through a bare workspace " +
  "specifier. Use that package's permitted boundary instead.";

const HINT = "Replace the bare scoped specifier with an explicit `jsr:`, `npm:`, or " +
  "allowed dependency path for this package.";

function isPackageFile(filename: string): boolean {
  const normalized = "/" + filename.replaceAll("\\", "/").replace(/^\/+/, "");
  // Test modules are outside published consumer import graphs, so their bare
  // specifiers cannot break resolution for a package consumer.
  // Both conventional Deno test suffixes. Exempting only ".test.ts" missed
  // "_test.ts", which is the more common convention — it accounted for 157 of
  // one repository's 296 diagnostics, and repo-hygiene (which ships these rules)
  // uses "_test.ts" for all 204 of its test files.
  if (normalized.endsWith(".test.ts") || normalized.endsWith("_test.ts")) {
    return false;
  }
  return normalized.includes("/packages/");
}

function isBareScopedPackageSpecifier(specifier: string): boolean {
  return /^@[^/]+\/[^/]+/.test(specifier);
}

type LintRule = Deno.lint.Plugin["rules"][string];

/** Reports bare scoped package specifiers from publishable package modules. */
export const noBareCrossPackageSpecifierRule: LintRule = {
  create(context) {
    if (!isPackageFile(context.filename)) return {};

    const check = (node: unknown) => {
      const specifier = extractLiteralImportSpecifier(node);
      if (specifier === undefined || !isBareScopedPackageSpecifier(specifier.value)) {
        return;
      }
      context.report({
        node: specifier.node,
        message: MESSAGE,
        hint: HINT,
      });
    };

    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportExpression: check,
      TSImportType: check,
    };
  },
};
