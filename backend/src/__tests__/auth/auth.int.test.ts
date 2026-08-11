// Authentication end to end: registration, session, rotation, logout and the WebSocket ticket.
//
// Owner: workflow W3-A (backend skeleton). Module `auth`.
//
// It lives in `src/__tests__/auth/` and not inside the module, which is what `docs/ownership.md`
// prescribes for the tests of a module and what the ESLint zones require: a file inside
// `src/modules/auth` may only import from its own directory, `lib`, `plugins` and `shared`, so a
// test that needs the harness cannot be one of them.
//
// Four things are asserted here that nothing else can assert:
//
//   1. Registration writes the starting capital of GDD section 117 as a ledger entry, with the
//      kind `STARTING_CAPITAL` and the key `starting-capital:<playerId>`, so the invariant "the
//      sum of the ledger equals the balance" holds from the first player (plan section 5.3).
//   2. The refresh token rotates, and a token that is presented twice is detected as a reuse and
//      takes the whole family of sessions down with it (stack section 6).
//   3. The WebSocket ticket is single use: the second redemption of the same ticket finds nothing.
//   4. `HELLO` carries the sequence and the replay window, and the frames of a mutation reach the
//      socket through Redis with the sequence the transaction assigned, which is the contract the
//      whole client synchronisation of plan section 7 rests on.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../../modules/auth/tokens.js';
import { LedgerType, Money, WsTransportEventType } from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

/** Collects the frames of a socket opened with `injectWS`, from before it opens. */
async function openSocket(ticket: string): Promise<{
  readonly frames: Record<string, unknown>[];
  close(): void;
}> {
  const frames: Record<string, unknown>[] = [];
  const socket = await harness.app.injectWS(`/ws?ticket=${ticket}`, undefined, {
    // Attached before the handshake completes, so the greeting cannot be missed.
    onInit: (raw) => {
      raw.on('message', (data: unknown) => {
        frames.push(JSON.parse(String(data)) as Record<string, unknown>);
      });
    },
  });
  return {
    frames,
    close(): void {
      socket.close();
    },
  };
}

/** Waits for a condition, polling. Integration tests wait for a socket, not for a timer. */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('the condition was not met within the timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('el registro', () => {
  it('crea el jugador con el capital inicial asentado en el ledger', async () => {
    const player = await registerViaHttp(harness, 'register');
    const body = player.body as {
      firstSession: boolean;
      player: { balance: string; ledgerSeq: number; status: string; dayNumber: number };
    };
    expect(body.firstSession).toBe(true);
    expect(body.player.balance).toBe('160000.0000');
    expect(body.player.status).toBe('ACTIVE');
    expect(body.player.ledgerSeq).toBe(1);
    expect(body.player.dayNumber).toBe(1);

    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId: player.playerId },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe(LedgerType.STARTING_CAPITAL);
    expect(entries[0]?.idempotencyKey).toBe(`starting-capital:${player.playerId}`);
    expect(Money.fromString(String(entries[0]?.balanceAfter))).toBe('160000.0000');

    // The origin comes from the deterministic allocator, so it is assigned and inside the world.
    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { spawnCellX: true, spawnCellY: true },
    });
    expect(row.spawnCellX).not.toBeNull();
    expect(row.spawnCellY).not.toBeNull();

    // And it schedules the first settlement sweep of that player, which is what keeps the chain
    // alive without a global cron (plan section 6.6).
    const scheduled = await harness.prisma.scheduledEvent.findMany({
      where: { playerId: player.playerId },
    });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.kind).toBe('PLAYER_SETTLE_SWEEP');
    expect(scheduled[0]?.status).toBe('PENDING');
  });

  it('rechaza la segunda cuenta con el mismo correo', async () => {
    const email = harness.email('duplicate');
    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'contrasena-de-prueba', displayName: 'Primero' },
    });
    expect(first.statusCode).toBe(200);
    harness.track(first.json<{ playerId: string }>().playerId as never);

    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'contrasena-de-prueba', displayName: 'Segundo' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
});

describe('la sesion', () => {
  it('abre sesion con las credenciales y rechaza una contrasena erronea', async () => {
    const player = await registerViaHttp(harness, 'login');
    const email = harness.email('login');

    const ok = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'contrasena-de-prueba' },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<{ playerId: string; firstSession: boolean }>();
    expect(body.playerId).toBe(player.playerId);
    // The account already had a session, the one registration opened.
    expect(body.firstSession).toBe(false);

    const wrong = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'otra-contrasena-larga' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json<{ error: { code: string } }>().error.code).toBe('AUTH_INVALID_CREDENTIALS');

    const unknown = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: harness.email('nobody'), password: 'contrasena-de-prueba' },
    });
    // The same code as a wrong password: the reply does not say whether the address exists.
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json<{ error: { code: string } }>().error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('devuelve el jugador y el reloj en GET /api/auth/me', async () => {
    const player = await registerViaHttp(harness, 'me');
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: bearer(player.accessToken),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      player: { id: string; atGameMs: string; lastAccrualGameMs: string };
      clock: { gameMs: string; rateNum: number };
    }>();
    expect(body.player.id).toBe(player.playerId);
    expect(body.clock.rateNum).toBe(1);
    // The advance guard settled up to the instant the reply reports, so the two agree.
    expect(body.player.lastAccrualGameMs).toBe(body.player.atGameMs);
    expect(body.clock.gameMs).toBe(body.player.atGameMs);
  });

  it('rechaza un token manipulado', async () => {
    const player = await registerViaHttp(harness, 'tamper');
    const tampered = `${player.accessToken.slice(0, -2)}xy`;
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: bearer(tampered),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTH_REQUIRED');
  });
});

describe('la rotacion del refresh', () => {
  it('emite un token nuevo y detecta la reutilizacion del anterior', async () => {
    const player = await registerViaHttp(harness, 'rotate');

    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: player.refreshCookie },
    });
    expect(first.statusCode).toBe(200);
    const rotatedCookie = String(first.headers['set-cookie']).split(';')[0] ?? '';
    expect(rotatedCookie).toContain(REFRESH_COOKIE_NAME);
    expect(rotatedCookie).not.toBe(player.refreshCookie);

    // The new one works.
    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: rotatedCookie },
    });
    expect(second.statusCode).toBe(200);

    // The first one is now revoked and has a successor, which is the signature of a stolen
    // cookie: it is refused and the whole family of sessions is revoked with it.
    const reused = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: player.refreshCookie },
    });
    expect(reused.statusCode).toBe(401);

    const active = await harness.prisma.refreshToken.count({
      where: { playerId: player.playerId, revokedAtRealMs: null },
    });
    expect(active).toBe(0);
  });

  it('cierra sesion revocando el token presentado', async () => {
    const player = await registerViaHttp(harness, 'logout');
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: player.refreshCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ ok: boolean }>().ok).toBe(true);

    const active = await harness.prisma.refreshToken.count({
      where: { playerId: player.playerId, revokedAtRealMs: null },
    });
    expect(active).toBe(0);

    // Logging out twice is not an error: the client asked for the session to be gone.
    const again = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: player.refreshCookie },
    });
    expect(again.statusCode).toBe(200);
  });
});

describe('el ticket y el WebSocket', () => {
  it('canjea el ticket una sola vez y saluda con la secuencia', async () => {
    const player = await registerViaHttp(harness, 'socket');
    const ticketReply = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/ws-ticket',
      headers: bearer(player.accessToken),
    });
    expect(ticketReply.statusCode).toBe(200);
    const ticket = ticketReply.json<{ ticket: string; path: string }>();
    expect(ticket.path).toBe('/ws');

    const socket = await openSocket(ticket.ticket);
    await waitFor(() => socket.frames.length >= 1);

    const hello = socket.frames[0] as {
      type: string;
      seq: number;
      payload: { playerId: string; seq: number; oldestReplaySeq: number; contractVersion: string };
    };
    expect(hello.type).toBe(WsTransportEventType.HELLO);
    expect(hello.payload.playerId).toBe(player.playerId);
    // A brand new player has produced no event, so the sequence is zero and the ring holds
    // nothing, which the contract expresses as `oldestReplaySeq = seq + 1`.
    expect(hello.seq).toBe(0);
    expect(hello.payload.seq).toBe(0);
    expect(hello.payload.oldestReplaySeq).toBe(1);

    // A mutation now travels to this socket with the sequence its transaction assigned.
    const grant = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/grant',
      headers: { ...bearer(player.accessToken), 'idempotency-key': `ws-grant-${harness.runId}` },
      payload: { amount: '25.0000', reason: 'prueba de socket' },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json<{ seq: number }>().seq).toBe(2);

    await waitFor(() => socket.frames.length >= 3);
    const types = socket.frames.slice(1).map((frame) => frame['type']);
    expect(types).toEqual(['PLAYER_UPSERTED', 'LEDGER_APPENDED']);
    expect(socket.frames.slice(1).map((frame) => frame['seq'])).toEqual([1, 2]);

    // The same frames are in the replay ring, which is what a reconnection reads.
    const ring = await harness.redis.commands.lrange(
      harness.services.keys.eventRing(player.playerId),
      0,
      -1,
    );
    expect(ring).toHaveLength(2);

    socket.close();

    // The ticket was consumed by the first redemption: a second attempt is closed.
    const reused = await harness.app.injectWS(`/ws?ticket=${ticket.ticket}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reused.readyState).not.toBe(1);
  });

  it('rechaza una conexion sin ticket', async () => {
    const socket = await harness.app.injectWS('/ws');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(socket.readyState).not.toBe(1);
  });
});
