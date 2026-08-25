import {
  TERRAFORM_WORKFLOW_ANCHOR,
  terraformWorkflowContract,
} from "./terraform-workflow-contract.ts";

type LintRule = Deno.lint.Plugin["rules"][string];

export const noTerraformAlertPlacementRule: LintRule = {
  create(context) {
    if (!context.filename.replaceAll("\\", "/").endsWith(TERRAFORM_WORKFLOW_ANCHOR)) return {};
    return {
      Program(node) {
        const finding = terraformWorkflowContract(context.filename).f1;
        if (finding !== undefined) {
          context.report({
            node,
            message:
              `Terraform alerts must have exactly one PR and one scheduled sender per root. ${finding}.`,
          });
        }
      },
    };
  },
};
