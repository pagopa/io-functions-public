import { Effect, Context } from "effect";
import { Context as AzureContext } from "@azure/functions";
import { UnknownException } from "effect/Cause";

export class Logger extends Context.Tag("Logger")<
  Logger,
  { readonly error: (message: string) => Effect.Effect<void, UnknownException>
    readonly verbose: (message: string) => Effect.Effect<void, UnknownException>
  }
>() {}

export const LoggerLive = (context: AzureContext) => ({
  error: (message: string) => Effect.try(() => context.log.error(message)),
  verbose: (message: string) => Effect.try(() => context.log.verbose(message))
});
