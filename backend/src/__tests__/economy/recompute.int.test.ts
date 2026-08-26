// The property that makes the ledger trustworthy: the history recomputes.
//
// Owner: workflow W5-C. Module `economy`.
//
// Plan section 6.2 lists recomputability as the third consequence of accruing by the integral
// of overlaps: "a test recalculates the historical cost from scratch and compares it against
// the ledger". This is that test, and it is a property rather than a case because the thing
// that would break it is a sequence nobody thought of — a worker hired halfway through a
// window, a machine sold in the middle of one, a settlement that ran twice, a settlement that
// never ran because the worker was down.
//
// What is generated: a payroll, a fleet, and a sequence of steps that advance the clock and
// sell stock. What is asserted, for every sequence:
//
//   1. The sum of the entries equals the stored balance, exactly. This is `auditBalance` of
//      `lib/ledger.ts` and it holds to the last ten-thousandth: `balanceAfter` is written
//      under the player lock and every write path goes through it.
//   2. The holding cost of the whole history, recomputed in one window from the sources read
//      independently out of PostgreSQL, equals the sum of the accrual entries the settlements
//      wrote in many windows. That is additivity, which is what makes the order of settlement
//      irrelevant and therefore makes a worker that was down for a day harmless.
//   3. The balance is the starting capital of GDD section 117, plus what was sold, minus that
//      recomputed cost.
//
// The tolerance of the second and third assertions is not slack: `accrueContinuousCosts`
// rounds once per category, so a window split into `n` pieces can differ from the whole by at
// most half a ten-thousandth per category and per piece. The header of
// `shared/rules/holding.ts` states it, and the bound below derives from the number of
// settlements the run actually produced rather than being a round number chosen to make the
// assertion pass.

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { auditBalance } from '../../lib/ledger.js';
import { sellStock } from '../../modules/economy/index.js';
import {
  ACCRUAL_LEDGER_TYPES,
  MACHINE_CATALOGUE,
  MachineStatus,
  MachineType,
  Money,
  STARTING_CAPITAL,
  WHEAT,
  accrueContinuousCosts,
  cropSaleRevenue,
  gameMs as toGameMsValue,
  type GameMs,
  type MachineCostSource,
  type PlayerId,
  type WorkerCostSource,
} from '../../shared/index.js';
import { createHarness, type Harness } from '../harness.js';
import { advanceAndCatchUp, createEconomyPlayer, depositStock } from './fixtures.js';

let harness: Harness;

/**
 * Runs of the property. Every run registers a player and moves the real database, so the
 * count is deliberately small: what fast-check buys here is the shape of the sequence, and
 * eight distinct shapes is already more than a hand written case list would cover.
 */
const RUNS = 8;

/** Stock every player starts with, comfortably above what any generated sequence sells. */
const INITIAL_STOCK_LITERS = 60_000;

/**
 * Game hours the run advances after the generated sequence, before the last settlement.
 *
 * Above the latest hour the generator can hire or acquire at, so that every source of cost
 * overlaps the window in every run and the property is never satisfied vacuously by a payroll
 * that had not started yet when the sequence ended.
 */
const CLOSING_TAIL_GAME_HOURS = 12;

/** Machinery the generator draws from: one with maintenance, one without (GDD section 89). */
const FLEET: readonly MachineType[] = [
  MachineType.TRACTOR,
  MachineType.HARVESTER,
  MachineType.PLOW,
];

interface Scenario {
  readonly workers: readonly { readonly salaryUnits: number; readonly hiredAtHour: number }[];
  readonly machines: readonly {
    readonly typeIndex: number;
    readonly acquiredAtHour: number;
    readonly disposedAtHour: number | null;
  }[];
  readonly steps: readonly { readonly advanceHours: number; readonly sellUnits: number }[];
}

const scenarioArbitrary = fc.record({
  // At least one worker earning something, so that every run has a cost to recompute: a
  // sequence with no payroll and no maintenance would satisfy the property vacuously.
  workers: fc.array(
    fc.record({
      salaryUnits: fc.integer({ min: 1, max: 40 }),
      hiredAtHour: fc.integer({ min: 0, max: 10 }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
  machines: fc.array(
    fc.record({
      typeIndex: fc.integer({ min: 0, max: FLEET.length - 1 }),
      acquiredAtHour: fc.integer({ min: 0, max: 10 }),
      disposedAtHour: fc.option(fc.integer({ min: 11, max: 30 }), { nil: null }),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  steps: fc.array(
    fc.record({
      advanceHours: fc.integer({ min: 1, max: 9 }),
      sellUnits: fc.integer({ min: 0, max: 2_000 }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
});

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

/** The instant `hours` game hours after another. */
function plusHours(from: GameMs, hours: number): GameMs {
  return toGameMsValue(from + BigInt(hours) * 3_600_000n);
}

/**
 * The sources of continuous cost of a player, read straight out of PostgreSQL.
 *
 * Deliberately not `loadAccrualSources` of `lib/accrual.ts`: the point of the property is to
 * recompute the history independently of the code that settled it, and reusing that loader
 * would hide a wrong filter by using the same wrong filter twice.
 */
async function readSources(playerId: PlayerId): Promise<{
  readonly workers: readonly WorkerCostSource[];
  readonly machines: readonly MachineCostSource[];
}> {
  const [workers, machines] = await Promise.all([
    harness.prisma.worker.findMany({
      where: { playerId },
      select: { salaryPerGameHour: true, hiredGameMs: true, terminatedGameMs: true },
    }),
    harness.prisma.machine.findMany({
      where: { playerId },
      select: { type: true, acquiredGameMs: true, disposedGameMs: true },
    }),
  ]);
  return {
    workers: workers.map((worker) => ({
      salaryPerGameHour: Money.fromString(worker.salaryPerGameHour.toFixed(4)),
      hiredGameMs: toGameMsValue(worker.hiredGameMs),
      terminatedGameMs:
        worker.terminatedGameMs === null ? null : toGameMsValue(worker.terminatedGameMs),
    })),
    machines: machines.map((machine) => ({
      type: machine.type,
      acquiredGameMs: toGameMsValue(machine.acquiredGameMs),
      disposedGameMs:
        machine.disposedGameMs === null ? null : toGameMsValue(machine.disposedGameMs),
    })),
  };
}

describe('el coste historico recalculado desde cero', () => {
  it('coincide con la suma del ledger sobre secuencias aleatorias de operaciones', async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async (scenario: Scenario) => {
        run += 1;
        const player = await createEconomyPlayer(harness, `recompute-${run}`, {
          withWorkerHome: true,
        });
        await depositStock(harness, player.farmId, 'WHEAT', INITIAL_STOCK_LITERS);

        const openedAt = toGameMsValue(
          (
            await harness.prisma.player.findUniqueOrThrow({
              where: { id: player.playerId },
              select: { lastAccrualGameMs: true },
            })
          ).lastAccrualGameMs,
        );

        const home = await harness.prisma.building.findFirstOrThrow({
          where: { farmId: player.farmId, type: 'WORKER_HOME' },
          select: { id: true },
        });
        for (const [index, worker] of scenario.workers.entries()) {
          await harness.prisma.worker.create({
            data: {
              playerId: player.playerId,
              farmId: player.farmId,
              homeId: home.id,
              name: `Trabajador ${index}`,
              skillBp: 5_000,
              salaryPerGameHour: Money.toString(Money.fromUnits(worker.salaryUnits)),
              status: 'IDLE',
              hiredGameMs: plusHours(openedAt, worker.hiredAtHour),
            },
          });
        }
        for (const machine of scenario.machines) {
          const type = FLEET[machine.typeIndex] ?? MachineType.TRACTOR;
          await harness.prisma.machine.create({
            data: {
              playerId: player.playerId,
              farmId: player.farmId,
              type,
              conditionBp: 10_000,
              conditionUpdatedAtGameMs: openedAt,
              status: MachineStatus.IDLE,
              purchasePrice: Money.toString(MACHINE_CATALOGUE[type].purchasePrice),
              acquiredGameMs: plusHours(openedAt, machine.acquiredAtHour),
              ...(machine.disposedAtHour === null
                ? {}
                : { disposedGameMs: plusHours(openedAt, machine.disposedAtHour) }),
            },
          });
        }

        // The sequence itself, through the real paths: the applier for the clock and
        // `sellStock` inside `withPlayerAdvanced` for the market.
        let soldUnits = 0;
        for (const step of scenario.steps) {
          await advanceAndCatchUp(harness, player.playerId, step.advanceHours);
          if (step.sellUnits > 0) {
            await withPlayerAdvanced(harness.services, player.playerId, async (ctx) =>
              sellStock(ctx, {
                farmId: player.farmId,
                item: 'WHEAT',
                quantityUnits: step.sellUnits,
                idempotencyKey: `recompute:${player.playerId}:${soldUnits}:${step.sellUnits}`,
              }),
            );
            soldUnits += step.sellUnits;
          }
        }
        // A closing stretch longer than the latest instant the generator can hire at, so
        // that every source of cost overlaps the window whatever the sequence was, and one
        // last settlement so the window the recomputation covers is closed.
        await advanceAndCatchUp(harness, player.playerId, CLOSING_TAIL_GAME_HOURS);

        const settledTo = toGameMsValue(
          (
            await harness.prisma.player.findUniqueOrThrow({
              where: { id: player.playerId },
              select: { lastAccrualGameMs: true },
            })
          ).lastAccrualGameMs,
        );

        // 1. The ledger sums to the balance, exactly.
        const audit = await harness.services.transaction(async (tx) =>
          auditBalance(tx, player.playerId),
        );
        expect(audit.ok).toBe(true);

        // 2. The cost recomputed in one window equals the sum of the accrual entries.
        const sources = await readSources(player.playerId);
        const recomputed = accrueContinuousCosts(
          {
            workers: sources.workers,
            machines: sources.machines,
            tasks: [],
            openingBalance: STARTING_CAPITAL,
          },
          { fromGameMs: openedAt, toGameMs: settledTo },
        );

        const accrued = await harness.prisma.ledgerEntry.aggregate({
          where: { playerId: player.playerId, type: { in: [...ACCRUAL_LEDGER_TYPES] } },
          _sum: { amount: true },
          _count: { _all: true },
        });
        const ledgerCost = Money.negate(
          Money.fromString((accrued._sum.amount ?? { toFixed: () => '0.0000' }).toFixed(4)),
        );

        // Half a ten-thousandth per category and per settlement, plus the single rounding
        // of the recomputation itself. Derived, not chosen.
        const settlements = accrued._count._all;
        // The run has a payroll by construction, so it has to have settled something: an
        // assertion that compared two zeros would prove nothing at all.
        expect(settlements).toBeGreaterThan(0);
        expect(Money.isZero(recomputed.total)).toBe(false);
        const tolerance = BigInt(settlements + ACCRUAL_LEDGER_TYPES.length);
        const costDelta =
          Money.toScaled(ledgerCost) - Money.toScaled(recomputed.total) >= 0n
            ? Money.toScaled(ledgerCost) - Money.toScaled(recomputed.total)
            : Money.toScaled(recomputed.total) - Money.toScaled(ledgerCost);
        expect(costDelta <= tolerance).toBe(true);

        // 3. Starting capital, plus what was sold, minus what was held.
        const revenue = cropSaleRevenue(WHEAT, soldUnits);
        const expected = Money.sub(Money.add(STARTING_CAPITAL, revenue), recomputed.total);
        const balanceDelta =
          Money.toScaled(audit.storedBalance) - Money.toScaled(expected) >= 0n
            ? Money.toScaled(audit.storedBalance) - Money.toScaled(expected)
            : Money.toScaled(expected) - Money.toScaled(audit.storedBalance);
        expect(balanceDelta <= tolerance).toBe(true);
      }),
      { numRuns: RUNS },
    );
  }, 120_000);
});
