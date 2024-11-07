module "apim_itn" {
  source = "../_modules/apim"

  env_short = local.env_short

  apim_name                = data.azurerm_api_management.apim_itn.name
  apim_resource_group_name = data.azurerm_api_management.apim_itn.resource_group_name

  api_host_name       = "api.io.pagopa.it"
  key_vault_common_id = data.azurerm_key_vault.key_vault_common.id
}