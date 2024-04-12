import { Effect, Context as EffectContext } from "effect";
import { Context as AzureFunctionContext } from "@azure/functions";
import { UnknownException } from "effect/Cause";

export type ContextLoggerType = {
  readonly info: (message: string) => Effect.Effect<void, UnknownException>;
  readonly error: (message: string) => Effect.Effect<void, UnknownException>;
};

export class ContextLogger extends EffectContext.Tag("ContextLogger")<
  ContextLogger,
  ContextLoggerType
>() {}

// Implementation
export const buildContextLogger = (context: AzureFunctionContext) => {
  return {
    info: (message: string) => Effect.try(() => context.log.info(message)),
    error: (message: string) => Effect.try(() => context.log.error(message))
  };
};
