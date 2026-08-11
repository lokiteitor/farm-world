// Tasks.
//
// Owner: W3-C.
//
// The task is the authoritative link between a worker and machinery (plan section 5.2),
// which makes this store the place where "who is doing what" is answered, and it answers
// it by index rather than by scanning: a panel that lists twenty fields would otherwise
// walk the task list twenty times per render.
//
// Progress is derived from the clock and not read from the row. `progressBp` travels on
// the reply and is correct at the instant of the reply only; a countdown that showed it
// would freeze between replies, and plan section 7 is explicit that no counter asks the
// server for the time.

import { defineStore } from 'pinia';
import { computed } from 'vue';
import {
  TaskStatus,
  clampBp,
  fromWireGameMs,
  type GameMs,
  type TaskDto,
  type TaskOperation,
} from '~/shared/index';
import { createCollection } from '~/stores/collection';

export const useTasksStore = defineStore('tasks', () => {
  const collection = createCollection<TaskDto>();

  const active = computed(() =>
    collection.all.value.filter((task) => task.status === TaskStatus.IN_PROGRESS),
  );

  const finished = computed(() =>
    collection.all.value.filter((task) => task.status !== TaskStatus.IN_PROGRESS),
  );

  /** Active task of each field, so a field panel needs no scan. */
  const activeByFieldId = computed<Readonly<Record<string, TaskDto>>>(() => {
    const index: Record<string, TaskDto> = {};
    for (const task of active.value) {
      if (task.targetFieldId !== null) {
        index[task.targetFieldId] = task;
      }
    }
    return index;
  });

  /** Active task of each forest plot. */
  const activeByForestPlotId = computed<Readonly<Record<string, TaskDto>>>(() => {
    const index: Record<string, TaskDto> = {};
    for (const task of active.value) {
      if (task.targetForestPlotId !== null) {
        index[task.targetForestPlotId] = task;
      }
    }
    return index;
  });

  /** Active task of each worker and of each machine. */
  const activeByWorkerId = computed<Readonly<Record<string, TaskDto>>>(() => {
    const index: Record<string, TaskDto> = {};
    for (const task of active.value) {
      index[task.workerId] = task;
    }
    return index;
  });

  const activeByMachineId = computed<Readonly<Record<string, TaskDto>>>(() => {
    const index: Record<string, TaskDto> = {};
    for (const task of active.value) {
      for (const machineId of task.machineIds) {
        index[machineId] = task;
      }
    }
    return index;
  });

  function ofOperation(operation: TaskOperation): readonly TaskDto[] {
    return collection.all.value.filter((task) => task.operation === operation);
  }

  /**
   * Elapsed fraction of the scheduled duration at a game instant, in basis points.
   *
   * A completed or cancelled task reports its real end, which is why the numerator uses
   * `endedGameMs` when it is set: a cancelled task must not keep filling its bar.
   */
  function progressBpAt(taskId: string, atGameMs: GameMs): number {
    const task = collection.get(taskId);
    if (task === undefined) {
      return 0;
    }
    const start = fromWireGameMs(task.startGameMs);
    const scheduledEnd = fromWireGameMs(task.scheduledEndGameMs);
    const total = scheduledEnd - start;
    if (total <= 0n) {
      return 10_000;
    }
    const end = task.endedGameMs === null ? atGameMs : fromWireGameMs(task.endedGameMs);
    const elapsed = (end < atGameMs ? end : atGameMs) - start;
    if (elapsed <= 0n) {
      return 0;
    }
    return clampBp(Number((elapsed * 10_000n) / total));
  }

  /** Game milliseconds left, or null once the task has ended. */
  function remainingGameMs(taskId: string, atGameMs: GameMs): bigint | null {
    const task = collection.get(taskId);
    if (task === undefined || task.status !== TaskStatus.IN_PROGRESS) {
      return null;
    }
    const remaining = fromWireGameMs(task.scheduledEndGameMs) - atGameMs;
    return remaining > 0n ? remaining : 0n;
  }

  return {
    byId: collection.byId,
    all: collection.all,
    count: collection.count,
    get: collection.get,
    upsert: collection.upsert,
    upsertMany: collection.upsertMany,
    remove: collection.remove,
    replaceAll: collection.replaceAll,
    reset: collection.clear,
    active,
    finished,
    activeByFieldId,
    activeByForestPlotId,
    activeByWorkerId,
    activeByMachineId,
    ofOperation,
    progressBpAt,
    remainingGameMs,
  };
});
