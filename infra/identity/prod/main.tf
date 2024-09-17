terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "<= 3.112.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "terraform-state-rg"
    storage_account_name = "tfappprodio"
    container_name       = "terraform-state"
    key                  = "io-functions-public.identity.tfstate"
  }
}

provider "azurerm" {
  features {
  }
}

module "federated_identities" {
  source = "github.com/pagopa/dx//infra/modules/azure_federated_identity_with_github?ref=main"

  prefix    = local.prefix
  env_short = local.env_short
  env       = local.env
  domain    = local.domain

  repositories = [local.repo_name]

  tags = local.tags
}

module "federated_identities_opex" {
  source = "github.com/pagopa/dx//infra/modules/azure_federated_identity_with_github?ref=main"

  prefix    = local.prefix
  env_short = local.env_short
  env       = "opex-${local.env}"
  domain    = "${local.domain}-opex"

  repositories = [local.repo_name]
  continuos_integration = {
    enable = true

    roles = {
      subscription = []
      resource_groups = {
        dashboards = [
          "Reader"
        ]
        terraform-state-rg = [
          "Reader and Data Access"
        ]
      }
    }
  }

  continuos_delivery = {
    enable = true

    roles = {
      subscription = []
      resource_groups = {
        dashboards = [
          "Contributor"
        ]
        terraform-state-rg = [
          "Storage Blob Data Contributor",
          "Reader and Data Access"
        ]
      }
    }
  }

  tags = local.tags
}

module "roles_ci" {
  source       = "github.com/pagopa/dx//infra/modules/azure_role_assignments?ref=main"
  principal_id = module.federated_identities.federated_ci_identity.id

  key_vault = [
    {
      name                = "io-p-kv-common"
      resource_group_name = "io-p-rg-common"
      roles = {
        secrets = "reader"
      }
    }
  ]
}

module "roles_cd" {
  source       = "github.com/pagopa/dx//infra/modules/azure_role_assignments?ref=main"
  principal_id = module.federated_identities.federated_cd_identity.id

  key_vault = [
    {
      name                = "io-p-kv-common"
      resource_group_name = "io-p-rg-common"
      roles = {
        secrets = "reader"
      }
    }
  ]
}