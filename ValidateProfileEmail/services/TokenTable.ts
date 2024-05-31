import * as crypto from "crypto";
import {
  StorageError,
  retrieveTableEntity
} from "@pagopa/io-functions-commons/dist/src/utils/azure_storage";
import { Context, Effect, Either, Option } from "effect";
import { TableService } from "azure-storage";
import { UnknownException } from "effect/Cause";
import { fptsEitherToEffect, fptsOptionToEffectOption } from "../transformers";

interface TokenTableService {
  readonly get: (
    token: string
  ) => Effect.Effect<
    Either.Either<Option.Option<unknown>, UnknownException | StorageError>,
    UnknownException
  >;
}

export class TokenTable extends Context.Tag("TokenTableService")<
  TokenTable,
  TokenTableService
>() {}

export const TokenTableLive = (
  tableService: TableService,
  validationTokensTableName: string
): TokenTableService => ({
  get: token =>
    Effect.gen(function*(_) {
      // STEP 1: Find and verify validation token
      // A token is in the following format:
      // [tokenId ULID] + ":" + [validatorHash crypto.randomBytes(12)]
      // Split the token to get tokenId and validatorHash
      const [tokenId, validator] = token.split(":");
      const hash = yield* _(
        Effect.try(() =>
          crypto
            .createHash("sha256")
            .update(validator)
            .digest("hex")
        )
      );
      return yield* _(
        Effect.tryPromise(() =>
          retrieveTableEntity(
            tableService,
            validationTokensTableName,
            tokenId,
            hash
          )
        ),
        Effect.flatMap(fptsEitherToEffect),
        Effect.map(fptsOptionToEffectOption),
        Effect.either
      );
    })
});
