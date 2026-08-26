// Farms: the bookkeeping unit and the aggregated stock.
//
// Owner: W3-C.
//
// A farm holds the fungible stock and the buildings hold the counted capacity, which is
// the asymmetry of plan section 5.4: what a farm stores has no individual identity and is
// aggregated per farm, while a machine and a worker do have one and their capacity is
// checked per building. Both readings arrive in the same reply, so the store keeps the
// aggregate the server sent rather than recomputing it from the buildings: recomputing
// would produce a second answer to a question the server already answered, and the two
// would disagree the moment a reservation is in flight.

import { defineStore } from 'pinia';
import { computed } from 'vue';
import { STORAGE_RESOURCE_UNITS, type FarmDto, type StorageResource } from '~/shared/index';
import { createCollection } from '~/stores/collection';

export const useFarmsStore = defineStore('farms', () => {
  const collection = createCollection<FarmDto>();

  /** The farm a panel defaults to: the first one, in creation order. */
  const primary = computed<FarmDto | null>(() => {
    const sorted = [...collection.all.value].sort((left, right) =>
      left.createdAtGameMs.length === right.createdAtGameMs.length
        ? left.createdAtGameMs.localeCompare(right.createdAtGameMs)
        : left.createdAtGameMs.length - right.createdAtGameMs.length,
    );
    return sorted[0] ?? null;
  });

  const hasWorkshop = computed(() => collection.all.value.some((farm) => farm.hasWorkshop));

  /** Free garage places over the whole holding (GDD section 96). */
  const freeMachineSlots = computed(() =>
    collection.all.value.reduce(
      (total, farm) => total + (farm.machineSlots.total - farm.machineSlots.used),
      0,
    ),
  );

  /** Free worker home places over the whole holding (GDD section 108). */
  const freeWorkerSlots = computed(() =>
    collection.all.value.reduce(
      (total, farm) => total + (farm.workerSlots.total - farm.workerSlots.used),
      0,
    ),
  );

  /** Occupancy of one store of one farm, in basis points, reservation included. */
  function occupancyBp(farmId: string, resource: StorageResource): number {
    const farm = collection.get(farmId);
    if (farm === undefined) {
      return 0;
    }
    return farm.storage.find((row) => row.category === resource)?.usage.occupancyBp ?? 0;
  }

  /**
   * Garage occupancy of a farm, as the machinery replies report it.
   *
   * `garageSlotsUsed` and `garageSlotsTotal` of the purchase and of the sale are the
   * aggregate over the live garages of one farm (`modules/machinery/service.ts`,
   * `garageSlotsOf`), which is exactly what `machineSlots` of this row means, so the two
   * are the same reading and applying one over the other is a replacement and never a
   * delta. Without this the counter would only reach the client through the
   * `BUILDING_UPSERTED` frame, and a client with no live socket would keep offering a
   * garage that a sale has already emptied (docs/handoff/NOTES-w5f.md, section 3.4).
   *
   * There is deliberately no counterpart for the worker homes: `homeSlotsUsed` of the
   * hire and of the dismissal is the aggregate over the whole holding and not over one
   * farm (`modules/workers/service.ts`, `homeSlots`), so it is kept where its scope is
   * true, in the workers store.
   */
  function applyMachineSlots(farmId: string, used: number, total: number): void {
    const farm = collection.get(farmId);
    if (farm === undefined) {
      return;
    }
    collection.upsert({ ...farm, machineSlots: { used, total } });
  }

  /**
   * Stored quantity in the unit the interface shows. The server never divides, so that a
   * rounded figure cannot re-enter a calculation; the divisor travels in the catalogue
   * and the division happens here (plan section 5.2).
   */
  function storedForDisplay(farmId: string, resource: StorageResource): number {
    const farm = collection.get(farmId);
    if (farm === undefined) {
      return 0;
    }
    const units = farm.storage.find((row) => row.category === resource)?.usage.storedUnits ?? 0;
    return units / STORAGE_RESOURCE_UNITS[resource].displayDivisor;
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
    primary,
    hasWorkshop,
    freeMachineSlots,
    freeWorkerSlots,
    occupancyBp,
    applyMachineSlots,
    storedForDisplay,
  };
});
