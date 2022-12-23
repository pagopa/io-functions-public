import { ResourceNotFoundCode } from "@pagopa/io-functions-commons/dist/src/utils/azure_storage";

import {
  TokenQueryParam,
  ValidateProfileEmailHandler,
  ValidationErrors
} from "../handler";

const VALIDATION_TOKEN = "01DPT9QAZ6N0FJX21A86FRCWB3:8c652f8566ba53bd8cf0b1b9" as TokenQueryParam;

const contextMock = {
  log: {
    error: jest.fn()
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
      undefined as any,
      validationCallbackUrl as any,
      timestampGeneratorMock
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      errorUrl("GENERIC_ERROR", timestampGeneratorMock)
    );
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
      undefined as any,
      validationCallbackUrl as any,
      timestampGeneratorMock
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      errorUrl("INVALID_TOKEN", timestampGeneratorMock)
    );
  });

  it("should return a redirect with a TOKEN_EXPIRED error in case the token is expired", async () => {
    const tableServiceMock = {
      retrieveEntity: jest.fn((_, __, ___, ____, f) => {
        f(undefined, {
          Email: "email@example.com",
          FiscalCode: "SPNDNL80A13Y555X",
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
      undefined as any,
      validationCallbackUrl as any,
      timestampGeneratorMock
    );

    const response = await verifyProfileEmailHandler(
      contextMock as any,
      VALIDATION_TOKEN
    );

    expect(response.kind).toBe("IResponseSeeOtherRedirect");
    expect(response.detail).toBe(
      errorUrl("TOKEN_EXPIRED", timestampGeneratorMock)
    );
  });
});
