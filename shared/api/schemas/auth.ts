// Auth area: registration, session and the WebSocket ticket.
//
// Owner: workflow W2 (API contract).
//
// Where the tokens live. The access token travels in the body of the reply and the
// client keeps it in memory only; the refresh token travels in an `httpOnly` cookie
// and never appears in any schema of this file, which is the point of using a cookie
// (stack section 6). The refresh route therefore has no request body: everything it
// needs is the cookie the browser sends on its own.
//
// Why a ticket for the WebSocket. A browser cannot set a header on a WebSocket
// handshake, and putting the access token in the query string would write it to the
// logs of every proxy on the way. The client asks for a single use ticket with a
// lifetime of thirty seconds and presents that instead (plan section 7).

import { z } from 'zod';
import { clockDtoSchema, playerIdSchema, realMsSchema, worldIdSchema } from './common.js';
import { playerDtoSchema } from './state.js';

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Password policy. A floor of ten characters and no composition rule: length is the
 * only requirement that measurably helps, and argon2 covers the rest (stack section 6).
 * The ceiling exists so that a hash is never computed over an unbounded input.
 */
export const passwordSchema = z.string().min(10).max(200);

export const emailSchema = z.email().max(200);

export const displayNameSchema = z.string().trim().min(1).max(64);

// ---------------------------------------------------------------------------
// POST /api/auth/register and POST /api/auth/login
// ---------------------------------------------------------------------------

export const registerBodySchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
});
export type LoginBody = z.infer<typeof loginBodySchema>;

/**
 * Reply of a route that opens a session. It carries the world and the player so that a
 * client can render its first frame without a second request, and the clock so that
 * every countdown starts extrapolating immediately.
 */
export const sessionReplySchema = z.strictObject({
  accessToken: z.string().min(16),
  /** Lifetime of the access token in real milliseconds (stack section 6). */
  accessTokenExpiresInRealMs: z.number().int().positive(),
  accessTokenExpiresAtRealMs: realMsSchema,
  playerId: playerIdSchema,
  worldId: worldIdSchema,
  player: playerDtoSchema,
  clock: clockDtoSchema,
  /** Whether this is the first session of the account, for the starting guide. */
  firstSession: z.boolean(),
});
export type SessionReply = z.infer<typeof sessionReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/auth/refresh and POST /api/auth/logout
// ---------------------------------------------------------------------------

/**
 * Rotating refresh: every use invalidates the presented token and issues a new one, so
 * a stolen token is usable at most once and the theft is detectable (stack section 6).
 * There is no request body: the cookie is the whole request.
 */
export const refreshReplySchema = z.strictObject({
  accessToken: z.string().min(16),
  accessTokenExpiresInRealMs: z.number().int().positive(),
  accessTokenExpiresAtRealMs: realMsSchema,
});
export type RefreshReply = z.infer<typeof refreshReplySchema>;

export const logoutReplySchema = z.strictObject({ ok: z.literal(true) });
export type LogoutReply = z.infer<typeof logoutReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/auth/ws-ticket
// ---------------------------------------------------------------------------

export const wsTicketReplySchema = z.strictObject({
  ticket: z.string().min(16).max(256),
  expiresAtRealMs: realMsSchema,
  expiresInRealMs: z.number().int().positive(),
  /** Path to connect to, so the client does not hard code the topology. */
  path: z.string().min(1).max(200),
});
export type WsTicketReply = z.infer<typeof wsTicketReplySchema>;

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

export const meReplySchema = z.strictObject({
  player: playerDtoSchema,
  worldId: worldIdSchema,
  clock: clockDtoSchema,
});
export type MeReply = z.infer<typeof meReplySchema>;
