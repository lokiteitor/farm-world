// The HTTP client of the scenario, derived from the route map.
//
// Owner: workflow W7-B. `scripts/smoke/**`.
//
// It takes the key of `shared/api/routes.ts` and nothing else, which is the same thing the
// Fastify registration and the typed client of the frontend do (plan section 7). Three
// consequences, and they are the reason the client exists instead of a handful of `fetch`
// calls:
//
//   1. The request body is typed as `RouteBody<K>`, so a field the contract does not declare
//      does not compile. That is what makes `npx tsc -p scripts/smoke/tsconfig.json` a real
//      gate and not a formality.
//   2. The reply is parsed with the very schema the route declares, so every call is also a
//      contract test: a server that answers a shape the contract does not describe fails here
//      with the path of the offending field, and never as a confusing assertion three steps
//      later.
//   3. The idempotency key is demanded exactly where `requiresIdempotencyKey` is set, so the
//      scenario cannot forget one and cannot invent one where the contract wants none.

import {
  API_ROUTES,
  buildPath,
  CONTRACT_VERSION_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  isApiErrorReply,
  routeDefinition,
  SHARED_CONTRACT_VERSION,
  type ApiErrorCode,
  type ApiRouteKey,
  type RouteBody,
  type RouteParams,
  type RouteQuery,
  type RouteReply,
} from '../../shared/index.js';

/** `never` collapses awkwardly in a generic, so the absence of a schema becomes an empty bag. */
type ParamsOf<TKey extends ApiRouteKey> = [RouteParams<TKey>] extends [never]
  ? Record<string, never>
  : RouteParams<TKey>;
type QueryOf<TKey extends ApiRouteKey> = [RouteQuery<TKey>] extends [never]
  ? Record<string, never>
  : RouteQuery<TKey>;
type BodyOf<TKey extends ApiRouteKey> = [RouteBody<TKey>] extends [never]
  ? undefined
  : RouteBody<TKey>;

export interface CallInit<TKey extends ApiRouteKey> {
  readonly params?: ParamsOf<TKey>;
  readonly query?: Partial<QueryOf<TKey>>;
  readonly body?: BodyOf<TKey>;
  /** Required by the routes the map marks, refused by the ones it does not. */
  readonly idempotencyKey?: string;
}

/** A refusal of the API, with the code the scenario asserts against. */
export class SmokeApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | null;
  readonly routeKey: string;
  readonly details: unknown;

  constructor(routeKey: string, status: number, code: ApiErrorCode | null, details: unknown) {
    super(`${routeKey} respondio ${String(status)}${code === null ? '' : ` (${code})`}`);
    this.name = 'SmokeApiError';
    this.routeKey = routeKey;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ApiClient {
  private accessToken: string | null = null;

  /** Requests issued, so the run can state how far it stayed from the rate limit. */
  private requests = 0;

  constructor(private readonly baseUrl: string) {}

  get requestCount(): number {
    return this.requests;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /** Issues a request and parses the reply with the schema the contract declares. */
  async call<TKey extends ApiRouteKey>(
    key: TKey,
    init: CallInit<TKey> = {},
  ): Promise<RouteReply<TKey>> {
    const route = routeDefinition(key);
    const params: Readonly<Record<string, string>> = Object.fromEntries(
      Object.entries((init.params ?? {}) as Record<string, unknown>).map(([name, value]) => [
        name,
        String(value),
      ]),
    );
    const url = new URL(buildPath(route.path, params), this.baseUrl);
    for (const [name, value] of Object.entries((init.query ?? {}) as Record<string, unknown>)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(name, String(value));
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      [CONTRACT_VERSION_HEADER]: SHARED_CONTRACT_VERSION,
    };
    if (route.requiresAuth && this.accessToken !== null) {
      headers['authorization'] = `Bearer ${this.accessToken}`;
    }
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (route.requiresIdempotencyKey === true) {
      if (init.idempotencyKey === undefined) {
        throw new Error(`${key} exige Idempotency-Key y la llamada no la aporta.`);
      }
      headers[IDEMPOTENCY_KEY_HEADER] = init.idempotencyKey;
    } else if (init.idempotencyKey !== undefined) {
      throw new Error(`${key} no admite Idempotency-Key y la llamada la aporta.`);
    }

    this.requests += 1;
    const response = await fetch(url, {
      method: route.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    const payload: unknown = text.length === 0 ? null : JSON.parse(text);

    if (!response.ok) {
      if (isApiErrorReply(payload)) {
        throw new SmokeApiError(key, response.status, payload.error.code, payload.error.details);
      }
      throw new SmokeApiError(key, response.status, null, payload);
    }

    return API_ROUTES[key].reply.parse(payload) as RouteReply<TKey>;
  }

  /**
   * Issues a request that is expected to fail, and returns the refusal.
   *
   * The negative assertions of plan section 10 are as load bearing as the positive ones: a
   * fifth machine in a garage of four has to be refused with a conflict, and a run where it
   * succeeds is a broken game and not a broken test. Wrapping the expectation here keeps every
   * one of them one line at the call site.
   */
  async expectRefusal<TKey extends ApiRouteKey>(
    key: TKey,
    init: CallInit<TKey> = {},
  ): Promise<SmokeApiError> {
    try {
      await this.call(key, init);
    } catch (error) {
      if (error instanceof SmokeApiError) {
        return error;
      }
      throw error;
    }
    throw new Error(`${key} fue aceptada y el recorrido exige que sea rechazada.`);
  }
}
