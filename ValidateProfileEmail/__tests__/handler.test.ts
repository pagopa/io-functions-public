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
import { not } from "fp-ts/lib/Predicate";

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
  href: ""
};
const timestampGeneratorMock = () => 1234567890;

const errorUrl = (
  error: keyof typeof ValidationErrors,
  timestampGenerator: () => number
) => {
  return `?result=failure&error=${error}&time=${timestampGenerator()}`;
};

const successUrl = (timestampGenerator: () => number) => {
  return `?result=success&time=${timestampGenerator()}`;
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

describe("ValidateProfileEmailHandler", () => {
  it("should return a redirect with a GENERIC_ERROR in case the query versus the table storage fails", async () => {
    const tableServiceMock = {
      retrieveEntity: jest.fn((_, __, ___, ____, f) => {
        f(new Error());
      })
    };

    const verifyProfileEmailHandler = ValidateProfileEmailHandler(
      tableServiceMock as any,
      "",
      mockProfileModel,
      validationCallbackUrl as any,
      timestampGeneratorMock,
      profileEmailReader,
      constTrue
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      errorUrl("GENERIC_ERROR", timestampGeneratorMock)
    );
    expect(mockFindLastVersionByModelId).not.toBeCalled();
    expect(mockUpdate).not.toBeCalled();
  });

  it("should return a redirect with a INVALID_TOKEN error in case the token if not found in the table", async () => {
    const tableServiceMock = {
      retrieveEntity: jest.fn((_, __, ___, ____, f) => {
        f({ code: ResourceNotFoundCode });
      })
    };

    const verifyProfileEmailHandler = ValidateProfileEmailHandler(
      tableServiceMock as any,
      "",
      mockProfileModel,
      validationCallbackUrl as any,
      timestampGeneratorMock,
      profileEmailReader,
      constTrue
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      errorUrl("INVALID_TOKEN", timestampGeneratorMock)
    );
    expect(mockFindLastVersionByModelId).not.toBeCalled();
    expect(mockUpdate).not.toBeCalled();
  });

  it("should return a redirect with a TOKEN_EXPIRED error in case the token is expired", async () => {
    const tableServiceMock = {
      retrieveEntity: jest.fn((_, __, ___, ____, f) => {
        f(undefined, {
          Email: anEmail,
          FiscalCode: aFiscalCode,
          InvalidAfter: new Date(Date.now() - 1000 * 1000).toISOString(),
          PartitionKey: "01DPT9QAZ6N0FJX21A86FRCWB3",
          RowKey:
            "026c47ead971b9af13353f5d5e563982ebca542f8df3246bdaf1f86e16075072"
        });
      })
    };

    const verifyProfileEmailHandler = ValidateProfileEmailHandler(
      tableServiceMock as any,
      "",
      mockProfileModel,
      validationCallbackUrl as any,
      timestampGeneratorMock,
      profileEmailReader,
      constTrue
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      errorUrl("TOKEN_EXPIRED", timestampGeneratorMock)
    );
    expect(mockFindLastVersionByModelId).not.toBeCalled();
    expect(mockUpdate).not.toBeCalled();
  });

  it("when a citizen changes e-mail it should return IResponseErrorPreconditionFailed if the e-mail is already taken (unique email enforcement = %uee)", async () => {
    const tableServiceMock = {
      retrieveEntity: jest.fn((_, __, ___, ____, f) => {
        f(undefined, {
          Email: anEmail,
          FiscalCode: aFiscalCode,
          InvalidAfter: new Date(Date.now() + 1000 * 1000).toISOString(),
          PartitionKey: "01DPT9QAZ6N0FJX21A86FRCWB3",
          RowKey:
            "026c47ead971b9af13353f5d5e563982ebca542f8df3246bdaf1f86e16075072"
        });
      })
    };

    const verifyProfileEmailHandler = ValidateProfileEmailHandler(
      tableServiceMock as any,
      "",
      mockProfileModel,
      validationCallbackUrl as any,
      timestampGeneratorMock,
      {
        list: generateProfileEmails(1)
      },
      constTrue
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      errorUrl("EMAIL_ALREADY_TAKEN", timestampGeneratorMock)
    );
    expect(mockFindLastVersionByModelId).toBeCalledWith([aFiscalCode]);
    expect(mockUpdate).not.toBeCalled();
  });

  it("returns 500 when the unique e-mail enforcement check fails", async () => {
    const tableServiceMock = {
      retrieveEntity: jest.fn((_, __, ___, ____, f) => {
        f(undefined, {
          Email: anEmail,
          FiscalCode: aFiscalCode,
          InvalidAfter: new Date(Date.now() + 1000 * 1000).toISOString(),
          PartitionKey: "01DPT9QAZ6N0FJX21A86FRCWB3",
          RowKey:
            "026c47ead971b9af13353f5d5e563982ebca542f8df3246bdaf1f86e16075072"
        });
      })
    };

    const verifyProfileEmailHandler = ValidateProfileEmailHandler(
      tableServiceMock as any,
      "",
      mockProfileModel,
      validationCallbackUrl as any,
      timestampGeneratorMock,
      {
        list: generateProfileEmails(1, true)
      },
      constTrue
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      errorUrl("GENERIC_ERROR", timestampGeneratorMock)
    );
    expect(mockFindLastVersionByModelId).toBeCalledWith([aFiscalCode]);
    expect(mockUpdate).not.toBeCalled();
  });

  it("should validate the email in profile if all the condition are verified", async () => {
    const tableServiceMock = {
      retrieveEntity: jest.fn((_, __, ___, ____, f) => {
        f(undefined, {
          Email: anEmail,
          FiscalCode: aFiscalCode,
          InvalidAfter: new Date(Date.now() + 1000 * 1000).toISOString(),
          PartitionKey: "01DPT9QAZ6N0FJX21A86FRCWB3",
          RowKey:
            "026c47ead971b9af13353f5d5e563982ebca542f8df3246bdaf1f86e16075072"
        });
      })
    };

    const verifyProfileEmailHandler = ValidateProfileEmailHandler(
      tableServiceMock as any,
      "",
      mockProfileModel,
      validationCallbackUrl as any,
      timestampGeneratorMock,
      {
        list: generateProfileEmails(0)
      },
      constTrue
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(successUrl(timestampGeneratorMock));
    expect(mockFindLastVersionByModelId).toBeCalledWith([aFiscalCode]);
    expect(mockUpdate).toBeCalledWith(
      expect.objectContaining({ isEmailValidated: true })
    );
  });
});
