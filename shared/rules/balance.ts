// Balance: break-even and the six KPIs of GDD section 125.
//
// Owner: workflow W2 (pure rules). Imported by tools/balance, which emits the report
// of docs/balance, and by the golden test that reproduces GDD sections 117 to 119.
//
// The scenario is described by parameters and the whole cycle is then derived from the
// catalogues: the phase timeline comes from the crop and the compatibility table, the
// durations from GDD section 91, the holding cost from the same accrual integral the
// server uses, and the revenue from GDD section 83. Nothing here restates a figure the
// GDD publishes; the point of the module is precisely to find out whether the figures
// the GDD publishes come out of its own catalogue.

import { BUILDING_CATALOGUE } from '../config/buildings.js';
import { CROPS, WHEAT, type CropDefinition } from '../config/crops.js';
import { STARTING_CAPITAL } from '../config/economy.js';
import { MACHINE_CATALOGUE, OPERATION_REQUIREMENTS } from '../config/machines.js';
import { WEED_GROWTH_STATES } from '../config/transitions.js';
import {
  CropCycleState,
  type BuildingType,
  type CropId,
  type MachineType,
  type TaskOperation,
  type TerrainType,
} from '../domain/enums.js';
import { Money } from '../domain/money.js';
import {
  BP_ONE,
  BP_ZERO,
  GAME_MS_ZERO,
  addGameMs,
  bp,
  clampBp,
  gameHours,
  gameHoursToGameMs,
  type Bp,
  type GameHours,
  type GameMs,
} from '../domain/units.js';
import { estimateTaskDuration } from './duration.js';
import {
  accrueContinuousCosts,
  type AccrualBreakdown,
  type MachineCostSource,
  type TaskCostSource,
} from './holding.js';
import { machineTypesForOperation } from './machinery.js';
import {
  DEFAULT_LAND_PRICE_CONFIG,
  cellPrice,
  cropSaleRevenue,
  multiplyByCount,
  type LandPriceConfig,
} from './pricing.js';
import { finalYieldLiters, type YieldBreakdown } from './yield.js';

/**
 * Break-even in cycles (GDD section 121):
 * `totalUpfrontInvestment / (revenuePerCycle - holdingCostPerCycle)`.
 *
 * Null when the denominator is not positive, which GDD section 121 itself calls out:
 * there is then no break-even and the farm goes under. It is the main KPI to watch,
 * and with the unadjusted values of the GDD it is exactly the case that occurs.
 */
export function breakEvenCycles(
  totalUpfrontInvestment: Money,
  revenuePerCycle: Money,
  holdingCostPerCycle: Money,
): number | null {
  const net = Money.toScaled(revenuePerCycle) - Money.toScaled(holdingCostPerCycle);
  if (net <= 0n) {
    return null;
  }
  return Number(Money.toScaled(totalUpfrontInvestment)) / Number(net);
}

/** How the machinery is acquired, which is the lever GDD section 120 recommends. */
export const MachineryOwnershipMode = {
  /** Everything is bought on day one, which is what GDD section 118 costs. */
  ALL_UPFRONT: 'ALL_UPFRONT',
  /**
   * Each machine is bought when the phase that needs it starts, which is the
   * staggered purchase of GDD section 120. Maintenance is then only paid from that
   * moment to the end of the cycle.
   */
  STAGGERED: 'STAGGERED',
} as const;
export type MachineryOwnershipMode =
  (typeof MachineryOwnershipMode)[keyof typeof MachineryOwnershipMode];

export interface BalanceScenario {
  readonly startingCapital: Money;
  readonly cropId: CropId;
  /** Cells of the initial field (GDD section 117: 250). */
  readonly fieldCells: number;
  /** Cells the farm footprint takes (GDD section 117: 80). */
  readonly farmFootprintCells: number;
  readonly landTerrain: TerrainType;
  readonly buildings: readonly BuildingType[];
  readonly machines: readonly MachineType[];
  readonly workers: readonly { readonly salaryPerGameHour: Money }[];
  /** Skill of the operator, which fixes `skillFactor` (GDD section 103). */
  readonly operatorSkillBp: Bp;
  /** Condition of the machinery, which fixes `conditionFactor` (GDD section 91). */
  readonly machineConditionBp: Bp;
  readonly fertilityBp: Bp;
  readonly fertilizationBp: Bp;
  /** Weed level when the cycle starts. */
  readonly initialWeedLevelBp: Bp;
  /**
   * Weed level at harvest. Null projects it from the rate of the crop over the phases
   * in which weeds grow, which is the honest reading of GDD sections 78 and 82; a
   * fixed value reproduces the assumption of GDD section 119.
   */
  readonly weedLevelAtHarvestBp: Bp | null;
  readonly ownershipMode: MachineryOwnershipMode;
}

/**
 * The minimum viable setup of GDD section 117, as a scenario. The operator skill is
 * 70 %, which is what makes the durations of GDD section 118 come out
 * (`skillFactor = 0.85`); GDD section 117 says "skill ~60 %" for the same worker,
 * which is one of the inconsistencies the balance report records.
 */
export const MINIMUM_SETUP_SCENARIO: BalanceScenario = {
  startingCapital: STARTING_CAPITAL,
  cropId: 'WHEAT',
  fieldCells: 250,
  farmFootprintCells: 80,
  landTerrain: 'GRASS',
  buildings: ['GARAGE', 'SILO', 'WORKER_HOME'],
  machines: ['TRACTOR', 'PLOW', 'SEEDER', 'HARVESTER', 'TRAILER'],
  // The salary the hiring rule of GDD section 102 actually produces for the 70 %
  // starting worker with the revised salary line (-6 + 0.31 x 70). The 15 $/h that
  // GDD section 117 quoted was inconsistent with its own hiring rule, and the balance
  // report flagged using it as an optimistic bias of the KPIs.
  workers: [{ salaryPerGameHour: Money.fromString('15.70') }],
  operatorSkillBp: bp(7000),
  machineConditionBp: BP_ONE,
  fertilityBp: BP_ONE,
  fertilizationBp: BP_ONE,
  initialWeedLevelBp: BP_ZERO,
  weedLevelAtHarvestBp: null,
  ownershipMode: 'ALL_UPFRONT',
};

/** One stretch of the cycle: either an operation or a timed growth phase. */
export interface BalancePhase {
  readonly state: CropCycleState;
  readonly operation: TaskOperation | null;
  readonly gameHours: GameHours;
  readonly machineTypes: readonly MachineType[];
  readonly fromGameMs: GameMs;
  readonly toGameMs: GameMs;
}

export interface SetupCostBreakdown {
  readonly landCells: number;
  readonly land: Money;
  readonly buildings: Money;
  readonly machinery: Money;
  readonly total: Money;
}

export interface BalanceKpis {
  /** KPI 1 of GDD section 125. */
  readonly minimumSetupCost: Money;
  /** KPI 2. Wages, maintenance, operation and overdraft interest over one cycle. */
  readonly holdingCostPerCycle: Money;
  /** KPI 3. */
  readonly revenuePerCycle: Money;
  /** KPI 4. Null when the holding cost is zero, where a ratio has no meaning. */
  readonly revenueToCostRatio: number | null;
  /** KPI 5. Null when there is no break-even (GDD section 121). */
  readonly gameHoursToFirstBreakEven: number | null;
  /** KPI 6. Negative when the setup does not fit in the starting capital. */
  readonly capitalCushionAfterSetup: Money;

  readonly cycleGameHours: GameHours;
  readonly netPerCycle: Money;
  readonly breakEvenCycles: number | null;
  readonly weedLevelAtHarvestBp: Bp;
  readonly weedGrowingGameHours: GameHours;
  readonly setup: SetupCostBreakdown;
  readonly holding: AccrualBreakdown;
  readonly yield: YieldBreakdown;
  readonly phases: readonly BalancePhase[];
}

/** Operations of one full cycle of a crop (GDD sections 76, 82 and 90). */
export function cycleOperations(crop: CropDefinition): readonly TaskOperation[] {
  return crop.requiresCultivation
    ? ['PLOW', 'CULTIVATE', 'SEED', 'HARVEST']
    : ['PLOW', 'SEED', 'HARVEST'];
}

/**
 * Timeline of one cycle: the operations of the crop in order, with the three timed
 * phases inserted after sowing.
 *
 * The state each stretch runs in matters beyond bookkeeping: weeds grow while the
 * field is virgin, growing or ready and not harvested (GDD section 78), so the field
 * accumulates weeds during the plowing task and during the harvesting task as well as
 * during growth.
 */
export function cyclePhases(
  scenario: BalanceScenario,
  crop: CropDefinition,
): readonly BalancePhase[] {
  const phases: BalancePhase[] = [];
  let state: CropCycleState = CropCycleState.VIRGIN;
  let cursor: GameMs = GAME_MS_ZERO;

  const push = (
    phaseState: CropCycleState,
    operation: TaskOperation | null,
    hours: GameHours,
    machineTypes: readonly MachineType[],
  ): void => {
    const from = cursor;
    const to = addGameMs(from, gameHoursToGameMs(hours));
    phases.push({
      state: phaseState,
      operation,
      gameHours: hours,
      machineTypes,
      fromGameMs: from,
      toGameMs: to,
    });
    cursor = to;
  };

  for (const operation of cycleOperations(crop)) {
    if (state === CropCycleState.SEEDED) {
      push(CropCycleState.SEEDED, null, crop.phaseDurationsGameHours.SEEDED, []);
      push(CropCycleState.GERMINATING, null, crop.phaseDurationsGameHours.GERMINATING, []);
      push(CropCycleState.GROWING, null, crop.phaseDurationsGameHours.GROWING, []);
      state = CropCycleState.READY_TO_HARVEST;
    }
    const estimate = estimateTaskDuration({
      operation,
      units: scenario.fieldCells,
      conditionBp: scenario.machineConditionBp,
      skillBp: scenario.operatorSkillBp,
    });
    push(state, operation, estimate.durationGameHours, machineTypesForOperation(operation));
    state = OPERATION_REQUIREMENTS[operation].toCropState ?? state;
  }

  return phases;
}

/** Acquisition cost of a scenario (GDD sections 115, 116 and 117). */
export function setupCost(
  scenario: BalanceScenario,
  landPrice: LandPriceConfig = DEFAULT_LAND_PRICE_CONFIG,
): SetupCostBreakdown {
  const landCells = scenario.fieldCells + scenario.farmFootprintCells;
  const perCell = cellPrice(scenario.landTerrain, landPrice);
  const land = perCell === null ? Money.ZERO : multiplyByCount(perCell, landCells);
  const buildings = Money.sum(
    scenario.buildings.map((type) => BUILDING_CATALOGUE[type].purchasePrice),
  );
  const machinery = Money.sum(
    scenario.machines.map((type) => MACHINE_CATALOGUE[type].purchasePrice),
  );
  return {
    landCells,
    land,
    buildings,
    machinery,
    total: Money.sum([land, buildings, machinery]),
  };
}

/**
 * The six KPIs of GDD section 125 for a scenario.
 *
 * The holding cost goes through the same accrual integral the server settles with, so
 * the report cannot drift from the game: if the integral changes, the KPIs change with
 * it.
 */
export function balanceKpis(
  scenario: BalanceScenario,
  options: {
    readonly crops?: Readonly<Record<CropId, CropDefinition>>;
    readonly landPrice?: LandPriceConfig;
  } = {},
): BalanceKpis {
  const crop = (options.crops ?? CROPS)[scenario.cropId] ?? WHEAT;
  const phases = cyclePhases(scenario, crop);
  const last = phases[phases.length - 1];
  const cycleEnd: GameMs = last === undefined ? GAME_MS_ZERO : last.toGameMs;
  const cycleGameHours = gameHours(phases.reduce((total, phase) => total + phase.gameHours, 0));

  const weedGrowingGameHours = gameHours(
    phases
      .filter((phase) => WEED_GROWTH_STATES.includes(phase.state))
      .reduce((total, phase) => total + phase.gameHours, 0),
  );
  const projectedWeed = clampBp(
    scenario.initialWeedLevelBp + crop.weedGrowthBpPerGameHour * weedGrowingGameHours,
  );
  const weedLevelAtHarvestBp = scenario.weedLevelAtHarvestBp ?? projectedWeed;

  const machineSources: MachineCostSource[] = scenario.machines.map((type) => {
    if (scenario.ownershipMode === MachineryOwnershipMode.ALL_UPFRONT) {
      return { type, acquiredGameMs: GAME_MS_ZERO, disposedGameMs: null };
    }
    const firstUse = phases.find((phase) => phase.machineTypes.includes(type));
    return {
      type,
      acquiredGameMs: firstUse === undefined ? GAME_MS_ZERO : firstUse.fromGameMs,
      disposedGameMs: null,
    };
  });

  const taskSources: TaskCostSource[] = phases
    .filter((phase) => phase.operation !== null)
    .map((phase) => ({
      machineTypes: phase.machineTypes,
      startGameMs: phase.fromGameMs,
      scheduledEndGameMs: phase.toGameMs,
      endedGameMs: null,
    }));

  const holding = accrueContinuousCosts(
    {
      workers: scenario.workers.map((worker) => ({
        salaryPerGameHour: worker.salaryPerGameHour,
        hiredGameMs: GAME_MS_ZERO,
        terminatedGameMs: null,
      })),
      machines: machineSources,
      tasks: taskSources,
      openingBalance: Money.ZERO,
    },
    { fromGameMs: GAME_MS_ZERO, toGameMs: cycleEnd },
  );

  const yieldBreakdown = finalYieldLiters({
    cellCount: scenario.fieldCells,
    crop,
    fertilityBp: scenario.fertilityBp,
    fertilizationBp: scenario.fertilizationBp,
    weedLevelBp: weedLevelAtHarvestBp,
  });
  const revenuePerCycle = cropSaleRevenue(crop, yieldBreakdown.liters);
  const setup = setupCost(scenario, options.landPrice ?? DEFAULT_LAND_PRICE_CONFIG);
  const netPerCycle = Money.sub(revenuePerCycle, holding.total);
  const cycles = breakEvenCycles(setup.total, revenuePerCycle, holding.total);
  const holdingScaled = Money.toScaled(holding.total);

  return {
    minimumSetupCost: setup.total,
    holdingCostPerCycle: holding.total,
    revenuePerCycle,
    revenueToCostRatio:
      holdingScaled === 0n ? null : Number(Money.toScaled(revenuePerCycle)) / Number(holdingScaled),
    gameHoursToFirstBreakEven: cycles === null ? null : cycles * cycleGameHours,
    capitalCushionAfterSetup: Money.sub(scenario.startingCapital, setup.total),
    cycleGameHours,
    netPerCycle,
    breakEvenCycles: cycles,
    weedLevelAtHarvestBp,
    weedGrowingGameHours,
    setup,
    holding,
    yield: yieldBreakdown,
    phases,
  };
}
