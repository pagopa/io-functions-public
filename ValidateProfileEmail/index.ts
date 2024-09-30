import { CosmosClient } from "@azure/cosmos";
import { Context } from "@azure/functions";
import { createTableService } from "azure-storage";

import * as express from "express";
import * as winston from "winston";

import { isLeft } from "fp-ts/lib/Either";

import { UrlFromString } from "@pagopa/ts-commons/lib/url";

import { VALIDATION_TOKEN_TABLE_NAME } from "@pagopa/io-functions-commons/dist/src/entities/validation_token";
import {
  PROFILE_COLLECTION_NAME,
  ProfileModel
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import { secureExpressApp } from "@pagopa/io-functions-commons/dist/src/utils/express";
import { AzureContextTransport } from "@pagopa/io-functions-commons/dist/src/utils/logging";
import { setAppContext } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware";

import createAzureFunctionHandler from "@pagopa/express-azure-functions/dist/src/createAzureFunctionsHandler";

import { DataTableProfileEmailsRepository } from "@pagopa/io-functions-commons/dist/src/utils/unique_email_enforcement/storage";
import { getConfigOrThrow } from "../utils/config";
import { profileEmailTableClient } from "../utils/unique_email_enforcement";
import { ValidateProfileEmail } from "./handler";

const config = getConfigOrThrow();

// Setup Express
const app = express();
secureExpressApp(app);

const errorOrValidationCallbackValidUrl = UrlFromString.decode(
  config.VALIDATION_CALLBACK_URL
);
if (isLeft(errorOrValidationCallbackValidUrl)) {
  throw Error("VALIDATION_CALLBACK_URL must be a valid url");
}
const validationCallbackValidUrl = errorOrValidationCallbackValidUrl.right;

const tableService = createTableService(config.StorageConnection);

const cosmosClient = new CosmosClient({
  endpoint: config.COSMOSDB_URI,
  key: config.COSMOSDB_KEY
});

const profilesContainer = cosmosClient
  .database(config.COSMOSDB_NAME)
  .container(PROFILE_COLLECTION_NAME);

const profileModel = new ProfileModel(profilesContainer);

const profileEmailsReader = new DataTableProfileEmailsRepository(
  profileEmailTableClient
);

app.get(
  "/validate-profile-email",
  ValidateProfileEmail(
    tableService,
    VALIDATION_TOKEN_TABLE_NAME,
    profileModel,
    {
      confirmValidationUrl: config.CONFIRM_CHOICE_PAGE_URL,
      validationCallbackUrl: validationCallbackValidUrl
    },
    profileEmailsReader
  )
);

const azureFunctionHandler = createAzureFunctionHandler(app);

// eslint-disable-next-line functional/no-let
let logger: Context["log"] | undefined;
const contextTransport = new AzureContextTransport(() => logger, {
  level: "debug"
});
winston.add(contextTransport);

// Binds the express app to an Azure Function handler
const httpStart = (context: Context): void => {
  logger = context.log;
  setAppContext(app, context);
  azureFunctionHandler(context);
};

export default httpStart;
