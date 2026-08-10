/**
 * Default-on Deno lint rules for package boundaries in a multi-repository fleet.
 *
 * @module
 */

import { noBareCrossPackageSpecifierRule } from "./rules/no-bare-cross-package-specifier.ts";
import { noServiceRelativePackageImportRule } from "./rules/no-service-relative-package-import.ts";

/** Both fleet package-boundary rules, enabled by default. */
const plugin: Deno.lint.Plugin = {
  name: "theozer",
  rules: {
    "no-bare-cross-package-specifier": noBareCrossPackageSpecifierRule,
    "no-service-relative-package-import": noServiceRelativePackageImportRule,
  },
};

export default plugin;
