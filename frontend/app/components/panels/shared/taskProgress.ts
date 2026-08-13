// Where a task is at an instant: elapsed fraction, time left and how it ended.
//
// Owner: W6-D. Read by the task listing, the assignment panel, the plot inspector and the
// return summary.
//
// It lives in `components/panels/shared/` and not in the directory of one panel because
// four of the five panels of this lot ask the same question, and ADR-0037 left this
// directory foreseen for exactly that case, with a single owner. The closing note of W5
// (`docs/handoff/NOTES-w5-cierre.md`, section 3) confirms it as the route to take when a
// piece is common to several panels of the same lot.
//
// Two properties are the whole point of the module.
//
// The clock is a parameter and never `Date.now`. Game time is an extrapolation from an
// anchor with a rational multiplier (ADR-0007), and a countdown that read the wall clock
// would part company with every other figure of the interface a minute after the
// multiplier changed. It is the same discipline ADR-0045 fixed for the cosmetic movement
// of a machine, and the reason a suite can drive these functions with an injected instant.
//
// A finished task stops where it stopped. `endedGameMs` is the real end and differs from
// the scheduled end precisely when the task was cancelled (GDD section 106, and
// `shared/api/schemas/tasks.ts`), so the bar of a cancelled task must not keep filling
// towards a completion that is not going to happen.
//
// `stores/tasks.ts` answers the same two questions by identifier against the store. These
// take the row, which is what lets the return summary and a test reason about a task that
// is not in the store, and both derive from the same three instants of the contract.

import {
  MS_PER_GAME_HOUR,
  TaskStatus,
  clampBp,
  fromWireGameMs,
  type GameMs,
  type TaskDto,
} from '~/shared/index';

/** Instant a task ends: its real end when it has one, its scheduled end otherwise. */
export function taskEndGameMs(task: TaskDto): GameMs {
  return task.endedGameMs === null
    ? fromWireGameMs(task.scheduledEndGameMs)
    : fromWireGameMs(task.endedGameMs);
}

/** Whether the task is still running, which is the only case that admits cancellation. */
export function isRunning(task: TaskDto): boolean {
  return task.status === TaskStatus.IN_PROGRESS;
}

/**
 * Elapsed fraction of the scheduled duration at an instant, in basis points.
 *
 * The numerator is capped by the end of the task and the denominator is always the
 * scheduled duration, so a cancelled task freezes at the fraction it reached instead of
 * being redrawn as complete.
 */
export function taskProgressBp(task: TaskDto, atGameMs: GameMs): number {
  const start = fromWireGameMs(task.startGameMs);
  const scheduledEnd = fromWireGameMs(task.scheduledEndGameMs);
  const total = scheduledEnd - start;
  if (total <= 0n) {
    return 10_000;
  }
  const end = taskEndGameMs(task);
  const capped = end < atGameMs ? end : atGameMs;
  const elapsed = capped - start;
  if (elapsed <= 0n) {
    return 0;
  }
  return clampBp(Number((elapsed * 10_000n) / total));
}

/**
 * Game milliseconds still to run, or null once the task is no longer in progress.
 *
 * Never negative: a task whose scheduled end has passed while the completion job has not
 * run yet reads zero, which the interface shows as "ahora". Reporting a negative figure
 * would be reporting a fact about the queue and not about the task.
 */
export function taskRemainingGameMs(task: TaskDto, atGameMs: GameMs): bigint | null {
  if (!isRunning(task)) {
    return null;
  }
  const remaining = fromWireGameMs(task.scheduledEndGameMs) - atGameMs;
  return remaining > 0n ? remaining : 0n;
}

/**
 * Game hours the task has actually worked at an instant.
 *
 * It is what the warning of a cancellation is built on: GDD section 106 loses the whole
 * progress and plan section 2.2 still applies the wear of the hours worked, so the player
 * has to be told how many hours are about to be paid for nothing.
 */
export function workedGameHours(task: TaskDto, atGameMs: GameMs): number {
  const start = fromWireGameMs(task.startGameMs);
  const end = taskEndGameMs(task);
  const capped = end < atGameMs ? end : atGameMs;
  const elapsed = capped - start;
  if (elapsed <= 0n) {
    return 0;
  }
  return Number(elapsed) / Number(MS_PER_GAME_HOUR);
}

/** Scheduled duration of the task, in game milliseconds. */
export function scheduledDurationGameMs(task: TaskDto): bigint {
  const total = fromWireGameMs(task.scheduledEndGameMs) - fromWireGameMs(task.startGameMs);
  return total > 0n ? total : 0n;
}

/**
 * Order of the active listing: the task that finishes first, first.
 *
 * Sorted by scheduled end and not by start, because what the player is waiting for is the
 * next thing to happen. Ties break by identifier so that two tasks scheduled for the same
 * instant do not swap places between renders.
 */
export function byNextToFinish(left: TaskDto, right: TaskDto): number {
  const a = fromWireGameMs(left.scheduledEndGameMs);
  const b = fromWireGameMs(right.scheduledEndGameMs);
  if (a !== b) {
    return a < b ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Order of the history: the most recently ended, first. */
export function byMostRecentlyEnded(left: TaskDto, right: TaskDto): number {
  const a = taskEndGameMs(left);
  const b = taskEndGameMs(right);
  if (a !== b) {
    return a > b ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
