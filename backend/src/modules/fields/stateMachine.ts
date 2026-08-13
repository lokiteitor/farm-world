// The crop cycle state machine, read from the table and never from a chain of conditionals.
//
// Owner: workflow W4-C. Module `fields`.
//
// The eight states and nine transitions of GDD section 76 live in
// `shared/config/transitions.ts` as data (ADR-0011), together with the machinery
// requirements of GDD section 90 in `OPERATION_REQUIREMENTS`. This file is the only place
// that interrogates them, and it does three things and no more:
//
//   1. Decides whether a transition exists, so an illegal one is refused with the reason
//      the client can render (`FIELD_STATE_NOT_ALLOWED` and the states that were allowed).
//   2. Decides whether an operation may start from a state, which is the same question
//      asked from the side of GDD section 90 rather than of GDD section 76. The two tables
//      are cross checked by a test of `shared/config`, so they cannot drift apart.
//   3. Names the side effects a transition carries: the soil condition of GDD section 81,
//      the weed reset of GDD section 78, and whether the operation names a crop.
//
// What it deliberately does not do is touch the database or the clock. Applying a
// transition is `service.ts`; deciding whether it is legal is here, and a test can ask the
// question without a transaction.

import {
  ApiError,
  CROP_CYCLE_TRANSITIONS,
  CropCycleState,
  OPERATION_REQUIREMENTS,
  ValidationCode,
  fieldStateNotAllowed,
  type CropCycleTransition,
  type OperationRequirement,
  type TaskOperation,
} from '../../shared/index.js';

/** The transition between two states, or null when the machine does not admit it. */
export function transitionBetween(
  from: CropCycleState,
  to: CropCycleState,
  transitions: readonly CropCycleTransition[] = CROP_CYCLE_TRANSITIONS,
): CropCycleTransition | null {
  return transitions.find((entry) => entry.from === from && entry.to === to) ?? null;
}

/** Every state the machine can reach from one state. */
export function statesReachableFrom(
  from: CropCycleState,
  transitions: readonly CropCycleTransition[] = CROP_CYCLE_TRANSITIONS,
): readonly CropCycleState[] {
  return transitions.filter((entry) => entry.from === from).map((entry) => entry.to);
}

/**
 * The transition, or a refusal naming the states that were admissible.
 *
 * `reason` is the operation when the caller has one and the destination state otherwise,
 * so a refused automatic transition reads as clearly in the log as a refused player action.
 */
export function requireTransition(
  from: CropCycleState,
  to: CropCycleState,
  reason: string,
  transitions: readonly CropCycleTransition[] = CROP_CYCLE_TRANSITIONS,
): CropCycleTransition {
  const transition = transitionBetween(from, to, transitions);
  if (transition === null) {
    throw fieldStateNotAllowed(reason, from, statesReachableFrom(from, transitions));
  }
  return transition;
}

/**
 * The requirement of an operation whose target is a field (GDD section 90).
 *
 * An operation whose target is a forest plot or a set of cells is refused here rather than
 * further down: `TARGET_KIND_MISMATCH` says exactly what happened, while letting it through
 * would produce a state machine refusal that blames the field.
 */
export function fieldOperationRequirement(
  operation: TaskOperation,
  requirements: Readonly<Record<TaskOperation, OperationRequirement>> = OPERATION_REQUIREMENTS,
): OperationRequirement {
  const requirement = requirements[operation];
  if (requirement.targetKind !== 'FIELD' || requirement.toCropState === null) {
    throw new ApiError(ValidationCode.TARGET_KIND_MISMATCH, { operation });
  }
  return requirement;
}

/**
 * Refuses an operation the state of the field does not admit (GDD sections 76 and 104).
 *
 * The state given is always the projected one, never the stored one: a field whose growth
 * job has not run yet is already `READY_TO_HARVEST` and a harvest assigned to it must be
 * accepted (plan section 6.5). The caller materialises the transition in the same
 * transaction before it gets here.
 */
export function requireOperationAllowed(
  operation: TaskOperation,
  state: CropCycleState,
  requirements: Readonly<Record<TaskOperation, OperationRequirement>> = OPERATION_REQUIREMENTS,
): OperationRequirement {
  const requirement = fieldOperationRequirement(operation, requirements);
  if (!requirement.fromCropStates.includes(state)) {
    throw fieldStateNotAllowed(operation, state, requirement.fromCropStates);
  }
  return requirement;
}

/**
 * States a geometry operation may extend a field from (GDD section 20).
 *
 * The list is the answer to an exploit rather than a rule of the GDD, and it is short
 * enough to state in full: adding unsown cells to a field that is already `SEEDED` would
 * enlarge `cellCount`, which multiplies the yield of GDD section 83 directly, so the player
 * would harvest a surface that was never sown. Extension is therefore admitted only where
 * the whole field still has to be worked before it can produce anything.
 */
export const EXTENDABLE_STATES: readonly CropCycleState[] = [
  CropCycleState.VIRGIN,
  CropCycleState.PLOWED,
  CropCycleState.CULTIVATED,
  CropCycleState.HARVESTED,
];

/** Refuses an extension of a field that is in the middle of a growing cycle. */
export function requireExtendable(state: CropCycleState): void {
  if (!EXTENDABLE_STATES.includes(state)) {
    throw fieldStateNotAllowed('EXTEND', state, EXTENDABLE_STATES);
  }
}
