// The auth module: the six routes of the `auth` area.
//
// Owner: workflow W3-A (backend skeleton). Module `auth`.
//
// Where the tokens live is the design of this module, and it comes from the contract
// (shared/api/schemas/auth.ts): the access token travels in the body and the client keeps it in
// memory only; the refresh token travels in an `httpOnly` cookie and appears in no schema,
// which is the whole point of using a cookie. So `POST /api/auth/refresh` has no request body:
// everything it needs is what the browser sends on its own.
//
// `POST /api/auth/login` is the one route of the surface with `advancesPlayer: true` and
// `requiresAuth: false`, so the generic advance guard of `plugins/routes.ts` cannot run for it:
// there is no session to advance until the credentials have been checked. The handler therefore
// advances the player itself, right after authenticating, which is the third of the three
// callers of `advancePlayer` that plan section 6.3 names.

import { type FastifyInstance } from 'fastify';
import { advancePlayerNow } from '../../lib/advancePlayer.js';
import { type ServiceContext } from '../../lib/context.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { signAccessToken } from '../../lib/jwt.js';
import { buildPlayerDto, toClockDto } from '../../lib/playerView.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import { type PlayerId, type RouteReply, type SessionReply } from '../../shared/index.js';
import { authenticate, recordLogin, registerPlayer } from './service.js';
import {
  clearRefreshCookie,
  issueRefreshToken,
  readRefreshCookie,
  refreshError,
  revokeRefreshToken,
  setRefreshCookie,
  verifyRefreshToken,
} from './tokens.js';

/** Builds the reply of a route that opens a session. */
async function sessionReplyFor(
  services: ServiceContext,
  playerId: PlayerId,
  reading: ClockReading,
  firstSession: boolean,
): Promise<{ readonly reply: SessionReply; readonly refreshToken: string }> {
  const nowRealMs = reading.atRealMs;
  const access = signAccessToken({
    secret: services.config.jwtSecret,
    playerId,
    issuedAtRealMs: nowRealMs,
    ttlSeconds: services.config.jwtAccessTtlSeconds,
  });
  const refresh = await issueRefreshToken(services.prisma, {
    playerId,
    nowRealMs,
    ttlSeconds: services.config.refreshTtlSeconds,
  });
  const player = await buildPlayerDto(services.prisma, playerId, reading);

  return {
    refreshToken: refresh.token,
    reply: {
      accessToken: access.token,
      accessTokenExpiresInRealMs: services.config.jwtAccessTtlSeconds * 1000,
      accessTokenExpiresAtRealMs: access.expiresAtRealMs.toString(),
      playerId,
      worldId: reading.world.id,
      player,
      clock: toClockDto(reading),
      firstSession,
    },
  };
}

/** Registers the six routes of the area. */
export function registerAuthRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // POST /api/auth/register
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/auth/register', async (request, reply) => {
    const services = request.server.services;
    const registered = await registerPlayer(services, {
      email: request.body.email,
      password: request.body.password,
      displayName: request.body.displayName,
    });
    const session = await sessionReplyFor(services, registered.playerId, registered.reading, true);
    setRefreshCookie(reply, session.refreshToken, {
      ttlSeconds: services.config.refreshTtlSeconds,
      isProduction: services.config.isProduction,
    });
    return session.reply;
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/login
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/auth/login', async (request, reply) => {
    const services = request.server.services;
    const authenticated = await authenticate(services, {
      email: request.body.email,
      password: request.body.password,
    });

    // The login is one of the three callers of the applier: a player who comes back after two
    // days has two days of events to apply and two days of costs to settle, and it happens
    // here rather than lazily so that the first frame the client renders is already current.
    await advancePlayerNow(services, authenticated.playerId);
    const reading = await readClock(request);
    await recordLogin(services, authenticated.playerId, reading);

    const session = await sessionReplyFor(
      services,
      authenticated.playerId,
      reading,
      authenticated.sessionCount === 0,
    );
    setRefreshCookie(reply, session.refreshToken, {
      ttlSeconds: services.config.refreshTtlSeconds,
      isProduction: services.config.isProduction,
    });
    return session.reply;
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/refresh
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/auth/refresh', async (request, reply) => {
    const services = request.server.services;
    const nowRealMs = services.clock.nowRealMs();
    const verification = await verifyRefreshToken(
      services.prisma,
      readRefreshCookie(request),
      nowRealMs,
    );
    if (!verification.ok) {
      // The cookie is cleared on every refusal, including a detected reuse: leaving a cookie
      // the server has just invalidated would make the client retry with it forever.
      clearRefreshCookie(reply, services.config.isProduction);
      request.log.warn({ failure: verification.failure }, 'refresh refused');
      throw refreshError(verification.failure);
    }

    const rotated = await issueRefreshToken(services.prisma, {
      playerId: verification.playerId,
      nowRealMs,
      ttlSeconds: services.config.refreshTtlSeconds,
      replacesTokenId: verification.tokenId,
    });
    const access = signAccessToken({
      secret: services.config.jwtSecret,
      playerId: verification.playerId,
      issuedAtRealMs: nowRealMs,
      ttlSeconds: services.config.jwtAccessTtlSeconds,
    });
    setRefreshCookie(reply, rotated.token, {
      ttlSeconds: services.config.refreshTtlSeconds,
      isProduction: services.config.isProduction,
    });

    const body: RouteReply<'POST /api/auth/refresh'> = {
      accessToken: access.token,
      accessTokenExpiresInRealMs: services.config.jwtAccessTtlSeconds * 1000,
      accessTokenExpiresAtRealMs: access.expiresAtRealMs.toString(),
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/logout
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/auth/logout', async (request, reply) => {
    const services = request.server.services;
    const presented = readRefreshCookie(request);
    if (presented !== undefined) {
      const nowRealMs = services.clock.nowRealMs();
      const verification = await verifyRefreshToken(services.prisma, presented, nowRealMs);
      if (verification.ok) {
        await revokeRefreshToken(services.prisma, verification.tokenId, nowRealMs);
      }
    }
    // Logging out never fails, whatever the cookie carried: the client asked for the session to
    // be gone, and answering 401 to that would be an answer to a question nobody asked.
    clearRefreshCookie(reply, services.config.isProduction);
    return { ok: true } as const;
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/ws-ticket
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/auth/ws-ticket', async (request) => {
    const auth = requirePlayer(request);
    return request.server.wsHub.issueTicket(auth.playerId);
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/me
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/auth/me', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const reading = await readClock(request);
    const body: RouteReply<'GET /api/auth/me'> = {
      player: await buildPlayerDto(services.prisma, auth.playerId, reading),
      worldId: auth.worldId,
      clock: toClockDto(reading),
    };
    return body;
  });
}

/**
 * Re-exported so that the integration suite and the smoke test can create a player without
 * going through HTTP, which is what lets them assert the ledger invariant of the opening entry
 * directly.
 */
export { registerPlayer } from './service.js';
