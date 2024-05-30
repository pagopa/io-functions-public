import { Context as EffectContext, Effect, Either, Option } from "effect";

import * as express from "express";

import { pipe } from "fp-ts/function";

import { Context } from "@azure/functions";
import { TableService } from "azure-storage";

import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import {
  IResponseErrorValidation,
  IResponseSeeOtherRedirect,
  ResponseSeeOtherRedirect
} from "@pagopa/ts-commons/lib/responses";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { hashFiscalCode } from "@pagopa/ts-commons/lib/hash";
import { ValidationTokenEntity } from "@pagopa/io-functions-commons/dist/src/entities/validation_token";
import { ProfileModel } from "@pagopa/io-functions-commons/dist/src/models/profile";
import { ContextMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "@pagopa/io-functions-commons/dist/src/utils/request_middleware";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";
import { IProfileEmailReader } from "@pagopa/io-functions-commons/dist/src/utils/unique_email_enforcement";
import { trackEvent } from "../utils/appinsights";
import {
  ConfirmEmailFlowQueryParamMiddleware,
  FlowType,
  FlowTypeEnum,
  TokenQueryParam,
  TokenQueryParamMiddleware
} from "../utils/middleware";
import {
  confirmChoicePageUrl,
  validationFailureUrl,
  validationSuccessUrl
} from "../utils/redirect_url";
import { ValidationErrors } from "../utils/validation_errors";
import { Logger, LoggerLive } from "./services/Logger";
import { fptsEitherToEffect, fptsOptionToEffectOption } from "./transformers";
import { Profile, ProfileLive } from "./services/Profile";
import { TokenTable, TokenTableLive } from "./services/TokenEntity";

type IValidateProfileEmailHandler = (
  context: Context,
  token: TokenQueryParam,
  flowChoice: FlowType
) => Promise<IResponseSeeOtherRedirect | IResponseErrorValidation>;

export const ValidateProfileEmailHandler = (
  tableService: TableService,
  validationTokensTableName: string,
  profileModel: ProfileModel,
  emailValidationUrls: {
    readonly confirmValidationUrl: ValidUrl;
    readonly validationCallbackUrl: ValidUrl;
  },
  profileEmails: IProfileEmailReader,
  FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED: (fiscalCode: FiscalCode) => boolean
): IValidateProfileEmailHandler => async (
  context,
  token,
  flowChoice
): Promise<IResponseSeeOtherRedirect | IResponseErrorValidation> => {
  const logPrefix = `ValidateProfileEmail|TOKEN=${token}`;
  const { validationCallbackUrl, confirmValidationUrl } = emailValidationUrls;
  const vFailureUrl = (error: keyof typeof ValidationErrors): ValidUrl =>
    validationFailureUrl(validationCallbackUrl, error);

  const program = Effect.gen(function*(_) {
    const logger = yield* _(Logger);
    const profile = yield* _(Profile);
    const tokenTable = yield* _(TokenTable);
    const entity = yield* _(tokenTable.get(token));

    if (Either.isLeft(entity)) {
      // TODO: this is a side effect, use EFFECT
      logger.error(
        `${logPrefix}|Error searching validation token|ERROR=${entity.left.message}`
      );
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const maybeTokenEntity = pipe(entity.right, fptsOptionToEffectOption);

    if (Option.isNone(maybeTokenEntity)) {
      // TODO: this is a side effect, use EFFECT
      logger.error(`${logPrefix}|Validation token not found`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.INVALID_TOKEN)
      );
    }

    const errorOrValidationTokenEntity = yield* _(
      pipe(
        ValidationTokenEntity.decode(maybeTokenEntity.value),
        fptsEitherToEffect
      ),
      Effect.either
    );

    if (Either.isLeft(errorOrValidationTokenEntity)) {
      // TODO: this is a side effect, use EFFECT
      logger.error(
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

    const date = yield* _(Effect.sync(Date.now));

    // Check if the token is expired
    if (date > invalidAfter.getTime()) {
      // TODO: this is a side effect, use EFFECT
      logger.error(`${logPrefix}|Token expired|EXPIRED_AT=${invalidAfter}`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.TOKEN_EXPIRED)
      );
    }

    // STEP 2: Find the profile
    const errorOrMaybeExistingProfile = yield* _(
      profile.get(fiscalCode),
      Effect.either
    );

    if (Either.isLeft(errorOrMaybeExistingProfile)) {
      // TODO: this is a side effect, use EFFECT
      logger.error(
        `${logPrefix}|Error searching the profile|ERROR=${errorOrMaybeExistingProfile.left}`
      );
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const maybeExistingProfile = errorOrMaybeExistingProfile.right;
    if (Option.isNone(maybeExistingProfile)) {
      // TODO: this is a side effect, use EFFECT
      logger.error(`${logPrefix}|Profile not found`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const existingProfile = maybeExistingProfile.value;

    // Check if the email in the profile is the same of the one in the validation token
    if (existingProfile.email !== email) {
      // TODO: this is a side effect, use EFFECT
      logger.error(`${logPrefix}|Email mismatch`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.INVALID_TOKEN)
      );
    }

    if (FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED(fiscalCode)) {
      const errorOrIsEmailTaken = yield* _(
        profile.checkIfEmailIsTaken(email),
        Effect.either
      );
      if (Either.isLeft(errorOrIsEmailTaken)) {
        logger.error(`${logPrefix}| Check for e-mail uniqueness failed`);
        return ResponseSeeOtherRedirect(
          vFailureUrl(ValidationErrors.GENERIC_ERROR)
        );
      } else if (errorOrIsEmailTaken.right) {
        return ResponseSeeOtherRedirect(
          vFailureUrl(ValidationErrors.EMAIL_ALREADY_TAKEN)
        );
      }
    }

    // Update the profile and set isEmailValidated to `true` ONLY if the flowChoice equals to VALIDATE
    // otherwise just redirect to confirm page with token and email(base64url encoded) in query param

    if (flowChoice !== FlowTypeEnum.VALIDATE) {
      return ResponseSeeOtherRedirect(
        confirmChoicePageUrl(confirmValidationUrl, token, email)
      );
    }

    const errorOrUpdatedProfile = yield* _(
      profile.update({ ...existingProfile, isEmailValidated: true }),
      Effect.either
    );

    if (Either.isLeft(errorOrUpdatedProfile)) {
      // TODO: this is a side effect, use EFFECT
      logger.error(
        `${logPrefix}|Error updating profile|ERROR=${errorOrUpdatedProfile.left}`
      );
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    return yield* _(
      Effect.sync(() => {
        trackEvent({
          name: "io.citizen-auth.validate_email",
          tagOverrides: {
            // TODO: this is a side effect, use EFFECT
            "ai.user.id": hashFiscalCode(existingProfile.fiscalCode),
            samplingEnabled: "false"
          }
        });

        logger.verbose(`${logPrefix}|The profile has been updated`);
        return ResponseSeeOtherRedirect(
          validationSuccessUrl(validationCallbackUrl)
        );
      })
    );
  });

  const ctx = EffectContext.empty().pipe(
    // Add Layer stuff instead provide the context as argument
    EffectContext.add(Logger, LoggerLive(context)),
    EffectContext.add(Profile, ProfileLive(profileModel, profileEmails)),
    EffectContext.add(
      TokenTable,
      TokenTableLive(tableService, validationTokensTableName)
    )
  );

  return Effect.runPromise(Effect.provide(program, ctx));
};

/**
 * Wraps a ValidateProfileEmail handler inside an Express request handler.
 */

export const ValidateProfileEmail = (
  tableService: TableService,
  validationTokensTableName: string,
  profileModel: ProfileModel,
  emailValidationUrls: {
    readonly confirmValidationUrl: ValidUrl;
    readonly validationCallbackUrl: ValidUrl;
  },
  profileEmails: IProfileEmailReader,
  FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED: (fiscalCode: FiscalCode) => boolean
): express.RequestHandler => {
  const handler = ValidateProfileEmailHandler(
    tableService,
    validationTokensTableName,
    profileModel,
    emailValidationUrls,
    profileEmails,
    FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED
  );

  const middlewaresWrap = withRequestMiddlewares(
    ContextMiddleware(),
    TokenQueryParamMiddleware,
    ConfirmEmailFlowQueryParamMiddleware
  );
  return wrapRequestHandler(middlewaresWrap(handler));
};
