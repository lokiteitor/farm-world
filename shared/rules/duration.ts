// Duration of a task: work speed, skill and machine condition.
//
// Owner: workflow W2 (pure rules).
//
// GDD section 91:
//
//   taskDuration (hours) = fieldCellCount / effectiveWorkSpeed
//   effectiveWorkSpeed   = machine.workSpeed x conditionFactor x skillFactor
//
// and GDD section 135 states the same formula for felling with the tree count as
// the numerator. The duration is fixed once, when the task starts, and the task row
// keeps the effective speed as audit, because GDD section 89 warns that the unit of
// `workSpeed` will be recalculated.
//
// The two factors come from different places and are deliberately kept apart:
// `skillFactor` is an algebraic formula the GDD states in full (section 103), while
// `conditionFactor` is a table of nodes, because GDD section 91 gives three non
// collinear points and says nothing below 10 % (plan section 2.2).

import { CONDITION_FACTOR_CURVE, type Curve } from '../config/curves.js';
import {
  MACHINE_CATALOGUE,
  OPERATION_REQUIREMENTS,
  type MachineDefinition,
  type OperationRequirement,
} from '../config/machines.js';
import { SKILL_FACTOR_BASE, SKILL_FACTOR_SPAN } from '../config/workers.js';
import { type MachineType, type TaskOperation } from '../domain/enums.js';
import { bpToRatio, gameHours, type Bp, type GameHours } from '../domain/units.js';
import { interpolateCurveAtBp } from './curves.js';

/** Coefficients of `skillFactor` (GDD section 103). */
export interface SkillFactorConfig {
  readonly base: number;
  readonly span: number;
}

export const DEFAULT_SKILL_FACTOR_CONFIG: SkillFactorConfig = {
  base: SKILL_FACTOR_BASE,
  span: SKILL_FACTOR_SPAN,
};

/**
 * Work speed multiplier of a worker (GDD section 103):
 * `0.5 + (skill / 100) x 0.5`, so 0 % skill gives 0.5 and 100 % gives 1.0.
 *
 * The floor is a design decision of the GDD, not a safety measure: skill never
 * makes a worker useless, which is what keeps the "many cheap workers against few
 * experts" trade off of GDD sections 65 and 103 alive.
 */
export function skillFactor(
  skillBp: Bp,
  config: SkillFactorConfig = DEFAULT_SKILL_FACTOR_CONFIG,
): number {
  return config.base + bpToRatio(skillBp) * config.span;
}

/**
 * Work speed multiplier of a machine in a given condition (GDD section 91), read
 * off the node table of shared/config, which adds the floor of 0.2 at zero
 * condition that plan section 2.2 introduces: without a floor the factor would
 * reach zero and the duration of a task would be infinite.
 */
export function conditionFactor(conditionBp: Bp, curve: Curve = CONDITION_FACTOR_CURVE): number {
  return interpolateCurveAtBp(curve, conditionBp);
}

/**
 * Work speed a task actually runs at, in units per game hour.
 *
 * Never negative: a base speed that a corrupt catalogue left below zero yields
 * zero, and the callers of `taskDurationGameHours` reject a non positive speed
 * there, where the message can name the operation.
 */
export function effectiveWorkSpeed(
  baseUnitsPerGameHour: number,
  conditionBp: Bp,
  skillBp: Bp,
  options: { readonly conditionCurve?: Curve; readonly skill?: SkillFactorConfig } = {},
): number {
  const base = baseUnitsPerGameHour > 0 ? baseUnitsPerGameHour : 0;
  const speed =
    base *
    conditionFactor(conditionBp, options.conditionCurve ?? CONDITION_FACTOR_CURVE) *
    skillFactor(skillBp, options.skill ?? DEFAULT_SKILL_FACTOR_CONFIG);
  return speed > 0 ? speed : 0;
}

/**
 * Duration of a task, in game hours (GDD sections 91 and 135).
 *
 * A unit count of zero gives a duration of zero, which is harmless: an empty
 * target is rejected earlier by the selection rules with `SELECTION_EMPTY`. A non
 * positive speed is rejected, because the catalogue guarantees a positive speed for
 * every operation and the coherence test of shared/config asserts it; a corrupt
 * catalogue must not be turned into an infinite or instantaneous task.
 */
export function taskDurationGameHours(units: number, speedUnitsPerGameHour: number): GameHours {
  if (!(speedUnitsPerGameHour > 0)) {
    throw new RangeError(`The effective work speed must be positive: ${speedUnitsPerGameHour}`);
  }
  const count = units > 0 ? units : 0;
  return gameHours(count / speedUnitsPerGameHour);
}

/**
 * Base work speed of an operation, in units per game hour, resolved from the
 * catalogue: the override of the operation if it declares one, otherwise the speed
 * of the required implement if it has one, otherwise the speed of the powered
 * machine.
 *
 * With the literal catalogue of GDD section 89 this gives 4.2 cells/h for plowing,
 * 5.5 for cultivating, 4.8 for seeding and 3.0 for harvesting, where the pace is
 * set by the combine because the trailer has no speed of its own.
 */
export function baseWorkSpeedForOperation(
  operation: TaskOperation,
  catalogue: Readonly<Record<MachineType, MachineDefinition>> = MACHINE_CATALOGUE,
  requirements: Readonly<Record<TaskOperation, OperationRequirement>> = OPERATION_REQUIREMENTS,
): number {
  const requirement = requirements[operation];
  if (requirement.workSpeedOverrideUnitsPerGameHour !== null) {
    return requirement.workSpeedOverrideUnitsPerGameHour;
  }
  if (requirement.requiredImplement !== null) {
    const implement = catalogue[requirement.requiredImplement];
    if (implement.workSpeedUnitsPerGameHour !== null) {
      return implement.workSpeedUnitsPerGameHour;
    }
  }
  return catalogue[requirement.poweredMachine].workSpeedUnitsPerGameHour ?? 0;
}

/** Everything the interface and the task row need about a duration estimate. */
export interface TaskDurationEstimate {
  readonly units: number;
  readonly baseWorkSpeedUnitsPerGameHour: number;
  readonly conditionFactor: number;
  readonly skillFactor: number;
  readonly effectiveWorkSpeedUnitsPerGameHour: number;
  /**
   * Effective speed in thousandths of a unit per game hour, which is the integer
   * the task row stores as audit (`Task.effectiveWorkSpeedMilli`).
   */
  readonly effectiveWorkSpeedMilli: number;
  readonly durationGameHours: GameHours;
}

/**
 * Duration of an operation over a number of units, resolving the base speed from
 * the catalogue.
 *
 * `conditionBp` is the condition of the machine that sets the pace, which is the
 * implement when there is one: a worn plow slows the work down even behind a new
 * tractor.
 */
export function estimateTaskDuration(
  input: {
    readonly operation: TaskOperation;
    readonly units: number;
    readonly conditionBp: Bp;
    readonly skillBp: Bp;
  },
  options: {
    readonly catalogue?: Readonly<Record<MachineType, MachineDefinition>>;
    readonly requirements?: Readonly<Record<TaskOperation, OperationRequirement>>;
    readonly conditionCurve?: Curve;
    readonly skill?: SkillFactorConfig;
  } = {},
): TaskDurationEstimate {
  const base = baseWorkSpeedForOperation(
    input.operation,
    options.catalogue ?? MACHINE_CATALOGUE,
    options.requirements ?? OPERATION_REQUIREMENTS,
  );
  const condition = conditionFactor(
    input.conditionBp,
    options.conditionCurve ?? CONDITION_FACTOR_CURVE,
  );
  const skill = skillFactor(input.skillBp, options.skill ?? DEFAULT_SKILL_FACTOR_CONFIG);
  const effective = effectiveWorkSpeed(base, input.conditionBp, input.skillBp, {
    ...(options.conditionCurve === undefined ? {} : { conditionCurve: options.conditionCurve }),
    ...(options.skill === undefined ? {} : { skill: options.skill }),
  });
  return {
    units: input.units > 0 ? input.units : 0,
    baseWorkSpeedUnitsPerGameHour: base,
    conditionFactor: condition,
    skillFactor: skill,
    effectiveWorkSpeedUnitsPerGameHour: effective,
    effectiveWorkSpeedMilli: Math.round(effective * 1000),
    durationGameHours: taskDurationGameHours(input.units, effective),
  };
}

/**
 * Duration of a batch felling, in game hours (GDD section 135). Same formula as
 * GDD section 91 with the tree count as the numerator and the 0.8 trees per game
 * hour of the felling head of GDD section 134 as the base speed.
 */
export function fellingDurationGameHours(
  treeCount: number,
  conditionBp: Bp,
  skillBp: Bp,
  options: {
    readonly catalogue?: Readonly<Record<MachineType, MachineDefinition>>;
    readonly requirements?: Readonly<Record<TaskOperation, OperationRequirement>>;
    readonly conditionCurve?: Curve;
    readonly skill?: SkillFactorConfig;
  } = {},
): GameHours {
  return estimateTaskDuration(
    { operation: 'FELL', units: treeCount, conditionBp, skillBp },
    options,
  ).durationGameHours;
}
