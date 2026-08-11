// Continuous costs: the hourly rate and the accrual integral.
//
// Owner: workflow W2 (pure rules).
//
// Invariant 2 of plan section 6.2: every source of cost records its validity
// interval and the cost of any window is the integral of the overlaps.
//
//   wages       = sum of salary        x overlap([a,b], validity of the worker)
//   maintenance = sum of maintenance   x overlap([a,b], validity of the machine)
//   operating   = sum of operating     x overlap([a,b], [start, coalesce(ended, scheduledEnd)])
//
// This resolves the warning of GDD section 124 about `operatingCost` without special
// code, tolerates out of order processing, which is unavoidable if the worker was
// down, and makes the whole thing recomputable: a test can recalculate the history
// from scratch and compare it against the ledger.
//
// Exactness and additivity. The integral is accumulated in `bigint`, in units of
// "scaled money units times game milliseconds", and divided by the milliseconds of
// a game hour only once per category. Therefore:
//
//   - `accrueContinuousCostsExact` is exactly additive: splitting a window at any
//     instant gives integrals that sum to the integral of the whole window. That is
//     the property that makes the order of settlement irrelevant.
//   - `accrueContinuousCosts` rounds once per category, so the money form of a split
//     window can differ from the whole by at most one unit of the fourth decimal per
//     category, which is one hundredth of a cent. Money is deliberately not kept in
//     whole cents: settlement is very frequent by design and rounding to cents on
//     each one accumulates a systematic bias in favour of the player.

import { OVERDRAFT_INTEREST_BP_PER_GAME_HOUR } from '../config/economy.js';
import { MACHINE_CATALOGUE, type MachineDefinition } from '../config/machines.js';
import { MachineStatus, type MachineType } from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { MS_PER_GAME_HOUR, type Bp, type GameHours, type GameMs } from '../domain/units.js';
import {
  closeInterval,
  gameMsToGameHours,
  intervalLengthGameMs,
  overlapGameMs,
  type GameInterval,
} from './clock.js';

// ---------------------------------------------------------------------------
// Hourly rate (GDD section 107)
// ---------------------------------------------------------------------------

export interface HoldingRateInput {
  readonly workers: readonly { readonly salaryPerGameHour: Money }[];
  readonly machines: readonly {
    readonly type: MachineType;
    readonly status: MachineStatus;
  }[];
}

export interface HoldingRate {
  readonly wagesPerGameHour: Money;
  readonly maintenancePerGameHour: Money;
  readonly operatingPerGameHour: Money;
  readonly totalPerGameHour: Money;
}

/**
 * Total hourly cost of a holding at one instant (GDD section 107):
 * every salary, every maintenance cost, and the operating cost of the machines that
 * are working. Shown in the top bar so that the player can see the cash burn before
 * committing to it.
 *
 * Maintenance and operation are additive and not exclusive, which GDD sections 107
 * and 114 state explicitly: possession is always paid and operation is paid on top.
 */
export function holdingRatePerGameHour(
  input: HoldingRateInput,
  catalogue: Readonly<Record<MachineType, MachineDefinition>> = MACHINE_CATALOGUE,
): HoldingRate {
  const wages = Money.sum(input.workers.map((worker) => worker.salaryPerGameHour));
  const maintenance = Money.sum(
    input.machines.map((machine) => catalogue[machine.type].maintenanceCostPerGameHour),
  );
  const operating = Money.sum(
    input.machines
      .filter((machine) => machine.status === MachineStatus.WORKING)
      .map((machine) => catalogue[machine.type].operatingCostPerGameHour),
  );
  return {
    wagesPerGameHour: wages,
    maintenancePerGameHour: maintenance,
    operatingPerGameHour: operating,
    totalPerGameHour: Money.sum([wages, maintenance, operating]),
  };
}

// ---------------------------------------------------------------------------
// Accrual over a window (GDD sections 107 and 124)
// ---------------------------------------------------------------------------

/** A worker as a source of cost, with the validity interval of plan section 5.3. */
export interface WorkerCostSource {
  readonly salaryPerGameHour: Money;
  readonly hiredGameMs: GameMs;
  readonly terminatedGameMs: GameMs | null;
}

/** A machine as a source of cost. Its rates come from the catalogue, by type. */
export interface MachineCostSource {
  readonly type: MachineType;
  readonly acquiredGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

/**
 * A task as a source of operating cost. The interval ends at `endedGameMs` when the
 * task really ended and at `scheduledEndGameMs` while it is still running, which is
 * why cancellation must record a distinct end: nothing is refunded, but the integral
 * has to stop where the work stopped (plan section 2.2).
 */
export interface TaskCostSource {
  readonly machineTypes: readonly MachineType[];
  readonly startGameMs: GameMs;
  readonly scheduledEndGameMs: GameMs;
  readonly endedGameMs: GameMs | null;
}

export interface AccrualSources {
  readonly workers: readonly WorkerCostSource[];
  readonly machines: readonly MachineCostSource[];
  readonly tasks: readonly TaskCostSource[];
  /**
   * Settled balance at the start of the window, which is the base of the overdraft
   * interest. Only its negative part is charged (plan section 6.6). It is taken at
   * the start of the window and not integrated against the moving balance: with the
   * default rate of zero the distinction is void, and the periodic settlement sweep
   * keeps the windows short enough for it to stay a modelling simplification rather
   * than a divergence.
   */
  readonly openingBalance: Money;
}

/** Parameters of the accrual, injected so the tests can fix them. */
export interface AccrualConfig {
  readonly catalogue: Readonly<Record<MachineType, MachineDefinition>>;
  readonly overdraftInterestBpPerGameHour: Bp;
}

export const DEFAULT_ACCRUAL_CONFIG: AccrualConfig = {
  catalogue: MACHINE_CATALOGUE,
  overdraftInterestBpPerGameHour: OVERDRAFT_INTEREST_BP_PER_GAME_HOUR,
};

/**
 * The four accruals as exact integrals, in units of scaled money units times game
 * milliseconds. Exactly additive over any partition of the window.
 */
export interface AccrualIntegral {
  readonly wagesUnitMs: bigint;
  readonly maintenanceUnitMs: bigint;
  readonly operatingUnitMs: bigint;
  readonly interestUnitMs: bigint;
}

export interface AccrualBreakdown {
  readonly wages: Money;
  readonly maintenance: Money;
  readonly operating: Money;
  readonly interest: Money;
  /**
   * Sum of the four rounded categories, and not the rounding of the exact total:
   * the ledger writes one entry per category and `balanceAfter` must equal the sum
   * of the entries it wrote.
   */
  readonly total: Money;
  readonly windowGameMs: bigint;
  readonly windowGameHours: GameHours;
}

/** Integer division rounding half away from zero. `denominator` must be positive. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Converts an exact integral into money, rounding once. */
export function integralToMoney(unitMs: bigint): Money {
  return Money.fromScaled(divideRounded(unitMs, MS_PER_GAME_HOUR));
}

/**
 * The four continuous accruals over a window, as exact integrals.
 *
 * Every rate is multiplied by the overlap of the window with the validity interval
 * of its source, so a worker hired halfway through the window is charged for half of
 * it and a machine sold before it started is not charged at all. Inverted or empty
 * overlaps contribute zero, which is what makes the function total.
 */
export function accrueContinuousCostsExact(
  sources: AccrualSources,
  window: GameInterval,
  config: AccrualConfig = DEFAULT_ACCRUAL_CONFIG,
): AccrualIntegral {
  let wagesUnitMs = 0n;
  for (const worker of sources.workers) {
    const overlap = overlapGameMs(
      window,
      closeInterval(
        { fromGameMs: worker.hiredGameMs, toGameMs: worker.terminatedGameMs },
        window.toGameMs,
      ),
    );
    if (overlap > 0n) {
      wagesUnitMs += Money.toScaled(worker.salaryPerGameHour) * overlap;
    }
  }

  let maintenanceUnitMs = 0n;
  for (const machine of sources.machines) {
    const rate = Money.toScaled(config.catalogue[machine.type].maintenanceCostPerGameHour);
    if (rate === 0n) {
      continue;
    }
    const overlap = overlapGameMs(
      window,
      closeInterval(
        { fromGameMs: machine.acquiredGameMs, toGameMs: machine.disposedGameMs },
        window.toGameMs,
      ),
    );
    if (overlap > 0n) {
      maintenanceUnitMs += rate * overlap;
    }
  }

  let operatingUnitMs = 0n;
  for (const task of sources.tasks) {
    const overlap = overlapGameMs(window, {
      fromGameMs: task.startGameMs,
      toGameMs: task.endedGameMs ?? task.scheduledEndGameMs,
    });
    if (overlap <= 0n) {
      continue;
    }
    for (const type of task.machineTypes) {
      const rate = Money.toScaled(config.catalogue[type].operatingCostPerGameHour);
      if (rate !== 0n) {
        operatingUnitMs += rate * overlap;
      }
    }
  }

  const windowMs = intervalLengthGameMs(window);
  const openingScaled = Money.toScaled(sources.openingBalance);
  const overdraftScaled = openingScaled < 0n ? -openingScaled : 0n;
  const interestRateScaled = divideRounded(
    overdraftScaled * BigInt(config.overdraftInterestBpPerGameHour),
    10_000n,
  );
  const interestUnitMs = interestRateScaled * windowMs;

  return { wagesUnitMs, maintenanceUnitMs, operatingUnitMs, interestUnitMs };
}

/**
 * The four continuous accruals over a window, as money. Every amount is positive:
 * these are costs, and the sign convention of the ledger is applied where the entry
 * is written, not here.
 */
export function accrueContinuousCosts(
  sources: AccrualSources,
  window: GameInterval,
  config: AccrualConfig = DEFAULT_ACCRUAL_CONFIG,
): AccrualBreakdown {
  const integral = accrueContinuousCostsExact(sources, window, config);
  const wages = integralToMoney(integral.wagesUnitMs);
  const maintenance = integralToMoney(integral.maintenanceUnitMs);
  const operating = integralToMoney(integral.operatingUnitMs);
  const interest = integralToMoney(integral.interestUnitMs);
  const windowGameMs = intervalLengthGameMs(window);
  return {
    wages,
    maintenance,
    operating,
    interest,
    total: Money.sum([wages, maintenance, operating, interest]),
    windowGameMs,
    windowGameHours: gameMsToGameHours(windowGameMs),
  };
}

/** Adds two exact integrals, which is what makes a chain of windows collapsible. */
export function addAccrualIntegrals(
  left: AccrualIntegral,
  right: AccrualIntegral,
): AccrualIntegral {
  return {
    wagesUnitMs: left.wagesUnitMs + right.wagesUnitMs,
    maintenanceUnitMs: left.maintenanceUnitMs + right.maintenanceUnitMs,
    operatingUnitMs: left.operatingUnitMs + right.operatingUnitMs,
    interestUnitMs: left.interestUnitMs + right.interestUnitMs,
  };
}
