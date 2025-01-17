import { ClientResponse } from "@shopify/graphql-client";
import {
  createStorefrontApiClient,
  type StorefrontQueries,
  type StorefrontMutations,
} from "@shopify/storefront-api-client";

export interface CodegenOperations {
  [key: string]: any;
}

// type Includes<
//   T extends string,
//   U extends string,
// > = T extends `${infer _Prefix}${U}${infer _Suffix}` ? true : false;

export namespace createStorefrontClient {
  export type Config = {
    publicAccessToken?: string;
    privateAccessToken?: string;
    apiVersion?: string;
    storeDomain: string;
    logger?: Parameters<typeof createStorefrontApiClient>[0]["logger"];
  };
  export type OperationReturn<
    GeneratedOperations extends CodegenOperations,
    RawGqlString extends string,
  > = RawGqlString extends keyof GeneratedOperations
    ? GeneratedOperations[RawGqlString]["return"]
    : any;
  export type OperationVariables<
    GeneratedOperations extends CodegenOperations,
    RawGqlString extends string,
  > = RawGqlString extends keyof GeneratedOperations
    ? Omit<
        GeneratedOperations[RawGqlString]["variables"],
        "country" | "language"
      >
    : any;

  // export type QueryFnReturn<
  //   Query extends string,
  //   GeneratedQueries extends CodegenOperations = StorefrontQueries,
  // > =
  //   Includes<Query, "@defer"> extends true
  //     ? ClientStreamIterator<OperationReturn<GeneratedQueries, Query>>
  //     : ClientResponse<OperationReturn<GeneratedQueries, Query>>;
  export type QueryFnReturn<
    Query extends string,
    GeneratedQueries extends CodegenOperations = StorefrontQueries,
  > = ClientResponse<OperationReturn<GeneratedQueries, Query>>;
}

export function createStorefrontClient<
  GeneratedQueries extends CodegenOperations = StorefrontQueries,
  GeneratedMutations extends CodegenOperations = StorefrontMutations,
>(options: createStorefrontClient.Config) {
  const client = createStorefrontApiClient({
    storeDomain: `https://${options.storeDomain}`,
    apiVersion: options.apiVersion || "2024-10",
    privateAccessToken: options.privateAccessToken,
    publicAccessToken: options.publicAccessToken,
    customFetchApi: fetch,
    clientName: "Solidifront Storefront Client",
    retries: 1,
    logger: options.logger,
  });

  return {
    async query<const RawGqlString extends string>(
      query: RawGqlString,
      options?: {
        variables?: createStorefrontClient.OperationVariables<
          GeneratedQueries,
          RawGqlString
        >;
      }
    ): Promise<
      Omit<
        createStorefrontClient.QueryFnReturn<RawGqlString, GeneratedQueries>,
        "headers"
      >
    > {
      const { headers, ...req } = (await client.request<
        createStorefrontClient.OperationReturn<GeneratedQueries, RawGqlString>
      >(query, {
        variables: options?.variables,
      })) as createStorefrontClient.QueryFnReturn<
        RawGqlString,
        GeneratedQueries
      >;

      return req;
    },
    async mutate<const RawGqlString extends string>(
      mutation: RawGqlString,
      options?: {
        variables: createStorefrontClient.OperationVariables<
          GeneratedMutations,
          RawGqlString
        >;
      }
    ) {
      return client.request<
        createStorefrontClient.OperationReturn<GeneratedMutations, RawGqlString>
      >(mutation, {
        variables: options?.variables,
      });
    },
  };
}

export type { StorefrontMutations, StorefrontQueries };
