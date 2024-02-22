import { ResourceNotFoundCode } from "@pagopa/io-functions-commons/dist/src/utils/azure_storage";

import {
  TokenQueryParam,
  ValidateProfileEmailHandler,
  ValidationErrors
} from "../handler";
import { EmailString, FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { IProfileEmailReader } from "@pagopa/io-functions-commons/dist/src/utils/unique_email_enforcement";
import { constTrue } from "fp-ts/lib/function";
import * as TE from "fp-ts/TaskEither";
import * as O from "fp-ts/Option";
import { ProfileModel } from "@pagopa/io-functions-commons/dist/src/models/profile";
import { aFiscalCode, aRetrievedProfile, anEmail } from "../__mocks__/profile";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";

const VALIDATION_TOKEN = "01DPT9QAZ6N0FJX21A86FRCWB3:8c652f8566ba53bd8cf0b1b9" as TokenQueryParam;

const mockFindLastVersionByModelId = jest
  .fn()
  .mockImplementation(() =>
    TE.right(O.some({ ...aRetrievedProfile, isEmailValidated: false }))
  );
const mockUpdate = jest
  .fn()
  .mockImplementation(() => TE.right(aRetrievedProfile));
const mockProfileModel = ({
  findLastVersionByModelId: mockFindLastVersionByModelId,
  update: mockUpdate
} as unknown) as ProfileModel;

const contextMock = {
  log: {
    error: jest.fn(),
    verbose: jest.fn()
  }
};

const validationCallbackUrl = {
  href: "localhost/validation"
};

const confirmChoiceUrl = {
  href: "localhost/confirm-choice"
} as ValidUrl;

const timestampGeneratorMock = () => 1234567890;

const errorUrl = (
  error: keyof typeof ValidationErrors,
  timestampGenerator: () => number
) => {
  return `${
    validationCallbackUrl.href
  }?result=failure&error=${error}&time=${timestampGenerator()}`;
};

const successUrl = (timestampGenerator: () => number) => {
  return `${
    validationCallbackUrl.href
  }?result=success&time=${timestampGenerator()}`;
};

const confirmPageUrl = (
  token: string,
  email: EmailString,
  timestampGenerator: () => number
) =>
  `${
    confirmChoiceUrl.href
  }?token=${token}&email=${email}&time=${timestampGenerator()}`;

const mockRetrieveEntity = jest
  .fn()
  .mockImplementation((_, __, ___, ____, f) => {
    f(undefined, {
      Email: anEmail,
      FiscalCode: aFiscalCode,
      InvalidAfter: new Date(Date.now() + 1000 * 1000).toISOString(),
      PartitionKey: "01DPT9QAZ6N0FJX21A86FRCWB3",
      RowKey: "026c47ead971b9af13353f5d5e563982ebca542f8df3246bdaf1f86e16075072"
    });
  });

const tableServiceMock = {
  retrieveEntity: mockRetrieveEntity
};

function generateProfileEmails(
  count: number,
  throws: boolean = false,
  fiscalCode: FiscalCode = "X" as FiscalCode
) {
  return async function*(email: EmailString) {
    if (throws) {
      throw new Error("error retriving profile emails");
    }
    for (let i = 0; i < count; i++) {
      yield { email, fiscalCode };
    }
  };
}

const profileEmailReader: IProfileEmailReader = {
  list: generateProfileEmails(0)
};

const expiredTokenEntity = {
  Email: anEmail,
  FiscalCode: aFiscalCode,
  InvalidAfter: new Date(Date.now() - 1000 * 1000).toISOString(),
  PartitionKey: "01DPT9QAZ6N0FJX21A86FRCWB3",
  RowKey: "026c47ead971b9af13353f5d5e563982ebca542f8df3246bdaf1f86e16075072"
};

describe("ValidateProfileEmailHandler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each`
    scenario                                                                                 | expectedError      | callbackInputs                      | isConfirmStep
    ${"GENERIC_ERROR in case the query versus the table storage fails during confirm step"}  | ${"GENERIC_ERROR"} | ${[new Error()]}                    | ${true}
    ${"GENERIC_ERROR in case the query versus the table storage fails"}                      | ${"GENERIC_ERROR"} | ${[new Error()]}                    | ${false}
    ${"INVALID_TOKEN error in case the token if not found in the table during confirm step"} | ${"INVALID_TOKEN"} | ${[{ code: ResourceNotFoundCode }]} | ${true}
    ${"INVALID_TOKEN error in case the token if not found in the table"}                     | ${"INVALID_TOKEN"} | ${[{ code: ResourceNotFoundCode }]} | ${false}
    ${"TOKEN_EXPIRED error in case the token is expired during confirm step"}                | ${"TOKEN_EXPIRED"} | ${[undefined, expiredTokenEntity]}  | ${true}
    ${"TOKEN_EXPIRED error in case the token is expired"}                                    | ${"TOKEN_EXPIRED"} | ${[undefined, expiredTokenEntity]}  | ${false}
  `(
    "should return a redirect with a $scenario",
    async ({ callbackInputs, expectedError, isConfirmStep }) => {
      mockRetrieveEntity.mockImplementationOnce((_, __, ___, ____, f) => {
        f(...callbackInputs);
      });

      const verifyProfileEmailHandler = ValidateProfileEmailHandler(
        tableServiceMock as any,
        "",
        mockProfileModel,
        validationCallbackUrl as any,
        timestampGeneratorMock,
        profileEmailReader,
        constTrue,
        confirmChoiceUrl
      );

      const response = await verifyProfileEmailHandler(
        contextMock as any,
        VALIDATION_TOKEN,
        isConfirmStep ? O.some(true) : O.none
      );

      expect(response.kind).toBe("IResponseSeeOtherRedirect");
      expect(response.detail).toBe(
        errorUrl(expectedError, timestampGeneratorMock)
      );
      expect(mockFindLastVersionByModelId).not.toBeCalled();
      expect(mockUpdate).not.toBeCalled();
    }
  );

  it.each`
    scenario                                                                                                                                                        | expectedError            | isThrowing   | isConfirmStep
    ${"should return IResponseSeeOtherRedirect if the e-mail is already taken (unique email enforcement = %uee) WHEN a citizen changes e-mail during confirm step"} | ${"EMAIL_ALREADY_TAKEN"} | ${undefined} | ${true}
    ${"should return IResponseSeeOtherRedirect if the e-mail is already taken (unique email enforcement = %uee) WHEN a citizen changes e-mail"}                     | ${"EMAIL_ALREADY_TAKEN"} | ${undefined} | ${false}
    ${"return 500 WHEN the unique e-mail enforcement check fails during confirm step"}                                                                              | ${"GENERIC_ERROR"}       | ${true}      | ${true}
    ${"return 500 WHEN the unique e-mail enforcement check fails"}                                                                                                  | ${"GENERIC_ERROR"}       | ${true}      | ${false}
  `(
    "should $scenario",
    async ({ expectedError, isThrowing, isConfirmStep }) => {
      const verifyProfileEmailHandler = ValidateProfileEmailHandler(
        tableServiceMock as any,
        "",
        mockProfileModel,
        validationCallbackUrl as any,
        timestampGeneratorMock,
        {
          list: generateProfileEmails(1, isThrowing)
        },
        constTrue,
        confirmChoiceUrl
      );

      const response = await verifyProfileEmailHandler(
        contextMock as any,
        VALIDATION_TOKEN,
        isConfirmStep ? O.some(true) : O.none
      );

      expect(response.kind).toBe("IResponseSeeOtherRedirect");
      expect(response.detail).toBe(
        errorUrl(expectedError, timestampGeneratorMock)
      );
      expect(mockFindLastVersionByModelId).toBeCalledWith([aFiscalCode]);
      expect(mockUpdate).not.toBeCalled();
    }
  );

  it("should validate the email in profile if all the condition are verified and we are in the confirm step", async () => {
    const verifyProfileEmailHandler = ValidateProfileEmailHandler(
      tableServiceMock as any,
      "",
      mockProfileModel,
      validationCallbackUrl as any,
      timestampGeneratorMock,
      {
        list: generateProfileEmails(0)
      },
      constTrue,
      confirmChoiceUrl
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN,
      O.some(true)
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(successUrl(timestampGeneratorMock));
    expect(mockFindLastVersionByModelId).toBeCalledWith([aFiscalCode]);
    expect(mockUpdate).toBeCalledWith(
      expect.objectContaining({ isEmailValidated: true })
    );
  });

  it("should NOT validate the email in profile if we are NOT in the confirm step", async () => {
    const verifyProfileEmailHandler = ValidateProfileEmailHandler(
      tableServiceMock as any,
      "",
      mockProfileModel,
      validationCallbackUrl as any,
      timestampGeneratorMock,
      {
        list: generateProfileEmails(0)
      },
      constTrue,
      confirmChoiceUrl
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN,
      O.none
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      confirmPageUrl(VALIDATION_TOKEN, anEmail, timestampGeneratorMock)
    );
    expect(mockFindLastVersionByModelId).toBeCalledWith([aFiscalCode]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
