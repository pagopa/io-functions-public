import { AzureFunction, Context, HttpRequest } from "@azure/functions";

const httpTrigger: AzureFunction = async (
  context: Context,
  _: HttpRequest
): Promise<void> => {
  // tslint:disable-next-line: no-object-mutation
  context.res = {
    body: "Test function"
  };
};

export default httpTrigger;
