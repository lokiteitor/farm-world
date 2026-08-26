// Projection of the state of a field to an instant.
//
// Owner: workflow W4-C. Module `fields`.
//
// Invariant 5 of plan section 6.5: the pure function is the authority and the scheduled
// job only materialises and notifies its result, recomputing it with the very same
// function. Nothing in this file reads or writes: it takes the stored columns of a field,
// the crop catalogue and an instant, and answers what the field is at that instant.
//
// Everything here delegates the arithmetic to `shared/rules/yield.ts`, which is the module
// the client also imports, so the number a panel shows and the number the server validates
// against come from one implementation (plan section 8). What this file adds is the part
// that is specific to the server side of the model and that a pure rule cannot know: how
// the interval since an attribute was last settled is split by the phase timeline.
//
// Why the split matters, with the case that makes it visible. Weeds grow only while the
// field is `GROWING`, `READY_TO_HARVEST` or `VIRGIN` (GDD section 78). A field sown at t0
// and read at t0 + 200 h has `weedLevelUpdatedAtGameMs = t0` and a stored state of
// `SEEDED`, because no job has run yet. Projecting the whole interval with the stored state
// would grow no weeds at all, and projecting it with the state the field has now would grow
// them across the six hours of `SEEDED` and the twelve of `GERMINATING`, when GDD section
// 78 says they do not grow there. Both readings are wrong by tens of percentage points on
// the yield of GDD section 83, and neither is detectable without doing the arithmetic by
// hand. So the interval is cut at the phase boundaries and each piece is accrued with the
// state that was in force during it.
//
// Where that cut lives, corrected in W7. It was written here and the client wrote its own,
// worse, version of it, which is the divergence the adversarial review measured at up to
// 1.459 L of yield (`docs/revision-formulas.md`, hallazgo H4). The cut is pure and the panel
// needs it as much as the server does, so it moved to `projectWeedLevelAcrossPhases` of
// `shared/rules/yield.ts` and `settleWeedLevel` below is now the mapping from the stored
// columns to it. `phaseSegments` stays here because fertility and the materialising loop
// walk the same timeline for their own purposes.
//
// Rounding. Each segment truncates towards zero inside `projectWeedLevel`, so a settlement
// over four segments loses at most four basis points against a single one. The bound is the
// one ADR-0013 already accepts (one basis point per settlement) multiplied by the number of
// phases of a cycle, which is four; on a level expressed in ten thousandths that is under
// 0.05 % and it is always in the direction that does not favour the player.

import {
  CROPS,
  CROP_CYCLE_TRANSITIONS,
  CropCycleState,
  FALLOW_LAND,
  FERTILITY_REGEN_STATES,
  TIMED_CROP_PHASE_ORDER,
  WEED_GROWTH_STATES,
  addGameMs,
  bp,
  finalYieldLiters,
  gameHoursToGameMs,
  growthProgressBp,
  projectCropPhase,
  projectFallowFertility,
  projectWeedLevelAcrossPhases,
  type Bp,
  type CropCycleTransition,
  type CropDefinition,
  type CropId,
  type GameMs,
  type LandRates,
  type SoilCondition,
  type TaskOperation,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// The shape the projection needs
// ---------------------------------------------------------------------------

/**
 * The stored columns of a field the projection reads, and nothing else.
 *
 * Deliberately not the row and not the DTO: the job handler, the route and the tests all
 * project, and only one of the three has a row in its hands.
 */
export interface FieldAttributes {
  readonly cellCount: number;
  readonly cropId: CropId | null;
  readonly cropCycleState: CropCycleState;
  readonly soilCondition: SoilCondition;
  readonly fertilityBp: Bp;
  readonly fertilityUpdatedAtGameMs: GameMs;
  readonly weedLevelBp: Bp;
  readonly weedLevelUpdatedAtGameMs: GameMs;
  readonly fertilizationBp: Bp;
  readonly fertilizationUpdatedAtGameMs: GameMs;
  readonly stateEnteredAtGameMs: GameMs;
  readonly seededAtGameMs: GameMs | null;
  readonly currentTaskId: string | null;
}

/**
 * The crop of a field, or null when it carries none.
 *
 * It used to answer with wheat for an unsown field, which made one member of the
 * catalogue a global constant of the simulation. With sixty two crops that choice would
 * have been arbitrary, so the rates that apply to bare land now live in `FALLOW_LAND` and
 * this answers honestly.
 */
export function cropOf(
  cropId: CropId | null,
  catalogue: Readonly<Record<CropId, CropDefinition>> = CROPS,
): CropDefinition | null {
  return cropId === null ? null : catalogue[cropId];
}

/** The rates that govern a field, whether or not anything is growing on it. */
export function landRatesOf(crop: CropDefinition | null): LandRates {
  return crop ?? FALLOW_LAND;
}

/** Whether a state belongs to the timed part of the cycle (GDD sections 76 and 80). */
export function isTimedPhase(state: CropCycleState): boolean {
  return (TIMED_CROP_PHASE_ORDER as readonly CropCycleState[]).includes(state);
}

// ---------------------------------------------------------------------------
// The phase timeline
// ---------------------------------------------------------------------------

/** One stretch of the timeline during which the field was in a single state. */
export interface PhaseSegment {
  readonly state: CropCycleState;
  readonly fromGameMs: GameMs;
  readonly toGameMs: GameMs;
}

/**
 * Ceiling on the number of segments one settlement produces: the three timed phases, plus
 * `READY_TO_HARVEST`, plus the stretch before sowing. It bounds the loop rather than
 * trusting the phase durations to be positive.
 */
export const MAX_PHASE_SEGMENTS = TIMED_CROP_PHASE_ORDER.length + 2;

/**
 * Cuts `[fromGameMs, toGameMs)` at the phase boundaries the growth timeline implies.
 *
 * A field outside the timed part of the cycle produces one segment with its stored state,
 * because none of those states moves on by the passage of time (GDD section 76: the
 * remaining transitions need a player action or the harvest configuration).
 */
export function phaseSegments(
  field: FieldAttributes,
  crop: CropDefinition | null,
  fromGameMs: GameMs,
  toGameMs: GameMs,
): readonly PhaseSegment[] {
  if (toGameMs <= fromGameMs) {
    return [];
  }
  const seeded = field.seededAtGameMs;
  if (seeded === null || crop === null || !isTimedPhase(field.cropCycleState)) {
    return [{ state: field.cropCycleState, fromGameMs, toGameMs }];
  }

  const segments: PhaseSegment[] = [];
  let cursor = fromGameMs;
  if (cursor < seeded) {
    // Unreachable in practice, because sowing settles both attributes and therefore moves
    // their timestamps to the instant of sowing. Kept because a stretch before the timeline
    // has no phase, and answering with the stored state is the only total answer.
    const end = seeded < toGameMs ? seeded : toGameMs;
    segments.push({ state: field.cropCycleState, fromGameMs: cursor, toGameMs: end });
    cursor = end;
  }

  for (let guard = 0; cursor < toGameMs && guard < MAX_PHASE_SEGMENTS; guard += 1) {
    const phase = projectCropPhase(seeded, cursor, crop);
    const boundary = phase.nextBoundaryGameMs;
    const end = boundary === null || boundary > toGameMs ? toGameMs : boundary;
    if (end <= cursor) {
      break;
    }
    segments.push({ state: phase.state, fromGameMs: cursor, toGameMs: end });
    cursor = end;
  }
  return segments;
}

/**
 * Instant the field leaves a timed phase, given when it was sown, or null when the state
 * is not one of the timed phases.
 *
 * The boundaries are the cumulative phase durations of the crop laid end to end from the
 * instant of sowing, which is exactly what `projectCropPhase` walks. It is derived here
 * rather than read from the projection because the materialising loop needs the boundary of
 * the state the field is stored in, which may be several phases behind the current one.
 */
export function phaseBoundaryAfter(
  state: CropCycleState,
  seededAtGameMs: GameMs,
  crop: CropDefinition | null,
  phaseOrder: readonly (typeof TIMED_CROP_PHASE_ORDER)[number][] = TIMED_CROP_PHASE_ORDER,
): GameMs | null {
  if (crop === null) {
    return null;
  }
  let boundary = seededAtGameMs;
  for (const phase of phaseOrder) {
    boundary = addGameMs(boundary, gameHoursToGameMs(crop.phaseDurationsGameHours[phase]));
    if (phase === state) {
      return boundary;
    }
  }
  return null;
}

/**
 * The state that follows a timed phase (GDD section 76): the next phase of the order, and
 * `READY_TO_HARVEST` after the last one. Null for a state outside the timed part.
 */
export function nextTimedState(
  state: CropCycleState,
  phaseOrder: readonly (typeof TIMED_CROP_PHASE_ORDER)[number][] = TIMED_CROP_PHASE_ORDER,
): CropCycleState | null {
  const index = phaseOrder.indexOf(state as (typeof TIMED_CROP_PHASE_ORDER)[number]);
  if (index < 0) {
    return null;
  }
  return phaseOrder[index + 1] ?? CropCycleState.READY_TO_HARVEST;
}

// ---------------------------------------------------------------------------
// The lazily accrued attributes
// ---------------------------------------------------------------------------

/** The three parallel attributes of GDD sections 77, 78 and 79, settled to an instant. */
export interface SettledAttributes {
  readonly fertilityBp: Bp;
  readonly weedLevelBp: Bp;
  readonly fertilizationBp: Bp;
}

/**
 * Weed level carried forward to an instant (GDD section 78).
 *
 * The segmentation by phase and the accrual are `projectWeedLevelAcrossPhases` of the
 * shared rules, so the rate, the list of growing states, the saturation at 100 % and the
 * way the interval is cut have exactly one implementation, which the client runs too. The
 * server keeps only the mapping from its stored columns to that input.
 */
export function settleWeedLevel(
  field: FieldAttributes,
  toGameMs: GameMs,
  crop: CropDefinition | null = cropOf(field.cropId),
  growthStates: readonly CropCycleState[] = WEED_GROWTH_STATES,
): Bp {
  return projectWeedLevelAcrossPhases(
    {
      weedLevelBp: field.weedLevelBp,
      updatedAtGameMs: field.weedLevelUpdatedAtGameMs,
      toGameMs,
      cropCycleState: field.cropCycleState,
      seededAtGameMs: field.seededAtGameMs,
      land: landRatesOf(crop),
      crop,
    },
    growthStates,
  );
}

/**
 * Fertility carried forward to an instant (GDD section 77, fallow recovery).
 *
 * Only `VIRGIN` recovers, and `VIRGIN` never advances by the passage of time, so the
 * segmentation degenerates to a single stretch. It goes through the same helper anyway:
 * the day a second recovering state appears, this function is already correct.
 */
export function settleFertility(
  field: FieldAttributes,
  toGameMs: GameMs,
  crop: CropDefinition | null = cropOf(field.cropId),
  regenStates: readonly CropCycleState[] = FERTILITY_REGEN_STATES,
): Bp {
  let level = field.fertilityBp;
  for (const segment of phaseSegments(field, crop, field.fertilityUpdatedAtGameMs, toGameMs)) {
    level = projectFallowFertility(
      {
        fertilityBp: level,
        updatedAtGameMs: segment.fromGameMs,
        toGameMs: segment.toGameMs,
        cropCycleState: segment.state,
        land: landRatesOf(crop),
      },
      regenStates,
    );
  }
  return level;
}

/**
 * Fertilisation carried forward (GDD section 79). It does not move: the MVP models the
 * attribute and fixes its multiplier at 1.0 (GDD section 86), so the decay the section
 * describes is not implemented and the stored value is already the current one. The
 * function exists so that the call sites settle three attributes and not two, and enabling
 * the decay later is a change here and nowhere else.
 */
export function settleFertilization(field: FieldAttributes, _toGameMs: GameMs): Bp {
  return field.fertilizationBp;
}

/** The three attributes settled in one call, which is what every transition writes. */
export function settleAttributes(
  field: FieldAttributes,
  toGameMs: GameMs,
  crop: CropDefinition | null = cropOf(field.cropId),
): SettledAttributes {
  return {
    fertilityBp: settleFertility(field, toGameMs, crop),
    weedLevelBp: settleWeedLevel(field, toGameMs, crop),
    fertilizationBp: settleFertilization(field, toGameMs),
  };
}

// ---------------------------------------------------------------------------
// The phase
// ---------------------------------------------------------------------------

/** Where the field is in its cycle at an instant, derived and never stored. */
export interface FieldPhaseProjection {
  readonly state: CropCycleState;
  /** Instant the field entered that state, derived from the growth timeline. */
  readonly enteredAtGameMs: GameMs;
  /** Instant of the next automatic transition, or null when there is none. */
  readonly nextBoundaryGameMs: GameMs | null;
  readonly growthProgressBp: Bp;
  /** Instant the field reaches `READY_TO_HARVEST`, or null outside the timed part. */
  readonly readyAtGameMs: GameMs | null;
}

/**
 * Phase of a field at an instant (GDD sections 76 and 80).
 *
 * This is the authority. A field whose `FIELD_ADVANCE_PHASE` job has not run yet is
 * already in the state this function reports, and every validation path accepts it as
 * such, materialising the transition in the same transaction (plan section 6.5).
 */
export function projectFieldPhase(
  field: FieldAttributes,
  atGameMs: GameMs,
  crop: CropDefinition | null = cropOf(field.cropId),
): FieldPhaseProjection {
  const seeded = field.seededAtGameMs;
  if (seeded === null || crop === null || !isTimedPhase(field.cropCycleState)) {
    return {
      state: field.cropCycleState,
      enteredAtGameMs: field.stateEnteredAtGameMs,
      nextBoundaryGameMs: null,
      growthProgressBp:
        seeded === null || crop === null ? bp(0) : growthProgressBp(seeded, atGameMs, crop),
      readyAtGameMs: null,
    };
  }
  const phase = projectCropPhase(seeded, atGameMs, crop);
  return {
    state: phase.state,
    enteredAtGameMs: phase.enteredAtGameMs,
    nextBoundaryGameMs: phase.nextBoundaryGameMs,
    growthProgressBp: phase.growthProgressBp,
    // Literal reading of the contract (`shared/api/schemas/fields.ts`): the instant is
    // reported while the field is still inside the timed part, and null once it is out,
    // where a countdown would have nothing left to count.
    readyAtGameMs: isTimedPhase(phase.state)
      ? addGameMs(seeded, gameHoursToGameMs(crop.growthDurationGameHours))
      : null,
  };
}

// ---------------------------------------------------------------------------
// What the player may do next
// ---------------------------------------------------------------------------

/**
 * Whether a transition whose applicability depends on the crop applies here.
 *
 * The only conditional player transition of the table is `PLOWED -> SEEDED`, which GDD
 * section 76 gates on `requiresCultivation`. A field with no crop yet offers it when any
 * crop of the catalogue admits direct sowing, because the crop is chosen when the task is
 * created and not when the field is inspected (GDD section 104).
 */
function cropAdmits(
  transition: CropCycleTransition,
  cropId: CropId | null,
  catalogue: Readonly<Record<CropId, CropDefinition>>,
): boolean {
  if (transition.to !== CropCycleState.SEEDED) {
    return true;
  }
  if (cropId !== null) {
    return !catalogue[cropId].requiresCultivation;
  }
  return Object.values(catalogue).some((crop) => !crop.requiresCultivation);
}

/**
 * Operations the state of the field admits right now (GDD sections 76 and 90).
 *
 * Derived from the transition table and not from a switch, which is the reason the table
 * is a datum (ADR-0011): a transition added there appears in the interface without any
 * change here. A field with a task in flight admits nothing, which is what makes the
 * disabled control of the panel explainable (GDD section 104).
 */
export function availableOperations(
  state: CropCycleState,
  cropId: CropId | null,
  hasActiveTask: boolean,
  catalogue: Readonly<Record<CropId, CropDefinition>> = CROPS,
  transitions: readonly CropCycleTransition[] = CROP_CYCLE_TRANSITIONS,
): readonly TaskOperation[] {
  if (hasActiveTask) {
    return [];
  }
  const operations: TaskOperation[] = [];
  for (const transition of transitions) {
    if (transition.from !== state || transition.automatic || transition.operation === null) {
      continue;
    }
    if (transition.conditionalOnCrop && !cropAdmits(transition, cropId, catalogue)) {
      continue;
    }
    if (!operations.includes(transition.operation)) {
      operations.push(transition.operation);
    }
  }
  return operations;
}

// ---------------------------------------------------------------------------
// Expected yield
// ---------------------------------------------------------------------------

/**
 * Expected yield of the field with its attributes settled (GDD section 83).
 *
 * It is what the panel shows and what the harvest actually deposits, because both call
 * this and this calls `finalYieldLiters` of the shared rules.
 *
 * The formula is applied whatever the state of the field, which is the literal reading of
 * `shared/api/schemas/fields.ts` and is what makes the figure useful: on an unsown field it
 * is the planning estimate the interface needs in order to compare two pieces of land, and
 * the state travels beside it so a panel that must not show it can tell. A field with no
 * crop yields nothing, which is the honest answer and the one the panel has to draw.
 */
export function expectedYieldLiters(
  field: FieldAttributes,
  settled: SettledAttributes,
  crop: CropDefinition | null = cropOf(field.cropId),
): number {
  if (crop === null) {
    return 0;
  }
  return finalYieldLiters({
    cellCount: field.cellCount,
    crop,
    fertilityBp: settled.fertilityBp,
    fertilizationBp: settled.fertilizationBp,
    weedLevelBp: settled.weedLevelBp,
  }).liters;
}
