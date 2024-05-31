import { Context as EffectContext, Effect } from "effect";

import * as express from "express";

import { Context } from "@azure/functions";
import { TableService } from "azure-storage";

import {
  IResponseErrorValidation,
  IResponseSeeOtherRedirect
} from "@pagopa/ts-commons/lib/responses";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { ProfileModel } from "@pagopa/io-functions-commons/dist/src/models/profile";
import { ContextMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "@pagopa/io-functions-commons/dist/src/utils/request_middleware";
import { ValidUrl } from "@pagopa/ts-commons/lib/url";
import { IProfileEmailReader } from "@pagopa/io-functions-commons/dist/src/utils/unique_email_enforcement";
import {
  ConfirmEmailFlowQueryParamMiddleware,
  FlowType,
  TokenQueryParam,
  TokenQueryParamMiddleware
} from "../utils/middleware";
import { Logger, LoggerLive } from "./services/Logger";
import { Profile, ProfileLive } from "./services/Profile";
import { TokenTable, TokenTableLive } from "./services/TokenTable";
import { validateProfileEmail } from "./program";

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
  const effectContext = EffectContext.empty().pipe(
    // TODO: Use layers instead *Live with input params
    // Add Layer stuff instead provide the context as argument
    EffectContext.add(Logger, LoggerLive(context)),
    EffectContext.add(Profile, ProfileLive(profileModel, profileEmails)),
    EffectContext.add(
      TokenTable,
      TokenTableLive(tableService, validationTokensTableName)
    )
  );

  return Effect.runPromise(
    Effect.provide(
      validateProfileEmail(
        token,
        flowChoice,
        FF_UNIQUE_EMAIL_ENFORCEMENT_ENABLED,
        emailValidationUrls
      ),
      effectContext
    )
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
