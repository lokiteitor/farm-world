// The Fastify instance: plugins, the route registry of the eleven modules, and the assertion
// that the two agree with the contract.
//
// Owner: workflow W3-A (backend skeleton). FROZEN AFTER W3, which is the point of the file: it
// is the classic conflict of a modular monolith, so it is written once, for the final set of
// features, and every later workflow replaces the body of its own module instead
// (plan section 11, rules 2 and 3).
//
// The order of registration is not cosmetic:
//
//   1. The compilers of the type provider, before any route, because a route registered without
//      them would validate nothing.
//   2. The decorations, before any handler can read them.
//   3. The transport plugins. Helmet, CORS, cookies and the rate limit are properties of the
//      surface and not of a route.
//   4. The error handler, before the routes, so a route that throws during registration is
//      reported in the shape of the contract.
//   5. The documentation, before the routes, because `@fastify/swagger` collects them through
//      the `onRoute` hook and cannot see what was registered before it.
//   6. The WebSocket, before the modules, because `POST /api/auth/ws-ticket` needs the hub.
//   7. The system routes and the eleven modules.
//   8. The completeness assertion: every key of `API_ROUTES` must have been registered. A route
//      the contract declares and nobody serves is a start-up failure here, which is where it is
//      cheap, instead of a 404 the client discovers three workflows later.
//
// What this file deliberately does not do: listen on a port, read the environment, build the
// services or install a signal handler. Those belong to `server.ts`, which is what lets the
// integration suite build a full application with `inject` and no socket at all.

import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { type ServiceContext } from './lib/context.js';
import { registerAuthRoutes } from './modules/auth/index.js';
import { registerEconomyRoutes } from './modules/economy/index.js';
import { registerFarmsRoutes } from './modules/farms/index.js';
import { registerFieldsRoutes } from './modules/fields/index.js';
import { registerForestryRoutes } from './modules/forestry/index.js';
import { registerLandRoutes } from './modules/land/index.js';
import { registerMachineryRoutes } from './modules/machinery/index.js';
import { registerSessionRoutes } from './modules/session/index.js';
import { registerTasksRoutes } from './modules/tasks/index.js';
import { registerWorkersRoutes } from './modules/workers/index.js';
import { registerWorldRoutes } from './modules/world/index.js';
import { registerAuthDecorations, completeIdempotency } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import { generateRequestId, isQuietPath } from './plugins/logger.js';
import { missingRouteKeys } from './plugins/routes.js';
import { DOCS_PREFIX, registerSwagger } from './plugins/swagger.js';
import { registerSystemRoutes } from './plugins/systemRoutes.js';
import { registerWebSocket } from './plugins/ws.js';
import { API_ROUTE_KEYS, WS_PATH, routeKey, type ApiRouteKey } from './shared/index.js';

/** Requests per window and per client, before the rate limit refuses. */
export const RATE_LIMIT_MAX = 600;

/** Length of the rate limit window, in real milliseconds. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

export interface BuildAppOptions {
  readonly services: ServiceContext;
  /** Real instant the process started at, for the uptime of `/health`. */
  readonly startedAtRealMs: bigint;
}

/** A route of the contract that nobody registered. */
export class IncompleteRouteRegistryError extends Error {
  readonly missing: readonly ApiRouteKey[];

  constructor(missing: readonly ApiRouteKey[]) {
    super(
      `El registro de rutas no cubre el contrato. Faltan ${missing.length}: ${missing.join(', ')}`,
    );
    this.name = 'IncompleteRouteRegistryError';
    this.missing = missing;
  }
}

/**
 * Builds the application. Ready to serve when it resolves; nothing listens yet.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const services = options.services;

  // Widened to the interface Fastify declares, and not passed at its Pino type: the generic of
  // the instance is inferred from this field, and a narrower logger type would propagate into
  // every helper that takes a plain `FastifyInstance`.
  const loggerInstance: FastifyBaseLogger = services.logger;

  const app = Fastify({
    loggerInstance,
    genReqId: generateRequestId,
    // The reverse proxy terminates TLS and rewrites nothing else (stack section 7.1), so the
    // client address comes from the forwarding headers.
    trustProxy: true,
    // A selection of two thousand cells is the largest legitimate body of the surface.
    bodyLimit: 2 * 1024 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerAuthDecorations(app, services);

  await app.register(fastifyHelmet, {
    // The API answers JSON and the documentation viewer sets its own policy with `staticCSP`;
    // the SPA is served by Caddy, which sets the headers of a page. A policy here would only
    // fight the viewer.
    contentSecurityPolicy: false,
  });
  await app.register(fastifyCors, {
    origin: services.config.corsOrigins,
    // The refresh token is a cookie, so the browser has to be allowed to send it.
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-contract-version'],
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => {
      // `request.ip` resolves the client address through the forwarding headers, which needs the
      // underlying socket. A WebSocket upgrade has none when it is injected rather than dialled,
      // and the limiter computes its key before it consults the allow list, so without this the
      // upgrade fails with a 500 inside the plugin. The fallback groups those requests together,
      // which is harmless: they are the ones the allow list is about to exempt anyway.
      const socket: { remoteAddress?: string | undefined } | undefined = request.socket;
      return socket?.remoteAddress === undefined ? 'unknown' : request.ip;
    },
    allowList: (request) =>
      // The probes are polled by Docker and by Prometheus every few seconds and must never be
      // refused: a health check that answers 429 takes a healthy process out of service.
      isQuietPath(request.url) ||
      // The WebSocket handshake is throttled where it can be: the ticket that authorises it comes
      // from `POST /api/auth/ws-ticket`, which is rate limited like every other route, is single
      // use and lives thirty seconds. Counting the upgrade as well would limit reconnections
      // during an outage, which is exactly when a client reconnects most.
      request.url.split('?')[0] === WS_PATH,
  });

  registerErrorHandler(app);

  // Collected through the hook, which is the public way to observe the route table. It is
  // installed before the documentation and before every module, because the hook only sees what
  // is registered after it: the routes of `@fastify/swagger-ui` are among them, and they are what
  // satisfies the declared `GET /docs`.
  const registered = new Set<string>();
  app.addHook('onRoute', (route) => {
    const url = typeof route.url === 'string' ? route.url : '';
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      registered.add(routeKey(method as never, url));
    }
    // `@fastify/swagger-ui` serves `GET /docs` as `/docs/` plus a redirect, and the contract
    // declares `GET /docs`. Recording the prefix as the declared key keeps the assertion below
    // honest without special casing it there.
    if (url.startsWith(DOCS_PREFIX)) {
      registered.add(routeKey('GET', DOCS_PREFIX));
    }
  });

  await registerSwagger(app);

  const hub = await registerWebSocket(app, services);
  app.decorate('wsHub', hub);

  // The response of a money moving request is stored so a retry replays it, and removed when
  // the response was a server failure so a transient error stays retryable (plan section 6.3).
  app.addHook('onSend', async (request, reply, payload) => {
    await completeIdempotency(request, reply, payload);
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unknown';
    services.metrics.httpRequests.inc({
      method: request.method,
      route,
      status: String(reply.statusCode),
    });
    services.metrics.httpDuration.observe(
      { method: request.method, route },
      reply.elapsedTime / 1000,
    );
  });

  registerSystemRoutes(app, options.startedAtRealMs);

  // The eleven modules of `docs/ownership.md`, in the order of the areas of the contract. Each
  // one registers the routes of its area and nothing else.
  registerAuthRoutes(app);
  registerSessionRoutes(app);
  registerWorldRoutes(app);
  registerLandRoutes(app);
  registerFarmsRoutes(app);
  registerFieldsRoutes(app);
  registerMachineryRoutes(app);
  registerWorkersRoutes(app);
  registerTasksRoutes(app);
  registerEconomyRoutes(app);
  registerForestryRoutes(app);

  await app.ready();

  const missing = missingRouteKeys(registered, API_ROUTE_KEYS);
  if (missing.length > 0) {
    throw new IncompleteRouteRegistryError(missing);
  }

  services.logger.info(
    {
      routes: API_ROUTE_KEYS.length,
      jobHandlers: services.jobs.registeredHandlers.length,
      missingJobHandlers: services.jobs.missingHandlers,
    },
    'application built',
  );
  return app;
}
