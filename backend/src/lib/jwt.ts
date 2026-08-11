// Signing and verification of the access token, HS256, without a dependency.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Why by hand. `backend/package.json` is frozen since workflow W1 (plan section 11,
// rule 2) and declares no JWT library: neither `@fastify/jwt`, nor `jsonwebtoken`,
// nor `jose`. Asking for one would block this phase on a change to a frozen file,
// and the alternative is genuinely small: HS256 is an HMAC over two base64url
// segments, and `node:crypto` provides both the HMAC and the constant time
// comparison. The scope is deliberately narrow, which is what makes writing it
// defensible instead of reckless:
//
//   - One algorithm, `HS256`, hard coded. The `alg` of the header is checked against
//     it and never used to select an implementation, which is the whole of the
//     algorithm confusion family of attacks.
//   - No `none`, no RSA, no key identifier, no JWKS, no nested tokens.
//   - The signature is compared with `timingSafeEqual`, and the comparison happens
//     before the payload is parsed, so a malformed token never reaches the claims.
//   - Expiry is mandatory: a token with no `exp` is rejected, so a bug that omits it
//     cannot mint an eternal session.
//
// The token is only ever produced and consumed by this service, so the registered
// claims used are the minimum: `sub` (the player), `iat`, `exp`, `iss` and a `typ`
// of our own that pins the token to its purpose. A refresh token is never a JWT: it
// is an opaque value with a row in `refresh_tokens`, because rotation and revocation
// need server state that a self contained token cannot have (stack section 6).
//
// The clock. This module reads real time and not game time, which is correct and not
// an exception to plan section 6.1: a session lifetime is a property of the transport
// and must not stretch when the game multiplier changes. The instant is injected all
// the same, so the tests do not depend on the host clock.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { type PlayerId, type RealMs } from '../shared/index.js';

/** The only algorithm this module implements. */
const ALGORITHM = 'HS256';

/** Value of the issuer claim. Identifies the service, not the deployment. */
export const TOKEN_ISSUER = 'farm-world';

/** Purpose of a token. An access token is never accepted where another is expected. */
export const TokenType = {
  ACCESS: 'access',
} as const;
export type TokenType = (typeof TokenType)[keyof typeof TokenType];

/** Claims of an access token. */
export interface AccessTokenClaims {
  /** Subject: the player the session belongs to. */
  readonly sub: PlayerId;
  readonly typ: TokenType;
  readonly iss: string;
  /** Issued at, in whole real seconds since the Unix epoch. */
  readonly iat: number;
  /** Expiry, in whole real seconds since the Unix epoch. */
  readonly exp: number;
}

/** Why a token was rejected. The caller maps it to a `ValidationCode`. */
export const TokenFailure = {
  MALFORMED: 'MALFORMED',
  BAD_SIGNATURE: 'BAD_SIGNATURE',
  EXPIRED: 'EXPIRED',
  WRONG_TYPE: 'WRONG_TYPE',
} as const;
export type TokenFailure = (typeof TokenFailure)[keyof typeof TokenFailure];

/** Result of a verification. Never throws: a bad token is an expected input. */
export type TokenVerification =
  | { readonly ok: true; readonly claims: AccessTokenClaims }
  | { readonly ok: false; readonly failure: TokenFailure };

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(secret: string, signingInput: string): string {
  return createHmac('sha256', secret).update(signingInput, 'utf8').digest('base64url');
}

/**
 * Issues an access token. `expiresAtRealMs` is returned as well, because the client
 * schedules its refresh from it and deriving it again from the token would mean
 * parsing what we just built.
 */
export function signAccessToken(options: {
  readonly secret: string;
  readonly playerId: PlayerId;
  readonly issuedAtRealMs: RealMs;
  readonly ttlSeconds: number;
}): {
  readonly token: string;
  readonly expiresAtRealMs: bigint;
  readonly claims: AccessTokenClaims;
} {
  const issuedAtSeconds = Number(options.issuedAtRealMs / 1000n);
  const expiresAtSeconds = issuedAtSeconds + options.ttlSeconds;
  const claims: AccessTokenClaims = {
    sub: options.playerId,
    typ: TokenType.ACCESS,
    iss: TOKEN_ISSUER,
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
  };
  const signingInput = `${encodeSegment({ alg: ALGORITHM, typ: 'JWT' })}.${encodeSegment(claims)}`;
  return {
    token: `${signingInput}.${sign(options.secret, signingInput)}`,
    expiresAtRealMs: BigInt(expiresAtSeconds) * 1000n,
    claims,
  };
}

/** Whether two base64url signatures are equal, in constant time. */
function signatureMatches(expected: string, received: string): boolean {
  const left = Buffer.from(expected, 'base64url');
  const right = Buffer.from(received, 'base64url');
  // `timingSafeEqual` throws on different lengths, which would itself leak the
  // length, so the lengths are compared first and the comparison is skipped only
  // when they differ: the length of an HMAC-SHA256 digest is not a secret.
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies an access token. The order of the checks is the security relevant part:
 * the signature is verified before anything from the payload is trusted, and the
 * algorithm of the header is compared against the only one implemented rather than
 * used to choose one.
 */
export function verifyAccessToken(options: {
  readonly secret: string;
  readonly token: string;
  readonly atRealMs: RealMs;
}): TokenVerification {
  const segments = options.token.split('.');
  if (segments.length !== 3) {
    return { ok: false, failure: TokenFailure.MALFORMED };
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];
  if (headerSegment.length === 0 || payloadSegment.length === 0 || signatureSegment.length === 0) {
    return { ok: false, failure: TokenFailure.MALFORMED };
  }

  const signingInput = `${headerSegment}.${payloadSegment}`;
  if (!signatureMatches(sign(options.secret, signingInput), signatureSegment)) {
    return { ok: false, failure: TokenFailure.BAD_SIGNATURE };
  }

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, failure: TokenFailure.MALFORMED };
  }

  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { alg?: unknown }).alg !== ALGORITHM
  ) {
    return { ok: false, failure: TokenFailure.MALFORMED };
  }
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, failure: TokenFailure.MALFORMED };
  }

  const claims = payload as Partial<Record<keyof AccessTokenClaims, unknown>>;
  if (
    typeof claims.sub !== 'string' ||
    claims.sub.length === 0 ||
    claims.iss !== TOKEN_ISSUER ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number' ||
    !Number.isFinite(claims.exp)
  ) {
    return { ok: false, failure: TokenFailure.MALFORMED };
  }
  if (claims.typ !== TokenType.ACCESS) {
    return { ok: false, failure: TokenFailure.WRONG_TYPE };
  }

  const nowSeconds = Number(options.atRealMs / 1000n);
  if (claims.exp <= nowSeconds) {
    return { ok: false, failure: TokenFailure.EXPIRED };
  }

  return {
    ok: true,
    claims: {
      sub: claims.sub as PlayerId,
      typ: TokenType.ACCESS,
      iss: TOKEN_ISSUER,
      iat: claims.iat,
      exp: claims.exp,
    },
  };
}

/** Extracts the token of an `Authorization: Bearer <token>` header. */
export function bearerToken(headerValue: string | undefined): string | null {
  if (headerValue === undefined) {
    return null;
  }
  const prefix = 'Bearer ';
  if (!headerValue.startsWith(prefix)) {
    return null;
  }
  const token = headerValue.slice(prefix.length).trim();
  return token.length === 0 ? null : token;
}
