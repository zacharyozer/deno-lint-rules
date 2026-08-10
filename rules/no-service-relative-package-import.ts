/** The rule implementation for `theozer/no-service-relative-package-import`. */

const MESSAGE = "Services and apps must import packages through their declared package " +
  "names, not relative paths into `packages/`.";

const HINT = "Replace the relative specifier with the package's declared import name.";

type SourceDeclaration = {
  source?: { value?: unknown } | null;
};

function normalize(filename: string): string {
  return "/" + filename.replaceAll("\\", "/").replace(/^\/+/, "");
}

function sourceRoot(filename: string): string | null {
  const match = filename.match(/^(.*\/)(?:services|apps)\//);
  return match?.[1] ?? null;
}

function resolveRelative(filename: string, specifier: string): string {
  const directory = filename.slice(0, filename.lastIndexOf("/") + 1);
  const parts: string[] = [];
  for (const part of (directory + specifier).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return "/" + parts.join("/");
}

function isRelativePackageImport(filename: string, specifier: string): boolean {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return false;
  }

  const normalized = normalize(filename);
  const root = sourceRoot(normalized);
  if (root === null) return false;
  return resolveRelative(normalized, specifier).startsWith(`${root}packages/`);
}

type LintRule = Deno.lint.Plugin["rules"][string];

/** Reports relative service and app imports that reach into `packages/`. */
export const noServiceRelativePackageImportRule: LintRule = {
  create(context) {
    const check = (node: SourceDeclaration) => {
      const specifier = node.source?.value;
      if (
        typeof specifier !== "string" ||
        !isRelativePackageImport(context.filename, specifier)
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
