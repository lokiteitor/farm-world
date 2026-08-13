// Machinery.
//
// Owner: W3-C.
//
// The machine carries no price, no work speed and no capacity: those are catalogue data
// indexed by type and both sides import the same catalogue (plan section 5.2). What the
// row carries is the condition, what it was actually paid for, and the reservation
// column. There is no `assignedWorkerId`: the authoritative link between a worker and a
// machine is the task, so the pairing is derived from `currentTaskId` and never stored
// twice.

import { defineStore } from 'pinia';
import { computed } from 'vue';
import {
  MACHINE_CATALOGUE,
  MIN_CONDITION_TO_ASSIGN,
  MachineStatus,
  Money,
  OPERATION_REQUIREMENTS,
  bp,
  conditionFactor,
  estimateTaskDuration,
  fromWireMoney,
  type MachineDefinition,
  type MachineDto,
  type MachineType,
  type TaskDurationEstimate,
  type TaskOperation,
} from '~/shared/index';
import { createCollection } from '~/stores/collection';

export const useMachinesStore = defineStore('machines', () => {
  const collection = createCollection<MachineDto>();

  const idle = computed(() =>
    collection.all.value.filter((machine) => machine.status === MachineStatus.IDLE),
  );

  const working = computed(() =>
    collection.all.value.filter((machine) => machine.status === MachineStatus.WORKING),
  );

  /** Maintenance is paid on possession, whatever the machine is doing (GDD section 107). */
  const maintenancePerGameHour = computed(() =>
    Money.sum(
      collection.all.value.map(
        (machine) => MACHINE_CATALOGUE[machine.type].maintenanceCostPerGameHour,
      ),
    ),
  );

  /** Operation is paid on top, and only while working (GDD sections 107 and 114). */
  const operatingPerGameHour = computed(() =>
    Money.sum(
      working.value.map((machine) => MACHINE_CATALOGUE[machine.type].operatingCostPerGameHour),
    ),
  );

  const totalResaleValue = computed(() =>
    Money.sum(collection.all.value.map((machine) => fromWireMoney(machine.resaleValue))),
  );

  function ofFarm(farmId: string): readonly MachineDto[] {
    return collection.all.value.filter((machine) => machine.farmId === farmId);
  }

  function ofType(farmId: string, type: MachineType): readonly MachineDto[] {
    return ofFarm(farmId).filter((machine) => machine.type === type);
  }

  function definitionOf(type: MachineType): MachineDefinition {
    return MACHINE_CATALOGUE[type];
  }

  /**
   * Machines that could take an operation right now: the right type for it, idle, and
   * above the minimum condition. It is the same triple the server checks, computed with
   * the same tables, so the panel disables a choice for the reason the server would
   * refuse it (GDD sections 90 and 104).
   */
  function candidatesFor(
    farmId: string,
    operation: TaskOperation,
  ): {
    readonly powered: readonly MachineDto[];
    readonly implement: readonly MachineDto[];
    readonly requirement: (typeof OPERATION_REQUIREMENTS)[TaskOperation];
  } {
    const requirement = OPERATION_REQUIREMENTS[operation];
    const usable = (machine: MachineDto): boolean =>
      machine.status === MachineStatus.IDLE && machine.assignable;
    return {
      requirement,
      powered: ofType(farmId, requirement.poweredMachine).filter(usable),
      implement:
        requirement.requiredImplement === null
          ? []
          : ofType(farmId, requirement.requiredImplement).filter(usable),
    };
  }

  /** Multiplier the current condition applies to the work speed (GDD section 91). */
  function conditionMultiplier(machineId: string): number {
    const machine = collection.get(machineId);
    return machine === undefined ? 0 : conditionFactor(bp(machine.conditionBp));
  }

  /**
   * Duration and speed a pairing would actually achieve (GDD sections 91 and 135). The
   * skill of the worker and the condition of the pace setting machine both enter, which
   * is what lets the assignment panel preview a duration and a cost before it sends
   * anything, with the same function the server estimates with.
   */
  function estimateFor(input: {
    readonly operation: TaskOperation;
    readonly units: number;
    readonly paceMachineId: string;
    readonly skillBp: number;
  }): TaskDurationEstimate | null {
    const machine = collection.get(input.paceMachineId);
    if (machine === undefined || input.units <= 0) {
      return null;
    }
    return estimateTaskDuration({
      operation: input.operation,
      units: input.units,
      conditionBp: bp(machine.conditionBp),
      skillBp: bp(input.skillBp),
    });
  }

  /**
   * Condition of one machine, from the reply of a cancellation.
   *
   * `cancelTaskResultSchema` reports the condition each machine ended with, prorated over
   * the hours actually worked (GDD section 106), and it is the only authoritative figure
   * the reply carries about the machine: the whole row travels in the `MACHINE_UPSERTED`
   * frame that the same route emits. Patching the one field is the same shape as
   * `balanceAfter` on the player, and it converges with the frame in either order because
   * the frame is a full replacement.
   *
   * `assignable` is recomputed rather than left as it was, because it is a derivation of
   * the condition (`shared/api/schemas/machinery.ts`) and a stale `true` next to a
   * condition below the floor is what a panel would enable a button on.
   */
  function applyCondition(machineId: string, conditionBp: number): void {
    const machine = collection.get(machineId);
    if (machine === undefined) {
      return;
    }
    collection.upsert({
      ...machine,
      conditionBp,
      assignable: conditionBp >= MIN_CONDITION_TO_ASSIGN,
    });
  }

  /** Whether a machine is above the assignment floor (plan section 2.2). */
  function assignable(machineId: string): boolean {
    const machine = collection.get(machineId);
    return machine !== undefined && machine.conditionBp >= MIN_CONDITION_TO_ASSIGN;
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
    idle,
    working,
    maintenancePerGameHour,
    operatingPerGameHour,
    totalResaleValue,
    ofFarm,
    ofType,
    definitionOf,
    candidatesFor,
    conditionMultiplier,
    estimateFor,
    applyCondition,
    assignable,
  };
});
