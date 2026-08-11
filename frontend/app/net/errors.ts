// The typed failure of a client call.
//
// Owner: W3-C.
//
// One rule, from shared/api/README.md section 3: the client branches on `code` and
// never on the HTTP status. The status is kept on the error because it is useful in a
// log and in a metric, and because a status that contradicts the code of the body is
// itself a finding worth seeing; nothing in the interface is allowed to switch on it.
//
// Transport level failures get a code too, so that a caller has exactly one shape to
// handle. A socket that never answers and a service that answers 503 are the same
// event as far as a panel is concerned: `SERVICE_UNAVAILABLE`.

import {
  ApiTransportCode,
  apiErrorMessage,
  apiErrorReplySchema,
  type ApiErrorCode,
  type ApiErrorDetails,
} from '~/shared/index';

/** Why a call failed, beyond the code the body carried. */
export const ApiFailureKind = {
  /** The server answered with an error body of the contract. */
  SERVER: 'SERVER',
  /** The request never completed: no network, DNS, TLS, or the socket dropped. */
  NETWORK: 'NETWORK',
  /** The request exceeded `requestTimeoutRealMs`. */
  TIMEOUT: 'TIMEOUT',
  /** The caller aborted it through its own signal. */
  ABORTED: 'ABORTED',
  /** The reply arrived and did not match the schema of its route. */
  CONTRACT: 'CONTRACT',
} as const;
export type ApiFailureKind = (typeof ApiFailureKind)[keyof typeof ApiFailureKind];

export interface ApiClientErrorInit {
  readonly code: ApiErrorCode;
  readonly kind: ApiFailureKind;
  readonly status: number;
  readonly routeKey: string;
  readonly details?: ApiErrorDetails | undefined;
  readonly cause?: unknown;
}

/**
 * A failed call. `message` comes from the shared table and never from the text that
 * arrived on the wire: that text exists for the logs and for a client without the
 * table (shared/api/README.md, rule 7.4).
 */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly kind: ApiFailureKind;
  readonly status: number;
  readonly routeKey: string;
  readonly details: ApiErrorDetails | undefined;

  constructor(init: ApiClientErrorInit) {
    super(apiErrorMessage(init.code), init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiClientError';
    this.code = init.code;
    this.kind = init.kind;
    this.status = init.status;
    this.routeKey = init.routeKey;
    this.details = init.details;
  }

  /** True when the failure is a property of the connection and not of the request. */
  get isTransient(): boolean {
    return (
      this.kind === ApiFailureKind.NETWORK ||
      this.kind === ApiFailureKind.TIMEOUT ||
      this.code === ApiTransportCode.SERVICE_UNAVAILABLE ||
      this.code === ApiTransportCode.RATE_LIMITED
    );
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

/**
 * Reads the error body of a failing reply. Returns null when the body is not one,
 * which happens for a failure produced by a proxy rather than by the API.
 */
export function parseApiErrorBody(
  bodyText: string,
): { readonly code: ApiErrorCode; readonly details: ApiErrorDetails | undefined } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return null;
  }
  const result = apiErrorReplySchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  return { code: result.data.error.code, details: result.data.error.details };
}

/** The transport code an unexplained HTTP status maps to. */
export function transportCodeForStatus(status: number): ApiErrorCode {
  if (status === 429) {
    return ApiTransportCode.RATE_LIMITED;
  }
  if (status === 501) {
    return ApiTransportCode.NOT_IMPLEMENTED;
  }
  if (status === 503 || status === 502 || status === 504) {
    return ApiTransportCode.SERVICE_UNAVAILABLE;
  }
  return ApiTransportCode.INTERNAL_ERROR;
}
