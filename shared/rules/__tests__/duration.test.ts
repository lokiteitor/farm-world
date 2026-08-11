import { describe, expect, it } from 'vitest';
import { MACHINE_CATALOGUE } from '../../config/machines.js';
import { SKILL_CAP_BP } from '../../config/workers.js';
import { BP_ONE, BP_ZERO, bp } from '../../domain/units.js';
import {
  baseWorkSpeedForOperation,
  conditionFactor,
  effectiveWorkSpeed,
  estimateTaskDuration,
  fellingDurationGameHours,
  skillFactor,
  taskDurationGameHours,
} from '../duration.js';
import { skillAfterTask, skillAfterTasks } from '../skill.js';

// Durations of GDD sections 91 and 135, the skill factor of GDD section 103 and the
// progression of GDD sections 105 and 110.

describe('skillFactor (GDD section 103)', () => {
  it('reproduces the three published points', () => {
    expect(skillFactor(BP_ZERO)).toBe(0.5);
    expect(skillFactor(bp(5_000))).toBe(0.75);
    expect(skillFactor(BP_ONE)).toBe(1);
  });

  it('never reaches zero, which is the design decision of GDD section 103', () => {
    expect(skillFactor(BP_ZERO)).toBeGreaterThan(0);
  });

  it('is the 0.85 that the durations of GDD section 118 imply at 70 % skill', () => {
    expect(skillFactor(bp(7_000))).toBeCloseTo(0.85, 12);
  });
});

describe('conditionFactor (GDD section 91)', () => {
  it('reads the node table and not a formula', () => {
    expect(conditionFactor(BP_ONE)).toBe(1);
    expect(conditionFactor(bp(5_000))).toBe(0.75);
    expect(conditionFactor(bp(1_000))).toBe(0.4);
    expect(conditionFactor(BP_ZERO)).toBe(0.2);
  });
});

describe('baseWorkSpeedForOperation', () => {
  it('resolves the speed from the implement when the implement sets the pace', () => {
    // GDD section 89: the tractor has no speed of its own, the implement does.
    expect(baseWorkSpeedForOperation('PLOW')).toBe(4.2);
    expect(baseWorkSpeedForOperation('CULTIVATE')).toBe(5.5);
    expect(baseWorkSpeedForOperation('SEED')).toBe(4.8);
  });

  it('resolves the speed from the powered machine when the implement is passive', () => {
    // The trailer has no speed, so the combine sets the pace (GDD sections 89 and 90).
    expect(MACHINE_CATALOGUE.TRAILER.workSpeedUnitsPerGameHour).toBeNull();
    expect(baseWorkSpeedForOperation('HARVEST')).toBe(3);
    expect(baseWorkSpeedForOperation('FELL')).toBe(0.8);
  });

  it('uses the override where the GDD publishes no speed at all', () => {
    // Invented values, justified in the catalogue: GDD section 137 requires forestry
    // machinery to replant without giving a speed, and GDD section 10 requires clearing
    // to cost machinery without saying which.
    expect(baseWorkSpeedForOperation('REPLANT')).toBe(6);
    expect(baseWorkSpeedForOperation('CLEAR_LAND')).toBe(2);
  });

  it('resolves a positive speed for every operation of the table', () => {
    for (const operation of [
      'PLOW',
      'CULTIVATE',
      'SEED',
      'HARVEST',
      'FELL',
      'REPLANT',
      'CLEAR_LAND',
    ] as const) {
      expect(baseWorkSpeedForOperation(operation)).toBeGreaterThan(0);
    }
  });
});

describe('taskDurationGameHours (GDD section 91)', () => {
  it('reproduces the four durations of GDD section 118 on 250 cells', () => {
    const at = (operation: 'PLOW' | 'SEED' | 'HARVEST'): number =>
      estimateTaskDuration({
        operation,
        units: 250,
        conditionBp: BP_ONE,
        skillBp: bp(7_000),
      }).durationGameHours;
    expect(at('PLOW')).toBeCloseTo(70.028, 3);
    expect(at('SEED')).toBeCloseTo(61.2745, 4);
    expect(at('HARVEST')).toBeCloseTo(98.0392, 4);
  });

  it('is inversely proportional to the effective speed', () => {
    expect(taskDurationGameHours(250, 2.5)).toBe(100);
    expect(taskDurationGameHours(500, 2.5)).toBe(200);
    expect(taskDurationGameHours(0, 2.5)).toBe(0);
    expect(taskDurationGameHours(-10, 2.5)).toBe(0);
  });

  it('rejects a non positive speed instead of producing an infinite task', () => {
    expect(() => taskDurationGameHours(250, 0)).toThrow(RangeError);
    expect(() => taskDurationGameHours(250, -1)).toThrow(RangeError);
  });

  it('multiplies the two factors, so a worn machine with a poor operator compounds', () => {
    const base = 4.2;
    // 4.2 x 0.4 x 0.5 = 0.84 cells per game hour, five times slower than new and expert.
    expect(effectiveWorkSpeed(base, bp(1_000), BP_ZERO)).toBeCloseTo(0.84, 12);
    expect(effectiveWorkSpeed(base, BP_ONE, BP_ONE)).toBeCloseTo(4.2, 12);
    // A negative base speed yields zero rather than a negative duration.
    expect(effectiveWorkSpeed(-1, BP_ONE, BP_ONE)).toBe(0);
  });

  it('records the effective speed as an integer for the audit column of the task', () => {
    const estimate = estimateTaskDuration({
      operation: 'PLOW',
      units: 250,
      conditionBp: BP_ONE,
      skillBp: bp(7_000),
    });
    expect(estimate.effectiveWorkSpeedUnitsPerGameHour).toBeCloseTo(3.57, 12);
    expect(estimate.effectiveWorkSpeedMilli).toBe(3570);
  });

  it('accepts injected configuration so a test can fix the factors', () => {
    const estimate = estimateTaskDuration(
      { operation: 'PLOW', units: 100, conditionBp: BP_ONE, skillBp: BP_ZERO },
      { conditionCurve: [[0, 1]], skill: { base: 1, span: 0 } },
    );
    // With both factors pinned at 1 the duration is the raw catalogue speed.
    expect(estimate.durationGameHours).toBeCloseTo(100 / 4.2, 12);
  });
});

describe('fellingDurationGameHours (GDD section 135)', () => {
  it('uses the tree count and the 0.8 trees per hour of the felling head', () => {
    // 250 trees / (0.8 x 1.0 x 0.85) = 367.65 game hours, which is why a clear cut of a
    // whole plot is a much longer commitment than a harvest of the same area.
    expect(fellingDurationGameHours(250, BP_ONE, bp(7_000))).toBeCloseTo(367.6471, 4);
    expect(fellingDurationGameHours(1, BP_ONE, BP_ONE)).toBeCloseTo(1.25, 12);
    expect(fellingDurationGameHours(0, BP_ONE, BP_ONE)).toBe(0);
  });
});

describe('skill progression (GDD sections 103, 105 and 110)', () => {
  it('adds one point per completed task, as the example of GDD section 110 shows', () => {
    expect(skillAfterTask(bp(7_000))).toBe(7_100);
  });

  it('stops at the ceiling and never lowers a skill above it', () => {
    expect(skillAfterTask(bp(9_450))).toBe(SKILL_CAP_BP);
    expect(skillAfterTask(SKILL_CAP_BP)).toBe(SKILL_CAP_BP);
    expect(skillAfterTask(bp(9_800))).toBe(9_800);
  });

  it('projects several tasks at once for the balance calculator', () => {
    expect(skillAfterTasks(bp(7_000), 5)).toBe(7_500);
    expect(skillAfterTasks(bp(7_000), 0)).toBe(7_000);
    expect(skillAfterTasks(bp(7_000), 1_000)).toBe(SKILL_CAP_BP);
    expect(skillAfterTasks(bp(7_000), -3)).toBe(7_000);
  });
});
