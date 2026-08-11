import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { WHEAT } from '../../config/crops.js';
import { CONDITION_FACTOR_CURVE, FERTILITY_TO_YIELD_CURVE } from '../../config/curves.js';
import { MACHINE_CATALOGUE } from '../../config/machines.js';
import { WEED_GROWTH_STATES } from '../../config/transitions.js';
import { type WorldClockAnchor } from '../../domain/entities.js';
import { CROP_CYCLE_STATES, CropCycleState, MachineType } from '../../domain/enums.js';
import { Money } from '../../domain/money.js';
import { BP_ONE, clampBp, gameMs, realMs, type GameMs } from '../../domain/units.js';
import { gameMsAt, overlapGameMs, realMsFor, type GameInterval } from '../clock.js';
import { interpolateCurve } from '../curves.js';
import { cellIndex, chunkOf, isContiguous, worldFromChunk } from '../geometry.js';
import {
  accrueContinuousCosts,
  accrueContinuousCostsExact,
  addAccrualIntegrals,
  type AccrualSources,
} from '../holding.js';
import { conditionAfterWork } from '../machinery.js';
import { skillAfterTask } from '../skill.js';
import { projectCropPhase, projectWeedLevel } from '../yield.js';

// Properties, which plan section 8 puts first in order of value. Each one states an
// algebraic law that the rest of the system relies on, and none of them asserts a
// literal: a literal would only be checked at the point the author happened to pick,
// whereas these hold over the whole input space.

const NUM_RUNS = 500;

const anchorArbitrary = fc
  .record({
    anchorGameMs: fc.bigInt({ min: 0n, max: 10n ** 13n }),
    anchorRealMs: fc.bigInt({ min: 0n, max: 10n ** 13n }),
    rateNum: fc.integer({ min: 0, max: 3600 }),
    rateDen: fc.integer({ min: 1, max: 1000 }),
    scheduleEpoch: fc.integer({ min: 0, max: 1000 }),
  })
  .map((raw): WorldClockAnchor => ({
    anchorGameMs: gameMs(raw.anchorGameMs),
    anchorRealMs: realMs(raw.anchorRealMs),
    rateNum: raw.rateNum,
    rateDen: raw.rateDen,
    scheduleEpoch: raw.scheduleEpoch,
  }));

/** Three instants in ascending order, which is the shape every additivity law needs. */
const orderedInstants = fc
  .tuple(
    fc.bigInt({ min: 0n, max: 10n ** 12n }),
    fc.bigInt({ min: 0n, max: 10n ** 12n }),
    fc.bigInt({ min: 0n, max: 10n ** 12n }),
  )
  .map((values): readonly [GameMs, GameMs, GameMs] => {
    const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return [gameMs(sorted[0] ?? 0n), gameMs(sorted[1] ?? 0n), gameMs(sorted[2] ?? 0n)];
  });

const intervalArbitrary = fc
  .tuple(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 0n, max: 10n ** 12n }))
  .map(([left, right]): GameInterval => {
    const from = left < right ? left : right;
    const to = left < right ? right : left;
    return { fromGameMs: gameMs(from), toGameMs: gameMs(to) };
  });

describe('clock', () => {
  it('gameMsAt is monotone non decreasing in real time', () => {
    fc.assert(
      fc.property(
        anchorArbitrary,
        fc.bigInt({ min: 0n, max: 10n ** 13n }),
        fc.bigInt({ min: 0n, max: 10n ** 13n }),
        (anchor, left, right) => {
          const earlier = left < right ? left : right;
          const later = left < right ? right : left;
          expect(gameMsAt(anchor, realMs(earlier)) <= gameMsAt(anchor, realMs(later))).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never fires early: gameMsAt(realMsFor(g)) is at least g', () => {
    fc.assert(
      fc.property(anchorArbitrary, fc.bigInt({ min: 0n, max: 10n ** 13n }), (anchor, target) => {
        const at = realMsFor(anchor, gameMs(target));
        if (at === null) {
          expect(anchor.rateNum).toBe(0);
          return;
        }
        expect(gameMsAt(anchor, at) >= gameMs(target)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a paused world has no real instant for any game instant', () => {
    fc.assert(
      fc.property(anchorArbitrary, fc.bigInt({ min: 0n, max: 10n ** 12n }), (anchor, target) => {
        const paused: WorldClockAnchor = { ...anchor, rateNum: 0 };
        expect(realMsFor(paused, gameMs(target))).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

describe('overlap', () => {
  it('is commutative and never negative', () => {
    fc.assert(
      fc.property(intervalArbitrary, intervalArbitrary, (left, right) => {
        const forward = overlapGameMs(left, right);
        expect(forward).toBe(overlapGameMs(right, left));
        expect(forward >= 0n).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is additive over a partition of one of its arguments', () => {
    fc.assert(
      fc.property(orderedInstants, intervalArbitrary, ([a, b, c], other) => {
        const whole = overlapGameMs({ fromGameMs: a, toGameMs: c }, other);
        const first = overlapGameMs({ fromGameMs: a, toGameMs: b }, other);
        const second = overlapGameMs({ fromGameMs: b, toGameMs: c }, other);
        expect(whole).toBe(first + second);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is never longer than either interval', () => {
    fc.assert(
      fc.property(intervalArbitrary, intervalArbitrary, (left, right) => {
        const overlap = overlapGameMs(left, right);
        expect(overlap <= left.toGameMs - left.fromGameMs).toBe(true);
        expect(overlap <= right.toGameMs - right.fromGameMs).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const machineTypeArbitrary = fc.constantFrom(
  MachineType.TRACTOR,
  MachineType.PLOW,
  MachineType.SEEDER,
  MachineType.HARVESTER,
  MachineType.TRAILER,
  MachineType.HARVESTER_FORESTRY,
  MachineType.FORWARDER,
);

const moneyArbitrary = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((scaled) => Money.fromScaled(BigInt(scaled)));

const openInstant = fc.option(fc.bigInt({ min: 0n, max: 10n ** 12n }), { nil: null });

const sourcesArbitrary = fc.record({
  workers: fc.array(
    fc.record({
      salaryPerGameHour: moneyArbitrary,
      hiredGameMs: fc.bigInt({ min: 0n, max: 10n ** 12n }),
      terminatedGameMs: openInstant,
    }),
    { maxLength: 4 },
  ),
  machines: fc.array(
    fc.record({
      type: machineTypeArbitrary,
      acquiredGameMs: fc.bigInt({ min: 0n, max: 10n ** 12n }),
      disposedGameMs: openInstant,
    }),
    { maxLength: 6 },
  ),
  tasks: fc.array(
    fc.record({
      machineTypes: fc.array(machineTypeArbitrary, { maxLength: 3 }),
      startGameMs: fc.bigInt({ min: 0n, max: 10n ** 12n }),
      scheduledEndGameMs: fc.bigInt({ min: 0n, max: 10n ** 12n }),
      endedGameMs: openInstant,
    }),
    { maxLength: 4 },
  ),
  openingBalance: fc
    .integer({ min: -10_000_000, max: 10_000_000 })
    .map((scaled) => Money.fromScaled(BigInt(scaled))),
});

/** Rebuilds the arbitrary record as branded sources. */
function toSources(raw: {
  workers: readonly {
    salaryPerGameHour: Money;
    hiredGameMs: bigint;
    terminatedGameMs: bigint | null;
  }[];
  machines: readonly { type: MachineType; acquiredGameMs: bigint; disposedGameMs: bigint | null }[];
  tasks: readonly {
    machineTypes: readonly MachineType[];
    startGameMs: bigint;
    scheduledEndGameMs: bigint;
    endedGameMs: bigint | null;
  }[];
  openingBalance: Money;
}): AccrualSources {
  return {
    workers: raw.workers.map((worker) => ({
      salaryPerGameHour: worker.salaryPerGameHour,
      hiredGameMs: gameMs(worker.hiredGameMs),
      terminatedGameMs: worker.terminatedGameMs === null ? null : gameMs(worker.terminatedGameMs),
    })),
    machines: raw.machines.map((machine) => ({
      type: machine.type,
      acquiredGameMs: gameMs(machine.acquiredGameMs),
      disposedGameMs: machine.disposedGameMs === null ? null : gameMs(machine.disposedGameMs),
    })),
    tasks: raw.tasks.map((task) => ({
      machineTypes: task.machineTypes,
      startGameMs: gameMs(task.startGameMs),
      scheduledEndGameMs: gameMs(task.scheduledEndGameMs),
      endedGameMs: task.endedGameMs === null ? null : gameMs(task.endedGameMs),
    })),
    openingBalance: raw.openingBalance,
  };
}

describe('accrual', () => {
  it('is exactly additive: the integral over [a,c] equals [a,b] plus [b,c]', () => {
    fc.assert(
      fc.property(sourcesArbitrary, orderedInstants, (raw, [a, b, c]) => {
        const sources = toSources(raw);
        const whole = accrueContinuousCostsExact(sources, { fromGameMs: a, toGameMs: c });
        const split = addAccrualIntegrals(
          accrueContinuousCostsExact(sources, { fromGameMs: a, toGameMs: b }),
          accrueContinuousCostsExact(sources, { fromGameMs: b, toGameMs: c }),
        );
        expect(whole).toEqual(split);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('in money form differs from the split by at most one ten-thousandth per category', () => {
    fc.assert(
      fc.property(sourcesArbitrary, orderedInstants, (raw, [a, b, c]) => {
        const sources = toSources(raw);
        const whole = accrueContinuousCosts(sources, { fromGameMs: a, toGameMs: c });
        const first = accrueContinuousCosts(sources, { fromGameMs: a, toGameMs: b });
        const second = accrueContinuousCosts(sources, { fromGameMs: b, toGameMs: c });
        for (const category of ['wages', 'maintenance', 'operating', 'interest'] as const) {
          const difference =
            Money.toScaled(whole[category]) -
            (Money.toScaled(first[category]) + Money.toScaled(second[category]));
          expect(difference <= 1n && difference >= -1n).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never charges a negative amount and totals its own categories', () => {
    fc.assert(
      fc.property(sourcesArbitrary, intervalArbitrary, (raw, window) => {
        const breakdown = accrueContinuousCosts(toSources(raw), window);
        for (const category of ['wages', 'maintenance', 'operating', 'interest'] as const) {
          expect(Money.isNegative(breakdown[category])).toBe(false);
        }
        expect(breakdown.total).toBe(
          Money.sum([
            breakdown.wages,
            breakdown.maintenance,
            breakdown.operating,
            breakdown.interest,
          ]),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('charges nothing over an empty window', () => {
    fc.assert(
      fc.property(sourcesArbitrary, fc.bigInt({ min: 0n, max: 10n ** 12n }), (raw, instant) => {
        const at = gameMs(instant);
        const breakdown = accrueContinuousCosts(toSources(raw), { fromGameMs: at, toGameMs: at });
        expect(breakdown.total).toBe(Money.ZERO);
      }),
      { numRuns: 200 },
    );
  });
});

describe('crop phase projection', () => {
  const seededArbitrary = fc.bigInt({ min: 0n, max: 10n ** 11n });
  const elapsedArbitrary = fc.bigInt({ min: 0n, max: 400n * 3_600_000n });

  it('is idempotent: projecting again at the entry instant gives the same phase', () => {
    fc.assert(
      fc.property(seededArbitrary, elapsedArbitrary, (seeded, elapsed) => {
        const seededAt = gameMs(seeded);
        const first = projectCropPhase(seededAt, gameMs(seeded + elapsed));
        const again = projectCropPhase(seededAt, first.enteredAtGameMs);
        expect(again.state).toBe(first.state);
        expect(again.enteredAtGameMs).toBe(first.enteredAtGameMs);
        expect(again.nextBoundaryGameMs).toBe(first.nextBoundaryGameMs);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('advances monotonically through the cycle', () => {
    fc.assert(
      fc.property(seededArbitrary, elapsedArbitrary, elapsedArbitrary, (seeded, left, right) => {
        const seededAt = gameMs(seeded);
        const earlier = left < right ? left : right;
        const later = left < right ? right : left;
        const order = [...CROP_CYCLE_STATES];
        const before = projectCropPhase(seededAt, gameMs(seeded + earlier));
        const after = projectCropPhase(seededAt, gameMs(seeded + later));
        expect(order.indexOf(after.state)).toBeGreaterThanOrEqual(order.indexOf(before.state));
        expect(after.growthProgressBp).toBeGreaterThanOrEqual(before.growthProgressBp);
        expect(after.enteredAtGameMs >= before.enteredAtGameMs).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reaches ready to harvest exactly at the growth duration and never before', () => {
    fc.assert(
      fc.property(seededArbitrary, elapsedArbitrary, (seeded, elapsed) => {
        const seededAt = gameMs(seeded);
        const projection = projectCropPhase(seededAt, gameMs(seeded + elapsed));
        const ready = projection.state === CropCycleState.READY_TO_HARVEST;
        expect(ready).toBe(elapsed >= 96n * 3_600_000n);
        expect(projection.growthProgressBp === BP_ONE).toBe(ready);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('lazily accrued attributes', () => {
  it('weeds only grow, never overshoot and stall outside their states', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.bigInt({ min: 0n, max: 10n ** 11n }),
        fc.bigInt({ min: 0n, max: 2000n * 3_600_000n }),
        fc.constantFrom(...CROP_CYCLE_STATES),
        (level, from, elapsed, state) => {
          const projected = projectWeedLevel({
            weedLevelBp: clampBp(level),
            updatedAtGameMs: gameMs(from),
            toGameMs: gameMs(from + elapsed),
            cropCycleState: state,
            crop: WHEAT,
          });
          expect(projected).toBeGreaterThanOrEqual(level);
          expect(projected).toBeLessThanOrEqual(BP_ONE);
          if (!WEED_GROWTH_STATES.includes(state)) {
            expect(projected).toBe(clampBp(level));
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('skill never passes its ceiling and never falls', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (level) => {
        const next = skillAfterTask(clampBp(level));
        expect(next).toBeGreaterThanOrEqual(level);
        expect(next).toBeLessThanOrEqual(Math.max(level, 9500));
      }),
      { numRuns: 200 },
    );
  });

  it('condition never rises by working and never goes below zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.double({ min: 0, max: 10_000, noNaN: true }),
        (level, hours) => {
          const next = conditionAfterWork(clampBp(level), hours, MACHINE_CATALOGUE.TRACTOR);
          expect(next).toBeLessThanOrEqual(level);
          expect(next).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('curves and geometry', () => {
  it('a curve is clamped outside its table and monotone inside a monotone table', () => {
    fc.assert(
      fc.property(fc.double({ min: -500, max: 500, noNaN: true }), (input) => {
        const value = interpolateCurve(CONDITION_FACTOR_CURVE, input);
        expect(value).toBeGreaterThanOrEqual(0.2);
        expect(value).toBeLessThanOrEqual(1);
        const fertility = interpolateCurve(FERTILITY_TO_YIELD_CURVE, input);
        expect(fertility).toBeGreaterThanOrEqual(0.25);
        expect(fertility).toBeLessThanOrEqual(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('chunk arithmetic round trips for any cell, including negative coordinates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: -100_000, max: 100_000 }),
        (cellX, cellY) => {
          const chunk = chunkOf(cellX, cellY);
          const index = cellIndex(cellX, cellY);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(1024);
          expect(worldFromChunk(chunk, index)).toEqual({ cellX, cellY });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('a rectangle is contiguous and a rectangle with a detached cell is not', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        (width, height, originX, originY) => {
          const cells: { cellX: number; cellY: number }[] = [];
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              cells.push({ cellX: originX + x, cellY: originY + y });
            }
          }
          expect(isContiguous(cells)).toBe(true);
          expect(isContiguous([...cells, { cellX: originX + width + 2, cellY: originY }])).toBe(
            false,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
