import * as crypto from "crypto";

import * as express from "express";

import { isLeft } from "fp-ts/lib/Either";
import { isNone } from "fp-ts/lib/Option";

import * as t from "io-ts";

import { Context } from "@azure/functions";
import { TableService } from "azure-storage";

import {
  IResponseErrorValidation,
  IResponsePermanentRedirect,
  ResponsePermanentRedirect
} from "italia-ts-commons/lib/responses";
import { PatternString } from "italia-ts-commons/lib/strings";

import { RequiredQueryParamMiddleware } from "io-functions-commons/dist/src/utils/middlewares/required_query_param";

import { VerificationTokenEntity } from "io-functions-commons/dist/src/entities/verification_token";
import { ProfileModel } from "io-functions-commons/dist/src/models/profile";
import { retrieveTableEntity } from "io-functions-commons/dist/src/utils/azure_storage";
import { ContextMiddleware } from "io-functions-commons/dist/src/utils/middlewares/context_middleware";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "io-functions-commons/dist/src/utils/request_middleware";
import { ValidUrl } from "italia-ts-commons/lib/url";

// A token must be in the following format:
// ULID + ":" + crypto.randomBytes(12)
const TokenQueryParam = PatternString("^[A-Za-z0-9]{26}:[A-Fa-f0-9]{24}$");
type TokenQueryParam = t.TypeOf<typeof TokenQueryParam>;

type IVerifyProfileEmailHandler = (
  context: Context,
  token: string
) => Promise<IResponsePermanentRedirect | IResponseErrorValidation>;

/**
 * Returns a ValidUrl in case of success
 */
function verificationSuccessUrl(verificationCallbackUrl: string): ValidUrl {
  return { href: `${verificationCallbackUrl}?result=success` };
}

/**
 * Returns a ValidUrl with a error in case of failure
 */
function verificationFailureUrl(
  verificationCallbackUrl: string,
  error: string
): ValidUrl {
  return { href: `${verificationCallbackUrl}?result=failure&error=${error}` };
}

const TokenQueryParamMiddleware = RequiredQueryParamMiddleware(
  "token",
  TokenQueryParam
);

// Used in the callback
export enum VerificationErrors {
  GENERIC_ERROR = "GENERIC_ERROR",
  INVALID_TOKEN = "INVALID_TOKEN",
  TOKEN_EXPIRED = "TOKEN_EXPIRED"
}

export function VerifyProfileEmailHandler(
  tableService: TableService,
  verificationTokensTableName: string,
  profileModel: ProfileModel,
  verificationCallbackUrl: string
): IVerifyProfileEmailHandler {
  return async (context, token) => {
    const logPrefix = `VerifyProfileEmail`;

    // STEP 1: Find and verify verification token

    // Get required data
    const [tokenId, validator] = token.split(":");
    const validatorHash = crypto
      .createHash("sha256")
      .update(validator)
      .digest("hex");

    // Retrive the entity from the table storage
    const errorOrMaybeVerificationTokenEntity = await retrieveTableEntity(
      VerificationTokenEntity,
      tableService,
      verificationTokensTableName,
      tokenId,
      validatorHash
    );

    if (isLeft(errorOrMaybeVerificationTokenEntity)) {
      context.log.error(
        `${logPrefix}|Error searching verification token|ERROR=${errorOrMaybeVerificationTokenEntity.value}`
      );
      return ResponsePermanentRedirect(
        verificationFailureUrl(
          verificationCallbackUrl,
          VerificationErrors.GENERIC_ERROR
        )
      );
    }

    const maybeVerificationTokenEntity =
      errorOrMaybeVerificationTokenEntity.value;

    if (isNone(maybeVerificationTokenEntity)) {
      context.log.error(`${logPrefix}|Verification token not found`);
      return ResponsePermanentRedirect(
        verificationFailureUrl(
          verificationCallbackUrl,
          VerificationErrors.INVALID_TOKEN
        )
      );
    }

    const verificationTokenEntity = maybeVerificationTokenEntity.value;
    const {
      InvalidAfter: invalidAfter,
      FiscalCode: fiscalCode
    } = verificationTokenEntity;

    // Check if the token is expired
    if (Date.now() > new Date(invalidAfter).getTime()) {
      context.log.error(
        `${logPrefix}|Token expired|EXPIRED_AT=${invalidAfter}`
      );
      return ResponsePermanentRedirect(
        verificationFailureUrl(
          verificationCallbackUrl,
          VerificationErrors.TOKEN_EXPIRED
        )
      );
    }

    // STEP 2: Find and modify the profile
    const errorOrMaybeExistingProfile = await profileModel.findOneProfileByFiscalCode(
      fiscalCode
    );

    if (isLeft(errorOrMaybeExistingProfile)) {
      context.log.error(`${logPrefix}|Error searching the profile`);
      return ResponsePermanentRedirect(
        verificationFailureUrl(
          verificationCallbackUrl,
          VerificationErrors.GENERIC_ERROR
        )
      );
    }

    const maybeExistingProfile = errorOrMaybeExistingProfile.value;
    if (isNone(maybeExistingProfile)) {
      context.log.error(`${logPrefix}|Profile not found`);
      return ResponsePermanentRedirect(
        verificationFailureUrl(
          verificationCallbackUrl,
          VerificationErrors.GENERIC_ERROR
        )
      );
    }

    const existingProfile = maybeExistingProfile.value;

    // Update the profile and set isEmailVaidated to `true`
    const errorOrMaybeUpdatedProfile = await profileModel.update(
      existingProfile.id,
      existingProfile.fiscalCode,
      o => ({
        ...o,
        isEmailValidated: true
      })
    );

    if (isLeft(errorOrMaybeUpdatedProfile)) {
      context.log.error(`${logPrefix}|Error updating profile`);
      return ResponsePermanentRedirect(
        verificationFailureUrl(
          verificationCallbackUrl,
          VerificationErrors.GENERIC_ERROR
        )
      );
    }

    const maybeUpdatedProfile = errorOrMaybeUpdatedProfile.value;

    if (isNone(maybeUpdatedProfile)) {
      // This should never happen since if the profile doesn't exist this function
      // will never be called, but let's deal with this anyway, you never know
      context.log.error(`${logPrefix}|The updated profile does not exist`);
      return ResponsePermanentRedirect(
        verificationFailureUrl(
          verificationCallbackUrl,
          VerificationErrors.GENERIC_ERROR
        )
      );
    }

    context.log.verbose(`${logPrefix}|The profile has been updated`);
    return ResponsePermanentRedirect(
      verificationSuccessUrl(verificationCallbackUrl)
    );
  };
}

/**
 * Wraps a VerifyProfileEmail handler inside an Express request handler.
 */
export function VerifyProfileEmail(
  tableService: TableService,
  verificationTokensTableName: string,
  profileModel: ProfileModel,
  verificationCallbackUrl: string
): express.RequestHandler {
  const handler = VerifyProfileEmailHandler(
    tableService,
    verificationTokensTableName,
    profileModel,
    verificationCallbackUrl
  );

  const middlewaresWrap = withRequestMiddlewares(
    ContextMiddleware(),
    TokenQueryParamMiddleware
  );
  return wrapRequestHandler(middlewaresWrap(handler));
}
