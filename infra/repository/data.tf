data "azurerm_user_assigned_identity" "identity_prod_ci" {
  name                = "${local.project}-functions-public-github-ci-identity"
  resource_group_name = local.identity_resource_group_name
}

data "azurerm_user_assigned_identity" "identity_prod_cd" {
  name                = "${local.project}-functions-public-github-cd-identity"
  resource_group_name = local.identity_resource_group_name
}

data "azurerm_user_assigned_identity" "identity_opex_prod_ci" {
  name                = "${local.project}-functions-public-opex-github-ci-identity"
  resource_group_name = local.identity_resource_group_name
}

data "azurerm_user_assigned_identity" "identity_opex_prod_cd" {
  name                = "${local.project}-functions-public-opex-github-cd-identity"
  resource_group_name = local.identity_resource_group_name
}

data "github_organization_teams" "all" {
  root_teams_only = true
  summary_only    = true
}
