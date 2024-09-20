import * as crypto from "crypto";
import * as E from "fp-ts/lib/Either";
import * as O from "fp-ts/lib/Option";

import { Effect, Context as EffectContext, Either, Option } from "effect";

import * as express from "express";

import { pipe } from "fp-ts/function";

import { Context } from "@azure/functions";
import { TableService } from "azure-storage";

import { ValidationTokenEntity } from "@pagopa/io-functions-commons/dist/src/entities/validation_token";
import {
  ProfileModel,
  RetrievedProfile
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import { retrieveTableEntity } from "@pagopa/io-functions-commons/dist/src/utils/azure_storage";
import { ContextMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "@pagopa/io-functions-commons/dist/src/utils/request_middleware";
import {
  IProfileEmailReader,
  isEmailAlreadyTaken
} from "@pagopa/io-functions-commons/dist/src/utils/unique_email_enforcement";
import { hashFiscalCode } from "@pagopa/ts-commons/lib/hash";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import {
  IResponseErrorValidation,
  IResponseSeeOtherRedirect,
  ResponseSeeOtherRedirect
} from "@pagopa/ts-commons/lib/responses";
import { EmailString, FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";
import { UnknownException } from "effect/Cause";
import { ContextLogger, buildContextLogger } from "../services/ContextLogger";
import { ProfileEmailsReaderService } from "../services/ProfileEmailsReader";
import { ProfileModelService } from "../services/ProfileModel";
import { TokenTable } from "../services/TokenTable";
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

type IValidateProfileEmailHandler = (
  context: Context,
  token: TokenQueryParam,
  flowChoice: FlowType
) => Promise<IResponseSeeOtherRedirect | IResponseErrorValidation>;

const fptsEitherToEffect = <L, R>(fpe: E.Either<L, R>): Effect.Effect<R, L> =>
  pipe(
    fpe,
    E.foldW(
      left => Effect.fail(left),
      right => Effect.succeed(right)
    )
  );

const fptsOptionToEffectOption = <S>(fpo: O.Option<S>): Option.Option<S> =>
  pipe(
    fpo,
    O.fold(
      () => Option.none(),
      value => Option.some(value)
    )
  );

const makeHash = (validator: string) =>
  Effect.try(() =>
    crypto
      .createHash("sha256")
      .update(validator)
      .digest("hex")
  );

// Retrieve the entity from the table storage
const getTableEntity = (validationTokensTableName: string, tokenId: string) => (
  validatorHash: string
) =>
  TokenTable.pipe(
    Effect.andThen(tableService =>
      Effect.tryPromise(() =>
        retrieveTableEntity(
          tableService,
          validationTokensTableName,
          tokenId,
          validatorHash
        )
      )
    )
  );

const getProfile = (fiscalCode: FiscalCode) =>
  ProfileModelService.pipe(
    Effect.andThen(profileModel =>
      Effect.tryPromise(() =>
        profileModel.findLastVersionByModelId([fiscalCode])()
      ).pipe(
        Effect.flatMap(fptsEitherToEffect),
        Effect.map(fptsOptionToEffectOption)
      )
    )
  );

const isEmailTaken = (
  logPrefix: string,
  email: EmailString,
  vFailureUrl: (error: keyof typeof ValidationErrors) => ValidUrl
) =>
  Effect.all([ContextLogger, ProfileEmailsReaderService]).pipe(
    Effect.andThen(([contextLogger, profileEmails]) =>
      Effect.tryPromise({
        try: () =>
          isEmailAlreadyTaken(email)({
            profileEmails
          }),
        catch: () => {
          contextLogger.error(
            `${logPrefix}| Check for e-mail uniqueness failed`
          );
          return ResponseSeeOtherRedirect(
            vFailureUrl(ValidationErrors.GENERIC_ERROR)
          );
        }
      })
    )
  );

const updateProfile = (profile: RetrievedProfile) =>
  ProfileModelService.pipe(
    Effect.andThen(profileModelService =>
      Effect.tryPromise(() => profileModelService.update(profile)()).pipe(
        Effect.flatMap(fptsEitherToEffect)
      )
    )
  );

export const buildHandler = (
  validationTokensTableName: string,
  {
    validationCallbackUrl,
    confirmValidationUrl
  }: {
    readonly confirmValidationUrl: ValidUrl;
    readonly validationCallbackUrl: ValidUrl;
  },
  logPrefix: string,
  vFailureUrl: (error: keyof typeof ValidationErrors) => ValidUrl,
  FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED: (fiscalCode: FiscalCode) => boolean
) => (
  token: TokenQueryParam,
  flowChoice: FlowType
): Effect.Effect<
  IResponseSeeOtherRedirect,
  UnknownException,
  ContextLogger | TokenTable | ProfileModelService | ProfileEmailsReaderService
> =>
  Effect.gen(function*(_) {
    // STEP 1: Find and verify validation token
    // A token is in the following format:
    // [tokenId ULID] + ":" + [validatorHash crypto.randomBytes(12)]
    // Split the token to get tokenId and validatorHash
    const [tokenId, validator] = token.split(":");
    const contextLogger = yield* _(ContextLogger);
    const hash = yield* _(makeHash(validator));

    const entity = yield* _(
      getTableEntity(validationTokensTableName, tokenId)(hash),
      Effect.flatMap(fptsEitherToEffect),
      Effect.either
    );

    if (Either.isLeft(entity)) {
      // TODO: this is a side effect, use EFFECT
      contextLogger.error(
        `${logPrefix}|Error searching validation token|ERROR=${entity.left.message}`
      );
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const maybeTokenEntity = pipe(entity.right, fptsOptionToEffectOption);

    if (Option.isNone(maybeTokenEntity)) {
      // TODO: this is a side effect, use EFFECT
      contextLogger.error(`${logPrefix}|Validation token not found`);
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
      contextLogger.error(
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
      contextLogger.error(
        `${logPrefix}|Token expired|EXPIRED_AT=${invalidAfter}`
      );
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.TOKEN_EXPIRED)
      );
    }

    // STEP 2: Find the profile
    const errorOrMaybeExistingProfile = yield* _(
      getProfile(fiscalCode),
      Effect.either
    );

    if (Either.isLeft(errorOrMaybeExistingProfile)) {
      // TODO: this is a side effect, use EFFECT
      contextLogger.error(
        `${logPrefix}|Error searching the profile|ERROR=${errorOrMaybeExistingProfile.left}`
      );
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const maybeExistingProfile = errorOrMaybeExistingProfile.right;
    if (Option.isNone(maybeExistingProfile)) {
      // TODO: this is a side effect, use EFFECT
      contextLogger.error(`${logPrefix}|Profile not found`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const existingProfile = maybeExistingProfile.value;

    // Check if the email in the profile is the same of the one in the validation token
    if (existingProfile.email !== email) {
      // TODO: this is a side effect, use EFFECT
      contextLogger.error(`${logPrefix}|Email mismatch`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.INVALID_TOKEN)
      );
    }

    if (FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED(fiscalCode)) {
      const errorOrIsEmailTaken = yield* _(
        isEmailTaken(logPrefix, email, vFailureUrl),
        Effect.either
      );
      if (Either.isLeft(errorOrIsEmailTaken)) {
        return errorOrIsEmailTaken.left;
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
      updateProfile({
        ...existingProfile,
        isEmailValidated: true
      }),
      Effect.either
    );

    if (Either.isLeft(errorOrUpdatedProfile)) {
      // TODO: this is a side effect, use EFFECT
      contextLogger.error(
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

        contextLogger.verbose(`${logPrefix}|The profile has been updated`);
        return ResponseSeeOtherRedirect(
          validationSuccessUrl(validationCallbackUrl)
        );
      })
    );
  });

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
  _context,
  token,
  flowChoice
): Promise<IResponseSeeOtherRedirect | IResponseErrorValidation> => {
  const logPrefix = `ValidateProfileEmail|TOKEN=${token}`;
  const vFailureUrl = (error: keyof typeof ValidationErrors): ValidUrl =>
    validationFailureUrl(emailValidationUrls.validationCallbackUrl, error);

  // get main Effect
  const mainEffect = buildHandler(
    validationTokensTableName,
    emailValidationUrls,
    logPrefix,
    vFailureUrl,
    FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED
  )(token, flowChoice);

  // createContext
  const contextLogger = buildContextLogger(_context);

  const context = EffectContext.empty().pipe(
    EffectContext.add(ContextLogger, contextLogger),
    EffectContext.add(TokenTable, tableService),
    EffectContext.add(ProfileModelService, profileModel),
    EffectContext.add(ProfileEmailsReaderService, profileEmails)
  );

  const runnable = Effect.provide(mainEffect, context);

  return await Effect.runPromise(runnable);
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
