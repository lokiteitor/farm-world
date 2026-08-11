// The `Idempotency-Key` guard, end to end over a route that really moves money.
//
// Owner: workflow W3-A (backend skeleton).
//
// The route used is `POST /api/dev/grant`, and that is not a shortcut: it is the only money moving
// route of the contract that this workflow implements, and the contract marks it exactly like the
// other seven, so what is asserted here is the guard and not the route
// (docs/handoff/NOTES-W2c.md, item 3.6).
//
// Two independent layers are exercised at once, and the test distinguishes them:
//
//   - The transport layer, `RequestIdempotency`, which replays the stored response so a double
//     click returns the first answer instead of performing the operation twice.
//   - The ledger layer, the unique key per player, which would refuse the second write even if the
//     transport layer failed. That is why the assertion counts the entries as well as comparing the
//     two responses: agreeing responses with two entries would be a broken invariant wearing a
//     correct answer.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerType, Money } from '../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from './harness.js';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

describe('la cabecera Idempotency-Key', () => {
  it('exige la cabecera en toda ruta que mueve dinero', async () => {
    const player = await registerViaHttp(harness, 'idem-missing');
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/grant',
      headers: bearer(player.accessToken),
      payload: { amount: '10.0000', reason: 'sin cabecera' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; details: { field: string } } }>();
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(body.error.details.field).toBe('headers.idempotency-key');
  });

  it('reproduce la respuesta almacenada y no repite la operacion', async () => {
    const player = await registerViaHttp(harness, 'idem-replay');
    const key = `idem-replay-${harness.runId}`;
    const payload = { amount: '250.0000', reason: 'primera vez' };

    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/grant',
      headers: { ...bearer(player.accessToken), 'idempotency-key': key },
      payload,
    });
    expect(first.statusCode).toBe(200);

    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/grant',
      headers: { ...bearer(player.accessToken), 'idempotency-key': key },
      payload,
    });
    expect(second.statusCode).toBe(200);
    // Byte for byte the same answer, sequence included: the client cannot tell the retry from the
    // original, which is the whole point.
    expect(second.json()).toEqual(first.json());

    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId: player.playerId, type: LedgerType.COMPENSATION },
    });
    expect(entries).toHaveLength(1);

    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { balance: true, ledgerSeq: true },
    });
    expect(Money.fromString(String(row.balance))).toBe('160250.0000');
    expect(row.ledgerSeq).toBe(2);

    const record = await harness.prisma.requestIdempotency.findUniqueOrThrow({
      where: { playerId_key: { playerId: player.playerId, key } },
      select: { statusCode: true, completedAtRealMs: true, path: true },
    });
    expect(record.statusCode).toBe(200);
    expect(record.completedAtRealMs).not.toBeNull();
    expect(record.path).toBe('/api/dev/grant');
  });

  it('rechaza la misma clave con un cuerpo distinto', async () => {
    const player = await registerViaHttp(harness, 'idem-reused');
    const key = `idem-reused-${harness.runId}`;

    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/grant',
      headers: { ...bearer(player.accessToken), 'idempotency-key': key },
      payload: { amount: '10.0000', reason: 'original' },
    });
    expect(first.statusCode).toBe(200);

    const different = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/grant',
      headers: { ...bearer(player.accessToken), 'idempotency-key': key },
      payload: { amount: '99.0000', reason: 'otra cosa' },
    });
    expect(different.statusCode).toBe(409);
    expect(different.json<{ error: { code: string } }>().error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const entries = await harness.prisma.ledgerEntry.count({
      where: { playerId: player.playerId, type: LedgerType.COMPENSATION },
    });
    expect(entries).toBe(1);
  });

  it('admite la misma clave en dos jugadores distintos', async () => {
    const left = await registerViaHttp(harness, 'idem-left');
    const right = await registerViaHttp(harness, 'idem-right');
    const key = `idem-shared-${harness.runId}`;
    const payload = { amount: '5.0000', reason: 'clave compartida' };

    for (const player of [left, right]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/dev/grant',
        headers: { ...bearer(player.accessToken), 'idempotency-key': key },
        payload,
      });
      // The record and the ledger key are both scoped to the player, so two players sending the
      // same key is not a collision.
      expect(response.statusCode).toBe(200);
    }

    const records = await harness.prisma.requestIdempotency.count({ where: { key } });
    expect(records).toBe(2);
  });

  it('no almacena la respuesta de un fallo del servidor, de modo que el reintento sigue abierto', async () => {
    const player = await registerViaHttp(harness, 'idem-5xx');
    const key = `idem-5xx-${harness.runId}`;

    // A stub route that moves money answers 501, which is a server failure: the record must be
    // removed so a retry once the module lands is not answered with a stale 501.
    const stub = await harness.app.inject({
      method: 'POST',
      url: '/api/machines',
      headers: { ...bearer(player.accessToken), 'idempotency-key': key },
      payload: { farmId: '00000000-0000-4000-8000-000000000000', type: 'TRACTOR' },
    });
    expect(stub.statusCode).toBe(501);

    const records = await harness.prisma.requestIdempotency.count({
      where: { playerId: player.playerId, key },
    });
    expect(records).toBe(0);
  });
});
