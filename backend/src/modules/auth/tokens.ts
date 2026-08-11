// Refresh tokens: rotation, reuse detection and the cookie.
//
// Owner: workflow W3-A (backend skeleton). Module `auth`.
//
// Two tokens with two different jobs (stack section 6, plan section 7):
//
//   - The access token is a signed JWT of fifteen minutes that travels in the body of the
//     reply and lives in the memory of the client. It is stateless on purpose: verifying it
//     costs one HMAC and no query, which is what lets every request carry one.
//   - The refresh token is an opaque value of 256 bits that travels in an `httpOnly` cookie
//     and has a row. It is stateful on purpose: rotation and revocation are exactly the
//     things a self contained token cannot do.
//
// Rotation. Every use invalidates the presented token and issues a new one, and the old row
// records which token replaced it. That chain is what makes theft detectable: a token that is
// already revoked and has a successor was used twice, which a legitimate client never does, so
// the whole active family of that player is revoked and the session ends. The alternative,
// accepting the second use, means a stolen cookie is usable forever.
//
// Only the hash of a token is stored, with SHA-256. A dump of the table then hands over no
// live session, and there is nothing to slow down: the token is 256 bits of entropy, not a
// password (`lib/ids.ts`).

// Type only import: it brings in the declaration merging of @fastify/cookie, which is what
// adds `setCookie` and `clearCookie` to the reply and `cookies` to the request. The plugin
// itself is registered once, in `src/app.ts`.
import type {} from '@fastify/cookie';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { hashToken, newOpaqueToken } from '../../lib/ids.js';
import { type Db } from '../../lib/tx.js';
import { ApiError, ValidationCode, type PlayerId, type RealMs } from '../../shared/index.js';

/** Name of the cookie. Prefixed so it cannot collide with another application on the host. */
export const REFRESH_COOKIE_NAME = 'fw_refresh';

/**
 * Path the cookie is scoped to. Only the three routes that rotate or revoke it need it, so it
 * is not sent with any other request and cannot be used by a cross site request against the
 * rest of the surface.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

/** A freshly issued refresh token: the value for the cookie and the row that backs it. */
export interface IssuedRefreshToken {
  readonly token: string;
  readonly id: string;
  readonly expiresAtRealMs: bigint;
}

/** Issues a refresh token for a player. */
export async function issueRefreshToken(
  db: Db,
  options: {
    readonly playerId: PlayerId;
    readonly nowRealMs: RealMs;
    readonly ttlSeconds: number;
    readonly userAgent?: string | undefined;
    readonly replacesTokenId?: string | undefined;
  },
): Promise<IssuedRefreshToken> {
  const token = newOpaqueToken();
  const expiresAtRealMs = options.nowRealMs + BigInt(options.ttlSeconds) * 1000n;
  const row = await db.refreshToken.create({
    data: {
      playerId: options.playerId,
      tokenHash: hashToken(token),
      issuedAtRealMs: options.nowRealMs,
      expiresAtRealMs,
      userAgent: options.userAgent ?? null,
    },
    select: { id: true },
  });
  if (options.replacesTokenId !== undefined) {
    await db.refreshToken.update({
      where: { id: options.replacesTokenId },
      data: { revokedAtRealMs: options.nowRealMs, replacedByTokenId: row.id },
    });
  }
  return { token, id: row.id, expiresAtRealMs };
}

/** Why a presented refresh token was refused. */
export const RefreshFailure = {
  MISSING: 'MISSING',
  UNKNOWN: 'UNKNOWN',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  REUSED: 'REUSED',
} as const;
export type RefreshFailure = (typeof RefreshFailure)[keyof typeof RefreshFailure];

export type RefreshVerification =
  | {
      readonly ok: true;
      readonly tokenId: string;
      readonly playerId: PlayerId;
    }
  | { readonly ok: false; readonly failure: RefreshFailure };

/**
 * Verifies a presented token and, when it detects a reuse, revokes the whole active family of
 * that player.
 *
 * The revocation happens here and not at the call site because it must happen whatever the
 * caller does next: the moment a token with a successor is presented, the session is
 * compromised and the cheapest correct response is to end every session of that account.
 */
export async function verifyRefreshToken(
  db: Db,
  presented: string | undefined,
  nowRealMs: RealMs,
): Promise<RefreshVerification> {
  if (presented === undefined || presented.length === 0) {
    return { ok: false, failure: RefreshFailure.MISSING };
  }
  const row = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(presented) },
    select: {
      id: true,
      playerId: true,
      expiresAtRealMs: true,
      revokedAtRealMs: true,
      replacedByTokenId: true,
    },
  });
  if (row === null) {
    return { ok: false, failure: RefreshFailure.UNKNOWN };
  }
  if (row.revokedAtRealMs !== null) {
    if (row.replacedByTokenId !== null) {
      await revokeFamily(db, row.playerId as PlayerId, nowRealMs);
      return { ok: false, failure: RefreshFailure.REUSED };
    }
    return { ok: false, failure: RefreshFailure.REVOKED };
  }
  if (row.expiresAtRealMs <= nowRealMs) {
    return { ok: false, failure: RefreshFailure.EXPIRED };
  }
  return { ok: true, tokenId: row.id, playerId: row.playerId as PlayerId };
}

/** Revokes one token. Idempotent: revoking an already revoked token changes nothing. */
export async function revokeRefreshToken(
  db: Db,
  tokenId: string,
  nowRealMs: RealMs,
): Promise<void> {
  await db.refreshToken.updateMany({
    where: { id: tokenId, revokedAtRealMs: null },
    data: { revokedAtRealMs: nowRealMs },
  });
}

/** Revokes every active token of a player, which is what a detected reuse triggers. */
export async function revokeFamily(db: Db, playerId: PlayerId, nowRealMs: RealMs): Promise<number> {
  const result = await db.refreshToken.updateMany({
    where: { playerId, revokedAtRealMs: null },
    data: { revokedAtRealMs: nowRealMs },
  });
  return result.count;
}

/** Maps a refusal to the code the client switches on. */
export function codeForRefreshFailure(failure: RefreshFailure): ValidationCode {
  return failure === RefreshFailure.EXPIRED
    ? ValidationCode.AUTH_TOKEN_EXPIRED
    : ValidationCode.AUTH_REQUIRED;
}

/** The refusal as the error the handler throws. */
export function refreshError(failure: RefreshFailure): ApiError {
  return new ApiError(codeForRefreshFailure(failure));
}

// ---------------------------------------------------------------------------
// The cookie
// ---------------------------------------------------------------------------

/**
 * Writes the cookie. `httpOnly` so no script can read it, `sameSite: lax` so it survives a
 * normal navigation while not travelling with a cross site POST, and `secure` outside
 * development, where the client is served over plain HTTP on localhost.
 */
export function setRefreshCookie(
  reply: FastifyReply,
  token: string,
  options: { readonly ttlSeconds: number; readonly isProduction: boolean },
): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: options.isProduction,
    path: REFRESH_COOKIE_PATH,
    maxAge: options.ttlSeconds,
  });
}

/** Removes the cookie, which is what logging out means for the browser. */
export function clearRefreshCookie(reply: FastifyReply, isProduction: boolean): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: REFRESH_COOKIE_PATH,
  });
}

/** The presented token, or undefined. */
export function readRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_COOKIE_NAME];
}
