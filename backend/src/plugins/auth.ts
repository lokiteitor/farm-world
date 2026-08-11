// Session verification, the request decorations, and the idempotency guard.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Three things live here, and they are together because all three are properties of a
// request rather than of a module:
//
//   1. The access token guard, derived from `requiresAuth` in the route map. It verifies the
//      HS256 token of `lib/jwt.ts`, loads the player once and decorates the request with it,
//      so no handler queries the player again for the identity it already has.
//   2. The clock of the request, read at most once and memoised. Reading it lazily and not
//      in a hook keeps the public routes free of a query they do not need, while every path
//      that does need it gets the same instant, which is what makes a request internally
//      consistent (plan section 6.1).
//   3. The `Idempotency-Key` guard, derived from `requiresIdempotencyKey` in the route map,
//      which the contract keeps equal to `movesMoney`. It is a guard of the registry and not
//      of the handler, exactly as `docs/handoff/NOTES-W2c.md`, item 1.4, requires: a route
//      that starts moving money cannot forget the header, because nothing was written by
//      hand for it.
//
// The idempotency contract, stated once here because it is easy to get subtly wrong:
//
//   - Same key, same request body, first call not finished yet: 503. The operation is in
//      flight and the honest answer is "retry", not a second execution.
//   - Same key, same request body, first call finished: the stored status and the stored
//      body are replayed verbatim. Nothing runs.
//   - Same key, different request body: 409 `IDEMPOTENCY_KEY_REUSED`. That is a client bug
//      and reporting it is more useful than silently doing the second operation.
//   - A response of 500 or above is not stored, and its record is removed, so a genuine
//      transient failure stays retryable.

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';
import { type ServiceContext } from '../lib/context.js';
import { type ClockReading } from '../lib/gameClock.js';
import { hashRequestBody } from '../lib/ids.js';
import { bearerToken, TokenFailure, verifyAccessToken } from '../lib/jwt.js';
import {
  ApiError,
  ApiTransportCode,
  IDEMPOTENCY_KEY_HEADER,
  ValidationCode,
  authRequired,
  idempotencyKeyRequired,
  idempotencyKeySchema,
  type PlayerId,
} from '../shared/index.js';

/** The session of a request, once the token has been verified. */
export interface AuthContext {
  readonly playerId: PlayerId;
  readonly worldId: string;
  readonly email: string;
  readonly displayName: string;
}

/** The record that makes a request replayable. */
export interface IdempotencyRecord {
  readonly id: string;
  readonly key: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The assembled services. The only way a handler reaches the database or the queue. */
    services: ServiceContext;
  }
  interface FastifyRequest {
    /** The session, or null on a route that does not require one. */
    auth: AuthContext | null;
    /** The memoised clock reading. Read it through `readClock`, never directly. */
    clockReading: ClockReading | null;
    /** The idempotency record of a money moving request, or null. */
    idempotency: IdempotencyRecord | null;
  }
}

/** Installs the decorations. Called once, on the root instance, before any route. */
export function registerAuthDecorations(app: FastifyInstance, services: ServiceContext): void {
  app.decorate('services', services);
  app.decorateRequest('auth', null);
  app.decorateRequest('clockReading', null);
  app.decorateRequest('idempotency', null);
}

/**
 * The clock of a request. One read per request, whoever asks first.
 *
 * Every later module calls this instead of `services.clock.read()`, so that a handler, its
 * validation and the reply it builds all describe the same instant.
 */
export async function readClock(request: FastifyRequest): Promise<ClockReading> {
  if (request.clockReading === null) {
    request.clockReading = await request.server.services.clock.read();
  }
  return request.clockReading;
}

/** The session of a request, or a 401. Used by every authenticated handler. */
export function requirePlayer(request: FastifyRequest): AuthContext {
  if (request.auth === null) {
    throw authRequired();
  }
  return request.auth;
}

/** Maps the reason a token was rejected to the code the client switches on. */
function codeForFailure(failure: TokenFailure): ValidationCode {
  return failure === TokenFailure.EXPIRED
    ? ValidationCode.AUTH_TOKEN_EXPIRED
    : ValidationCode.AUTH_REQUIRED;
}

/**
 * The guard of an authenticated route.
 *
 * The player row is loaded here, which is one query, because every authenticated route
 * needs at least the identity and most need the row. A token that verifies against a player
 * that no longer exists is a 401 and not a 404: from the outside the session is simply no
 * longer valid.
 */
export async function authGuard(request: FastifyRequest): Promise<void> {
  const services = request.server.services;
  const token = bearerToken(request.headers.authorization);
  if (token === null) {
    throw authRequired();
  }

  const verification = verifyAccessToken({
    secret: services.config.jwtSecret,
    token,
    atRealMs: services.clock.nowRealMs(),
  });
  if (!verification.ok) {
    throw new ApiError(codeForFailure(verification.failure));
  }

  const player = await services.prisma.player.findUnique({
    where: { id: verification.claims.sub },
    select: { id: true, worldId: true, email: true, displayName: true },
  });
  if (player === null) {
    throw new ApiError(ValidationCode.AUTH_REQUIRED);
  }

  request.auth = {
    playerId: player.id as PlayerId,
    worldId: player.worldId,
    email: player.email,
    displayName: player.displayName,
  };
}

// ---------------------------------------------------------------------------
// The idempotency guard
// ---------------------------------------------------------------------------

/** Reads and validates the header. */
function readIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.length === 0) {
    throw idempotencyKeyRequired();
  }
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(ValidationCode.VALIDATION_FAILED, {
      field: `headers.${IDEMPOTENCY_KEY_HEADER}`,
    });
  }
  return parsed.data;
}

/**
 * The guard itself. Registered as a `preHandler` on exactly the routes the map marks, and
 * always after `authGuard`, because the record is scoped to the player: two players may
 * legitimately send the same key.
 *
 * Returns true when it has already answered, which is the replay case; the caller must then
 * not run the handler.
 */
export async function idempotencyGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const services = request.server.services;
  const auth = requirePlayer(request);
  const key = readIdempotencyKey(request);
  const path = request.routeOptions.url ?? request.url;
  const requestHash = hashRequestBody(request.method, path, request.body);
  const nowRealMs = services.clock.nowRealMs();

  try {
    const created = await services.prisma.requestIdempotency.create({
      data: {
        playerId: auth.playerId,
        key,
        method: request.method,
        path,
        requestHash,
        createdAtRealMs: nowRealMs,
      },
      select: { id: true },
    });
    request.idempotency = { id: created.id, key };
    return false;
  } catch (error) {
    const isUniqueViolation =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
    if (!isUniqueViolation) {
      throw error;
    }
  }

  const existing = await services.prisma.requestIdempotency.findUnique({
    where: { playerId_key: { playerId: auth.playerId, key } },
  });
  if (existing === null) {
    // The record disappeared between the failed insert and this read, which means another
    // request completed with a status of 500 or above and removed it. Retrying the insert
    // once is the right answer and cannot loop, because the second attempt either succeeds
    // or finds a record that stays.
    const created = await services.prisma.requestIdempotency.create({
      data: {
        playerId: auth.playerId,
        key,
        method: request.method,
        path,
        requestHash,
        createdAtRealMs: nowRealMs,
      },
      select: { id: true },
    });
    request.idempotency = { id: created.id, key };
    return false;
  }

  if (existing.requestHash !== requestHash) {
    throw new ApiError(ValidationCode.IDEMPOTENCY_KEY_REUSED, {
      field: `headers.${IDEMPOTENCY_KEY_HEADER}`,
    });
  }

  if (existing.statusCode === null) {
    throw new ApiError(ApiTransportCode.SERVICE_UNAVAILABLE, {
      field: `headers.${IDEMPOTENCY_KEY_HEADER}`,
    });
  }

  services.metrics.idempotentReplays.inc();
  request.log.info({ key, status: existing.statusCode }, 'replaying a stored response');
  await reply.status(existing.statusCode).send(existing.responseBody);
  return true;
}

/**
 * Completes the record with the response, or removes it when the response was a server
 * failure. Installed as an `onSend` hook on the whole instance; it does nothing for a
 * request that carries no record.
 *
 * It never throws: the operation is already done and committed, and failing the response
 * because the bookkeeping of the retry failed would turn a success into an error the client
 * would then retry.
 */
export async function completeIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<void> {
  const record = request.idempotency;
  if (record === null) {
    return;
  }
  const services = request.server.services;
  try {
    if (reply.statusCode >= 500) {
      await services.prisma.requestIdempotency.deleteMany({ where: { id: record.id } });
      return;
    }
    let body: unknown = null;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        body = JSON.parse(payload);
      } catch {
        body = null;
      }
    }
    await services.prisma.requestIdempotency.updateMany({
      where: { id: record.id, statusCode: null },
      data: {
        statusCode: reply.statusCode,
        responseBody: body === null ? Prisma.DbNull : (body as Prisma.InputJsonValue),
        completedAtRealMs: services.clock.nowRealMs(),
      },
    });
  } catch (error) {
    request.log.warn({ err: error, key: record.key }, 'could not store the idempotent response');
  }
}
