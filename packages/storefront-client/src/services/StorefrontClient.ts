import { Effect, Layer, Redacted, Schedule, pipe } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { type ClientOptions, GraphQLJsonBody } from "../schemas.js";
import { BuildStorefrontApiUrl } from "./BuildStorefrontApiUrl.js";
import { MakePublicHeadersBuilder } from "./MakePublicHeadersBuilder.js";
import { MakePrivateHeadersBuilder } from "./MakePrivateHeadersBuilder.js";
import { MakeDefaultHeadersBuilder } from "./MakeDefaultHeadersBuilder.js";
import { BuildDefaultClientOptions } from "./BuildDefaultClientOptions.js";
import { RETRIABLE_STATUS_CODES, RETRY_WAIT_TIME } from "../constants.js";
import {
  BadRequestStatusError,
  ForbiddenStatusError,
  LockedStatusError,
  NotFoundStatusError,
  PaymentRequiredStatusError,
  StorefrontServerStatusError,
} from "../errors.js";

import * as ResponseErrors from "../data/ResponseErrors.js";
import * as ClientResponse from "../data/ClientResponse.js";

export type RequestOptions<Variables = any> = Omit<
  ClientOptions["Encoded"],
  "retries" | "storeName"
> & {
  buyerIp?: string;
} & (Variables extends {
    [x: string]: never;
  }
    ? {
        variables?: never;
      }
    : {
        variables: Variables;
      });

export class StorefrontClient extends Effect.Service<StorefrontClient>()(
  "@solidifront/storefront-client/StorefrontClient",
  {
    effect: Effect.gen(function* () {
      const defaultOptions = yield* BuildDefaultClientOptions;

      const buildEndpoint = yield* BuildStorefrontApiUrl;
      const publicHeadersBuilder = yield* MakePublicHeadersBuilder;
      const privateHeadersBuilder = yield* MakePrivateHeadersBuilder;
      const defaultHeaderBuilder = yield* MakeDefaultHeadersBuilder;

      const defaultClient = yield* HttpClient.HttpClient;

      const defaultEndpoint = buildEndpoint({
        apiVersion: defaultOptions.apiVersion,
        storeName: defaultOptions.storeName,
      });

      const client = defaultClient.pipe(
        HttpClient.mapRequestInput((request) =>
          HttpClientRequest.setHeaders(request, {
            ...defaultHeaderBuilder.makeFallback(request, {
              contentType: defaultOptions.contentType,
              apiVersion: defaultOptions.apiVersion,
            }),
            ...publicHeadersBuilder.makeFallback(request, {
              publicAccessToken: defaultOptions.publicAccessToken,
            }),
            ...privateHeadersBuilder.makeFallback(request, {
              privateAccessToken: defaultOptions.privateAccessToken
                ? Redacted.value(defaultOptions.privateAccessToken)
                : undefined,
            }),
          })
        ),
        HttpClient.transformResponse((response) =>
          response.pipe(
            Effect.filterOrFail(
              (res) => res.status !== BadRequestStatusError.status,
              () => new BadRequestStatusError()
            ),
            Effect.filterOrFail(
              (res) => res.status !== PaymentRequiredStatusError.status,
              () => new PaymentRequiredStatusError()
            ),
            Effect.filterOrFail(
              (res) => res.status !== ForbiddenStatusError.status,
              () => new ForbiddenStatusError()
            ),
            Effect.filterOrFail(
              (res) => res.status !== NotFoundStatusError.status,
              () => new NotFoundStatusError()
            ),
            Effect.filterOrFail(
              (res) => res.status !== LockedStatusError.status,
              () => new LockedStatusError()
            ),
            Effect.filterOrElse(
              (res) => res.status <= 500,
              (res) => new StorefrontServerStatusError(res.status)
            )
          )
        ),
        HttpClient.retry({
          times: defaultOptions.retries,
          schedule: Schedule.spaced(`${RETRY_WAIT_TIME} millis`),
          while: (error) => {
            if (error._tag === "ResponseError") {
              return RETRIABLE_STATUS_CODES.includes(error.response.status);
            }
            return false;
          },
        })
      );

      const makeRequest = <const Operation extends string>(
        operation: Operation,
        options?: RequestOptions
      ) =>
        Effect.gen(function* () {
          let endpoint = defaultEndpoint;
          if (options?.apiVersion)
            endpoint = buildEndpoint({
              apiVersion: options.apiVersion,
              storeName: defaultOptions.storeName,
            });

          const request = HttpClientRequest.post(endpoint).pipe(
            HttpClientRequest.setHeaders({
              ...defaultHeaderBuilder.make({
                contentType: options?.contentType,
                apiVersion: options?.apiVersion,
              }),
              ...privateHeadersBuilder.make({
                privateAccessToken: options?.privateAccessToken,
                buyerIp: options?.buyerIp,
              }),
              ...publicHeadersBuilder.make({
                publicAccessToken: options?.publicAccessToken,
              }),
            }),
            HttpClientRequest.bodyJson({
              query: operation,
              variables: options?.variables,
            })
          );
          return yield* request;
        });

      const executeRequest = <const Operation extends string, TData = any>(
        operation: Operation,
        options?: RequestOptions
      ) =>
        Effect.gen(function* () {
          const request = yield* makeRequest(operation, options);
          const response = yield* client.execute(request);
          const json = yield* pipe(
            response,
            HttpClientResponse.schemaBodyJson(GraphQLJsonBody)
          );

          if (json.errors) {
            return ClientResponse.make<TData>({
              extensions: json.extensions,
              errors: ResponseErrors.make({
                networkStatusCode: response.status,
                graphQLErrors: json.errors,
              }),
            });
          }

          return ClientResponse.make<TData>({
            data: json.data as TData,
            extensions: json.extensions,
          });
        }).pipe(
          Effect.catchAll((error) => {
            if (
              error._tag === "BadRequestStatusError" ||
              error._tag === "ForbiddenStatusError" ||
              error._tag === "LockedStatusError" ||
              error._tag === "NotFoundStatusError" ||
              error._tag === "PaymentRequiredStatusError" ||
              error._tag === "StorefrontServerStatusError"
            ) {
              return Effect.succeed(
                ClientResponse.make<TData>({
                  errors: ResponseErrors.make({
                    networkStatusCode: error.status,
                    graphQLErrors: [],
                    message: error.message,
                  }),
                })
              );
            }
            return Effect.fail(error);
          })
        );

      return {
        request: executeRequest,
        buildApiUrl: buildEndpoint,
      };
    }),
    dependencies: [
      BuildStorefrontApiUrl.Default,
      MakePublicHeadersBuilder.Default,
      MakePrivateHeadersBuilder.Default,
      MakeDefaultHeadersBuilder.Default,
      FetchHttpClient.layer,
    ],
  }
) {}

export const layer = (options: ClientOptions["Encoded"]) => {
  return Layer.mergeAll(
    StorefrontClient.Default.pipe(
      Layer.provide(BuildDefaultClientOptions.Default(options))
    )
  );
};