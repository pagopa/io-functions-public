import { Effect, Either, Option, pipe } from "effect";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";
import { ResponseSeeOtherRedirect } from "@pagopa/ts-commons/lib/responses";
import { ValidationTokenEntity } from "@pagopa/io-functions-commons/dist/src/entities/validation_token";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { hashFiscalCode } from "@pagopa/ts-commons/lib/hash";
import { ValidationErrors } from "../utils/validation_errors";
import {
  confirmChoicePageUrl,
  validationFailureUrl,
  validationSuccessUrl
} from "../utils/redirect_url";
import { FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED } from "../utils/unique_email_enforcement";
import { FlowType, FlowTypeEnum, TokenQueryParam } from "../utils/middleware";
import { trackEvent } from "../utils/appinsights";
import { Logger } from "./services/Logger";
import { Profile } from "./services/Profile";
import { TokenTable } from "./services/TokenTable";
import { fptsEitherToEffect, fptsOptionToEffectOption } from "./transformers";

export const validateProfileEmail = (
  token: TokenQueryParam,
  flowChoice: FlowType,
  isUniqueEmailEnforcementEnabled: typeof FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED,
  emailValidationUrls: {
    readonly confirmValidationUrl: ValidUrl;
    readonly validationCallbackUrl: ValidUrl;
  }
) =>
  Effect.gen(function*(_) {
    const logger = yield* _(Logger);
    const profile = yield* _(Profile);
    const tokenTable = yield* _(TokenTable);
    const entity = yield* _(tokenTable.get(token));

    const { validationCallbackUrl, confirmValidationUrl } = emailValidationUrls;
    const logPrefix = `ValidateProfileEmail|TOKEN=${token}`;
    const vFailureUrl = (error: keyof typeof ValidationErrors): ValidUrl =>
      validationFailureUrl(validationCallbackUrl, error);

    if (Either.isLeft(entity)) {
      logger.error(
        `${logPrefix}|Error searching validation token|ERROR=${entity.left.message}`
      );
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const maybeTokenEntity = pipe(entity.right, fptsOptionToEffectOption);

    if (Option.isNone(maybeTokenEntity)) {
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
      logger.error(
        `${logPrefix}|Error searching the profile|ERROR=${errorOrMaybeExistingProfile.left}`
      );
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const maybeExistingProfile = errorOrMaybeExistingProfile.right;
    if (Option.isNone(maybeExistingProfile)) {
      logger.error(`${logPrefix}|Profile not found`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.GENERIC_ERROR)
      );
    }

    const existingProfile = maybeExistingProfile.value;

    // Check if the email in the profile is the same of the one in the validation token
    if (existingProfile.email !== email) {
      logger.error(`${logPrefix}|Email mismatch`);
      return ResponseSeeOtherRedirect(
        vFailureUrl(ValidationErrors.INVALID_TOKEN)
      );
    }

    if (isUniqueEmailEnforcementEnabled(fiscalCode)) {
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
