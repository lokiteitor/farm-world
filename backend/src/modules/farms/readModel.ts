// The read models of the `farms` area.
//
// Owner: workflow W4-B. Module `farms`.
//
// One builder per entity of the contract, used by the four routes and by the frames they
// emit alike. That is not tidiness: ADR-0006 makes every entity of a mutating reply a
// complete replacement rather than a delta, so the reply of `POST /api/farms/:id/buildings`
// and the `BUILDING_UPSERTED` frame it produces have to be the same object, or the client
// would converge to a different state depending on which arrived first.
//
// Two readings live side by side in `FarmDto`, and the difference matters (GDD section 68,
// plan section 5.4). The fungible stock is aggregated per farm, because grain and wood have
// no individual identity; the counted capacities are aggregated here for display but
// enforced per building, because a machine and a worker do have a location and the hard
// restrictions of GDD sections 96 and 108 are a `CHECK` on the row of one building.
//
// `capacity` and `occupancy` of a building are read through `capacityKind` of the shared
// catalogue instead of a switch on the type, so adding a building to
// `shared/config/buildings.ts` needs no change here. Storage buildings report an occupancy
// of zero on purpose: their contents belong to the farm, and reporting them twice would let
// an interface add them up.

import { type Db } from '../../lib/tx.js';
import {
  BUILDING_CATALOGUE,
  buildingResaleValue,
  toWireGameMs,
  toWireMoney,
  type BuildingDto,
  type BuildingId,
  STORAGE_RESOURCES,
  type FarmDto,
  type FarmId,
  type FarmsReply,
  type GameMs,
  type PlayerId,
} from '../../shared/index.js';
import {
  capacitiesOf,
  loadBuildings,
  loadFarmStorage,
  loadFarms,
  type BuildingRow,
  type FarmRow,
  type FarmStorageRow,
} from './service.js';

/** The capacity a building declares, in the unit its kind implies. */
export function capacityOf(building: BuildingRow): number {
  switch (BUILDING_CATALOGUE[building.type].capacityKind) {
    case 'MACHINES':
      return building.capacityMachines;
    case 'WORKERS':
      return building.capacityWorkers;
    case 'STORAGE':
      return building.capacityStorageUnits;
    case 'NONE':
      return 0;
  }
}

/** What occupies a building now. Storage buildings keep it at zero; the stock is the farm's. */
export function occupancyOf(building: BuildingRow): number {
  switch (BUILDING_CATALOGUE[building.type].capacityKind) {
    case 'MACHINES':
      return building.machineCount;
    case 'WORKERS':
      return building.workerCount;
    case 'STORAGE':
    case 'NONE':
      return 0;
  }
}

/**
 * A building as the contract carries it.
 *
 * `resaleValue` comes from the shared rule and therefore from the catalogue price, not from
 * the price actually paid. That is deliberate and it is what keeps the figure the panel
 * shows equal to the figure `DELETE /api/buildings/:id` credits: both call
 * `buildingResaleValue`, so a retuned catalogue moves the two together instead of leaving
 * the interface quoting a refund the server will not pay.
 */
export function toBuildingDto(building: BuildingRow): BuildingDto {
  return {
    id: building.id as BuildingId,
    farmId: building.farmId as FarmId,
    type: building.type,
    originCellX: building.originCellX,
    originCellY: building.originCellY,
    widthCells: building.widthCells,
    heightCells: building.heightCells,
    capacity: capacityOf(building),
    occupancy: occupancyOf(building),
    builtAtGameMs: toWireGameMs(building.builtAtGameMs as unknown as GameMs),
    resaleValue: toWireMoney(buildingResaleValue(building.type)),
  };
}

/** A farm as the contract carries it, with the buildings and storage already loaded. */
export function toFarmDto(
  farm: FarmRow,
  buildings: readonly BuildingRow[],
  storage: readonly FarmStorageRow[],
): FarmDto {
  const capacities = capacitiesOf(farm, buildings, storage);
  return {
    id: capacities.farmId,
    name: capacities.name,
    // Every category, in the declaration order of the vocabulary, including the ones with
    // no store built: the panel draws the same rows before and after the first silo.
    storage: STORAGE_RESOURCES.map((category) => ({
      category,
      usage: capacities.storage[category],
    })),
    machineSlots: capacities.machineSlots,
    workerSlots: capacities.workerSlots,
    hasWorkshop: capacities.hasWorkshop,
    buildingCount: capacities.buildingCount,
    createdAtGameMs: toWireGameMs(farm.createdAtGameMs as unknown as GameMs),
  };
}

/** One farm and its buildings, reloaded from the database. Two statements. */
export async function buildFarmDto(db: Db, targetFarmId: string): Promise<FarmDto> {
  const farm = await db.farm.findUniqueOrThrow({
    where: { id: targetFarmId },
    select: { id: true, playerId: true, name: true, createdAtGameMs: true },
  });
  const buildings = await loadBuildings(db, [farm.id]);
  const storage = await loadFarmStorage(db, [farm.id]);
  return toFarmDto(farm, buildings, storage);
}

/**
 * The whole `GET /api/farms` reply: every live farm of the player and every live building.
 *
 * Two statements whatever the number of farms, because the buildings are fetched in one
 * batch and grouped in memory. A farm with no buildings still appears, with zero
 * capacities: it is the state a player is in between `POST /api/farms` and the first
 * building, and an interface that could not render it would have nowhere to put the
 * placement flow.
 */
export async function buildFarmsReply(db: Db, playerId: PlayerId): Promise<FarmsReply> {
  const farms = await loadFarms(db, playerId);
  const farmIds = farms.map((farm) => farm.id);
  const buildings = await loadBuildings(db, farmIds);
  const storage = await loadFarmStorage(db, farmIds);
  return {
    farms: farms.map((farm) =>
      toFarmDto(
        farm,
        buildings.filter((building) => building.farmId === farm.id),
        storage.filter((row) => row.farmId === farm.id),
      ),
    ),
    buildings: buildings.map(toBuildingDto),
  };
}

/** Re-exported so a caller of this module needs one import and not two. */
export type { BuildingRow, FarmRow };
