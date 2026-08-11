/**
 * Default-on Deno lint rules for package boundaries in a registry package repository.
 *
 * @module
 */

import { noRelativeCrossPackageImportRule } from "./rules/no-relative-cross-package-import.ts";
import { noServiceRelativePackageImportRule } from "./rules/no-service-relative-package-import.ts";

/** Package-boundary rules for repositories that publish packages to a registry. */
const plugin: Deno.lint.Plugin = {
  name: "theozer",
  rules: {
    "no-relative-cross-package-import": noRelativeCrossPackageImportRule,
    "no-service-relative-package-import": noServiceRelativePackageImportRule,
  },
};

export default plugin;
