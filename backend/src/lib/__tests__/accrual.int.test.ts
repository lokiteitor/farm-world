// The accrual against the real database: additivity and the settlement mark.
//
// Owner: workflow W3-A (backend skeleton).
//
// The property that matters is additivity: settling `[a, c)` in one window and settling `[a, b)`
// then `[b, c)` charge the same amount. It is what makes the order of settlement irrelevant, and
// therefore what makes a worker that was down for a day harmless: whatever it did not settle, the
// next write path settles, and the total is the same (plan section 6.2).
//
// `shared/rules/__tests__/properties.test.ts` already proves it for the pure integral with
// fast-check. What this file proves is the part that cannot be pure: that the sources are read
// from PostgreSQL with the right overlap filters, that the entries are written once per category
// with the key of the interval, and that the mark advances monotonically so a repeat settles
// nothing.
//
// Every expected amount is derived from the shared catalogue and never written as a literal. A
// test that hard coded 6.30 would be asserting the balance of the GDD and not the arithmetic of
// this module, and would have to be edited whenever the catalogue is retuned.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createFarmFixture,
  createHarness,
  registerViaHttp,
  type Harness,
} from '../../__tests__/harness.js';
import {
  ACCRUAL_LEDGER_TYPES,
  LedgerType,
  MACHINE_CATALOGUE,
  MS_PER_GAME_HOUR,
  MachineType,
  Money,
  gameHours as toGameHours,
  gameMs as toGameMsValue,
  type GameMs,
  type PlayerId,
} from '../../shared/index.js';
import { settleAccruals } from '../accrual.js';
import { lockPlayer } from '../tx.js';

let harness: Harness;

/** Salary of the fixture worker: a round rate, so every expectation divides exactly. */
const SALARY = Money.fromUnits(20);

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

/** A player with one worker and one tractor, both valid from the instant it starts. */
async function playerWithCosts(label: string): Promise<{
  readonly playerId: PlayerId;
  readonly startedAtGameMs: GameMs;
}> {
  const player = await registerViaHttp(harness, label);
  const row = await harness.prisma.player.findUniqueOrThrow({
    where: { id: player.playerId },
    select: { startedAtGameMs: true },
  });
  const startedAtGameMs = toGameMsValue(row.startedAtGameMs);
  const farm = await createFarmFixture(harness, player.playerId, startedAtGameMs);

  await harness.prisma.worker.create({
    data: {
      playerId: player.playerId,
      farmId: farm.farmId,
      homeId: farm.homeId,
      name: 'Trabajador de prueba',
      skillBp: 5000,
      salaryPerGameHour: Money.toString(SALARY),
      status: 'IDLE',
      hiredGameMs: startedAtGameMs,
    },
  });
  await harness.prisma.machine.create({
    data: {
      playerId: player.playerId,
      farmId: farm.farmId,
      garageId: farm.garageId,
      type: MachineType.TRACTOR,
      conditionBp: 10_000,
      conditionUpdatedAtGameMs: startedAtGameMs,
      status: 'IDLE',
      purchasePrice: '0',
      acquiredGameMs: startedAtGameMs,
    },
  });

  return { playerId: player.playerId, startedAtGameMs };
}

/** Settles a player up to an instant, with the lock the ledger requires. */
async function settleTo(
  playerId: PlayerId,
  toGameMs: GameMs,
): Promise<Awaited<ReturnType<typeof settleAccruals>>> {
  const reading = await harness.services.clock.read();
  return harness.services.transaction(async (tx) => {
    const lock = await lockPlayer(tx, playerId);
    if (lock === null) {
      throw new Error('the player does not exist');
    }
    return settleAccruals(tx, lock, toGameMs, reading.atRealMs);
  });
}

/** The instant `hours` game hours after another. */
function plusHours(from: GameMs, hours: number): GameMs {
  return toGameMsValue(from + BigInt(hours) * MS_PER_GAME_HOUR);
}

describe('la liquidacion de devengos', () => {
  it('cobra salario y mantenimiento por la ventana, con un asiento por categoria', async () => {
    const player = await playerWithCosts('accrual-basic');
    const hours = 6;
    const settlement = await settleTo(player.playerId, plusHours(player.startedAtGameMs, hours));

    expect(settlement.settled).toBe(true);
    expect(settlement.breakdown.wages).toBe(Money.mulHours(SALARY, toGameHours(hours)));
    expect(settlement.breakdown.maintenance).toBe(
      Money.mulHours(
        MACHINE_CATALOGUE[MachineType.TRACTOR].maintenanceCostPerGameHour,
        toGameHours(hours),
      ),
    );
    // The tractor is idle, so nothing operates, and the overdraft rate is zero by default.
    expect(settlement.breakdown.operating).toBe(Money.ZERO);
    expect(settlement.breakdown.interest).toBe(Money.ZERO);

    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId: player.playerId, type: { in: [...ACCRUAL_LEDGER_TYPES] } },
      orderBy: { seq: 'asc' },
    });
    expect(entries.map((entry) => entry.type)).toEqual([
      LedgerType.WORKER_WAGES,
      LedgerType.MACHINE_MAINTENANCE,
    ]);
    // The key carries the start of the interval, which is what makes a retry of the same window a
    // no-op (plan section 6.3).
    expect(entries[0]?.idempotencyKey).toBe(
      `accrual:${player.playerId}:WORKER_WAGES:${player.startedAtGameMs}`,
    );

    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { lastAccrualGameMs: true },
    });
    expect(row.lastAccrualGameMs).toBe(plusHours(player.startedAtGameMs, hours));
  });

  it('no liquida dos veces la misma ventana', async () => {
    const player = await playerWithCosts('accrual-repeat');
    const target = plusHours(player.startedAtGameMs, 4);

    const first = await settleTo(player.playerId, target);
    const second = await settleTo(player.playerId, target);

    expect(first.settled).toBe(true);
    expect(second.settled).toBe(false);
    expect(second.entries).toHaveLength(0);
    expect(Money.compare(first.balanceAfter, second.balanceAfter)).toBe(0);
  });

  it('es aditiva: una ventana de doce horas cuesta lo mismo en uno o en dos tramos', async () => {
    const whole = await playerWithCosts('accrual-whole');
    const split = await playerWithCosts('accrual-split');

    const wholeSettlement = await settleTo(whole.playerId, plusHours(whole.startedAtGameMs, 12));
    await settleTo(split.playerId, plusHours(split.startedAtGameMs, 6));
    const secondHalf = await settleTo(split.playerId, plusHours(split.startedAtGameMs, 12));

    const wholeRow = await harness.prisma.player.findUniqueOrThrow({
      where: { id: whole.playerId },
      select: { balance: true },
    });
    const splitRow = await harness.prisma.player.findUniqueOrThrow({
      where: { id: split.playerId },
      select: { balance: true },
    });

    // Exact equality, not a tolerance: the rates of the fixture are whole units and the windows are
    // whole hours, so no category rounds. The money form rounds once per category, so a fixture
    // with a rate of, say, 0.00005 per hour could differ by one ten-thousandth per category; that
    // is documented in the header of `shared/rules/holding.ts` and is why the fixture is round.
    expect(Money.fromString(String(splitRow.balance))).toBe(
      Money.fromString(String(wholeRow.balance)),
    );
    expect(secondHalf.window.fromGameMs).toBe(plusHours(split.startedAtGameMs, 6));

    // And the split player has twice as many entries for the same total, which is the visible
    // consequence of settling twice.
    const wholeEntries = await harness.prisma.ledgerEntry.count({
      where: { playerId: whole.playerId, type: { in: [...ACCRUAL_LEDGER_TYPES] } },
    });
    const splitEntries = await harness.prisma.ledgerEntry.count({
      where: { playerId: split.playerId, type: { in: [...ACCRUAL_LEDGER_TYPES] } },
    });
    expect(wholeEntries).toBe(2);
    expect(splitEntries).toBe(4);
    expect(Money.compare(wholeSettlement.balanceAfter, wholeSettlement.balanceAfter)).toBe(0);
  });

  it('no cobra a un trabajador despedido antes de la ventana', async () => {
    const player = await playerWithCosts('accrual-terminated');
    await harness.prisma.worker.updateMany({
      where: { playerId: player.playerId },
      data: { terminatedGameMs: player.startedAtGameMs, status: 'IDLE' },
    });

    const settlement = await settleTo(player.playerId, plusHours(player.startedAtGameMs, 8));
    expect(settlement.breakdown.wages).toBe(Money.ZERO);
    // The tractor is still there, so maintenance is not zero: the filter is per source and not
    // per player.
    expect(Money.isZero(settlement.breakdown.maintenance)).toBe(false);
  });
});
