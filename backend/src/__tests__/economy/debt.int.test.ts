// The debt policy of plan section 6.6, in its readable half.
//
// Owner: workflow W5-C. Module `economy`.
//
// The property under test is the asymmetry, and it is the one that keeps the game playable
// with the values of the GDD left unadjusted: a negative balance blocks acquiring and does
// not block selling. Blocking both would deadlock a player whose only way out is the market,
// and with GDD sections 118 and 119 producing a deficit in the very first cycle that deadlock
// would be the normal outcome rather than an edge case.
//
// The purchase used here is `POST /api/land/purchase`, which is the canonical money moving
// route of the contract and belongs to an earlier workflow, so what the assertion covers is
// the real path a player takes and not a helper written for the occasion.
//
// The fourth accrual is checked by its absence. `OVERDRAFT_INTEREST` is one of
// `ACCRUAL_LEDGER_TYPES`, the integral that computes it is in `shared/rules/holding.ts` and
// the settlement writes it exactly like the other three; the rate is zero, so no entry is
// ever written today. Asserting both halves — that the kind is wired and that the rate is
// zero — is what makes it a lever available without a migration instead of dead code.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClockReading } from '../../lib/gameClock.js';
import {
  assertDiscretionarySpendingAllowed,
  debtOf,
  isInDebt,
} from '../../modules/economy/index.js';
import {
  ACCRUAL_LEDGER_TYPES,
  LedgerType,
  Money,
  OVERDRAFT_INTEREST_BP_PER_GAME_HOUR,
  PlayerStatus,
  STARTING_CAPITAL,
  StorageResource,
  ValidationCode,
  isApiError,
  type World,
} from '../../shared/index.js';
import { createHarness, type Harness } from '../harness.js';
import {
  advanceAndCatchUp,
  balanceOf,
  clearGrid,
  createEconomyPlayer,
  depositStock,
  errorCode,
  findGrassCells,
  getJson,
  grant,
  postPurchase,
  postSell,
} from './fixtures.js';

let harness: Harness;
let reading: ClockReading;
let world: World;

/** Chunk row this file owns. No other suite of the module touches it. */
const BAND = 700;

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
});

afterAll(async () => {
  await clearGrid(harness, world);
  await harness.teardown();
});

describe('la politica de deuda', () => {
  it('deriva IN_DEBT del saldo liquidado negativo', async () => {
    const player = await createEconomyPlayer(harness, 'debt-status');
    await grant(
      harness,
      player.accessToken,
      Money.toString(Money.negate(Money.add(STARTING_CAPITAL, Money.fromUnits(500)))),
      'debt-status',
    );

    const { statusCode, body } = await getJson(harness, player.accessToken, '/api/auth/me');
    expect(statusCode, JSON.stringify(body)).toBe(200);
    const dto = body['player'] as Record<string, unknown>;
    expect(dto['status']).toBe(PlayerStatus.IN_DEBT);
    expect(dto['balance']).toBe(Money.toString(Money.fromUnits(-500)));

    const balance = await balanceOf(harness, player.playerId);
    expect(isInDebt(balance)).toBe(true);
    expect(debtOf(balance)).toBe(Money.toString(Money.fromUnits(500)));
  });

  it('bloquea comprar tierra con el saldo negativo y no reclama ninguna celda', async () => {
    const player = await createEconomyPlayer(harness, 'debt-buy');
    const cells = await findGrassCells(harness, world, 3, BAND);
    await grant(
      harness,
      player.accessToken,
      Money.toString(Money.negate(Money.add(STARTING_CAPITAL, Money.fromUnits(100)))),
      'debt-buy',
    );

    const { statusCode, body } = await postPurchase(harness, player.accessToken, cells);

    expect(statusCode).toBe(402);
    expect(errorCode(body)).toBe(ValidationCode.INSUFFICIENT_FUNDS);

    const owned = await harness.prisma.worldCell.count({
      where: { ownerPlayerId: player.playerId },
    });
    expect(owned).toBe(0);
    expect(await balanceOf(harness, player.playerId)).toBe(Money.toString(Money.fromUnits(-100)));
  });

  it('no bloquea vender con el saldo negativo, que es la unica via de ingreso', async () => {
    const player = await createEconomyPlayer(harness, 'debt-sell');
    await depositStock(harness, player.farmId, StorageResource.WHEAT_LITERS, 10_000);
    await grant(
      harness,
      player.accessToken,
      Money.toString(Money.negate(Money.add(STARTING_CAPITAL, Money.fromUnits(1_000)))),
      'debt-sell',
    );
    expect(await balanceOf(harness, player.playerId)).toBe(Money.toString(Money.fromUnits(-1_000)));

    const { statusCode, body } = await postSell(
      harness,
      player.accessToken,
      { farmId: player.farmId, resource: StorageResource.WHEAT_LITERS, quantityUnits: 10_000 },
      'debt-sell-1',
    );

    expect(statusCode, JSON.stringify(body)).toBe(200);
    const result = body['result'] as Record<string, unknown>;
    // 10 000 L at 0.22 is 2 200, which takes the balance from -1 000 to 1 200.
    expect(result['revenue']).toBe(Money.toString(Money.fromUnits(2_200)));
    expect(result['balanceAfter']).toBe(Money.toString(Money.fromUnits(1_200)));

    // And the status follows the balance back out of debt on the same advance.
    const { body: me } = await getJson(harness, player.accessToken, '/api/auth/me');
    expect((me['player'] as Record<string, unknown>)['status']).toBe(PlayerStatus.ACTIVE);
  });

  it('nombra el estado cuando un camino de gasto pregunta antes de calcular un precio', () => {
    expect(() => assertDiscretionarySpendingAllowed(Money.fromUnits(1))).not.toThrow();
    expect(() => assertDiscretionarySpendingAllowed(Money.ZERO)).not.toThrow();
    try {
      assertDiscretionarySpendingAllowed(Money.fromUnits(-1));
      expect.unreachable('un saldo negativo tiene que bloquear el gasto discrecional');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect(isApiError(error) ? error.code : null).toBe(ValidationCode.SPENDING_BLOCKED_IN_DEBT);
    }
  });
});

describe('el interes de descubierto', () => {
  it('es el cuarto tipo de devengo y su tasa es cero (plan 6.6)', async () => {
    expect(ACCRUAL_LEDGER_TYPES).toContain(LedgerType.OVERDRAFT_INTEREST);
    expect(ACCRUAL_LEDGER_TYPES).toHaveLength(4);
    expect(OVERDRAFT_INTEREST_BP_PER_GAME_HOUR).toBe(0);
  });

  it('no escribe ningun asiento aunque el saldo lleve horas en negativo', async () => {
    const player = await createEconomyPlayer(harness, 'debt-interest');
    // Small enough that the liquidation threshold of 30 % of the liquidatable value, which
    // the silo alone puts well above it, is never crossed.
    await grant(
      harness,
      player.accessToken,
      Money.toString(Money.negate(Money.add(STARTING_CAPITAL, Money.fromUnits(100)))),
      'debt-interest',
    );

    await advanceAndCatchUp(harness, player.playerId, 12);

    const interest = await harness.prisma.ledgerEntry.count({
      where: { playerId: player.playerId, type: LedgerType.OVERDRAFT_INTEREST },
    });
    expect(interest).toBe(0);
    // The balance did not move either: nothing else accrues for a player with no payroll and
    // no machinery, which is what makes this assertion about the interest and nothing else.
    expect(await balanceOf(harness, player.playerId)).toBe(Money.toString(Money.fromUnits(-100)));
  });
});
