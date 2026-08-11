// Registration of a route from the contract, with its guards derived from the flags.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// `defineRoute` is how every module of every later workflow registers a route, and it takes
// the key of the contract rather than a method and a path. Everything else follows from the
// entry of `shared/api/routes.ts`:
//
//   - the schemas of the parameters, the query and the body, so validation cannot drift from
//     the declaration;
//   - the reply schema, which the serialiser enforces, so a handler that builds the wrong
//     shape fails in development instead of in the client;
//   - the summary and the area, which become the OpenAPI operation;
//   - and the four guards, each derived from a flag and never from a hand written list, which
//     is the requirement of `docs/handoff/NOTES-W2c.md`, item 1.4: a route that starts moving
//     money cannot forget the idempotency header, because nobody has to remember to add it.
//
// The order of the guards is fixed: the development flag first, because a disabled route must
// not even look at credentials; then the session; then the idempotency record, which is per
// player and therefore needs the session; and last the advance of the player.
//
// The advance is attached to the read paths and not to the sequenced ones. A sequenced route
// mutates, so it runs inside `withPlayerAdvanced`, which advances the player in the same
// transaction as its own writes; advancing again in a `preHandler` would open a second
// transaction, take the player lock twice and change nothing. Every sequenced route must use
// that wrapper: it is also the only thing that returns the `seq` its reply has to carry.
//
// The typing is worth the two conditional helpers below. `defineRoute` gives the handler a
// request whose `params`, `query` and `body` come from the very schemas the route declares,
// and demands a return value of exactly `RouteReply<K>`; a handler that returns a field the
// contract does not declare does not compile, which is a better place to find out than the
// response serialiser.

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { advancePlayerNow } from '../lib/advancePlayer.js';
import {
  API_ROUTES,
  apiErrorReplySchema,
  notImplemented,
  routeDefinition,
  type ApiRouteKey,
  type RouteBody,
  type RouteParams,
  type RouteQuery,
  type RouteReply,
} from '../shared/index.js';
import { authGuard, idempotencyGuard, readClock, requirePlayer } from './auth.js';
import { devGuard } from './devGuard.js';

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

/** The request of a route, with the three inputs at the types the contract declares. */
export type TypedRequest<TKey extends ApiRouteKey> = FastifyRequest<{
  Params: ParamsOf<TKey>;
  Querystring: QueryOf<TKey>;
  Body: BodyOf<TKey>;
}>;

/** The handler of a route. Returns the reply; the framework serialises it. */
export type TypedHandler<TKey extends ApiRouteKey> = (
  request: TypedRequest<TKey>,
  reply: FastifyReply,
) => Promise<RouteReply<TKey>>;

/**
 * The `preHandler` that advances the player before a read path.
 *
 * It is what makes the simulation self repairing: if the worker is down, the first request of
 * a player applies every event that fell due and settles every cost, so a read never shows a
 * state that is behind the clock (plan section 6.3).
 */
async function advanceGuard(request: FastifyRequest): Promise<void> {
  const auth = requirePlayer(request);
  // The instant of the request and not a fresh one: the reply of the handler reports
  // `atGameMs`, and advancing to a later instant than the one it reports would leave
  // `lastAccrualGameMs` ahead of it, which reads as an inconsistency in a payload where both
  // travel side by side.
  const reading = await readClock(request);
  const result = await advancePlayerNow(request.server.services, auth.playerId, reading.gameNow);
  if (result.processedEvents > 0 || result.truncated) {
    request.log.info(
      {
        playerId: auth.playerId,
        processedEvents: result.processedEvents,
        truncated: result.truncated,
      },
      'player advanced on a request path',
    );
  }
}

/** Registers one route of the contract. */
export function defineRoute<TKey extends ApiRouteKey>(
  app: FastifyInstance,
  key: TKey,
  handler: TypedHandler<TKey>,
): void {
  const entry = API_ROUTES[key];
  const route = routeDefinition(key);

  const preHandlers: ((request: FastifyRequest, reply: FastifyReply) => Promise<unknown>)[] = [];
  if (route.devOnly === true) {
    preHandlers.push(devGuard);
  }
  if (route.requiresAuth) {
    preHandlers.push(authGuard);
  }
  if (route.requiresIdempotencyKey === true) {
    preHandlers.push(idempotencyGuard);
  }
  if (route.requiresAuth && route.advancesPlayer && !route.sequenced) {
    preHandlers.push(advanceGuard);
  }

  // A route that answers text rather than JSON declares its schema as a plain string in the
  // contract, which the serialiser would then turn into a quoted JSON string. Those routes
  // set their own content type and are registered without a response schema; the reply schema
  // still exists in the map, which is what keeps "every route declares a reply" true
  // (docs/handoff/NOTES-W2c.md, item 3.7).
  const isTextReply = route.replyContentType !== undefined;

  app.route({
    method: route.method,
    url: route.path,
    schema: {
      ...('params' in entry ? { params: entry.params } : {}),
      ...('query' in entry ? { querystring: entry.query } : {}),
      ...('body' in entry ? { body: entry.body } : {}),
      ...(isTextReply
        ? {}
        : {
            response: {
              200: entry.reply,
              '4xx': apiErrorReplySchema,
              '5xx': apiErrorReplySchema,
            },
          }),
      summary: route.summary,
      tags: [route.area],
      operationId: key.replace(/[^A-Za-z0-9]+/g, '_'),
    },
    ...(preHandlers.length === 0 ? {} : { preHandler: preHandlers }),
    handler: async (request, reply) => handler(request as TypedRequest<TKey>, reply),
  });
}

/**
 * Registers a route of the contract that is declared and not implemented yet.
 *
 * It is a real route: it validates its request against the contract, carries its guards and
 * appears in the OpenAPI document, and it answers 501 with `NOT_IMPLEMENTED` and the key of the
 * route in the details. That is what rule 3 of plan section 11 asks for — a registry written
 * once, with the definitive path and signature of every route, so that the agent of a later
 * workflow replaces the body of its own stub and never touches the registry.
 *
 * The 501 is deliberately not a 404: a client developed against the simulated server must be
 * able to tell "this is not built yet" from "this route does not exist".
 */
export function defineStubRoute<TKey extends ApiRouteKey>(app: FastifyInstance, key: TKey): void {
  defineRoute(app, key, async () => {
    throw notImplemented(key);
  });
}

/**
 * The keys of the routes that are missing from a set of registered ones.
 *
 * `app.ts` collects what was registered through the `onRoute` hook, which is the public and
 * stable way to observe the route table, and asserts with this function that the eleven
 * modules together cover the contract. A missing route is then a start-up failure and not a
 * 404 discovered by the client three workflows later.
 */
export function missingRouteKeys(
  registered: Iterable<string>,
  expected: readonly ApiRouteKey[],
): readonly ApiRouteKey[] {
  const seen = new Set(registered);
  return expected.filter((key) => !seen.has(key));
}
