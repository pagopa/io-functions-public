module "identity_cd" {
  source = "github.com/pagopa/terraform-azurerm-v3//github_federated_identity?ref=v7.47.2"

  prefix    = var.prefix
  env_short = var.env_short
  domain    = var.domain

  identity_role = "cd"

  github_federations = [
    {
      repository = local.github.repository
      subject    = github_repository_environment.prod_opex_cd.environment
    }
  ]

  cd_rbac_roles = {
    subscription_roles = var.opex_environment_cd_roles.subscription
    resource_groups    = var.opex_environment_cd_roles.resource_groups
  }

  tags = var.tags
}
