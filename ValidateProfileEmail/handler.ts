import * as crypto from "crypto";
import * as E from "fp-ts/lib/Either";
import * as O from "fp-ts/lib/Option";

import { Effect, Either, Option } from "effect";

import * as express from "express";

import { isLeft } from "fp-ts/lib/Either";
import { isNone } from "fp-ts/lib/Option";

import * as TE from "fp-ts/lib/TaskEither";
import { pipe } from "fp-ts/function";

import { Context } from "@azure/functions";
import { BlobService, TableService } from "azure-storage";

import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import {
  IResponseErrorValidation,
  IResponseSeeOtherRedirect,
  ResponseErrorInternal,
  ResponseSeeOtherRedirect
} from "@pagopa/ts-commons/lib/responses";
import { EmailString, FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { hashFiscalCode } from "@pagopa/ts-commons/lib/hash";
import { ValidationTokenEntity } from "@pagopa/io-functions-commons/dist/src/entities/validation_token";
import {
  Profile,
  ProfileModel,
  RetrievedProfile
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import { retrieveTableEntity } from "@pagopa/io-functions-commons/dist/src/utils/azure_storage";
import { ContextMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "@pagopa/io-functions-commons/dist/src/utils/request_middleware";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";
import {
  IProfileEmailReader,
  isEmailAlreadyTaken
} from "@pagopa/io-functions-commons/dist/src/utils/unique_email_enforcement";
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
import { update } from "effect/Differ";

type IValidateProfileEmailHandler = (
  context: Context,
  token: TokenQueryParam,
  flowChoice: FlowType
) => Promise<IResponseSeeOtherRedirect | IResponseErrorValidation>;

export const ValidateProfileEmailHandler1 = (
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

  // Check if the e-mail is already taken
  if (FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED(fiscalCode)) {
    try {
      const isEmailTaken = await isEmailAlreadyTaken(email)({
        profileEmails
      });
      if (isEmailTaken) {
        return ResponseSeeOtherRedirect(
          vFailureUrl(ValidationErrors.EMAIL_ALREADY_TAKEN)
        );
      }
    } catch {
      context.log.error(`${logPrefix}| Check for e-mail uniqueness failed`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }
  }

  // Update the profile and set isEmailValidated to `true` ONLY if the flowChoice equals to VALIDATE
  // otherwise just redirect to confirm page with token and email(base64url encoded) in query param
  return await pipe(
    flowChoice,
    TE.fromPredicate(
      flow => flow === FlowTypeEnum.VALIDATE,
      () =>
        ResponseSeeOtherRedirect(
          confirmChoicePageUrl(confirmValidationUrl, token, email)
        )
    ),
    TE.chain(() =>
      pipe(
        profileModel.update({
          ...existingProfile,
          isEmailValidated: true
        }),
        TE.mapLeft(error => {
          context.log.error(
            `${logPrefix}|Error updating profile|ERROR=${error}`
          );
          return ResponseSeeOtherRedirect(
            vFailureUrl(ValidationErrors.GENERIC_ERROR)
          );
        }),
        TE.map(() => {
          trackEvent({
            name: "io.citizen-auth.validate_email",
            tagOverrides: {
              "ai.user.id": hashFiscalCode(existingProfile.fiscalCode),
              samplingEnabled: "false"
            }
          });

          context.log.verbose(`${logPrefix}|The profile has been updated`);
          return ResponseSeeOtherRedirect(
            validationSuccessUrl(validationCallbackUrl)
          );
        })
      )
    ),
    TE.toUnion
  )();
};

const fptsEitherToEffect = <L, R>(fpe: E.Either<L, R>): Effect.Effect<R, L> =>
  fpe._tag === "Right" ? Effect.succeed(fpe.right) : Effect.fail(fpe.left);

const fptsOptionToEffectOption = <S>(fpe: O.Option<S>): Option.Option<S> =>
  fpe._tag === "None" ? Option.none() : Option.some(fpe.value);

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

  // STEP 1: Find and verify validation token
  // A token is in the following format:
  // [tokenId ULID] + ":" + [validatorHash crypto.randomBytes(12)]
  // Split the token to get tokenId and validatorHash
  const [tokenId, validator] = token.split(":");

  const makeHash = Effect.try(() =>
    crypto
      .createHash("sha256")
      .update(validator)
      .digest("hex")
  );

  // Retrieve the entity from the table storage
  const getTableEntity = (validatorHash: string) =>
    Effect.tryPromise(() =>
      retrieveTableEntity(
        tableService,
        validationTokensTableName,
        tokenId,
        validatorHash
      )
    );

  const getProfile = (fiscalCode: FiscalCode) =>
    Effect.tryPromise(() =>
      profileModel.findLastVersionByModelId([fiscalCode])()
    ).pipe(
      Effect.flatMap(fptsEitherToEffect),
      Effect.map(fptsOptionToEffectOption)
    );

  const updateProfile = (profile: RetrievedProfile) =>
    Effect.tryPromise(() => profileModel.update(profile)()).pipe(
      Effect.flatMap(fptsEitherToEffect)
    );

  const isEmailTaken = (email: EmailString) =>
    Effect.tryPromise({
      try: () =>
        isEmailAlreadyTaken(email)({
          profileEmails
        }),
      catch: () => {
        // TODO: this is a side effect
        context.log.error(`${logPrefix}| Check for e-mail uniqueness failed`);
        return ResponseSeeOtherRedirect(
          vFailureUrl(ValidationErrors.GENERIC_ERROR)
        );
      }
    });

  return Effect.runPromise(
    Effect.gen(function*(_) {
      const hash = yield* _(makeHash);
      const entity = yield* _(
        getTableEntity(hash),
        Effect.flatMap(fptsEitherToEffect),
        Effect.either
      );

      if (Either.isLeft(entity)) {
        // TODO: this is a side effect, use EFFECT
        context.log.error(
          `${logPrefix}|Error searching validation token|ERROR=${entity.left.message}`
        );
        return ResponseSeeOtherRedirect(
          vFailureUrl(ValidationErrors.GENERIC_ERROR)
        );
      }

      const maybeTokenEntity = pipe(entity.right, fptsOptionToEffectOption);

      if (Option.isNone(maybeTokenEntity)) {
        // TODO: this is a side effect, use EFFECT
        context.log.error(`${logPrefix}|Validation token not found`);
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

      const date = yield* _(Effect.sync(Date.now));

      // Check if the token is expired
      if (date > invalidAfter.getTime()) {
        // TODO: this is a side effect, use EFFECT
        context.log.error(
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
        context.log.error(
          `${logPrefix}|Error searching the profile|ERROR=${errorOrMaybeExistingProfile.left}`
        );
        return ResponseSeeOtherRedirect(
          vFailureUrl(ValidationErrors.GENERIC_ERROR)
        );
      }

      const maybeExistingProfile = errorOrMaybeExistingProfile.right;
      if (Option.isNone(maybeExistingProfile)) {
        // TODO: this is a side effect, use EFFECT
        context.log.error(`${logPrefix}|Profile not found`);
        return ResponseSeeOtherRedirect(
          vFailureUrl(ValidationErrors.GENERIC_ERROR)
        );
      }

      const existingProfile = maybeExistingProfile.value;

      // Check if the email in the profile is the same of the one in the validation token
      if (existingProfile.email !== email) {
        // TODO: this is a side effect, use EFFECT
        context.log.error(`${logPrefix}|Email mismatch`);
        return ResponseSeeOtherRedirect(
          vFailureUrl(ValidationErrors.INVALID_TOKEN)
        );
      }

      if (FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED(fiscalCode)) {
        const errorOrIsEmailTaken = yield* _(
          isEmailTaken(email),
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
        updateProfile({ ...existingProfile, isEmailValidated: true }),
        Effect.either
      );

      if (Either.isLeft(errorOrUpdatedProfile)) {
        // TODO: this is a side effect, use EFFECT
        context.log.error(
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

          context.log.verbose(`${logPrefix}|The profile has been updated`);
          return ResponseSeeOtherRedirect(
            validationSuccessUrl(validationCallbackUrl)
          );
        })
      );
    })
  );
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
