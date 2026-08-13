// The crop cycle state machine as data.
//
// Owner: workflow W2 (vocabulary).
//
// The table of GDD section 76 is a datum and not a chain of conditionals, for the same
// reason as the compatibility table of GDD section 90: the server validates against it,
// the client derives from it which operations a field admits, and the coherence test
// cross checks it against the machinery catalogue. One table, three consumers.

import {
  CropCycleState,
  type CropId,
  type TaskOperation,
  type TerrainType,
} from '../domain/enums.js';

/** What makes a transition happen (GDD section 76). */
export type TransitionTrigger =
  /** An action of the player, which means a task with machinery and a worker. */
  | 'PLAYER_ACTION'
  /** Elapsed game time, materialised by a scheduled event. */
  | 'TIME'
  /** Growth progress reaching 100 % (GDD section 80). */
  | 'GROWTH_PROGRESS'
  /** The configuration of the crop (GDD section 76, `afterHarvestState`). */
  | 'CROP_CONFIG';

export interface CropCycleTransition {
  readonly from: CropCycleState;
  readonly to: CropCycleState;
  readonly trigger: TransitionTrigger;
  /**
   * Operation that carries out the transition, and therefore the entry point into the
   * machinery requirements of GDD section 90. Null when the transition needs no
   * machinery, which is exactly the case for the automatic ones.
   */
  readonly operation: TaskOperation | null;
  /** Whether the server applies it on its own, without an action of the player. */
  readonly automatic: boolean;
  /**
   * Whether the transition is conditional on the crop configuration. True only for
   * `CULTIVATED`, which GDD section 76 marks as optional through `requiresCultivation`,
   * and for the return after harvest, whose destination the crop decides.
   */
  readonly conditionalOnCrop: boolean;
}

/**
 * The eight states of GDD sections 41 and 76 and their nine transitions. The extra
 * transition with respect to the table of GDD section 76 is `PLOWED -> SEEDED`, which
 * that same section admits in its note and GDD section 90 states outright
 * ("CULTIVATED/PLOWED -> SEEDED"): for wheat, with `requiresCultivation: false`,
 * cultivating is optional and its only remaining purpose is resetting the weeds.
 */
export const CROP_CYCLE_TRANSITIONS: readonly CropCycleTransition[] = [
  {
    from: CropCycleState.VIRGIN,
    to: CropCycleState.PLOWED,
    trigger: 'PLAYER_ACTION',
    operation: 'PLOW',
    automatic: false,
    conditionalOnCrop: false,
  },
  {
    from: CropCycleState.PLOWED,
    to: CropCycleState.CULTIVATED,
    trigger: 'PLAYER_ACTION',
    operation: 'CULTIVATE',
    automatic: false,
    conditionalOnCrop: false,
  },
  {
    from: CropCycleState.CULTIVATED,
    to: CropCycleState.SEEDED,
    trigger: 'PLAYER_ACTION',
    operation: 'SEED',
    automatic: false,
    conditionalOnCrop: false,
  },
  {
    from: CropCycleState.PLOWED,
    to: CropCycleState.SEEDED,
    trigger: 'PLAYER_ACTION',
    operation: 'SEED',
    automatic: false,
    conditionalOnCrop: true,
  },
  {
    from: CropCycleState.SEEDED,
    to: CropCycleState.GERMINATING,
    trigger: 'TIME',
    operation: null,
    automatic: true,
    conditionalOnCrop: false,
  },
  {
    from: CropCycleState.GERMINATING,
    to: CropCycleState.GROWING,
    trigger: 'TIME',
    operation: null,
    automatic: true,
    conditionalOnCrop: false,
  },
  {
    from: CropCycleState.GROWING,
    to: CropCycleState.READY_TO_HARVEST,
    trigger: 'GROWTH_PROGRESS',
    operation: null,
    automatic: true,
    conditionalOnCrop: false,
  },
  {
    from: CropCycleState.READY_TO_HARVEST,
    to: CropCycleState.HARVESTED,
    trigger: 'PLAYER_ACTION',
    operation: 'HARVEST',
    automatic: false,
    conditionalOnCrop: false,
  },
  {
    // Destination taken from `afterHarvestState` of the crop; wheat returns to virgin
    // soil (GDD sections 76, 82 and 84).
    from: CropCycleState.HARVESTED,
    to: CropCycleState.VIRGIN,
    trigger: 'CROP_CONFIG',
    operation: null,
    automatic: true,
    conditionalOnCrop: true,
  },
];

/**
 * States in which the weed level grows with time. GDD section 78 lists growing, ready
 * and not harvested, and virgin and unworked; the balance revision adopts the strict
 * reading of finding H8 (docs/revision-formulas.md) and keeps only `GROWING`: during
 * the plowing and harvesting tasks the field is being worked, which section 78 itself
 * excludes, and the state-based settlement cannot tell a worked stretch from an idle
 * one. Consequence, accepted and recorded in the balance report: a field left virgin
 * or unharvested no longer accumulates weeds while idle.
 *
 * It is settled lazily on every state change, because it is continuous, nothing is
 * triggered when it crosses a threshold, and it is only consumed when the yield is
 * computed (plan section 6.5).
 */
export const WEED_GROWTH_STATES: readonly CropCycleState[] = [CropCycleState.GROWING];

/**
 * States in which fertility recovers with time. Only `VIRGIN`, which is fallow: GDD
 * section 77 admits fallow as a restoration route, and without it the MVP would be
 * irreversible, since GDD section 77 only ever subtracts fertility (plan section 2.2).
 */
export const FERTILITY_REGEN_STATES: readonly CropCycleState[] = [CropCycleState.VIRGIN];

/** Weed level and fertility saturate at these bounds. No overshoot is ever stored. */
export const WEED_LEVEL_MAX_BP = 10_000;
export const FERTILITY_MAX_BP = 10_000;

/**
 * Terrain a field cell must have (GDD sections 8 and 17). Forest is not directly arable:
 * it has to be cleared first, which is the `CLEAR_LAND` operation of GDD section 10.
 */
export const ARABLE_TERRAINS: readonly TerrainType[] = ['GRASS'];

/** Terrain a forest plot cell must have (GDD sections 8 and 10). */
export const FORESTABLE_TERRAINS: readonly TerrainType[] = ['FOREST'];

/** Terrain a building may sit on (GDD section 8, where forest is buildable when cleared). */
export const BUILDABLE_TERRAINS: readonly TerrainType[] = ['GRASS'];

/** Terrain that can be bought (GDD section 8). */
export const PURCHASABLE_TERRAINS: readonly TerrainType[] = ['GRASS', 'FOREST'];

/**
 * Crop a field starts with when it is created: none. A field is created over owned land
 * and stays `VIRGIN` with no crop until it is sown (GDD sections 13, 19 and 85).
 */
export const INITIAL_CROP_ID: CropId | null = null;

/** State a newly created field starts in (GDD sections 13 and 19). */
export const INITIAL_CROP_CYCLE_STATE: CropCycleState = CropCycleState.VIRGIN;
