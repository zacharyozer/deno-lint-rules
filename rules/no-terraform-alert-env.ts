import {
  TERRAFORM_WORKFLOW_ANCHOR,
  terraformWorkflowContract,
} from "./terraform-workflow-contract.ts";

type LintRule = Deno.lint.Plugin["rules"][string];

export const noTerraformAlertEnvRule: LintRule = {
  create(context) {
    if (!context.filename.replaceAll("\\", "/").endsWith(TERRAFORM_WORKFLOW_ANCHOR)) return {};
    return {
      Program(node) {
        const finding = terraformWorkflowContract(context.filename).f4;
        if (finding !== undefined) {
          context.report({
            node,
            message:
              `Terraform alert --allow-env grants must match the guard module graph. ${finding}.`,
          });
        }
      },
    };
  },
};
