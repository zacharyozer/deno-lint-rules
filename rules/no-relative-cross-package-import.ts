/** The rule implementation for `theozer/no-relative-cross-package-import`. */

import { extractLiteralImportSpecifier } from "./import-specifier.ts";

const MESSAGE = "Packages must not import another package through a relative path. " +
  "Use that package's declared workspace specifier instead.";

const HINT = "Replace the relative cross-package path with the target package's npm " +
  "specifier and declare it as a direct dependency.";

function isPackageFile(filename: string): boolean {
  const normalized = "/" + filename.replaceAll("\\", "/").replace(/^\/+/, "");
  // Test modules are outside published consumer import graphs, so this
  // production boundary guard does not inspect them.
  // Both conventional Deno test suffixes. Exempting only ".test.ts" missed
  // "_test.ts", which is the more common convention — it accounted for 157 of
  // one repository's 296 diagnostics, and repo-hygiene (which ships these rules)
  // uses "_test.ts" for all 204 of its test files.
  if (normalized.endsWith(".test.ts") || normalized.endsWith("_test.ts")) {
    return false;
  }
  return normalized.includes("/packages/");
}

function packageOwner(path: string): string | undefined {
  const segments = normalizePath(path).split("/");
  const packages = segments.lastIndexOf("packages");
  const owner = segments[packages + 1];
  return packages < 0 || owner === undefined ? undefined : `packages/${owner}`;
}

function relativeCrossesPackageBoundary(
  filename: string,
  specifier: string,
): boolean {
  if (!specifier.startsWith(".")) return false;
  const from = packageOwner(filename);
  const to = packageOwner(`${dirname(filename)}/${specifier}`);
  return from !== undefined && to !== undefined && from !== to;
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "." : path.slice(0, slash);
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

type LintRule = Deno.lint.Plugin["rules"][string];

/** Reports relative imports that cross from one publishable package into another. */
export const noRelativeCrossPackageImportRule: LintRule = {
  create(context) {
    if (!isPackageFile(context.filename)) return {};

    // The source plugin retained a legacy rule ID because its root lint
    // configuration was already deployed. This package names the npm-era
    // contract accurately: it forbids relative package crossings; bare
    // workspace specifiers are the required boundary.
    const check = (node: unknown) => {
      const specifier = extractLiteralImportSpecifier(node);
      if (
        specifier === undefined || !relativeCrossesPackageBoundary(
          context.filename,
          specifier.value,
        )
      ) {
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
