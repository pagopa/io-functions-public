import {
  ProfileModel,
  RetrievedProfile
} from "@pagopa/io-functions-commons/dist/src/models/profile";
import { EmailString, FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { Effect, Context, Option, pipe } from "effect";
import { CosmosErrors } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { UnknownException } from "effect/Cause";
import {
  IProfileEmailReader,
  isEmailAlreadyTaken
} from "@pagopa/io-functions-commons/dist/src/utils/unique_email_enforcement";
import { fptsEitherToEffect, fptsOptionToEffectOption } from "../transformers";

interface ProfileService {
  readonly get: (
    fiscalCode: FiscalCode
  ) => Effect.Effect<
    Option.Option<RetrievedProfile>,
    CosmosErrors | UnknownException
  >;
  readonly update: (
    profile: RetrievedProfile
  ) => Effect.Effect<RetrievedProfile, CosmosErrors | UnknownException>;
  readonly checkIfEmailIsTaken: (
    email: EmailString
  ) => Effect.Effect<boolean, UnknownException>;
}

export class Profile extends Context.Tag("ProfileService")<
  Profile,
  ProfileService
>() {}

export const ProfileLive = (
  profileModel: ProfileModel,
  profileEmails: IProfileEmailReader
): ProfileService => ({
  get: fiscalCode =>
    pipe(
      Effect.tryPromise(() =>
        profileModel.findLastVersionByModelId([fiscalCode])()
      ),
      Effect.flatMap(fptsEitherToEffect),
      Effect.map(fptsOptionToEffectOption)
    ),
  update: profile =>
    pipe(
      Effect.tryPromise(() => profileModel.update(profile)()),
      Effect.flatMap(fptsEitherToEffect)
    ),
  checkIfEmailIsTaken: email =>
    Effect.tryPromise(() =>
      isEmailAlreadyTaken(email)({
        profileEmails
      })
    )
});
