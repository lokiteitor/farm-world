// Matching a URL back to a route of the contract.
//
// Owner: W3-C.
//
// The simulated server is walked exactly like the Fastify registration is, over
// `routeDefinitions()`, so it cannot fall behind the contract: a route added to the map
// appears here with no change, and its absence from the handler table is a compile error
// rather than a 404 discovered by a panel.
//
// The matcher is built once from the map and is ordered so that a literal segment wins over
// a placeholder. That order matters for two real pairs of this contract:
// `POST /api/fields/merge` against `POST /api/fields/:fieldId/extend`, and
// `GET /api/machines/catalog` against `GET /api/machines`.

import {
  API_ROUTE_KEYS,
  pathParamNames,
  routeDefinition,
  type ApiRouteKey,
  type HttpMethod,
} from '~/shared/index';

export interface MatchedRoute {
  readonly routeKey: ApiRouteKey;
  readonly params: Readonly<Record<string, string>>;
}

interface CompiledRoute {
  readonly routeKey: ApiRouteKey;
  readonly method: HttpMethod;
  readonly segments: readonly string[];
  readonly paramNames: readonly string[];
  /** Literal segments, used to order the table: the more literal, the earlier. */
  readonly literalCount: number;
}

const COMPILED: readonly CompiledRoute[] = API_ROUTE_KEYS.map((routeKey) => {
  const route = routeDefinition(routeKey);
  const segments = route.path.split('/').filter((segment) => segment.length > 0);
  return {
    routeKey,
    method: route.method,
    segments,
    paramNames: pathParamNames(route.path),
    literalCount: segments.filter((segment) => !segment.startsWith(':')).length,
  };
})
  .slice()
  .sort((left, right) => right.literalCount - left.literalCount);

/** Splits a URL into its path segments and its query, ignoring the origin. */
export function splitUrl(url: string): {
  readonly segments: readonly string[];
  readonly query: Readonly<Record<string, string>>;
} {
  const withoutOrigin = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
  const [pathPart = '', queryPart = ''] = withoutOrigin.split('?');
  const query: Record<string, string> = {};
  if (queryPart.length > 0) {
    for (const [field, value] of new URLSearchParams(queryPart)) {
      query[field] = value;
    }
  }
  return {
    segments: pathPart
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment)),
    query,
  };
}

/** The route a method and a path resolve to, or null. */
export function matchRoute(method: string, url: string): MatchedRoute | null {
  const { segments } = splitUrl(url);
  for (const candidate of COMPILED) {
    if (candidate.method !== method || candidate.segments.length !== segments.length) {
      continue;
    }
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const expected = candidate.segments[index] ?? '';
      const actual = segments[index] ?? '';
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = actual;
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { routeKey: candidate.routeKey, params };
    }
  }
  return null;
}
