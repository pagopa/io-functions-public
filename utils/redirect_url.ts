import { EmailString } from "@pagopa/ts-commons/lib/strings";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";
import base64url from "base64url";
import { TokenQueryParam } from "./middleware";
import { ValidationErrors } from "./validation_errors";

/**
 * Returns a ValidUrl that represents a successful validation
 */
export const confirmChoicePageUrl = (
  url: ValidUrl,
  token: TokenQueryParam,
  email: EmailString
): ValidUrl =>
  ({
    href: `${url.href}?token=${token}&email=${base64url(email)}`
  } as ValidUrl);

/**
 * Returns a ValidUrl that represents a successful validation
 */
export const validationSuccessUrl = (
  validationCallbackUrl: ValidUrl,
  timeStampGenerator: () => number
): ValidUrl =>
  ({
    href: `${
      validationCallbackUrl.href
    }?result=success&time=${timeStampGenerator()}`
  } as ValidUrl);

/**
 * Returns a ValidUrl that represents a failed validation
 */
export const validationFailureUrl = (
  validationCallbackUrl: ValidUrl,
  error: keyof typeof ValidationErrors,
  timeStampGenerator: () => number
): ValidUrl =>
  ({
    href: `${
      validationCallbackUrl.href
    }?result=failure&error=${error}&time=${timeStampGenerator()}`
  } as ValidUrl);
