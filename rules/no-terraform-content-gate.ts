import {
  TERRAFORM_WORKFLOW_ANCHOR,
  terraformWorkflowContract,
} from "./terraform-workflow-contract.ts";

type LintRule = Deno.lint.Plugin["rules"][string];

export const noTerraformContentGateRule: LintRule = {
  create(context) {
    if (!context.filename.replaceAll("\\", "/").endsWith(TERRAFORM_WORKFLOW_ANCHOR)) return {};
    return {
      Program(node) {
        const finding = terraformWorkflowContract(context.filename).c3;
        if (finding !== undefined) {
          context.report({
            node,
            message: `Terraform content gates must cover the tracked Terraform roots. ${finding}.`,
          });
        }
      },
    };
  },
};
