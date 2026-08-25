/**
 * Default-on Deno lint rules for package boundaries in a multi-repository fleet.
 *
 * @module
 */

import { noBareCrossPackageSpecifierRule } from "./rules/no-bare-cross-package-specifier.ts";
import { noServiceRelativePackageImportRule } from "./rules/no-service-relative-package-import.ts";
import { noTerraformAlertEnvRule } from "./rules/no-terraform-alert-env.ts";
import { noTerraformAlertPlacementRule } from "./rules/no-terraform-alert-placement.ts";
import { noTerraformContentGateRule } from "./rules/no-terraform-content-gate.ts";
import { noUnsafeTerraformAlertPayloadRule } from "./rules/no-unsafe-terraform-alert-payload.ts";

/** Default-on fleet rules for plain TypeScript repositories. */
const plugin: Deno.lint.Plugin = {
  name: "theozer",
  rules: {
    "no-bare-cross-package-specifier": noBareCrossPackageSpecifierRule,
    "no-service-relative-package-import": noServiceRelativePackageImportRule,
    "no-terraform-content-gate": noTerraformContentGateRule,
    "no-terraform-alert-placement": noTerraformAlertPlacementRule,
    "no-terraform-alert-env": noTerraformAlertEnvRule,
    "no-unsafe-terraform-alert-payload": noUnsafeTerraformAlertPayloadRule,
  },
};

export default plugin;
