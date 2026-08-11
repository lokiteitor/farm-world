// The access token: what it accepts and, above all, what it refuses.
//
// Owner: workflow W3-A (backend skeleton).
//
// The module is written by hand because `backend/package.json` is frozen and declares no JWT
// library (`lib/jwt.ts`), so the refusals are what justify that decision. Each test below is one of
// the ways a token can be wrong, and the algorithm confusion case is the important one: the `alg` of
// the header is compared against the only algorithm implemented and never used to select one, which
// is the whole of that family of attacks.

import { describe, expect, it } from 'vitest';
import { realMs as toRealMsValue, type PlayerId, type RealMs } from '../../shared/index.js';
import { TokenFailure, bearerToken, signAccessToken, verifyAccessToken } from '../jwt.js';

const SECRET = 'un-secreto-de-pruebas-suficientemente-largo';
const PLAYER = '019ff2d6-fcde-7010-85fa-803b113e77cd' as PlayerId;
const NOW: RealMs = toRealMsValue(1_800_000_000_000n);
const TTL = 900;

function issue(options: { readonly secret?: string; readonly at?: RealMs } = {}): string {
  return signAccessToken({
    secret: options.secret ?? SECRET,
    playerId: PLAYER,
    issuedAtRealMs: options.at ?? NOW,
    ttlSeconds: TTL,
  }).token;
}

/** Rebuilds a token with a different payload, keeping the original signature. */
function withPayload(token: string, payload: object): string {
  const [header, , signature] = token.split('.') as [string, string, string];
  const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${header}.${forged}.${signature}`;
}

describe('la emision', () => {
  it('firma y verifica el mismo token', () => {
    const issued = signAccessToken({
      secret: SECRET,
      playerId: PLAYER,
      issuedAtRealMs: NOW,
      ttlSeconds: TTL,
    });
    expect(issued.expiresAtRealMs).toBe(NOW + BigInt(TTL) * 1000n);

    const verification = verifyAccessToken({ secret: SECRET, token: issued.token, atRealMs: NOW });
    expect(verification.ok).toBe(true);
    if (!verification.ok) {
      return;
    }
    expect(verification.claims.sub).toBe(PLAYER);
    expect(verification.claims.iss).toBe('farm-world');
    expect(verification.claims.exp - verification.claims.iat).toBe(TTL);
  });

  it('produce tres segmentos en base64url', () => {
    const token = issue();
    expect(token.split('.')).toHaveLength(3);
    expect(token).not.toContain('=');
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
  });
});

describe('la verificacion', () => {
  it('rechaza una firma que no corresponde', () => {
    const token = issue();
    const tampered = `${token.slice(0, -3)}abc`;
    const verification = verifyAccessToken({ secret: SECRET, token: tampered, atRealMs: NOW });
    expect(verification).toEqual({ ok: false, failure: TokenFailure.BAD_SIGNATURE });
  });

  it('rechaza un token firmado con otro secreto', () => {
    const token = issue({ secret: 'otro-secreto-igualmente-largo-pero-distinto' });
    const verification = verifyAccessToken({ secret: SECRET, token, atRealMs: NOW });
    expect(verification).toEqual({ ok: false, failure: TokenFailure.BAD_SIGNATURE });
  });

  it('rechaza un payload manipulado, porque la firma se comprueba antes de leerlo', () => {
    const token = issue();
    const forged = withPayload(token, {
      sub: 'otro-jugador',
      typ: 'access',
      iss: 'farm-world',
      iat: Number(NOW / 1000n),
      exp: Number(NOW / 1000n) + TTL,
    });
    const verification = verifyAccessToken({ secret: SECRET, token: forged, atRealMs: NOW });
    expect(verification).toEqual({ ok: false, failure: TokenFailure.BAD_SIGNATURE });
  });

  it('rechaza un token caducado y distingue el motivo', () => {
    const token = issue();
    const later = toRealMsValue(NOW + BigInt(TTL) * 1000n);
    const verification = verifyAccessToken({ secret: SECRET, token, atRealMs: later });
    expect(verification).toEqual({ ok: false, failure: TokenFailure.EXPIRED });
  });

  it('rechaza el algoritmo none y cualquier otro que no sea HS256', () => {
    // The header is not used to choose an implementation, so a token that claims `none` is simply
    // one whose header does not match and whose signature therefore cannot verify.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8').toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub: PLAYER,
        typ: 'access',
        iss: 'farm-world',
        iat: Number(NOW / 1000n),
        exp: Number(NOW / 1000n) + TTL,
      }),
      'utf8',
    ).toString('base64url');
    const verification = verifyAccessToken({
      secret: SECRET,
      token: `${header}.${payload}.`,
      atRealMs: NOW,
    });
    expect(verification.ok).toBe(false);
  });

  it('rechaza cualquier forma malformada sin lanzar', () => {
    for (const token of ['', 'a', 'a.b', 'a.b.c.d', '..', 'a..c', `${issue()}.extra`]) {
      const verification = verifyAccessToken({ secret: SECRET, token, atRealMs: NOW });
      expect(verification.ok).toBe(false);
    }
  });
});

describe('la cabecera Authorization', () => {
  it('extrae el token del esquema Bearer y nada mas', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('Bearer   abc  ')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe(null);
    expect(bearerToken('Basic abc')).toBe(null);
    expect(bearerToken('Bearer ')).toBe(null);
    expect(bearerToken(undefined)).toBe(null);
  });
});
