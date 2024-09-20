import { IProfileEmailReader } from "@pagopa/io-functions-commons/dist/src/utils/unique_email_enforcement";
import { Context } from "effect";

export class ProfileEmailsReaderService extends Context.Tag(
  "ProfileEmailsReaderService"
)<ProfileEmailsReaderService, IProfileEmailReader>() {}
