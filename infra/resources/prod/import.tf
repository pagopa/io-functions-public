import {
  to = module.apim_weu.azurerm_api_management_named_value.io_fn3_public_key_v2
  id = "/subscriptions/ec285037-c673-4f58-b594-d7c480da4e8b/resourceGroups/io-p-rg-internal/providers/Microsoft.ApiManagement/service/io-p-apim-v2-api/namedValues/io-fn3-public-key"
}

import {
  to = module.apim_weu.azurerm_api_management_named_value.io_fn3_public_url_v2
  id = "/subscriptions/ec285037-c673-4f58-b594-d7c480da4e8b/resourceGroups/io-p-rg-internal/providers/Microsoft.ApiManagement/service/io-p-apim-v2-api/namedValues/io-fn3-public-url"
}

import {
  to = module.apim_weu.module.api_v2_public.azurerm_api_management_api.this
  id = "/subscriptions/ec285037-c673-4f58-b594-d7c480da4e8b/resourceGroups/io-p-rg-internal/providers/Microsoft.ApiManagement/service/io-p-apim-v2-api/apis/io-public-api;rev=1"
}

import {
  to = module.apim_weu.module.api_v2_public.azurerm_api_management_api_policy.this[0]
  id = "/subscriptions/ec285037-c673-4f58-b594-d7c480da4e8b/resourceGroups/io-p-rg-internal/providers/Microsoft.ApiManagement/service/io-p-apim-v2-api/apis/io-public-api"
}

import {
  to = module.apim_weu.module.api_v2_public.azurerm_api_management_product_api.this["io-public-api"]
  id = "/subscriptions/ec285037-c673-4f58-b594-d7c480da4e8b/resourceGroups/io-p-rg-internal/providers/Microsoft.ApiManagement/service/io-p-apim-v2-api/products/io-public-api/apis/io-public-api"
}

import {
  to = module.apim_weu.module.apim_v2_product_public.azurerm_api_management_product.this
  id = "/subscriptions/ec285037-c673-4f58-b594-d7c480da4e8b/resourceGroups/io-p-rg-internal/providers/Microsoft.ApiManagement/service/io-p-apim-v2-api/products/io-public-api"
}

import {
  to = module.apim_weu.module.apim_v2_product_public.azurerm_api_management_product_policy.this[0]
  id = "/subscriptions/ec285037-c673-4f58-b594-d7c480da4e8b/resourceGroups/io-p-rg-internal/providers/Microsoft.ApiManagement/service/io-p-apim-v2-api/products/io-public-api"
}
