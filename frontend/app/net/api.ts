// The typed REST client, derived from the route map of the contract.
//
// Owner: W3-C. Consumed by the stores, by the panels of W4 to W6 and by the tests.
//
// Everything about a call is read from `API_ROUTES` and nothing is written twice
// (shared/api/README.md, section 7): the path and its placeholders, the schema that
// validates the body before it leaves, the schema that validates the reply, whether the
// call needs a session, whether it needs an idempotency key, and whether its reply goes
// through the reducer. A route added to the contract is therefore callable with no
// change here, and a route whose body gained a required field stops compiling at the
// call site instead of failing at the server.
//
// Four behaviours are implemented here and nowhere else:
//
//   1. Credentials are always included, because the refresh token is an httpOnly
//      cookie (stack section 6).
//   2. A single queued refresh serves a whole burst of concurrent 401s. The reason is
//      in net/session.ts: rotation invalidates the token it consumed, so concurrent
//      refreshes would destroy the session they were trying to save.
//   3. Every call is bounded by an `AbortController`, so a request that never answers
//      fails as a timeout instead of leaving a spinner turning forever.
//   4. A money moving route gets a client generated idempotency key, generated once
//      per attempt of the player and reused by every retry (plan section 6.3).

import {
  ApiClientError,
  ApiFailureKind,
  parseApiErrorBody,
  transportCodeForStatus,
} from '~/net/errors';
import { clientRuntime } from '~/net/runtime';
import { accessToken, clearSession, refreshAccessToken, setSession } from '~/net/session';
import { httpTransport, type HttpRequest, type HttpResponse } from '~/net/transport';
import {
  CONTRACT_VERSION_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  SHARED_CONTRACT_VERSION,
  ValidationCode,
  buildPath,
  routeDefinition,
  type ApiRouteKey,
  type RouteBody,
  type RouteParams,
  type RouteQuery,
  type RouteReply,
} from '~/shared/index';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Query fields of a route, loosened to what a URL can carry.
 *
 * The inferred query type of a route has already been coerced (`limit: number`), and a
 * query string only carries text, so the keys are checked against the schema and the
 * values are accepted in the three forms that stringify unambiguously.
 */
export type QueryFields<TKey extends ApiRouteKey> = {
  readonly [TField in keyof RouteQuery<TKey>]?: string | number | boolean;
};

export interface ApiCallOptions<TKey extends ApiRouteKey> {
  readonly params?: RouteParams<TKey>;
  readonly query?: QueryFields<TKey>;
  readonly body?: RouteBody<TKey>;
  /**
   * Idempotency key of a money moving route. Omitted means one is generated, which is
   * right for a single call and wrong for a retry: a retry must present the key of the
   * attempt it is repeating, or the server treats it as a second purchase.
   */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly timeoutRealMs?: number;
  /** Overrides `validateReplies` of the runtime for this one call. */
  readonly validateReply?: boolean;
  /**
   * Whether a 401 may trigger the refresh and one retry. False on the refresh route
   * itself, which is what stops the recovery from recursing.
   */
  readonly allowRefresh?: boolean;
}

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------

/**
 * A key for one attempt of the player at a money moving operation.
 *
 * Generated on the client because the key has to survive the failure that makes a
 * retry necessary: a key the server handed out would need a round trip that may be the
 * very one that failed. `crypto.randomUUID` where it exists, and a hex string from
 * `getRandomValues` otherwise; never `Math.random`, which is not a source of
 * uniqueness and is forbidden anyway wherever determinism matters.
 */
export function newIdempotencyKey(): string {
  const source = globalThis.crypto as
    | {
        randomUUID?: () => string;
        getRandomValues?: <T extends Uint8Array>(array: T) => T;
      }
    | undefined;
  if (source?.randomUUID !== undefined) {
    return source.randomUUID();
  }
  if (source?.getRandomValues !== undefined) {
    const bytes = source.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error(
    'No cryptographic random source is available, so no idempotency key can be generated.',
  );
}

// ---------------------------------------------------------------------------
// URL and headers
// ---------------------------------------------------------------------------

type LooseRecord = Readonly<Record<string, string | number | boolean | undefined>>;

/**
 * Widens an options field to the untyped shape the URL builder needs. The cast is
 * confined to these two helpers, so nothing else in the module needs one.
 */
function looseRecord(value: unknown): LooseRecord {
  return (value ?? {}) as LooseRecord;
}

function buildQueryString(query: LooseRecord): string {
  const search = new URLSearchParams();
  for (const [field, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    search.append(field, String(value));
  }
  const text = search.toString();
  return text.length === 0 ? '' : `?${text}`;
}

function buildUrl(routeKey: ApiRouteKey, options: ApiCallOptions<ApiRouteKey>): string {
  const route = routeDefinition(routeKey);
  const params = looseRecord(options.params) as Readonly<Record<string, string>>;
  let path: string;
  try {
    path = buildPath(route.path, params);
  } catch (cause) {
    throw new ApiClientError({
      code: ValidationCode.VALIDATION_FAILED,
      kind: ApiFailureKind.CONTRACT,
      status: 0,
      routeKey,
      details: { field: 'params' },
      cause,
    });
  }
  const query = options.query === undefined ? '' : buildQueryString(looseRecord(options.query));
  return `${clientRuntime().apiBase}${path}${query}`;
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

interface AbortPlan {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
  timedOut: boolean;
}

/**
 * Combines the caller's signal with a deadline. `AbortSignal.any` is not used because
 * the two reasons have to stay distinguishable: a call the player cancelled is not a
 * failure to report, and a call that ran out of time is.
 */
function planAbort(callerSignal: AbortSignal | undefined, timeoutRealMs: number): AbortPlan {
  const controller = new AbortController();
  const plan: AbortPlan = {
    signal: controller.signal,
    timedOut: false,
    dispose: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
  const onCallerAbort = (): void => {
    controller.abort();
  };
  const timer = setTimeout(() => {
    plan.timedOut = true;
    controller.abort();
  }, timeoutRealMs);
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  return plan;
}

async function send(
  routeKey: ApiRouteKey,
  options: ApiCallOptions<ApiRouteKey>,
  idempotencyKey: string | undefined,
): Promise<HttpResponse> {
  const route = routeDefinition(routeKey);
  const runtime = clientRuntime();
  const bodyText =
    route.body === undefined || options.body === undefined
      ? null
      : JSON.stringify(route.body.parse(options.body));

  const headers: Record<string, string> = {
    accept: route.replyContentType === undefined ? 'application/json' : route.replyContentType,
    [CONTRACT_VERSION_HEADER]: SHARED_CONTRACT_VERSION,
  };
  if (bodyText !== null) {
    headers['content-type'] = 'application/json';
  }
  const token = accessToken();
  if (route.requiresAuth && token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  if (idempotencyKey !== undefined) {
    headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;
  }

  const plan = planAbort(options.signal, options.timeoutRealMs ?? runtime.requestTimeoutRealMs);
  const request: HttpRequest = {
    method: route.method,
    url: buildUrl(routeKey, options),
    headers,
    body: bodyText,
    signal: plan.signal,
  };
  try {
    return await httpTransport()(request);
  } catch (cause) {
    if (plan.timedOut) {
      throw new ApiClientError({
        code: transportCodeForStatus(503),
        kind: ApiFailureKind.TIMEOUT,
        status: 0,
        routeKey,
        cause,
      });
    }
    if (options.signal?.aborted === true) {
      throw new ApiClientError({
        code: transportCodeForStatus(503),
        kind: ApiFailureKind.ABORTED,
        status: 0,
        routeKey,
        cause,
      });
    }
    throw new ApiClientError({
      code: transportCodeForStatus(503),
      kind: ApiFailureKind.NETWORK,
      status: 0,
      routeKey,
      cause,
    });
  } finally {
    plan.dispose();
  }
}

function decodeReply(
  routeKey: ApiRouteKey,
  response: HttpResponse,
  validate: boolean,
): RouteReply<ApiRouteKey> {
  const route = routeDefinition(routeKey);
  const raw: unknown =
    route.replyContentType === undefined
      ? safeJson(routeKey, response.bodyText)
      : response.bodyText;
  if (!validate) {
    return raw as RouteReply<ApiRouteKey>;
  }
  const parsed = route.reply.safeParse(raw);
  if (!parsed.success) {
    throw new ApiClientError({
      code: ValidationCode.VALIDATION_FAILED,
      kind: ApiFailureKind.CONTRACT,
      status: response.status,
      routeKey,
      details: { field: parsed.error.issues[0]?.path.join('.') ?? 'reply' },
      cause: parsed.error,
    });
  }
  return parsed.data as RouteReply<ApiRouteKey>;
}

function safeJson(routeKey: ApiRouteKey, bodyText: string): unknown {
  if (bodyText.length === 0) {
    return {};
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch (cause) {
    throw new ApiClientError({
      code: ValidationCode.VALIDATION_FAILED,
      kind: ApiFailureKind.CONTRACT,
      status: 0,
      routeKey,
      details: { field: 'reply' },
      cause,
    });
  }
}

function failureFor(routeKey: ApiRouteKey, response: HttpResponse): ApiClientError {
  const body = parseApiErrorBody(response.bodyText);
  if (body === null) {
    return new ApiClientError({
      code: transportCodeForStatus(response.status),
      kind: ApiFailureKind.SERVER,
      status: response.status,
      routeKey,
    });
  }
  return new ApiClientError({
    code: body.code,
    kind: ApiFailureKind.SERVER,
    status: response.status,
    routeKey,
    details: body.details,
  });
}

/** Whether a 401 is the kind the refresh can fix. */
function isRecoverableUnauthorised(error: ApiClientError): boolean {
  return (
    error.status === 401 &&
    (error.code === ValidationCode.AUTH_TOKEN_EXPIRED ||
      error.code === ValidationCode.AUTH_REQUIRED)
  );
}

/** Refreshes the access token through the contract route, without recursing. */
async function performRefresh(): Promise<{ accessToken: string; expiresAtRealMs: number }> {
  const response = await send('POST /api/auth/refresh', { allowRefresh: false }, undefined);
  if (response.status < 200 || response.status >= 300) {
    throw failureFor('POST /api/auth/refresh', response);
  }
  const reply = decodeReply(
    'POST /api/auth/refresh',
    response,
    true,
  ) as RouteReply<'POST /api/auth/refresh'>;
  return {
    accessToken: reply.accessToken,
    expiresAtRealMs: Number(reply.accessTokenExpiresAtRealMs),
  };
}

/**
 * Calls one route of the contract.
 *
 * Presence of `params` and `body` is checked at run time and not in the type, and the
 * choice is deliberate: making them conditionally required produced an options type
 * that every call site had to satisfy with a cast, which trades one silent mistake for
 * another. What the type does guarantee is the shape of what is passed, and what the
 * run time guarantees is that a missing body is refused at the boundary with
 * `VALIDATION_FAILED`, the same code the server would answer.
 */
export async function apiCall<TKey extends ApiRouteKey>(
  routeKey: TKey,
  options: ApiCallOptions<TKey> = {},
): Promise<RouteReply<TKey>> {
  const route = routeDefinition(routeKey);
  const wide = options as unknown as ApiCallOptions<ApiRouteKey>;

  if (route.body !== undefined && options.body === undefined) {
    throw new ApiClientError({
      code: ValidationCode.VALIDATION_FAILED,
      kind: ApiFailureKind.CONTRACT,
      status: 0,
      routeKey,
      details: { field: 'body' },
    });
  }
  const idempotencyKey =
    route.requiresIdempotencyKey === true
      ? (options.idempotencyKey ?? newIdempotencyKey())
      : undefined;
  const validate = options.validateReply ?? clientRuntime().validateReplies;
  const allowRefresh = options.allowRefresh ?? true;

  let response = await send(routeKey, wide, idempotencyKey);
  if (response.status === 401 && allowRefresh && route.requiresAuth) {
    const failure = failureFor(routeKey, response);
    if (isRecoverableUnauthorised(failure)) {
      const token = await refreshAccessToken(performRefresh);
      if (token === null) {
        throw failure;
      }
      // The retry presents the same idempotency key, which is the whole reason the key
      // is generated once per attempt of the player and not once per request.
      response = await send(routeKey, { ...wide, allowRefresh: false }, idempotencyKey);
    }
  }
  if (response.status < 200 || response.status >= 300) {
    throw failureFor(routeKey, response);
  }
  return decodeReply(routeKey, response, validate) as RouteReply<TKey>;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/**
 * Opens a session and stores the access token. Register and login share the reply
 * shape, so they share this path (shared/api/schemas/auth.ts).
 */
export async function apiOpenSession(
  routeKey: 'POST /api/auth/register' | 'POST /api/auth/login',
  body: RouteBody<'POST /api/auth/register'> | RouteBody<'POST /api/auth/login'>,
): Promise<RouteReply<'POST /api/auth/login'>> {
  const reply = (await apiCall(routeKey, {
    // Both bodies are accepted by both schemas as far as this function is concerned:
    // the route entry validates the one that applies before the request leaves.
    body: body as RouteBody<'POST /api/auth/register'> & RouteBody<'POST /api/auth/login'>,
    allowRefresh: false,
  })) as RouteReply<'POST /api/auth/login'>;
  setSession({
    accessToken: reply.accessToken,
    expiresAtRealMs: Number(reply.accessTokenExpiresAtRealMs),
  });
  return reply;
}

/** Closes the session on the server and locally, whatever the server answers. */
export async function apiCloseSession(): Promise<void> {
  try {
    await apiCall('POST /api/auth/logout', { allowRefresh: false });
  } finally {
    clearSession();
  }
}

/**
 * Obtains an access token from the refresh cookie alone. This is the first call of a
 * reloaded page: there is no access token in memory and the cookie is the session.
 * Returns false when there is no live session, which is not an error.
 */
export async function apiResumeSession(): Promise<boolean> {
  try {
    setSession(await performRefresh());
    return true;
  } catch {
    clearSession();
    return false;
  }
}

/** Requests a single use ticket and returns the URL of the WebSocket handshake. */
export async function apiWsTicket(): Promise<{ url: string; expiresAtRealMs: number }> {
  const reply = await apiCall('POST /api/auth/ws-ticket');
  const runtime = clientRuntime();
  const path = reply.path.length > 0 ? reply.path : runtime.wsPath;
  return {
    url: `${path}?ticket=${encodeURIComponent(reply.ticket)}`,
    expiresAtRealMs: Number(reply.expiresAtRealMs),
  };
}
