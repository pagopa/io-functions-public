/**
 * Config module
 *
 * Single point of access for the application confguration. Handles validation on required environment variables.
 * The configuration is evaluate eagerly at the first access to the module. The module exposes convenient methods to access such value.
 */
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { FiscalCode, NonEmptyString } from "@pagopa/ts-commons/lib/strings";

import { withFallback, JsonFromString } from "io-ts-types";

import {
  FeatureFlag,
  FeatureFlagEnum
} from "@pagopa/ts-commons/lib/featureFlag";

import { pipe } from "fp-ts/lib/function";
import * as t from "io-ts";
import * as E from "fp-ts/lib/Either";
import { UrlFromString } from "@pagopa/ts-commons/lib/url";

export const BetaUsers = t.readonlyArray(FiscalCode);
export type BetaUsers = t.TypeOf<typeof BetaUsers>;

export const BetaUsersFromString = withFallback(
  t.string.pipe(JsonFromString),
  []
).pipe(BetaUsers);

export const FeatureFlagFromString = withFallback(
  FeatureFlag,
  FeatureFlagEnum.NONE
);

export const IConfig = t.type({
  APPINSIGHTS_INSTRUMENTATIONKEY: NonEmptyString,

  COSMOSDB_KEY: NonEmptyString,
  COSMOSDB_NAME: NonEmptyString,
  COSMOSDB_URI: NonEmptyString,

  FF_UNIQUE_EMAIL_ENFORCEMENT: FeatureFlagFromString,

  PROFILE_EMAIL_STORAGE_CONNECTION_STRING: NonEmptyString,
  PROFILE_EMAIL_STORAGE_TABLE_NAME: NonEmptyString,

  StorageConnection: NonEmptyString,

  UNIQUE_EMAIL_ENFORCEMENT_USERS: BetaUsersFromString,
  VALIDATION_CALLBACK_URL: NonEmptyString,
  CONFIRM_CHOICE_PAGE_URL: UrlFromString,

  isProduction: t.boolean
});

// global app configuration
export type IConfig = t.TypeOf<typeof IConfig>;

// No need to re-evaluate this object for each call
const errorOrConfig: t.Validation<IConfig> = IConfig.decode({
  ...process.env,
  isProduction: process.env.NODE_ENV === "production"
});

/**
 * Read the application configuration and check for invalid values.
 * Configuration is eagerly evalued when the application starts.
 *
 * @returns either the configuration values or a list of validation errors
 */
export const getConfig = (): t.Validation<IConfig> => errorOrConfig;

/**
 * Read the application configuration and check for invalid values.
 * If the application is not valid, raises an exception.
 *
 * @returns the configuration values
 * @throws validation errors found while parsing the application configuration
 */
export const getConfigOrThrow = (): IConfig =>
  pipe(
    errorOrConfig,
    E.getOrElseW(errors => {
      throw new Error(`Invalid configuration: ${readableReport(errors)}`);
    })
  );
