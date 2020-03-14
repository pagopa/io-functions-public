import { Context } from "@azure/functions";
import { createTableService } from "azure-storage";

import * as express from "express";
import * as winston from "winston";

import { isLeft } from "fp-ts/lib/Either";

import { DocumentClient as DocumentDBClient } from "documentdb";

import { UrlFromString } from "italia-ts-commons/lib/url";

import { VALIDATION_TOKEN_TABLE_NAME } from "io-functions-commons/dist/src/entities/validation_token";
import {
  PROFILE_COLLECTION_NAME,
  ProfileModel
} from "io-functions-commons/dist/src/models/profile";
import * as documentDbUtils from "io-functions-commons/dist/src/utils/documentdb";
import { getRequiredStringEnv } from "io-functions-commons/dist/src/utils/env";
import { secureExpressApp } from "io-functions-commons/dist/src/utils/express";
import { AzureContextTransport } from "io-functions-commons/dist/src/utils/logging";
import { setAppContext } from "io-functions-commons/dist/src/utils/middlewares/context_middleware";

import createAzureFunctionHandler from "io-functions-express/dist/src/createAzureFunctionsHandler";

import { ValidateProfileEmail } from "./handler";

// Setup Express
const app = express();
secureExpressApp(app);

const storageConnectionString = getRequiredStringEnv("StorageConnection");
const cosmosDbUri = getRequiredStringEnv("COSMOSDB_URI");
const cosmosDbKey = getRequiredStringEnv("COSMOSDB_KEY");
const cosmosDbName = getRequiredStringEnv("COSMOSDB_NAME");

const validationCallbackUrl = getRequiredStringEnv("VALIDATION_CALLBACK_URL");
const errorOrValidationCallbackValidUrl = UrlFromString.decode(
  validationCallbackUrl
);
if (isLeft(errorOrValidationCallbackValidUrl)) {
  throw Error("VALIDATION_CALLBACK_URL must be a valid url");
}
const validationCallbackValidUrl = errorOrValidationCallbackValidUrl.value;

const tableService = createTableService(storageConnectionString);

const documentClient = new DocumentDBClient(cosmosDbUri, {
  masterKey: cosmosDbKey
});
const documentDbDatabaseUrl = documentDbUtils.getDatabaseUri(cosmosDbName);
const profilesCollectionUrl = documentDbUtils.getCollectionUri(
  documentDbDatabaseUrl,
  PROFILE_COLLECTION_NAME
);
const profileModel = new ProfileModel(documentClient, profilesCollectionUrl);

app.get(
  "/validate-profile-email",
  ValidateProfileEmail(
    tableService,
    VALIDATION_TOKEN_TABLE_NAME,
    profileModel,
    validationCallbackValidUrl,
    Date.now
  )
);

const azureFunctionHandler = createAzureFunctionHandler(app);

// tslint:disable-next-line: no-let
let logger: Context["log"] | undefined;
const contextTransport = new AzureContextTransport(() => logger, {
  level: "debug"
});
winston.add(contextTransport);

// Binds the express app to an Azure Function handler
function httpStart(context: Context): void {
  logger = context.log;
  setAppContext(app, context);
  azureFunctionHandler(context);
}

export default httpStart;
