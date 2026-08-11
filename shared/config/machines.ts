// Machinery catalogue and the operation to machinery compatibility table.
//
// Owner: workflow W2 (vocabulary).
//
// The catalogue is the literal one of GDD section 89 for agriculture and GDD section
// 134 for forestry. Two consequences of taking it literally, both documented in the
// balance report rather than tuned away (plan section 2.2):
//
//   - Implements carry no `maintenanceCost` and no `operatingCost` in GDD section 89,
//     so both are zero here. GDD section 118 assumes about 70 $/h of combined
//     maintenance while this catalogue yields 37 $/h.
//   - `maintenanceCost` and `operatingCost` are additive, not exclusive: GDD sections
//     107 and 114 are explicit that possession is always paid and operation is paid on
//     top while the machine works.

import {
  MachineRole,
  MachineType,
  type CropCycleState,
  type SoilCondition,
  type StorageResource,
  type TaskOperation,
} from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { DM3_PER_M3, bp, gameHours, type Bp, type GameHours } from '../domain/units.js';

/** Unit a task is measured in, which is also the unit of `workSpeed`. */
export type WorkUnit = 'CELLS' | 'TREES';

/** What a task points at. */
export type TargetKind = 'FIELD' | 'FOREST_PLOT' | 'CELLS';

export interface MachineDefinition {
  readonly type: MachineType;
  readonly role: MachineRole;
  readonly purchasePrice: Money;
  /** Paid always, working or not (GDD sections 89, 94, 107 and 134). */
  readonly maintenanceCostPerGameHour: Money;
  /** Paid only while the machine executes a task (GDD sections 89, 94 and 134). */
  readonly operatingCostPerGameHour: Money;
  /**
   * Units per game hour. Null for machines that do not set the pace: the tractor,
   * whose speed comes from the implement, and the passive trailer and forwarder.
   */
  readonly workSpeedUnitsPerGameHour: number | null;
  readonly workUnit: WorkUnit | null;
  /** Metres. Kept from GDD section 89 although the MVP does not use it in any formula. */
  readonly workWidthM: number | null;
  /** Capacity, in the unit of `capacityResource` (GDD sections 89 and 134). */
  readonly capacity: number | null;
  readonly capacityResource: StorageResource | null;
  /**
   * Condition lost per game hour worked, in basis points. GDD section 93 requires the
   * rate but never defines it, so these are invented values (plan section 2.2):
   * 15 bp/h for the tractor and its implements, 25 bp/h for the combine and 30 bp/h
   * for forestry machinery, which is the order the GDD implies through price and
   * severity of use. At 15 bp/h a machine goes from 100 % to 0 % in 667 game hours,
   * about two agricultural cycles of GDD section 118, which makes repair a recurring
   * decision without making it constant.
   *
   * Degradation while idle is explicitly outside the MVP (GDD sections 93 and 99), so
   * the rate applies only to hours worked.
   */
  readonly wearRateBpPerGameHour: Bp;
  /**
   * Cost of restoring one point of condition (GDD section 93:
   * `repairCost = (100 - condition) x repairCostPerPoint`). Derived from the purchase
   * price at the rate of `REPAIR_COST_BP_PER_CONDITION_POINT`, and written out
   * literally so the catalogue can be read without doing arithmetic. The coherence
   * test checks the derivation.
   */
  readonly repairCostPerConditionPoint: Money;
  /** Implements a powered machine can tow (GDD sections 88 and 89). */
  readonly compatibleImplements: readonly MachineType[];
}

/**
 * Repair cost per condition point, as a fraction of the purchase price. Invented
 * value: GDD section 93 gives the formula but not the rate. 0.30 % per point means a
 * full repair from zero costs 30 % of a new machine, which keeps repair clearly
 * cheaper than replacement while remaining a decision that competes with expansion
 * (GDD section 65).
 */
export const REPAIR_COST_BP_PER_CONDITION_POINT: Bp = bp(30);

/**
 * Duration of a repair per condition point restored, in game hours. Invented value:
 * GDD section 93 gives repair no duration at all. A quarter of an hour per point puts
 * a full repair at 25 game hours, long enough that repairing during a cycle has a cost
 * in opportunity, short enough not to block a cycle.
 *
 * Repair occupies the machine (`IN_REPAIR`), requires a workshop and does not consume
 * a worker (plan section 2.2).
 */
export const REPAIR_GAME_HOURS_PER_CONDITION_POINT: GameHours = gameHours(0.25);

/**
 * Minimum condition to assign a machine to a task (plan section 2.2). GDD section 91
 * says nothing below 10 %, and the condition curve is clamped there, so accepting a
 * machine below that point would mean extrapolating a balance number.
 */
export const MIN_CONDITION_TO_ASSIGN: Bp = bp(1000);

/** Condition below which the interface warns the player (GDD section 93). */
export const CONDITION_WARNING_THRESHOLD: Bp = bp(2000);

export const MACHINE_CATALOGUE: Readonly<Record<MachineType, MachineDefinition>> = {
  // Agricultural catalogue (GDD section 89).
  TRACTOR: {
    type: MachineType.TRACTOR,
    role: MachineRole.POWERED,
    purchasePrice: Money.fromUnits(18_000),
    maintenanceCostPerGameHour: Money.fromUnits(12),
    operatingCostPerGameHour: Money.fromUnits(22),
    workSpeedUnitsPerGameHour: null,
    workUnit: null,
    workWidthM: null,
    capacity: null,
    capacityResource: null,
    wearRateBpPerGameHour: bp(15),
    repairCostPerConditionPoint: Money.fromString('54'),
    compatibleImplements: [
      MachineType.PLOW,
      MachineType.CULTIVATOR,
      MachineType.SEEDER,
      MachineType.TRAILER,
    ],
  },
  PLOW: {
    type: MachineType.PLOW,
    role: MachineRole.IMPLEMENT,
    purchasePrice: Money.fromUnits(6_500),
    maintenanceCostPerGameHour: Money.ZERO,
    operatingCostPerGameHour: Money.ZERO,
    workSpeedUnitsPerGameHour: 4.2,
    workUnit: 'CELLS',
    workWidthM: 3,
    capacity: null,
    capacityResource: null,
    wearRateBpPerGameHour: bp(15),
    repairCostPerConditionPoint: Money.fromString('19.5'),
    compatibleImplements: [],
  },
  CULTIVATOR: {
    type: MachineType.CULTIVATOR,
    role: MachineRole.IMPLEMENT,
    purchasePrice: Money.fromUnits(5_200),
    maintenanceCostPerGameHour: Money.ZERO,
    operatingCostPerGameHour: Money.ZERO,
    workSpeedUnitsPerGameHour: 5.5,
    workUnit: 'CELLS',
    workWidthM: 4,
    capacity: null,
    capacityResource: null,
    wearRateBpPerGameHour: bp(15),
    repairCostPerConditionPoint: Money.fromString('15.6'),
    compatibleImplements: [],
  },
  SEEDER: {
    type: MachineType.SEEDER,
    role: MachineRole.IMPLEMENT,
    purchasePrice: Money.fromUnits(9_800),
    maintenanceCostPerGameHour: Money.ZERO,
    operatingCostPerGameHour: Money.ZERO,
    workSpeedUnitsPerGameHour: 4.8,
    workUnit: 'CELLS',
    workWidthM: 3,
    capacity: null,
    capacityResource: null,
    wearRateBpPerGameHour: bp(15),
    repairCostPerConditionPoint: Money.fromString('29.4'),
    compatibleImplements: [],
  },
  HARVESTER: {
    type: MachineType.HARVESTER,
    role: MachineRole.POWERED,
    purchasePrice: Money.fromUnits(42_000),
    maintenanceCostPerGameHour: Money.fromUnits(25),
    operatingCostPerGameHour: Money.fromUnits(60),
    workSpeedUnitsPerGameHour: 3.0,
    workUnit: 'CELLS',
    workWidthM: 6,
    capacity: null,
    capacityResource: null,
    wearRateBpPerGameHour: bp(25),
    repairCostPerConditionPoint: Money.fromString('126'),
    compatibleImplements: [MachineType.TRAILER],
  },
  TRAILER: {
    type: MachineType.TRAILER,
    role: MachineRole.IMPLEMENT,
    purchasePrice: Money.fromUnits(7_200),
    maintenanceCostPerGameHour: Money.ZERO,
    operatingCostPerGameHour: Money.ZERO,
    workSpeedUnitsPerGameHour: null,
    workUnit: null,
    workWidthM: null,
    // GDD section 97 keeps the incremental filling of the trailer outside the MVP:
    // the produce goes straight to the silo and the capacity is not an active
    // restriction. The figure stays in the catalogue because the restriction is
    // planned, not discarded.
    capacity: 12_000,
    capacityResource: 'WHEAT_LITERS',
    wearRateBpPerGameHour: bp(15),
    repairCostPerConditionPoint: Money.fromString('21.6'),
    compatibleImplements: [],
  },

  // Forestry catalogue (GDD section 134). Deliberately not a reuse of the tractor:
  // expanding into forestry is a new capital investment.
  HARVESTER_FORESTRY: {
    type: MachineType.HARVESTER_FORESTRY,
    role: MachineRole.POWERED,
    purchasePrice: Money.fromUnits(65_000),
    maintenanceCostPerGameHour: Money.fromUnits(30),
    operatingCostPerGameHour: Money.fromUnits(70),
    workSpeedUnitsPerGameHour: 0.8,
    workUnit: 'TREES',
    workWidthM: null,
    capacity: null,
    capacityResource: null,
    wearRateBpPerGameHour: bp(30),
    repairCostPerConditionPoint: Money.fromString('195'),
    compatibleImplements: [],
  },
  FORWARDER: {
    type: MachineType.FORWARDER,
    role: MachineRole.POWERED,
    purchasePrice: Money.fromUnits(38_000),
    // GDD section 134 lists no running costs for the forwarder. Taken literally, as
    // with the implements, and documented as a deviation of GDD section 138.
    maintenanceCostPerGameHour: Money.ZERO,
    operatingCostPerGameHour: Money.ZERO,
    workSpeedUnitsPerGameHour: null,
    workUnit: null,
    workWidthM: null,
    // The 15 m³ of GDD section 134, in the stored unit of the resource.
    capacity: 15 * DM3_PER_M3,
    capacityResource: 'WOOD_M3',
    wearRateBpPerGameHour: bp(30),
    repairCostPerConditionPoint: Money.fromString('114'),
    compatibleImplements: [],
  },
};

/**
 * One row of the compatibility table of GDD section 90, extended with the two
 * forestry operations of GDD sections 132 and 137 and with the clearing of GDD
 * section 10.
 *
 * The server validates against this table before accepting a task, and the client
 * uses the same table to say why a combination is invalid, so the rule exists once
 * (plan section 5.4).
 */
export interface OperationRequirement {
  readonly operation: TaskOperation;
  readonly targetKind: TargetKind;
  readonly workUnit: WorkUnit;
  /** Powered machine the operation requires (GDD section 88). */
  readonly poweredMachine: MachineType;
  /** Implement the operation requires, reserved by the task while it runs. */
  readonly requiredImplement: MachineType | null;
  /**
   * Machines the player must own, without being reserved. The forwarder of GDD
   * section 134 is an ownership requirement in the MVP and becomes an active
   * restriction when transport is modelled (plan section 2.2).
   */
  readonly requiredPossession: readonly MachineType[];
  /** Crop cycle states the operation may start from. Empty for non field targets. */
  readonly fromCropStates: readonly CropCycleState[];
  /** State the field reaches on completion, or null for non field targets. */
  readonly toCropState: CropCycleState | null;
  /** Soil condition after completion (GDD section 81), or null if unchanged. */
  readonly soilConditionAfter: SoilCondition | null;
  /** Whether completion resets the weed level (GDD sections 78 and 89). */
  readonly resetsWeedLevel: boolean;
  /** Whether the task must name a crop (GDD sections 89 and 104). */
  readonly requiresCrop: boolean;
  /** Storage the destination farm must have room for, or null. */
  readonly requiresStorage: StorageResource | null;
  /**
   * Work speed in units per game hour when neither the implement nor the powered
   * machine sets the pace. Null means the ordinary rule applies: the speed of the
   * implement if it has one, otherwise the speed of the powered machine.
   */
  readonly workSpeedOverrideUnitsPerGameHour: number | null;
}

export const OPERATION_REQUIREMENTS: Readonly<Record<TaskOperation, OperationRequirement>> = {
  PLOW: {
    operation: 'PLOW',
    targetKind: 'FIELD',
    workUnit: 'CELLS',
    poweredMachine: MachineType.TRACTOR,
    requiredImplement: MachineType.PLOW,
    requiredPossession: [],
    fromCropStates: ['VIRGIN'],
    toCropState: 'PLOWED',
    soilConditionAfter: 'PLOWED',
    resetsWeedLevel: false,
    requiresCrop: false,
    requiresStorage: null,
    workSpeedOverrideUnitsPerGameHour: null,
  },
  CULTIVATE: {
    operation: 'CULTIVATE',
    targetKind: 'FIELD',
    workUnit: 'CELLS',
    poweredMachine: MachineType.TRACTOR,
    requiredImplement: MachineType.CULTIVATOR,
    requiredPossession: [],
    fromCropStates: ['PLOWED'],
    toCropState: 'CULTIVATED',
    soilConditionAfter: 'CULTIVATED',
    // Side effect of GDD section 89, and the only way to reset weeds in the MVP
    // (GDD section 78, where herbicides are out of scope).
    resetsWeedLevel: true,
    requiresCrop: false,
    requiresStorage: null,
    workSpeedOverrideUnitsPerGameHour: null,
  },
  SEED: {
    operation: 'SEED',
    targetKind: 'FIELD',
    workUnit: 'CELLS',
    poweredMachine: MachineType.TRACTOR,
    requiredImplement: MachineType.SEEDER,
    requiredPossession: [],
    // Both origins, as GDD section 90 states and GDD section 76 confirms for a crop
    // with `requiresCultivation: false`.
    fromCropStates: ['CULTIVATED', 'PLOWED'],
    toCropState: 'SEEDED',
    soilConditionAfter: null,
    resetsWeedLevel: false,
    requiresCrop: true,
    requiresStorage: null,
    workSpeedOverrideUnitsPerGameHour: null,
  },
  HARVEST: {
    operation: 'HARVEST',
    targetKind: 'FIELD',
    workUnit: 'CELLS',
    poweredMachine: MachineType.HARVESTER,
    // GDD section 90 lists the trailer as the additional implement and GDD section 89
    // marks the combine as `requiresTrailerOrSilo`.
    requiredImplement: MachineType.TRAILER,
    requiredPossession: [],
    fromCropStates: ['READY_TO_HARVEST'],
    toCropState: 'HARVESTED',
    // The field returns to virgin soil with the cycle (GDD sections 76 and 84).
    soilConditionAfter: 'UNTOUCHED',
    resetsWeedLevel: true,
    requiresCrop: false,
    requiresStorage: 'WHEAT_LITERS',
    workSpeedOverrideUnitsPerGameHour: null,
  },
  FELL: {
    operation: 'FELL',
    targetKind: 'FOREST_PLOT',
    workUnit: 'TREES',
    poweredMachine: MachineType.HARVESTER_FORESTRY,
    requiredImplement: null,
    requiredPossession: [MachineType.FORWARDER],
    fromCropStates: [],
    toCropState: null,
    soilConditionAfter: null,
    resetsWeedLevel: false,
    requiresCrop: false,
    requiresStorage: 'WOOD_M3',
    workSpeedOverrideUnitsPerGameHour: null,
  },
  REPLANT: {
    operation: 'REPLANT',
    targetKind: 'FOREST_PLOT',
    workUnit: 'CELLS',
    poweredMachine: MachineType.HARVESTER_FORESTRY,
    requiredImplement: null,
    requiredPossession: [],
    fromCropStates: [],
    toCropState: null,
    soilConditionAfter: null,
    resetsWeedLevel: false,
    requiresCrop: false,
    requiresStorage: null,
    // Invented value. GDD section 137 requires forestry machinery for replanting but
    // gives no speed, and reusing the 0.8 trees/hour of the felling head would make
    // planting a sapling four times slower than harvesting a grown tree. Six cells per
    // game hour keeps replanting a plot comparable to plowing a field of the same size.
    workSpeedOverrideUnitsPerGameHour: 6.0,
  },
  CLEAR_LAND: {
    operation: 'CLEAR_LAND',
    targetKind: 'CELLS',
    workUnit: 'CELLS',
    // GDD section 10 requires clearing to have an economic and machinery cost but does
    // not say which machine. The tractor and plow are used, since what is left after
    // felling is turning stump ground into arable land, and the cost is the operating
    // cost of the task: inventing a separate fee would be inventing a balance number.
    poweredMachine: MachineType.TRACTOR,
    requiredImplement: MachineType.PLOW,
    requiredPossession: [],
    fromCropStates: [],
    toCropState: null,
    soilConditionAfter: null,
    resetsWeedLevel: false,
    requiresCrop: false,
    requiresStorage: null,
    // Invented value, half the plowing speed: clearing felled forest is slower than
    // working an open field.
    workSpeedOverrideUnitsPerGameHour: 2.0,
  },
};
