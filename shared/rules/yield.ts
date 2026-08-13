// Crop cycle: phase projection, weeds, fertility and final yield.
//
// Owner: workflow W2 (pure rules).
//
// Invariant 5 of plan section 6.5: the pure function is the authority and the
// scheduled job only materialises and notifies its result, recomputing it with the
// same function. Everything in this module is therefore a projection from a stored
// timestamp, the catalogue and an instant, and never a mutation of an accumulator.
//
// Rounding of the lazily accrued attributes. Weed growth and fallow fertility
// recovery are integrated in `bigint` and truncated towards zero, so a settlement
// never grants more than the elapsed time earns and the result cannot depend on the
// platform. The cost is a bias of at most one basis point per settlement; since
// both attributes are settled only on a change of state, and a wheat cycle passes
// through at most nine of them (GDD section 76), the accumulated bias stays below
// 0.1 % of the level.

import { CROPS, WHEAT, type CropDefinition, type TimedCropCycleState } from '../config/crops.js';
import {
  FERTILITY_TO_YIELD_CURVE,
  FERTILIZATION_TO_YIELD_CURVE,
  WEED_TO_YIELD_PENALTY_CURVE,
  type Curve,
} from '../config/curves.js';
import {
  FERTILITY_MAX_BP,
  FERTILITY_REGEN_STATES,
  WEED_GROWTH_STATES,
  WEED_LEVEL_MAX_BP,
} from '../config/transitions.js';
import { CropCycleState, type CropId } from '../domain/enums.js';
import {
  MS_PER_GAME_HOUR,
  addGameMs,
  bp,
  clampBp,
  floorDiv,
  gameHoursToGameMs,
  type Bp,
  type GameMs,
} from '../domain/units.js';
import { interpolateCurveAtBp } from './curves.js';

/** The timed phases in cycle order (GDD section 76). */
export const TIMED_CROP_PHASE_ORDER: readonly TimedCropCycleState[] = [
  CropCycleState.SEEDED,
  CropCycleState.GERMINATING,
  CropCycleState.GROWING,
];

/** Crop definition for an identifier, falling back to nothing: an unknown id throws. */
export function cropById(
  cropId: CropId,
  catalogue: Readonly<Record<CropId, CropDefinition>> = CROPS,
): CropDefinition {
  return catalogue[cropId];
}

// ---------------------------------------------------------------------------
// Yield multipliers
// ---------------------------------------------------------------------------

/** Fertility to yield multiplier (GDD section 77). */
export function fertilityToYield(fertilityBp: Bp, curve: Curve = FERTILITY_TO_YIELD_CURVE): number {
  return interpolateCurveAtBp(curve, fertilityBp);
}

/**
 * Weed level to the fraction of yield lost (GDD section 78). The yield formula of
 * GDD section 83 uses `1 - penalty`, so this returns the penalty and not a
 * multiplier.
 */
export function weedToYieldPenalty(
  weedLevelBp: Bp,
  curve: Curve = WEED_TO_YIELD_PENALTY_CURVE,
): number {
  return interpolateCurveAtBp(curve, weedLevelBp);
}

/**
 * Fertilisation to yield multiplier (GDD section 79). Fixed at 1.0 across the whole
 * range in the MVP; the function and the curve exist so that enabling it later is a
 * change of table and not a change of code.
 */
export function fertilizationToYield(
  fertilizationBp: Bp,
  curve: Curve = FERTILIZATION_TO_YIELD_CURVE,
): number {
  return interpolateCurveAtBp(curve, fertilizationBp);
}

export interface YieldInput {
  readonly cellCount: number;
  readonly crop: CropDefinition;
  readonly fertilityBp: Bp;
  readonly fertilizationBp: Bp;
  readonly weedLevelBp: Bp;
}

export interface YieldBreakdown {
  readonly baseLiters: number;
  readonly fertilityMultiplier: number;
  readonly fertilizationMultiplier: number;
  readonly weedPenalty: number;
  /** Litres, as a whole number: every fungible stock is an integer. */
  readonly liters: number;
}

/**
 * Final yield of a field (GDD section 83):
 * `baseYieldPerCell x cellCount x fertilityMult x fertilizationMult x (1 - weedPenalty)`.
 *
 * The multiplications happen in that fixed order and the result is truncated, so
 * the silo never receives a litre the formula did not produce and two runs of the
 * same inputs cannot disagree.
 */
export function finalYieldLiters(
  input: YieldInput,
  curves: {
    readonly fertility?: Curve;
    readonly fertilization?: Curve;
    readonly weed?: Curve;
  } = {},
): YieldBreakdown {
  const cells = input.cellCount > 0 ? Math.floor(input.cellCount) : 0;
  const baseLiters = input.crop.baseYieldPerCellLiters * cells;
  const fertilityMultiplier = fertilityToYield(
    input.fertilityBp,
    curves.fertility ?? FERTILITY_TO_YIELD_CURVE,
  );
  const fertilizationMultiplier = fertilizationToYield(
    input.fertilizationBp,
    curves.fertilization ?? FERTILIZATION_TO_YIELD_CURVE,
  );
  const weedPenalty = weedToYieldPenalty(
    input.weedLevelBp,
    curves.weed ?? WEED_TO_YIELD_PENALTY_CURVE,
  );
  const litersExact =
    baseLiters * fertilityMultiplier * fertilizationMultiplier * (1 - weedPenalty);
  return {
    baseLiters,
    fertilityMultiplier,
    fertilizationMultiplier,
    weedPenalty,
    liters: litersExact > 0 ? Math.floor(litersExact) : 0,
  };
}

// ---------------------------------------------------------------------------
// Lazily accrued attributes
// ---------------------------------------------------------------------------

/** Integrates a rate in basis points per game hour over a game interval. */
function accrueBasisPoints(ratePerGameHour: Bp, fromGameMs: GameMs, toGameMs: GameMs): number {
  const elapsed = toGameMs - fromGameMs;
  if (elapsed <= 0n) {
    return 0;
  }
  return Number(floorDiv(BigInt(ratePerGameHour) * elapsed, MS_PER_GAME_HOUR));
}

export interface WeedProjectionInput {
  readonly weedLevelBp: Bp;
  readonly updatedAtGameMs: GameMs;
  readonly toGameMs: GameMs;
  readonly cropCycleState: CropCycleState;
  readonly crop: CropDefinition;
}

/**
 * Weed level projected forward (GDD section 78). Weeds grow only while the field is
 * in one of the states of GDD section 78, which the table of shared/config lists,
 * and they saturate at 100 %.
 *
 * Consequence of implementing the published 0.6 %/h literally, recorded as the main
 * finding of the balance report: over the 325 h cycle of GDD section 118 the level
 * saturates instead of reaching the 20 % that GDD section 119 assumes, so harvesting
 * wheat without cultivating carries the maximum penalty of GDD section 78. Nothing
 * is tuned here (plan section 2.2).
 */
export function projectWeedLevel(
  input: WeedProjectionInput,
  growthStates: readonly CropCycleState[] = WEED_GROWTH_STATES,
  maxBp: number = WEED_LEVEL_MAX_BP,
): Bp {
  if (!growthStates.includes(input.cropCycleState)) {
    return input.weedLevelBp;
  }
  const growth = accrueBasisPoints(
    input.crop.weedGrowthBpPerGameHour,
    input.updatedAtGameMs,
    input.toGameMs,
  );
  const level = input.weedLevelBp + growth;
  return clampBp(level > maxBp ? maxBp : level);
}

export interface PhasedWeedProjectionInput {
  readonly weedLevelBp: Bp;
  readonly updatedAtGameMs: GameMs;
  readonly toGameMs: GameMs;
  /** Stored state of the field, which governs any stretch outside the sown timeline. */
  readonly cropCycleState: CropCycleState;
  /** Instant the field was sown, or null when it carries no crop. */
  readonly seededAtGameMs: GameMs | null;
  readonly crop: CropDefinition;
}

/**
 * Ceiling on the segments one settlement produces: the three timed phases, plus
 * `READY_TO_HARVEST`, plus the stretch before sowing. It bounds the loop rather than
 * trusting the phase durations to be positive.
 */
const MAX_PHASE_SEGMENTS = TIMED_CROP_PHASE_ORDER.length + 2;

/**
 * Weed level carried forward across the phase boundaries of the cycle (GDD section 78).
 *
 * Weeds grow only while the field is `GROWING`, `READY_TO_HARVEST` or `VIRGIN`, so an
 * interval that spans several phases cannot be projected with a single state and neither
 * of the two single state readings is right. A field sown at t0 and read at t0 + 200 h is
 * stored as `SEEDED`, because no job has run yet: projecting with the stored state grows no
 * weeds at all, and projecting with the state it has now grows them across the six hours of
 * `SEEDED` and the twelve of `GERMINATING`, where GDD section 78 says they do not grow.
 * Both are wrong by more than a thousand basis points on the yield of GDD section 83.
 *
 * So the interval is cut at the boundaries the growth timeline implies and each piece is
 * accrued with the state that was in force during it. It lives here, and not in the server,
 * because the panel projects the same field with the same rule: two implementations of this
 * is exactly how the figure a panel shows and the figure the server validates come to
 * differ (plan section 8).
 *
 * Rounding: each segment truncates towards zero inside `projectWeedLevel`, so a settlement
 * over four segments loses at most four basis points against a single one, always in the
 * direction that does not favour the player.
 */
export function projectWeedLevelAcrossPhases(
  input: PhasedWeedProjectionInput,
  growthStates: readonly CropCycleState[] = WEED_GROWTH_STATES,
  maxBp: number = WEED_LEVEL_MAX_BP,
): Bp {
  let level = input.weedLevelBp;
  let cursor = input.updatedAtGameMs;
  const accrue = (state: CropCycleState, fromGameMs: GameMs, toGameMs: GameMs): void => {
    level = projectWeedLevel(
      {
        weedLevelBp: level,
        updatedAtGameMs: fromGameMs,
        toGameMs,
        cropCycleState: state,
        crop: input.crop,
      },
      growthStates,
      maxBp,
    );
  };

  if (input.toGameMs <= cursor) {
    return level;
  }
  const seeded = input.seededAtGameMs;
  const timed = (TIMED_CROP_PHASE_ORDER as readonly CropCycleState[]).includes(
    input.cropCycleState,
  );
  if (seeded === null || !timed) {
    // None of the remaining states of GDD section 76 moves on by the passage of time: they
    // need a player action or the harvest configuration, so the stretch is a single one.
    accrue(input.cropCycleState, cursor, input.toGameMs);
    return level;
  }

  if (cursor < seeded) {
    // Unreachable in practice, because sowing settles the attribute and therefore moves its
    // timestamp to the instant of sowing. Kept because a stretch before the timeline has no
    // phase, and answering with the stored state is the only total answer.
    const end = seeded < input.toGameMs ? seeded : input.toGameMs;
    accrue(input.cropCycleState, cursor, end);
    cursor = end;
  }

  for (let guard = 0; cursor < input.toGameMs && guard < MAX_PHASE_SEGMENTS; guard += 1) {
    const phase = projectCropPhase(seeded, cursor, input.crop);
    const boundary = phase.nextBoundaryGameMs;
    const end = boundary === null || boundary > input.toGameMs ? input.toGameMs : boundary;
    if (end <= cursor) {
      break;
    }
    accrue(phase.state, cursor, end);
    cursor = end;
  }
  return level;
}

export interface FertilityProjectionInput {
  readonly fertilityBp: Bp;
  readonly updatedAtGameMs: GameMs;
  readonly toGameMs: GameMs;
  readonly cropCycleState: CropCycleState;
  readonly crop: CropDefinition;
}

/**
 * Fertility projected forward while the field lies fallow (GDD section 77, which
 * admits fallow as the restoration route, plan section 2.2). Outside the fallow
 * states fertility does not move by the passage of time: it only drops per harvest.
 */
export function projectFallowFertility(
  input: FertilityProjectionInput,
  regenStates: readonly CropCycleState[] = FERTILITY_REGEN_STATES,
  maxBp: number = FERTILITY_MAX_BP,
): Bp {
  if (!regenStates.includes(input.cropCycleState)) {
    return input.fertilityBp;
  }
  const regen = accrueBasisPoints(
    input.crop.fertilityRegenBpPerGameHourInFallow,
    input.updatedAtGameMs,
    input.toGameMs,
  );
  const level = input.fertilityBp + regen;
  return clampBp(level > maxBp ? maxBp : level);
}

/** Fertility after a completed harvest (GDD sections 77 and 82). */
export function fertilityAfterHarvest(fertilityBp: Bp, crop: CropDefinition): Bp {
  return clampBp(fertilityBp - crop.fertilityDrainPerCycleBp);
}

// ---------------------------------------------------------------------------
// Growth and phase projection
// ---------------------------------------------------------------------------

/**
 * Growth progress inside the timed part of the cycle (GDD section 80):
 * `min(100, elapsed / growthDuration)`, in basis points, measured from the instant
 * the field was sown.
 */
export function growthProgressBp(
  seededAtGameMs: GameMs,
  atGameMs: GameMs,
  crop: CropDefinition = WHEAT,
): Bp {
  const totalMs = gameHoursToGameMs(crop.growthDurationGameHours);
  if (totalMs <= 0n) {
    return bp(10_000);
  }
  const elapsed = atGameMs - seededAtGameMs;
  if (elapsed <= 0n) {
    return bp(0);
  }
  return clampBp(Number(floorDiv(elapsed * 10_000n, totalMs)));
}

/** Where a sown field is in the timed part of its cycle, and when it moves on. */
export interface CropPhaseProjection {
  /** `SEEDED`, `GERMINATING`, `GROWING` or `READY_TO_HARVEST`. */
  readonly state: CropCycleState;
  /** Instant the field entered that state, derived and not stored. */
  readonly enteredAtGameMs: GameMs;
  /** Instant of the next automatic transition, or null once ready to harvest. */
  readonly nextBoundaryGameMs: GameMs | null;
  readonly growthProgressBp: Bp;
}

/**
 * Phase of a sown field at an instant (GDD section 76).
 *
 * The three timed phases of the crop are laid end to end from the instant of
 * sowing, and the field is ready to harvest once their total has elapsed. The
 * boundaries are closed on the left: a field exactly at a boundary is already in
 * the next phase, which is what makes the projection idempotent, since projecting
 * again at `enteredAtGameMs` returns the same phase and the same entry instant.
 *
 * The scheduled `FIELD_ADVANCE_PHASE` job recomputes this and only materialises the
 * result; validation accepts a field whose job has not run yet (plan section 6.5).
 */
export function projectCropPhase(
  seededAtGameMs: GameMs,
  atGameMs: GameMs,
  crop: CropDefinition = WHEAT,
  phaseOrder: readonly TimedCropCycleState[] = TIMED_CROP_PHASE_ORDER,
): CropPhaseProjection {
  const progress = growthProgressBp(seededAtGameMs, atGameMs, crop);
  let boundary = seededAtGameMs;
  for (let index = 0; index < phaseOrder.length; index += 1) {
    const phase = phaseOrder[index];
    if (phase === undefined) {
      continue;
    }
    const next = addGameMs(boundary, gameHoursToGameMs(crop.phaseDurationsGameHours[phase]));
    if (atGameMs < next) {
      return {
        state: phase,
        enteredAtGameMs: boundary,
        nextBoundaryGameMs: next,
        growthProgressBp: progress,
      };
    }
    boundary = next;
  }
  return {
    state: CropCycleState.READY_TO_HARVEST,
    enteredAtGameMs: boundary,
    nextBoundaryGameMs: null,
    growthProgressBp: progress,
  };
}
