locals {
  github = {
    org        = "pagopa"
    repository = "io-functions-public"
  }

  repo_secrets = {
    "AZURE_SUBSCRIPTION_ID" = data.azurerm_subscription.current.subscription_id
    "AZURE_TENANT_ID"       = data.azurerm_subscription.current.tenant_id
  }

  env_secrets_ci = {
    "AZURE_CLIENT_ID_CI" = module.identity_ci.identity_client_id
  }

  env_secrets_cd = {
    "AZURE_CLIENT_ID_CD" = module.identity_cd.identity_client_id
  }
}
