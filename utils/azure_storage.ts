import { GetTableEntityOptions, TableClient } from "@azure/data-tables";
import { Either } from "fp-ts/lib/Either";
import * as E from "fp-ts/lib/Either";
import { none, Option, some } from "fp-ts/lib/Option";

export type StorageError = Error & {
  readonly code?: string;
};

const ResourceNotFoundCode = "ResourceNotFound";

/**
 * Retrieve an entity from table storage
 *
 * @param tableClient the Azure TableClient
 * @param partitionKey
 * @param rowKey
 * @param options
 */
export const retrieveTableEntity = async (
  tableClient: TableClient,
  partitionKey: string,
  rowKey: string,
  options?: GetTableEntityOptions
): Promise<Either<StorageError, Option<unknown>>> =>
  tableClient.getEntity(partitionKey, rowKey, options).then(
    result => E.right(some(result)),
    err => {
      const errorAsStorageError = err as StorageError;
      if (errorAsStorageError.code === ResourceNotFoundCode) {
        return E.right(none);
      }
      return E.left(errorAsStorageError);
    }
  );
