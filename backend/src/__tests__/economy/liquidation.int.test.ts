// Forced liquidation: the threshold, the published order and the entry per asset.
//
// Owner: workflow W5-C. Module `economy`.
//
// Three properties, and all three are what plan section 6.6 asks for literally:
//
//   1. It fires at the threshold and not before. The threshold is proportional to the
//      liquidatable value, so a debt that is small next to the holding is left alone; a
//      liquidation on the first negative cent would make the deficit of the first cycle,
//      which GDD sections 118 and 119 predict, unplayable.
//   2. It follows `LIQUIDATION_STEPS` of `shared/config/economy.ts`, which the run reports in
//      the `meta` of its aggregate entry. Asserting against the catalogue and not against a
//      literal list is the point: the order is policy and lives in one place.
//   3. It leaves one ledger entry per asset, with `refId` pointing at it, so that the return
//      summary of plan section 6.7 can say what was sold and why.
//
// And two that follow from them and are just as easy to break: it stops as soon as the debt
// is covered, so it is a liquidation and not a confiscation; and the sweep is what triggers
// it, never the login, so it is applied by `advancePlayer` at the due instant of
// `PLAYER_SETTLE_SWEEP` and not by the first request of a returning player.
//
// The arithmetic is exact by construction. The fixture holds implements, whose maintenance is
// zero in the catalogue of GDD section 89, and a worker who earns nothing, so no game hour
// costs anything and every balance in the assertions is the result of the operation under
// test alone.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LIQUIDATION_DEBT_THRESHOLD_BP,
  LIQUIDATION_STEPS,
  LedgerType,
  MACHINE_CATALOGUE,
  MachineType,
  Money,
  STARTING_CAPITAL,
  StorageResource,
  WHEAT,
  bp,
  cropSaleRevenue,
  machineResaleValue,
} from '../../shared/index.js';
import { createHarness, type Harness } from '../harness.js';
import {
  advanceAndCatchUp,
  balanceOf,
  createEconomyPlayer,
  createFreeWorker,
  createMachine,
  depositStock,
  type EconomyPlayer,
} from './fixtures.js';

let harness: Harness;

/** Game hours between one settlement sweep and the next, from `SETTLE_SWEEP_PERIOD_GAME_MS`. */
const SWEEP_PERIOD_GAME_HOURS = 6;

/** Resale of a machine at full condition, which is the price the liquidation pays. */
function resaleOf(type: MachineType): Money {
  return machineResaleValue({
    purchasePrice: MACHINE_CATALOGUE[type].purchasePrice,
    conditionBp: bp(10_000),
  });
}

/** The entries of a player, oldest first, which is the order the liquidation wrote them in. */
async function entriesOf(
  playerId: EconomyPlayer['playerId'],
): Promise<readonly { type: LedgerType; amount: string; refId: string | null; meta: unknown }[]> {
  const rows = await harness.prisma.ledgerEntry.findMany({
    where: { playerId },
    orderBy: { seq: 'asc' },
    select: { type: true, amount: true, refId: true, meta: true },
  });
  return rows.map((row) => ({
    type: row.type,
    amount: row.amount.toFixed(4),
    refId: row.refId,
    meta: row.meta,
  }));
}

/** Takes the balance to exactly `-debt` with the development route. */
async function forceDebt(player: EconomyPlayer, debt: Money, reason: string): Promise<void> {
  const current = await balanceOf(harness, player.playerId);
  const delta = Money.negate(Money.add(current, debt));
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/dev/grant',
    headers: {
      authorization: `Bearer ${player.accessToken}`,
      'idempotency-key': `liq-grant-${reason}`,
    },
    payload: { amount: Money.toString(delta), reason },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(await balanceOf(harness, player.playerId)).toBe(Money.toString(Money.negate(debt)));
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

describe('la liquidacion forzosa', () => {
  it('no se dispara mientras la deuda no supera el umbral del valor liquidable', async () => {
    const player = await createEconomyPlayer(harness, 'liq-below');
    await depositStock(harness, player.farmId, StorageResource.WHEAT_LITERS, 10_000);
    // The silo alone is worth 6 000 at the resale factor, so 30 % of the holding is well
    // above a debt of 100.
    await forceDebt(player, Money.fromUnits(100), 'below');

    await advanceAndCatchUp(harness, player.playerId, SWEEP_PERIOD_GAME_HOURS + 1);

    const farm = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: player.farmId },
      select: { storedWheatLiters: true },
    });
    expect(farm.storedWheatLiters).toBe(10_000);
    const liquidations = await harness.prisma.ledgerEntry.count({
      where: { playerId: player.playerId, type: LedgerType.LIQUIDATION },
    });
    expect(liquidations).toBe(0);
    expect(await balanceOf(harness, player.playerId)).toBe(Money.toString(Money.fromUnits(-100)));
  });

  it('se dispara en el umbral, vende en el orden publicado y se detiene al cubrir la deuda', async () => {
    const player = await createEconomyPlayer(harness, 'liq-threshold');
    await depositStock(harness, player.farmId, StorageResource.WHEAT_LITERS, 10_000);
    const plowId = await createMachine(harness, player, MachineType.PLOW);
    const seederId = await createMachine(harness, player, MachineType.SEEDER);

    // Stock 9 000 + plow 3 900 + seeder 5 880 + silo 6 000 = 24 780 liquidatable, so the
    // threshold is 7 434 and a debt of 10 000 is past it.
    const stock = cropSaleRevenue(WHEAT, 10_000);
    const plow = resaleOf(MachineType.PLOW);
    const seeder = resaleOf(MachineType.SEEDER);
    const liquidatable = Money.sum([stock, plow, seeder, Money.fromUnits(6_000)]);
    expect(liquidatable).toBe(Money.toString(Money.fromUnits(24_780)));
    const threshold = Money.mulBp(liquidatable, LIQUIDATION_DEBT_THRESHOLD_BP);
    const debt = Money.fromUnits(10_000);
    expect(Money.compare(debt, threshold)).toBe(1);

    await forceDebt(player, debt, 'threshold');
    await advanceAndCatchUp(harness, player.playerId, SWEEP_PERIOD_GAME_HOURS + 1);

    // Stock first, then the machine with the lowest identifier, and then it stops: the debt
    // is covered and the second machine is left alone.
    const entries = await entriesOf(player.playerId);
    const liquidation = entries.filter(
      (entry) =>
        entry.type === LedgerType.CROP_SALE ||
        entry.type === LedgerType.MACHINE_SALE ||
        entry.type === LedgerType.LIQUIDATION,
    );
    expect(liquidation.map((entry) => entry.type)).toEqual([
      LedgerType.CROP_SALE,
      LedgerType.MACHINE_SALE,
      LedgerType.LIQUIDATION,
    ]);
    expect(liquidation[0]?.amount).toBe(Money.toString(stock));
    expect(liquidation[1]?.amount).toBe(Money.toString(plow));

    const sold = [plowId, seederId].sort()[0];
    expect(liquidation[1]?.refId).toBe(sold);

    const machines = await harness.prisma.machine.findMany({
      where: { playerId: player.playerId },
      orderBy: { id: 'asc' },
      select: { id: true, disposedGameMs: true },
    });
    expect(machines.filter((machine) => machine.disposedGameMs !== null)).toHaveLength(1);

    // -10 000 + 9 000 + 3 900 = 2 900.
    expect(await balanceOf(harness, player.playerId)).toBe(Money.toString(Money.fromUnits(2_900)));

    const meta = liquidation[2]?.meta as Record<string, unknown>;
    expect(meta['stepsRun']).toEqual(['INVENTORY', 'IDLE_MACHINES']);
    // The loop stops as soon as the balance is no longer negative, so the steps after the one
    // that covered the debt are never even considered.
    expect(meta['stepsSkipped']).toEqual([]);
    expect(meta['assetCount']).toBe(2);
    expect(meta['proceeds']).toBe(Money.toString(Money.add(stock, plow)));
  });

  it('recorre el orden completo y declara los dos pasos que siguen sin estrategia', async () => {
    const player = await createEconomyPlayer(harness, 'liq-full', { withWorkerHome: true });
    await depositStock(harness, player.farmId, StorageResource.WHEAT_LITERS, 1_000);
    const trailerId = await createMachine(harness, player, MachineType.TRAILER);
    const workerId = await createFreeWorker(harness, player, 'Peon liquidable');

    await forceDebt(player, Money.fromUnits(200_000), 'full');
    await advanceAndCatchUp(harness, player.playerId, SWEEP_PERIOD_GAME_HOURS + 1);

    const entries = await entriesOf(player.playerId);
    const summary = entries.find((entry) => entry.type === LedgerType.LIQUIDATION);
    expect(summary).toBeDefined();
    const meta = summary?.meta as Record<string, unknown>;

    // The order is the catalogue, not a list restated here. `CANCEL_TASKS` runs since W7,
    // through the registry of `lib/moduleSeams.ts`: this player has no running task, so it
    // cancels nothing, and running a step that found nothing is still running it. What stays
    // skipped are the two steps that have no strategy at all
    // (docs/handoff/NOTES-w6a.md 2.1, NOTES-w5c.md 2.4).
    expect(meta['stepsRun']).toEqual(['INVENTORY', 'IDLE_MACHINES', 'CANCEL_TASKS', 'WORKERS']);
    expect(meta['stepsSkipped']).toEqual(['BUILDINGS', 'UNUSED_LAND']);
    const published: readonly string[] = LIQUIDATION_STEPS;
    const order = [...(meta['stepsRun'] as string[]), ...(meta['stepsSkipped'] as string[])];
    expect(order.every((step) => published.includes(step))).toBe(true);
    expect(published.filter((step) => order.includes(step))).toHaveLength(published.length);

    // One entry per asset that changed hands, with the asset in `refId`.
    const sales = entries.filter(
      (entry) => entry.type === LedgerType.CROP_SALE || entry.type === LedgerType.MACHINE_SALE,
    );
    expect(sales).toHaveLength(2);
    expect(sales[0]?.amount).toBe(Money.toString(cropSaleRevenue(WHEAT, 1_000)));
    expect(sales[1]?.refId).toBe(trailerId);
    expect(sales[1]?.amount).toBe(Money.toString(resaleOf(MachineType.TRAILER)));

    // The worker is not sold: he is dismissed, which is what stops the wage accrual, and the
    // dismissal is recorded where every other dismissal is.
    const worker = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: workerId },
      select: { terminatedGameMs: true, homeId: true },
    });
    expect(worker.terminatedGameMs).not.toBeNull();
    const home = await harness.prisma.building.findUniqueOrThrow({
      where: { id: worker.homeId },
      select: { workerCount: true },
    });
    expect(home.workerCount).toBe(0);

    const assets = meta['assets'] as Record<string, unknown>[];
    expect(assets.map((asset) => asset['kind'])).toEqual(['STOCK', 'MACHINE', 'WORKER']);
  });

  it('la dispara el barrido y no el regreso del jugador', async () => {
    const player = await createEconomyPlayer(harness, 'liq-sweep');
    await depositStock(harness, player.farmId, StorageResource.WHEAT_LITERS, 20_000);
    await forceDebt(player, Money.fromUnits(50_000), 'sweep');

    // Coming back without the sweep having fallen due changes nothing, however deep the debt.
    await advanceAndCatchUp(harness, player.playerId, SWEEP_PERIOD_GAME_HOURS - 2);
    let farm = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: player.farmId },
      select: { storedWheatLiters: true },
    });
    expect(farm.storedWheatLiters).toBe(20_000);

    // Once it does, the same applier liquidates.
    await advanceAndCatchUp(harness, player.playerId, 3);
    farm = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: player.farmId },
      select: { storedWheatLiters: true },
    });
    expect(farm.storedWheatLiters).toBe(0);
  });

  it('un segundo avance sobre el mismo evento no vuelve a liquidar', async () => {
    const player = await createEconomyPlayer(harness, 'liq-idem');
    await depositStock(harness, player.farmId, StorageResource.WHEAT_LITERS, 5_000);
    await forceDebt(player, Money.fromUnits(50_000), 'idem');

    await advanceAndCatchUp(harness, player.playerId, SWEEP_PERIOD_GAME_HOURS + 1);
    const afterFirst = await balanceOf(harness, player.playerId);
    const countAfterFirst = await harness.prisma.ledgerEntry.count({
      where: { playerId: player.playerId, type: LedgerType.LIQUIDATION },
    });

    // The same instant again: the event was already claimed, so nothing is applied twice.
    await advanceAndCatchUp(harness, player.playerId, 0);
    expect(await balanceOf(harness, player.playerId)).toBe(afterFirst);
    expect(
      await harness.prisma.ledgerEntry.count({
        where: { playerId: player.playerId, type: LedgerType.LIQUIDATION },
      }),
    ).toBe(countAfterFirst);
    expect(countAfterFirst).toBe(1);
  });

  it('el barrido tiene manejador de verdad: el evento se procesa y encadena el siguiente', async () => {
    // The point of the assertion is the metric `farm_world_scheduled_events_unhandled_total`,
    // which counts a due event whose kind has no handler. `PLAYER_SETTLE_SWEEP` has had one
    // since W3 and this module extends it through `registerSettleSweepHook` rather than adding
    // a kind of its own, so the counter must stay flat while the chain advances.
    const player = await createEconomyPlayer(harness, 'liq-sweep-chain');
    const before = await harness.prisma.scheduledEvent.findMany({
      where: { playerId: player.playerId, kind: 'PLAYER_SETTLE_SWEEP' },
      select: { id: true, status: true, dueGameMs: true },
    });
    expect(before).toHaveLength(1);
    expect(before[0]?.status).toBe('PENDING');

    await advanceAndCatchUp(harness, player.playerId, SWEEP_PERIOD_GAME_HOURS + 1);

    const after = await harness.prisma.scheduledEvent.findMany({
      where: { playerId: player.playerId, kind: 'PLAYER_SETTLE_SWEEP' },
      orderBy: { dueGameMs: 'asc' },
      select: { id: true, status: true, dueGameMs: true, processedAtGameMs: true },
    });
    expect(after).toHaveLength(2);
    expect(after[0]?.status).toBe('PROCESSED');
    expect(after[0]?.processedAtGameMs).toBe(before[0]?.dueGameMs);
    expect(after[1]?.status).toBe('PENDING');
    // One period ahead of the one that just ran, which is what keeps the chain alive.
    expect(after[1]?.dueGameMs).toBeGreaterThan(after[0]?.dueGameMs ?? 0n);
  });

  it('el capital inicial de GDD 117 es el punto de partida de cada caso', async () => {
    const player = await createEconomyPlayer(harness, 'liq-start');
    expect(await balanceOf(harness, player.playerId)).toBe(Money.toString(STARTING_CAPITAL));
  });
});
