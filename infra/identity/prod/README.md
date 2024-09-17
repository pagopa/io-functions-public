# IO Functions Public - GitHub federated Managed Identities

<!-- markdownlint-disable -->
<!-- BEGINNING OF PRE-COMMIT-TERRAFORM DOCS HOOK -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_azurerm"></a> [azurerm](#requirement\_azurerm) | <= 3.112.0 |

## Providers

No providers.

## Modules

| Name | Source | Version |
|------|--------|---------|
| <a name="module_federated_identities"></a> [federated\_identities](#module\_federated\_identities) | github.com/pagopa/dx//infra/modules/azure_federated_identity_with_github | main |
| <a name="module_federated_identities_opex"></a> [federated\_identities\_opex](#module\_federated\_identities\_opex) | github.com/pagopa/dx//infra/modules/azure_federated_identity_with_github | main |
| <a name="module_roles_cd"></a> [roles\_cd](#module\_roles\_cd) | github.com/pagopa/dx//infra/modules/azure_role_assignments | main |
| <a name="module_roles_ci"></a> [roles\_ci](#module\_roles\_ci) | github.com/pagopa/dx//infra/modules/azure_role_assignments | main |

## Resources

No resources.

## Inputs

No inputs.

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_federated_cd_identity"></a> [federated\_cd\_identity](#output\_federated\_cd\_identity) | n/a |
| <a name="output_federated_ci_identity"></a> [federated\_ci\_identity](#output\_federated\_ci\_identity) | n/a |
<!-- END OF PRE-COMMIT-TERRAFORM DOCS HOOK -->