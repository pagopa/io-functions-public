# IO publicly accessible Functions

This project implements the APIs that must be publicly accessible.
The implementation is based on the Azure Functions v2 runtime.

## Contributing

### Setup

Install the [Azure Functions Core Tools](https://github.com/Azure/azure-functions-core-tools).

Install the dependencies:

```
$ yarn install
```

Create a file `local.settings.json` in your cloned repo, with the
following contents:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "<FILL_ME>",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "APPINSIGHTS_INSTRUMENTATIONKEY": "<FILL_ME>",
    "COSMOSDB_NAME": "<FILL_ME>",
    "CUSTOMCONNSTR_COSMOSDB_KEY": "<FILL_ME>",
    "CUSTOMCONNSTR_COSMOSDB_URI": "<FILL_ME>",
    "StorageConnection": "<FILL_ME>",
    "VERIFICATION_TOKENS_TABLE_NAME": "<FILL_ME>",
    "VERIFICATION_CALLBACK_URL": "<FILL_ME>"
  }
}
```

### Starting the functions runtime

```
$ yarn start
```

The server should reload automatically when the code changes.

