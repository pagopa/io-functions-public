import { CosmosClient } from "@azure/cosmos";
import { GetPropertiesResponse, TableServiceClient } from "@azure/data-tables";
import { toError } from "fp-ts/lib/Either";
import { TaskEither } from "fp-ts/lib/TaskEither";
import fetch from "node-fetch";
import { pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { apply } from "fp-ts";
import * as RA from "fp-ts/lib/ReadonlyArray";
import { getConfig, IConfig } from "./config";

type ProblemSource = "AzureCosmosDB" | "AzureStorage" | "Config" | "Url";
// eslint-disable-next-line functional/prefer-readonly-type, @typescript-eslint/naming-convention
export type HealthProblem<S extends ProblemSource> = string & { __source: S };
export type HealthCheck<
  S extends ProblemSource = ProblemSource,
  T = true
> = TaskEither<ReadonlyArray<HealthProblem<S>>, T>;

// format and cast a problem message with its source
const formatProblem = <S extends ProblemSource>(
  source: S,
  message: string
): HealthProblem<S> => `${source}|${message}` as HealthProblem<S>;

// utility to format an unknown error to an arry of HealthProblem
const toHealthProblems = <S extends ProblemSource>(source: S) => (
  e: unknown
): ReadonlyArray<HealthProblem<S>> => [
  formatProblem(source, toError(e).message)
];

/**
 * Check application's configuration is correct
 *
 * @returns either true or an array of error messages
 */
export const checkConfigHealth = (): HealthCheck<"Config", IConfig> =>
  pipe(
    getConfig(),
    TE.fromEither,
    TE.mapLeft(errors =>
      // give each problem its own line
      errors.map(e => formatProblem("Config", readableReport([e])))
    )
  );

/**
 * Check the application can connect to an Azure CosmosDb instances
 *
 * @param dbUri uri of the database
 * @param dbUri connection string for the storage
 *
 * @returns either true or an array of error messages
 */
export const checkAzureCosmosDbHealth = (
  dbUri: string,
  dbKey?: string
): HealthCheck<"AzureCosmosDB", true> =>
  pipe(
    TE.tryCatch(() => {
      const client = new CosmosClient({
        endpoint: dbUri,
        key: dbKey
      });
      return client.getDatabaseAccount();
    }, toHealthProblems("AzureCosmosDB")),
    TE.map(_ => true)
  );

/**
 * Check the application can connect to an Azure Storage
 *
 * @param connStr connection string for the storage
 *
 * @returns either true or an array of error messages
 */
export const checkAzureStorageHealth = (
  connStr: string
): HealthCheck<"AzureStorage"> =>
  pipe(
    [TableServiceClient.fromConnectionString],
    // for each, create a task that wraps getServiceProperties
    RA.map(createService =>
      TE.tryCatch(
        () =>
          new Promise<GetPropertiesResponse>((resolve, reject) =>
            createService(connStr)
              .getProperties()
              .then(
                result => {
                  resolve(result);
                },
                err => {
                  reject(err.message.replace(/\n/gim, " ")); // avoid newlines
                }
              )
          ),
        toHealthProblems("AzureStorage")
      )
    ),
    TE.sequenceSeqArray,
    TE.map(_ => true)
  );

/**
 * Check a url is reachable
 *
 * @param url url to connect with
 *
 * @returns either true or an array of error messages
 */
export const checkUrlHealth = (url: string): HealthCheck<"Url", true> =>
  pipe(
    TE.tryCatch(() => fetch(url, { method: "HEAD" }), toHealthProblems("Url")),
    TE.map(_ => true)
  );

/**
 * Execute all the health checks for the application
 *
 * @returns either true or an array of error messages
 */
export const checkApplicationHealth = (): HealthCheck<ProblemSource, true> =>
  pipe(
    checkConfigHealth(),
    TE.chainW(config =>
      apply.sequenceT(TE.ApplySeq)<
        ReadonlyArray<HealthProblem<ProblemSource>>,
        // eslint-disable-next-line functional/prefer-readonly-type
        Array<TaskEither<ReadonlyArray<HealthProblem<ProblemSource>>, true>>
      >(
        checkAzureCosmosDbHealth(config.COSMOSDB_URI, config.COSMOSDB_KEY),
        checkAzureStorageHealth(config.StorageConnection),
        checkUrlHealth(config.VALIDATION_CALLBACK_URL)
      )
    ),
    TE.map(_ => true)
  );
