import { ProfileModel } from "@pagopa/io-functions-commons/dist/src/models/profile";
import { Context } from "effect";

export class ProfileModelService extends Context.Tag("ProfileModelService")<
  ProfileModelService,
  ProfileModel
>() {}
