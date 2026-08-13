// The ledger query: paging by sequence, the filters and the self audit.
//
// Owner: workflow W5-C. Module `economy`.
//
// What paging has to guarantee, and what an offset would not: walking the cursor visits every
// entry exactly once even while the player is being settled between two pages. The sequence
// is unique per player and monotonic, so `seq < cursor` is a window a concurrent write cannot
// disturb; an offset would re-read the rows it skipped and shift under the reader.
//
// The filters by kind and by interval are exercised against the service and not against the
// route, because `ledgerQuerySchema` of the frozen contract carries `limit` and `cursor` only
// and rejects anything else at the boundary. They are the shape the return summary of GDD
// section 124 needs, so they are implemented and covered now and the route picks them up when
// the contract widens (`docs/handoff/NOTES-w5c.md`, item 3.1).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditBalance } from '../../lib/ledger.js';
import { queryLedger, sumLedger } from '../../modules/economy/index.js';
import {
  DEFAULT_LEDGER_PAGE,
  LedgerType,
  MAX_LEDGER_PAGE,
  Money,
  STARTING_CAPITAL,
  StorageResource,
  ValidationCode,
  gameMs as toGameMsValue,
  type GameMs,
} from '../../shared/index.js';
import { createHarness, type Harness } from '../harness.js';
import {
  balanceOf,
  createEconomyPlayer,
  depositStock,
  errorCode,
  getJson,
  postSell,
  type EconomyPlayer,
} from './fixtures.js';

let harness: Harness;

/** Sales the paging cases walk through. Comfortably more than the page they ask for. */
const SALE_COUNT = 12;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

/** A player with `SALE_COUNT` sales behind it, plus the opening entry of GDD section 117. */
async function playerWithHistory(label: string): Promise<EconomyPlayer> {
  const player = await createEconomyPlayer(harness, label);
  await depositStock(harness, player.farmId, StorageResource.WHEAT_LITERS, 100 * SALE_COUNT);
  for (let index = 0; index < SALE_COUNT; index += 1) {
    const { statusCode } = await postSell(
      harness,
      player.accessToken,
      { farmId: player.farmId, resource: StorageResource.WHEAT_LITERS, quantityUnits: 100 },
      `${label}-${index}`,
    );
    expect(statusCode).toBe(200);
  }
  return player;
}

describe('GET /api/economy/ledger', () => {
  it('devuelve la pagina mas reciente primero, con el saldo liquidado', async () => {
    const player = await playerWithHistory('ledger-page');

    const { statusCode, body } = await getJson(
      harness,
      player.accessToken,
      '/api/economy/ledger?limit=5',
    );
    expect(statusCode, JSON.stringify(body)).toBe(200);

    const entries = body['entries'] as Record<string, unknown>[];
    expect(entries).toHaveLength(5);
    const seqs = entries.map((entry) => entry['seq'] as number);
    expect(seqs).toEqual([...seqs].sort((left, right) => right - left));
    expect(entries[0]?.['type']).toBe(LedgerType.CROP_SALE);

    // The opening entry of the player plus the twelve sales.
    expect(body['entryCount']).toBe(SALE_COUNT + 1);
    expect(body['balance']).toBe(Money.toString(await balanceOf(harness, player.playerId)));
    expect(body['nextCursor']).toBe(String(seqs[seqs.length - 1]));
  });

  it('recorre todo el historico con el cursor, sin repetir ni saltar ningun asiento', async () => {
    const player = await playerWithHistory('ledger-walk');

    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url = `/api/economy/ledger?limit=4${cursor === null ? '' : `&cursor=${cursor}`}`;
      const { body } = await getJson(harness, player.accessToken, url);
      const entries = body['entries'] as Record<string, unknown>[];
      seen.push(...entries.map((entry) => entry['seq'] as number));
      cursor = body['nextCursor'] as string | null;
      if (cursor === null) {
        break;
      }
    }

    expect(cursor).toBeNull();
    expect(seen).toHaveLength(SALE_COUNT + 1);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort((left, right) => left - right)).toEqual(
      Array.from({ length: SALE_COUNT + 1 }, (_unused, index) => index + 1),
    );
  });

  it('rechaza un cursor que no lo es', async () => {
    const player = await createEconomyPlayer(harness, 'ledger-cursor');
    const { statusCode, body } = await getJson(
      harness,
      player.accessToken,
      '/api/economy/ledger?cursor=no-es-un-cursor',
    );
    expect(statusCode).toBe(400);
    expect(errorCode(body)).toBe(ValidationCode.VALIDATION_FAILED);
  });

  it('aplica el tamano de pagina por defecto y su techo', async () => {
    const player = await createEconomyPlayer(harness, 'ledger-limits');
    const { body } = await getJson(harness, player.accessToken, '/api/economy/ledger');
    expect((body['entries'] as unknown[]).length).toBeLessThanOrEqual(DEFAULT_LEDGER_PAGE);

    const beyond = await getJson(
      harness,
      player.accessToken,
      `/api/economy/ledger?limit=${MAX_LEDGER_PAGE + 1}`,
    );
    expect(beyond.statusCode).toBe(400);
  });

  it('el asiento de apertura es el capital inicial de GDD 117', async () => {
    const player = await createEconomyPlayer(harness, 'ledger-opening');
    const { body } = await getJson(harness, player.accessToken, '/api/economy/ledger');
    const entries = body['entries'] as Record<string, unknown>[];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.['type']).toBe(LedgerType.STARTING_CAPITAL);
    expect(entries[0]?.['amount']).toBe(Money.toString(STARTING_CAPITAL));
    expect(entries[0]?.['balanceAfter']).toBe(Money.toString(STARTING_CAPITAL));
  });
});

describe('queryLedger', () => {
  it('filtra por tipo de asiento', async () => {
    const player = await playerWithHistory('ledger-type');

    const sales = await queryLedger(harness.prisma, player.playerId, {
      limit: 100,
      cursor: null,
      types: [LedgerType.CROP_SALE],
      fromGameMs: null,
      toGameMs: null,
    });
    expect(sales.entryCount).toBe(SALE_COUNT);
    expect(sales.entries.every((entry) => entry.type === LedgerType.CROP_SALE)).toBe(true);

    const opening = await queryLedger(harness.prisma, player.playerId, {
      limit: 100,
      cursor: null,
      types: [LedgerType.STARTING_CAPITAL],
      fromGameMs: null,
      toGameMs: null,
    });
    expect(opening.entryCount).toBe(1);
  });

  it('filtra por intervalo de tiempo de juego, cerrado por abajo y abierto por arriba', async () => {
    const player = await playerWithHistory('ledger-interval');
    const all = await queryLedger(harness.prisma, player.playerId, {
      limit: 100,
      cursor: null,
      types: null,
      fromGameMs: null,
      toGameMs: null,
    });
    const instants = all.entries.map((entry) => entry.atGameMs);
    const at = instants[0] as GameMs;

    const upTo = await queryLedger(harness.prisma, player.playerId, {
      limit: 100,
      cursor: null,
      types: null,
      fromGameMs: null,
      toGameMs: at,
    });
    const from = await queryLedger(harness.prisma, player.playerId, {
      limit: 100,
      cursor: null,
      types: null,
      fromGameMs: at,
      toGameMs: null,
    });
    // The two halves partition the history: closed below and open above, so no entry is
    // counted twice and none is lost.
    expect(upTo.entryCount + from.entryCount).toBe(all.entryCount);

    const empty = await queryLedger(harness.prisma, player.playerId, {
      limit: 100,
      cursor: null,
      types: null,
      fromGameMs: toGameMsValue(at + 1_000_000_000n),
      toGameMs: null,
    });
    expect(empty.entryCount).toBe(0);
    expect(empty.entries).toHaveLength(0);
    expect(empty.nextCursor).toBeNull();
  });

  it('suma por tipo lo que el resumen de regreso de GDD 124 agrega', async () => {
    const player = await playerWithHistory('ledger-sum');
    const sales = await sumLedger(harness.prisma, player.playerId, {
      types: [LedgerType.CROP_SALE],
      fromGameMs: null,
      toGameMs: null,
    });
    // Twelve sales of a hundred litres at 0.90.
    expect(sales).toBe(Money.toString(Money.fromUnits(SALE_COUNT * 90)));
  });

  it('la suma de los asientos es el saldo almacenado', async () => {
    const player = await playerWithHistory('ledger-audit');
    const audit = await harness.services.transaction(async (tx) =>
      auditBalance(tx, player.playerId),
    );
    expect(audit.ok).toBe(true);
    expect(audit.entryCount).toBe(SALE_COUNT + 1);
    expect(audit.storedBalance).toBe(audit.summedBalance);
  });
});
