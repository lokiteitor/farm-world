// How a worker is named, described and judged in the interface.
//
// Owner: W5-F. Read by the payroll panel, by the hiring pool and by any other panel that
// shows a worker; `docs/handoff/NOTES-w4f.md`, section 2.4, records that the building
// inspector prints the raw enum identifier of `WorkerStatus` because no table of Spanish
// labels existed. This is that table, placed beside the payroll for the same reason the
// building one sits beside the farm panel (ADR-0037).
//
// Two figures deserve a note. The skill factor is derived here with `skillFactor` of
// `shared/rules/skill.ts` even though it also travels on the row: a preview of "what would
// this candidate bring" needs the function and not the last answer the server gave, and the
// suite checks that the two agree. And the wage is a rate and never a transaction: hiring
// and firing move no money (`shared/api/schemas/workers.ts`), so what the player is deciding
// about is the burn rate of GDD section 107.

import {
  SKILL_CAP_BP,
  ValidationCode,
  WorkerStatus,
  bp,
  skillAfterTask,
  skillFactor,
  type Bp,
  type WorkerDto,
} from '~/shared/index';

/** Tone vocabulary of the shell components, so a panel never invents a colour. */
export type StatusTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'info';

/**
 * Worker status (GDD sections 35 and 101).
 *
 * Only `IDLE` and `WORKING` are produced by the MVP; the other four are reserved by GDD
 * sections 35, 101 and 112 and are named anyway, because a state the interface cannot
 * express is a state that would be shown as a raw identifier the day something writes it.
 */
export const WORKER_STATUS_LABELS: Readonly<Record<WorkerStatus, string>> = {
  IDLE: 'Ocioso',
  WORKING: 'Trabajando',
  TRAVELING: 'En desplazamiento',
  UNAVAILABLE: 'No disponible',
  RESTING: 'Descansando',
  INJURED: 'Lesionado',
};

export const WORKER_STATUS_TONES: Readonly<Record<WorkerStatus, StatusTone>> = {
  IDLE: 'neutral',
  WORKING: 'accent',
  TRAVELING: 'info',
  UNAVAILABLE: 'warning',
  RESTING: 'info',
  INJURED: 'danger',
};

export function labelOfWorkerStatus(status: WorkerStatus): string {
  return WORKER_STATUS_LABELS[status];
}

export function toneOfWorkerStatus(status: WorkerStatus): StatusTone {
  return WORKER_STATUS_TONES[status];
}

/** `skillFactor` of GDD section 103, derived from the skill and never from a literal. */
export function derivedSkillFactor(skillBp: number): number {
  return skillFactor(bp(skillBp));
}

/**
 * The factor as the interface writes it: `x0.85`.
 *
 * Two decimals because that is the resolution at which the factor changes the duration of a
 * task by something the player can read on a countdown.
 */
export function formatSkillFactor(value: number): string {
  return `x${value.toFixed(2)}`;
}

/** Skill the worker would reach after one more completed task (GDD sections 103 and 105). */
export function skillAfterNextTask(skillBp: number): Bp {
  return skillAfterTask(bp(skillBp));
}

/** Whether the worker has reached the progression ceiling of GDD section 103. */
export function isAtSkillCap(skillBp: number): boolean {
  return skillBp >= SKILL_CAP_BP;
}

/**
 * Housing occupancy counted over the payroll rather than read off the counter of the
 * building.
 *
 * Same reasoning as `garageOccupancy` of the machinery panel: hiring and dismissal carry the
 * worker in the result of the mutation and the building only in the `BUILDING_UPSERTED`
 * frame (`shared/api/routes.ts`), so a client whose socket is not live would keep a full
 * home after a dismissal and refuse the hire the server would accept. `homeId` is mandatory
 * on a worker (GDD section 108), which is precisely the fact the counter counts.
 */
export function homeOccupancy(
  homes: readonly { readonly id: string; readonly capacity: number }[],
  workersOfFarm: readonly WorkerDto[],
): { readonly used: number; readonly total: number; readonly free: number } {
  const ids = new Set(homes.map((home) => home.id));
  const used = workersOfFarm.filter((worker) => ids.has(worker.homeId)).length;
  const total = homes.reduce((sum, home) => sum + home.capacity, 0);
  const free = total - used;
  return { used, total, free: free > 0 ? free : 0 };
}

/**
 * Why a worker cannot be dismissed, or null when the dismissal would be accepted.
 *
 * GDD section 109 admits exactly one refusal and the server checks exactly that
 * (`backend/src/modules/workers/service.ts`): a worker in the middle of a task stays. The
 * reservation column is read as well as the status, because they are the same fact seen
 * from two places and the server refuses on either.
 */
export function fireBlockingCode(worker: WorkerDto): ValidationCode | null {
  if (worker.status !== WorkerStatus.IDLE || worker.currentTaskId !== null) {
    return ValidationCode.WORKER_NOT_IDLE;
  }
  return null;
}
