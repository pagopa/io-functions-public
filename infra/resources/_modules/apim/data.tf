data "azurerm_key_vault_secret" "io_fn3_public_key_secret_v2" {
  name         = "fn3public-KEY-APIM"
  key_vault_id = var.key_vault_common_id
}