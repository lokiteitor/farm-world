// Buildings: the counted capacity, per building.
//
// Owner: W3-C.
//
// The free places are a getter and not a field, and they are computed per building
// rather than per farm, because that is where the server checks them: the counter and
// its `CHECK` live on the building row (plan section 5.4). A panel that greys out the
// buy button has to grey it out for the same reason the server would refuse, and
// aggregating first and comparing afterwards loses exactly the case that matters, a
// holding with room in total and no room in any single garage.

import { defineStore } from 'pinia';
import { computed } from 'vue';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  type BuildingDefinition,
  type BuildingDto,
} from '~/shared/index';
import { createCollection } from '~/stores/collection';

/** A building with room left, which is what a placement or a purchase needs. */
export interface BuildingSlot {
  readonly building: BuildingDto;
  readonly free: number;
}

export const useBuildingsStore = defineStore('buildings', () => {
  const collection = createCollection<BuildingDto>();

  const byFarm = computed<Readonly<Record<string, readonly BuildingDto[]>>>(() => {
    const grouped: Record<string, BuildingDto[]> = {};
    for (const building of collection.all.value) {
      (grouped[building.farmId] ??= []).push(building);
    }
    return grouped;
  });

  function ofFarm(farmId: string): readonly BuildingDto[] {
    return byFarm.value[farmId] ?? [];
  }

  function ofType(farmId: string, type: BuildingType): readonly BuildingDto[] {
    return ofFarm(farmId).filter((building) => building.type === type);
  }

  /** Buildings of a type with room left, most free first. */
  function slotsOfType(farmId: string, type: BuildingType): readonly BuildingSlot[] {
    return ofType(farmId, type)
      .map((building) => ({ building, free: building.capacity - building.occupancy }))
      .filter((slot) => slot.free > 0)
      .sort((left, right) => right.free - left.free);
  }

  /** Free garage places of a farm (GDD section 96). */
  function freeGarageSlots(farmId: string): number {
    return slotsOfType(farmId, BuildingType.GARAGE).reduce((total, slot) => total + slot.free, 0);
  }

  /** Free worker home places of a farm (GDD section 108). */
  function freeHomeSlots(farmId: string): number {
    return slotsOfType(farmId, BuildingType.WORKER_HOME).reduce(
      (total, slot) => total + slot.free,
      0,
    );
  }

  /** The garage a purchase would go to when the player names none. */
  function defaultGarage(farmId: string): BuildingDto | null {
    return slotsOfType(farmId, BuildingType.GARAGE)[0]?.building ?? null;
  }

  /** The home a hire would go to when the player names none. */
  function defaultHome(farmId: string): BuildingDto | null {
    return slotsOfType(farmId, BuildingType.WORKER_HOME)[0]?.building ?? null;
  }

  /** Whether the farm has a workshop, which repair requires (GDD sections 29 and 93). */
  function hasWorkshop(farmId: string): boolean {
    return ofType(farmId, BuildingType.WORKSHOP).length > 0;
  }

  /** Catalogue entry of a type: footprint, price and capacity (GDD sections 116, 136). */
  function definitionOf(type: BuildingType): BuildingDefinition {
    return BUILDING_CATALOGUE[type];
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
    byFarm,
    ofFarm,
    ofType,
    slotsOfType,
    freeGarageSlots,
    freeHomeSlots,
    defaultGarage,
    defaultHome,
    hasWorkshop,
    definitionOf,
  };
});
