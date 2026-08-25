/**
 * Default-on Deno lint rules for package boundaries in a registry package repository.
 *
 * @module
 */

import { noRelativeCrossPackageImportRule } from "./rules/no-relative-cross-package-import.ts";
import { noServiceRelativePackageImportRule } from "./rules/no-service-relative-package-import.ts";
import { noUnsafeTerraformAlertPayloadRule } from "./rules/no-unsafe-terraform-alert-payload.ts";

/** Default-on fleet rules for repositories that publish packages to a registry. */
const plugin: Deno.lint.Plugin = {
  name: "theozer",
  rules: {
    "no-relative-cross-package-import": noRelativeCrossPackageImportRule,
    "no-service-relative-package-import": noServiceRelativePackageImportRule,
    "no-unsafe-terraform-alert-payload": noUnsafeTerraformAlertPayloadRule,
  },
};

export default plugin;
