// Worker skill progression.
//
// Owner: workflow W2 (pure rules).
//
// GDD section 103 recommends skill progression for the MVP, GDD section 105 places
// the increment at the completion of a task, and the narrative example of GDD
// section 110 shows a worker going from 70 % to 71 %, which fixes the increment at
// one point. The ceiling is what GDD section 103 asks for so that retaining staff
// pays off without a worker ever becoming perfect.

import { SKILL_CAP_BP, SKILL_GAIN_PER_TASK_BP } from '../config/workers.js';
import { clampBp, type Bp } from '../domain/units.js';

/** Parameters of the progression, injected so the tests can fix them. */
export interface SkillProgressionConfig {
  readonly gainPerTaskBp: Bp;
  readonly capBp: Bp;
}

export const DEFAULT_SKILL_PROGRESSION: SkillProgressionConfig = {
  gainPerTaskBp: SKILL_GAIN_PER_TASK_BP,
  capBp: SKILL_CAP_BP,
};

/**
 * Skill after completing one task (GDD sections 103, 105 and 110).
 *
 * A worker already at or above the ceiling keeps the skill unchanged rather than
 * being pulled down to it: the ceiling bounds progression, and lowering a skill the
 * player never lost would be a silent penalty.
 */
export function skillAfterTask(
  skillBp: Bp,
  config: SkillProgressionConfig = DEFAULT_SKILL_PROGRESSION,
): Bp {
  if (skillBp >= config.capBp) {
    return skillBp;
  }
  const next = skillBp + config.gainPerTaskBp;
  return clampBp(next > config.capBp ? config.capBp : next);
}

/**
 * Skill after a number of completed tasks. Equivalent to applying
 * `skillAfterTask` that many times, and used by the balance calculator, which
 * projects several cycles without materialising each task.
 */
export function skillAfterTasks(
  skillBp: Bp,
  completedTasks: number,
  config: SkillProgressionConfig = DEFAULT_SKILL_PROGRESSION,
): Bp {
  const tasks = completedTasks > 0 ? Math.floor(completedTasks) : 0;
  if (skillBp >= config.capBp) {
    return skillBp;
  }
  const next = skillBp + config.gainPerTaskBp * tasks;
  return clampBp(next > config.capBp ? config.capBp : next);
}
