// The payroll.
//
// Owner: W3-C.
//
// A wage is a continuous accrual and not a transaction (shared/api/schemas/workers.ts),
// so nothing here moves money: what the store exposes is the rate, because the rate is
// what the player is deciding about when hiring. `skillFactor` travels on the row and is
// also derived locally, for the same reason as everywhere else in this layer: a preview
// of "what if I hired this candidate" needs the function and not the last answer.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  Money,
  WorkerStatus,
  bp,
  fromWireMoney,
  skillAfterTask,
  skillFactor,
  type SlotUsage,
  type WorkerDto,
} from '~/shared/index';
import { createCollection } from '~/stores/collection';

export const useWorkersStore = defineStore('workers', () => {
  const collection = createCollection<WorkerDto>();

  /**
   * Home places over the whole holding, as the hire and the dismissal report them.
   *
   * It lives here and not on the farm because that is the scope the server gives it:
   * `homeSlotsUsed` and `homeSlotsTotal` aggregate every live worker home of the player
   * and not those of one farm, and the header of `modules/workers/service.ts` says so
   * explicitly, precisely so that a client does not read it as a farm figure. Null until
   * a reply has carried it; `GET /api/farms` is where the per farm reading comes from.
   */
  const homeSlots = ref<SlotUsage | null>(null);

  const idle = computed(() =>
    collection.all.value.filter((worker) => worker.status === WorkerStatus.IDLE),
  );

  const busy = computed(() =>
    collection.all.value.filter((worker) => worker.status === WorkerStatus.WORKING),
  );

  /** Sum of the wages per game hour of the whole payroll (GDD section 107). */
  const totalSalaryPerGameHour = computed(() =>
    Money.sum(collection.all.value.map((worker) => fromWireMoney(worker.salaryPerGameHour))),
  );

  const headcount = computed(() => collection.count.value);

  /** Free home places over the holding, or null while no reply has reported them. */
  const freeHomeSlots = computed(() =>
    homeSlots.value === null ? null : homeSlots.value.total - homeSlots.value.used,
  );

  function ofFarm(farmId: string): readonly WorkerDto[] {
    return collection.all.value.filter((worker) => worker.farmId === farmId);
  }

  function ofHome(homeId: string): readonly WorkerDto[] {
    return collection.all.value.filter((worker) => worker.homeId === homeId);
  }

  /** Idle workers of a farm, the ones a task can be assigned to (GDD section 104). */
  function assignable(farmId: string): readonly WorkerDto[] {
    return ofFarm(farmId).filter((worker) => worker.status === WorkerStatus.IDLE);
  }

  /** Duration multiplier the skill of a worker applies (GDD section 103). */
  function factorOf(workerId: string): number {
    const worker = collection.get(workerId);
    return worker === undefined ? 0 : skillFactor(bp(worker.skillBp));
  }

  /** Skill the worker would reach after one more completed task (GDD section 103). */
  function skillAfterNextTask(workerId: string): number {
    const worker = collection.get(workerId);
    return worker === undefined ? 0 : skillAfterTask(bp(worker.skillBp));
  }

  function applyHomeSlots(used: number, total: number): void {
    homeSlots.value = { used, total };
  }

  function reset(): void {
    collection.clear();
    homeSlots.value = null;
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
    reset,
    idle,
    busy,
    totalSalaryPerGameHour,
    headcount,
    homeSlots,
    freeHomeSlots,
    ofFarm,
    ofHome,
    assignable,
    factorOf,
    skillAfterNextTask,
    applyHomeSlots,
  };
});
