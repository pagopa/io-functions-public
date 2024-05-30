import { Effect, Option } from "effect";
import * as E from "fp-ts/lib/Either";
import * as O from "fp-ts/lib/Option";

export const fptsEitherToEffect = <L, R>(
  fpe: E.Either<L, R>
): Effect.Effect<R, L> =>
  fpe._tag === "Right" ? Effect.succeed(fpe.right) : Effect.fail(fpe.left);

export const fptsOptionToEffectOption = <S>(
  fpe: O.Option<S>
): Option.Option<S> =>
  fpe._tag === "None" ? Option.none() : Option.some(fpe.value);
