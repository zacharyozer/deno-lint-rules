/** The rule implementation for `theozer/no-unsafe-terraform-alert-payload`. */

import { firstTerraformAlertContractViolation } from "./terraform-alert-contract.ts";

const MESSAGE = "Terraform alert senders must validate and send the safe alert payload contract.";

const HINT = "Keep the strict SafeResource schema, identity-derived payload and routing headers, " +
  "and request-size bound on the actual fetch path.";

const TARGET_SUFFIX = "/scripts/terraform-destroy-guard.ts";
type LintRule = Deno.lint.Plugin["rules"][string];

function isTargetFile(filename: string): boolean {
  const normalized = "/" + filename.replaceAll("\\", "/").replace(/^\/+/, "");
  return normalized.endsWith(TARGET_SUFFIX);
}

/** Reports unsafe Terraform alert senders only for the file whose contract is being checked. */
export const noUnsafeTerraformAlertPayloadRule: LintRule = {
  create(context) {
    if (!isTargetFile(context.filename)) return {};
    return {
      Program(node) {
        const violation = firstTerraformAlertContractViolation(context.sourceCode.getText(node));
        if (violation === undefined) return;
        context.report({ node, message: `${MESSAGE} ${violation}.`, hint: HINT });
      },
    };
  },
};
