// Inventory: the fungible stock, per farm and per resource.
//
// Owner: W3-C.
//
// The quantities are integers in the stored unit, litres for wheat and cubic decimetres
// for wood, and the divisor to the display unit travels with the line. The interface
// divides and the server never does, so a rounded figure cannot re-enter a calculation
// (plan section 5.2).
//
// The occupancy that matters includes the reservation. A harvest reserves room in the
// silo when it is assigned so that an overflow is an actionable rejection instead of a
// silent loss at completion time (plan section 5.4), and a silo bar that ignored the
// reservation would tell the player there is room the server has already committed.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  STORAGE_RESOURCE_UNITS,
  type StorageResource,
  type InventoryFarm,
  type InventoryLine,
  type StorageUsage,
} from '~/shared/index';

export const useInventoryStore = defineStore('inventory', () => {
  const byFarmId = ref<Record<string, InventoryFarm>>({});

  const farms = computed<readonly InventoryFarm[]>(() => Object.values(byFarmId.value));

  function lineOf(farmId: string, resource: StorageResource): InventoryLine | undefined {
    return byFarmId.value[farmId]?.lines.find((line) => line.resource === resource);
  }

  function usageOf(farmId: string, resource: StorageResource): StorageUsage | null {
    return lineOf(farmId, resource)?.usage ?? null;
  }

  /** Occupancy in basis points, reservation included (plan section 5.4). */
  function occupancyBp(farmId: string, resource: StorageResource): number {
    return usageOf(farmId, resource)?.occupancyBp ?? 0;
  }

  /** Room a harvest or a felling could still claim, in the stored unit. */
  function freeUnits(farmId: string, resource: StorageResource): number {
    const usage = usageOf(farmId, resource);
    if (usage === null) {
      return 0;
    }
    const free = usage.capacityUnits - usage.storedUnits - usage.reservedUnits;
    return free > 0 ? free : 0;
  }

  /** Stored quantity in the display unit, with the divisor of the catalogue. */
  function storedForDisplay(farmId: string, resource: StorageResource): number {
    const line = lineOf(farmId, resource);
    if (line === undefined) {
      return 0;
    }
    return line.usage.storedUnits / line.displayDivisor;
  }

  /** Label of the display unit, so a panel does not hard code "m3" or "L". */
  function displayUnit(resource: StorageResource): string {
    return STORAGE_RESOURCE_UNITS[resource].displayUnit;
  }

  /** Total stored of one resource over every farm, in the stored unit. */
  function totalStoredUnits(resource: StorageResource): number {
    return farms.value.reduce((total, farm) => {
      const line = farm.lines.find((candidate) => candidate.resource === resource);
      return total + (line?.usage.storedUnits ?? 0);
    }, 0);
  }

  /** Worst occupancy over every farm, which is what the top bar shows for the silo. */
  const worstOccupancyBp = computed<Readonly<Record<StorageResource, number>>>(() => {
    const worst: Record<StorageResource, number> = { WHEAT_LITERS: 0, WOOD_M3: 0 };
    for (const farm of farms.value) {
      for (const line of farm.lines) {
        if (line.usage.occupancyBp > worst[line.resource]) {
          worst[line.resource] = line.usage.occupancyBp;
        }
      }
    }
    return worst;
  });

  function applyInventoryFarms(next: readonly InventoryFarm[]): void {
    for (const farm of next) {
      byFarmId.value[farm.farmId] = farm;
    }
  }

  function replaceAll(next: readonly InventoryFarm[]): void {
    const map: Record<string, InventoryFarm> = {};
    for (const farm of next) {
      map[farm.farmId] = farm;
    }
    byFarmId.value = map;
  }

  function reset(): void {
    byFarmId.value = {};
  }

  return {
    byFarmId,
    farms,
    worstOccupancyBp,
    lineOf,
    usageOf,
    occupancyBp,
    freeUnits,
    storedForDisplay,
    displayUnit,
    totalStoredUnits,
    applyInventoryFarms,
    replaceAll,
    reset,
  };
});
