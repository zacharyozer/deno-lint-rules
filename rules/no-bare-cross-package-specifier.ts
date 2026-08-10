/** The rule implementation for `theozer/no-bare-cross-package-specifier`. */

const MESSAGE = "Packages must not import another package through a bare workspace " +
  "specifier. Use that package's permitted boundary instead.";

const HINT = "Replace the bare scoped specifier with an explicit `jsr:`, `npm:`, or " +
  "allowed dependency path for this package.";

function isPackageFile(filename: string): boolean {
  const normalized = "/" + filename.replaceAll("\\", "/").replace(/^\/+/, "");
  // Test modules are outside published consumer import graphs, so their bare
  // specifiers cannot break resolution for a package consumer.
  return normalized.includes("/packages/") && !normalized.endsWith(".test.ts");
}

function isBareScopedPackageSpecifier(specifier: string): boolean {
  return /^@[^/]+\/[^/]+/.test(specifier);
}

type LintRule = Deno.lint.Plugin["rules"][string];

/** Reports bare scoped package specifiers from publishable package modules. */
export const noBareCrossPackageSpecifierRule: LintRule = {
  create(context) {
    if (!isPackageFile(context.filename)) return {};

    const check = (node: { source?: { value?: unknown } | null }) => {
      const specifier = node.source?.value;
      if (
        typeof specifier !== "string" ||
        !isBareScopedPackageSpecifier(specifier)
      ) {
        return;
      }
      context.report({
        node: node.source as Deno.lint.Node,
        message: MESSAGE,
        hint: HINT,
      });
    };

    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
};
