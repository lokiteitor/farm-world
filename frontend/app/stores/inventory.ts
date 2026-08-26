// Inventory: the fungible stock, per farm, per category and per pile.
//
// Owner: W3-C.
//
// Two levels, because the domain has two. Capacity belongs to the storage category, which
// is what a building grants, so that is what the meters draw; value belongs to the crop, so
// the sellable lines are piles of one crop each. The quantities are integers in the stored
// unit, litres for every crop and cubic decimetres for wood, and the divisor to the display
// unit travels with the line. The interface
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
  type InventoryCategory,
  type InventoryFarm,
  type InventoryLine,
  type StockItem,
  type StorageResource,
  type StorageUsage,
} from '~/shared/index';

export const useInventoryStore = defineStore('inventory', () => {
  const byFarmId = ref<Record<string, InventoryFarm>>({});

  const farms = computed<readonly InventoryFarm[]>(() => Object.values(byFarmId.value));

  /** The meter of one category on one farm: capacity and what is in it. */
  function categoryOf(farmId: string, category: StorageResource): InventoryCategory | undefined {
    return byFarmId.value[farmId]?.categories.find((row) => row.category === category);
  }

  /** The pile of one crop on one farm, or undefined when the farm holds none of it. */
  function lineOf(farmId: string, item: StockItem): InventoryLine | undefined {
    return byFarmId.value[farmId]?.lines.find((line) => line.item === item);
  }

  /** Every pile of a farm that holds something, in the order the server sent them. */
  function linesOf(farmId: string): readonly InventoryLine[] {
    return byFarmId.value[farmId]?.lines ?? [];
  }

  function usageOf(farmId: string, category: StorageResource): StorageUsage | null {
    return categoryOf(farmId, category)?.usage ?? null;
  }

  /** Occupancy in basis points, reservation included (plan section 5.4). */
  function occupancyBp(farmId: string, category: StorageResource): number {
    return usageOf(farmId, category)?.occupancyBp ?? 0;
  }

  /** Room a harvest or a felling could still claim, in the stored unit. */
  function freeUnits(farmId: string, category: StorageResource): number {
    const usage = usageOf(farmId, category);
    if (usage === null) {
      return 0;
    }
    const free = usage.capacityUnits - usage.storedUnits - usage.reservedUnits;
    return free > 0 ? free : 0;
  }

  /** Stock of one pile in the display unit, with the divisor of the catalogue. */
  function storedForDisplay(farmId: string, item: StockItem): number {
    const line = lineOf(farmId, item);
    if (line === undefined) {
      return 0;
    }
    return line.storedUnits / line.displayDivisor;
  }

  /** Label of the display unit, so a panel does not hard code "m3" or "L". */
  function displayUnit(category: StorageResource): string {
    return STORAGE_RESOURCE_UNITS[category].displayUnit;
  }

  /** Total stored of one pile over every farm, in the stored unit. */
  function totalStoredUnits(item: StockItem): number {
    return farms.value.reduce((total, farm) => {
      const line = farm.lines.find((candidate) => candidate.item === item);
      return total + (line?.storedUnits ?? 0);
    }, 0);
  }

  /**
   * Worst occupancy over every farm and category, which is what the top bar shows.
   *
   * One meter and not one per category: with five categories a bar each would be five bars
   * that are almost always empty, and what the player has to know at a glance is whether
   * anything is about to overflow.
   */
  const worstOccupancy = computed<{ category: StorageResource; occupancyBp: number } | null>(() => {
    let worst: { category: StorageResource; occupancyBp: number } | null = null;
    for (const farm of farms.value) {
      for (const row of farm.categories) {
        if (row.usage.capacityUnits <= 0) {
          continue;
        }
        if (worst === null || row.usage.occupancyBp > worst.occupancyBp) {
          worst = { category: row.category, occupancyBp: row.usage.occupancyBp };
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
    worstOccupancy,
    categoryOf,
    lineOf,
    linesOf,
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
