import { EmailString } from "@pagopa/ts-commons/lib/strings";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";
import base64url from "base64url";
import { TokenQueryParam } from "../middleware";
import {
  confirmChoicePageUrl,
  validationFailureUrl,
  validationSuccessUrl
} from "../redirect_url";
import { ValidationErrors } from "../validation_errors";

const validationCallbackUrl = {
  href: "https://localhost/validation"
} as ValidUrl;

const confirmValidationUrl = {
  href: "https://localhost/confirm-choice"
} as ValidUrl;

const aToken = "sample_token" as TokenQueryParam;
const anEmail = "example@example.com" as EmailString;

describe("Redirect utilities testing", () => {
  it("should redirect to confirm URL", () => {
    const result = confirmChoicePageUrl(confirmValidationUrl, aToken, anEmail);
    expect(result.href).toEqual(
      `${confirmValidationUrl.href}?token=${aToken}&email=${base64url(anEmail)}`
    );
  });

  it("should redirect to result page", () => {
    const result = validationSuccessUrl(validationCallbackUrl);
    expect(result.href).toEqual(`${validationCallbackUrl.href}?result=success`);
  });

  it.each`
    error
    ${ValidationErrors.GENERIC_ERROR}
    ${ValidationErrors.INVALID_TOKEN}
    ${ValidationErrors.TOKEN_EXPIRED}
    ${ValidationErrors.EMAIL_ALREADY_TAKEN}
  `("should redirect to failure page with $error", ({ error }) => {
    const result = validationFailureUrl(validationCallbackUrl, error);
    expect(result.href).toEqual(
      `${validationCallbackUrl.href}?result=failure&error=${error}`
    );
  });
});
