import { TableService } from "azure-storage";
import { Context } from "effect";

export class TokenTable extends Context.Tag("TokenTable")<
  TokenTable,
  TableService
>() {}
