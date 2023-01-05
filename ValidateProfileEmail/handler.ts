import * as crypto from "crypto";

import * as express from "express";

import { isLeft } from "fp-ts/lib/Either";
import { isNone } from "fp-ts/lib/Option";

import * as t from "io-ts";

import { Context } from "@azure/functions";
import { TableService } from "azure-storage";

import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import {
  IResponseErrorValidation,
  IResponseSeeOtherRedirect,
  ResponseSeeOtherRedirect
} from "@pagopa/ts-commons/lib/responses";
import { PatternString } from "@pagopa/ts-commons/lib/strings";

import { RequiredQueryParamMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/required_query_param";

import { ValidationTokenEntity } from "@pagopa/io-functions-commons/dist/src/entities/validation_token";
import { ProfileModel } from "@pagopa/io-functions-commons/dist/src/models/profile";
import { retrieveTableEntity } from "@pagopa/io-functions-commons/dist/src/utils/azure_storage";
import { ContextMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "@pagopa/io-functions-commons/dist/src/utils/request_middleware";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";

// Tokens are generated by CreateValidationTokenActivity function inside the
// io-functions-app project (https://github.com/pagopa/io-functions-app)
// A token is in the following format:
// [tokenId ULID] + ":" + [validatorHash crypto.randomBytes(12)]
export const TokenQueryParam = PatternString(
  "^[A-Za-z0-9]{26}:[A-Fa-f0-9]{24}$"
);
export type TokenQueryParam = t.TypeOf<typeof TokenQueryParam>;

type IValidateProfileEmailHandler = (
  context: Context,
  token: TokenQueryParam
) => Promise<IResponseSeeOtherRedirect | IResponseErrorValidation>;

// Used in the callback
export enum ValidationErrors {
  GENERIC_ERROR = "GENERIC_ERROR",
  INVALID_TOKEN = "INVALID_TOKEN",
  TOKEN_EXPIRED = "TOKEN_EXPIRED"
}

/**
 * Returns a ValidUrl that represents a successful validation
 */
const validationSuccessUrl = (validationCallbackUrl: ValidUrl): ValidUrl => ({
  href: `${validationCallbackUrl.href}?result=success&time=${Date.now()}`
});

/**
 * Returns a ValidUrl that represents a failed validation
 */
const validationFailureUrl = (
  validationCallbackUrl: ValidUrl,
  error: keyof typeof ValidationErrors,
  timeStampGenerator: () => number
): ValidUrl => ({
  href: `${
    validationCallbackUrl.href
  }?result=failure&error=${error}&time=${timeStampGenerator()}`
});

const TokenQueryParamMiddleware = RequiredQueryParamMiddleware(
  "token",
  TokenQueryParam
);

export const ValidateProfileEmailHandler = (
  tableService: TableService,
  validationTokensTableName: string,
  profileModel: ProfileModel,
  validationCallbackUrl: ValidUrl,
  timeStampGenerator: () => number
): IValidateProfileEmailHandler => async (
  context,
  token
): Promise<IResponseSeeOtherRedirect | IResponseErrorValidation> => {
  const logPrefix = `ValidateProfileEmail|TOKEN=${token}`;
  const vFailureUrl = (error: keyof typeof ValidationErrors): ValidUrl =>
    validationFailureUrl(validationCallbackUrl, error, timeStampGenerator);

  // STEP 1: Find and verify validation token

  // A token is in the following format:
  // [tokenId ULID] + ":" + [validatorHash crypto.randomBytes(12)]
  // Split the token to get tokenId and validatorHash
  const [tokenId, validator] = token.split(":");
  const validatorHash = crypto
    .createHash("sha256")
    .update(validator)
    .digest("hex");

  // Retrieve the entity from the table storage
  const errorOrMaybeTableEntity = await retrieveTableEntity(
    tableService,
    validationTokensTableName,
    tokenId,
    validatorHash
  );

  if (isLeft(errorOrMaybeTableEntity)) {
    context.log.error(
      `${logPrefix}|Error searching validation token|ERROR=${errorOrMaybeTableEntity.left.message}`
    );
    return ResponseSeeOtherRedirect(
      vFailureUrl(ValidationErrors.GENERIC_ERROR)
    );
  }

  const maybeTokenEntity = errorOrMaybeTableEntity.right;

  if (isNone(maybeTokenEntity)) {
    context.log.error(`${logPrefix}|Validation token not found`);
    return ResponseSeeOtherRedirect(
      vFailureUrl(ValidationErrors.INVALID_TOKEN)
    );
  }

  // Check if the entity is a ValidationTokenEntity
  const errorOrValidationTokenEntity = ValidationTokenEntity.decode(
    maybeTokenEntity.value
  );

  if (isLeft(errorOrValidationTokenEntity)) {
    context.log.error(
      `${logPrefix}|Validation token can't be decoded|ERROR=${readableReport(
        errorOrValidationTokenEntity.left
      )}`
    );
    return ResponseSeeOtherRedirect(
      vFailureUrl(ValidationErrors.INVALID_TOKEN)
    );
  }

  const validationTokenEntity = errorOrValidationTokenEntity.right;
  const {
    Email: email,
    InvalidAfter: invalidAfter,
    FiscalCode: fiscalCode
  } = validationTokenEntity;

  // Check if the token is expired
  if (Date.now() > invalidAfter.getTime()) {
    context.log.error(`${logPrefix}|Token expired|EXPIRED_AT=${invalidAfter}`);
    return ResponseSeeOtherRedirect(
      vFailureUrl(ValidationErrors.TOKEN_EXPIRED)
    );
  }

  // STEP 2: Find the profile
  const errorOrMaybeExistingProfile = await profileModel.findLastVersionByModelId(
    [fiscalCode]
  )();

  if (isLeft(errorOrMaybeExistingProfile)) {
    context.log.error(
      `${logPrefix}|Error searching the profile|ERROR=${errorOrMaybeExistingProfile.left}`
    );
    return ResponseSeeOtherRedirect(
      vFailureUrl(ValidationErrors.GENERIC_ERROR)
    );
  }

  const maybeExistingProfile = errorOrMaybeExistingProfile.right;
  if (isNone(maybeExistingProfile)) {
    context.log.error(`${logPrefix}|Profile not found`);
    return ResponseSeeOtherRedirect(
      vFailureUrl(ValidationErrors.GENERIC_ERROR)
    );
  }

  const existingProfile = maybeExistingProfile.value;

  // Check if the email in the profile is the same of the one in the validation token
  if (existingProfile.email !== email) {
    context.log.error(`${logPrefix}|Email mismatch`);
    return ResponseSeeOtherRedirect(
      vFailureUrl(ValidationErrors.INVALID_TOKEN)
    );
  }

  // Update the profile and set isEmailValidated to `true`
  const errorOrUpdatedProfile = await profileModel.update({
    ...existingProfile,
    isEmailValidated: true
  })();

  if (isLeft(errorOrUpdatedProfile)) {
    context.log.error(
      `${logPrefix}|Error updating profile|ERROR=${errorOrUpdatedProfile.left}`
    );
    return ResponseSeeOtherRedirect(
      vFailureUrl(ValidationErrors.GENERIC_ERROR)
    );
  }

  context.log.verbose(`${logPrefix}|The profile has been updated`);
  return ResponseSeeOtherRedirect(validationSuccessUrl(validationCallbackUrl));
};

/**
 * Wraps a ValidateProfileEmail handler inside an Express request handler.
 */
export const ValidateProfileEmail = (
  tableService: TableService,
  validationTokensTableName: string,
  profileModel: ProfileModel,
  validationCallbackUrl: ValidUrl,
  timeStampGenerator: () => number
): express.RequestHandler => {
  const handler = ValidateProfileEmailHandler(
    tableService,
    validationTokensTableName,
    profileModel,
    validationCallbackUrl,
    timeStampGenerator
  );

  const middlewaresWrap = withRequestMiddlewares(
    ContextMiddleware(),
    TokenQueryParamMiddleware
  );
  return wrapRequestHandler(middlewaresWrap(handler));
};
