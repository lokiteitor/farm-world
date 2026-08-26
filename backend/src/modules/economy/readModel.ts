// The read model of the `economy` area: what the inventory panel and the top bar draw.
//
// Owner: workflow W5-C. Module `economy`.
//
// One builder, used by `GET /api/inventory`, by the `INVENTORY_UPSERTED` frame a sale emits
// and by the frame a forced liquidation emits. That is not tidiness: ADR-0006 makes every
// entity of a mutating reply a complete replacement rather than a delta, so the reply and
// the frame have to be the same object or the client would converge to a different state
// depending on which arrived first.
//
// Three decisions this file makes, all of them visible in the payload:
//
//   1. Every farm reports a line per resource, including the ones it has no store for. A
//      farm without a silo is at "0 of 0" and not absent, which is the state a player is in
//      between creating the farm and raising the first building; a panel that could not
//      render it would have nowhere to put the call to action. `occupancyBp` is zero there,
//      because a farm with no silo is at 0 % of nothing rather than at a division by zero.
//   2. The occupancy travels in basis points, which is how every domain percentage travels
//      (ADR-0013), and the interface divides. GDD section 49 shows it as "24 500 L / 100 000
//      L, used 24.5 %", which is 2 450 basis points here.
//   3. The stored unit and the display unit travel with their divisor, so the server never
//      divides. Wood is held in cubic decimetres and shown in cubic metres (GDD section 136),
//      and a rounded cubic metre figure that leaked back into a calculation would lose up to
//      999 dm3 per line.
//
// The market value of a line is the fixed price of GDD section 123 applied to what is
// stored, not to what is stored plus what is reserved: a reservation is room committed to a
// harvest that has not arrived, and pricing it would show the player money that does not
// exist yet.

import { type Db } from '../../lib/tx.js';
import {
  STORAGE_RESOURCE_UNITS,
  STORAGE_RESOURCES,
  type StorageResource,
  toWireGameMs,
  toWireMoney,
  type FarmId,
  type GameMs,
  type InventoryFarm,
  type InventoryCategory,
  type InventoryLine,
  type InventoryReply,
  type PlayerId,
} from '../../shared/index.js';
import {
  loadFarmStock,
  loadFarmStorage,
  loadFarms,
  storageUsageOf,
  type FarmRow,
  type FarmStockRow,
  type FarmStorageRow,
} from '../farms/service.js';
import { categoryOfItem, stockMarketValue } from './market.js';

/** One pile of a farm (GDD sections 27, 49 and 136). */
export function toInventoryLine(stock: FarmStockRow): InventoryLine {
  const category = categoryOfItem(stock.item);
  const units = STORAGE_RESOURCE_UNITS[category];
  return {
    item: stock.item,
    category,
    storedUnit: units.storedUnit,
    displayUnit: units.displayUnit,
    displayDivisor: units.displayDivisor,
    storedUnits: stock.storedUnits,
    reservedUnits: stock.reservedUnits,
    marketValue: toWireMoney(stockMarketValue(stock)),
  };
}

/** The capacity meters of a farm: one per category, including the empty ones. */
export function toInventoryCategory(
  storage: readonly FarmStorageRow[],
  category: StorageResource,
): InventoryCategory {
  const units = STORAGE_RESOURCE_UNITS[category];
  return {
    category,
    storedUnit: units.storedUnit,
    displayUnit: units.displayUnit,
    displayDivisor: units.displayDivisor,
    usage: storageUsageOf(storage, category),
  };
}

/**
 * One farm: every category as a meter, and one line per pile that holds something.
 *
 * The two levels are the shape of the panel and the shape of the domain at once. Capacity
 * belongs to the category, so that is what the meters draw; value belongs to the crop, so
 * that is what the sellable lines are. Empty piles are omitted, which keeps the reply
 * proportional to what the farm holds rather than to the size of the catalogue.
 */
export function toInventoryFarm(
  farm: FarmRow,
  storage: readonly FarmStorageRow[],
  stock: readonly FarmStockRow[],
): InventoryFarm {
  return {
    farmId: farm.id as FarmId,
    categories: STORAGE_RESOURCES.map((category) => toInventoryCategory(storage, category)),
    lines: stock.map(toInventoryLine),
  };
}

/** The inventory of every live farm of a player. Three statements, whatever the number. */
export async function buildInventoryFarms(
  db: Db,
  playerId: PlayerId,
): Promise<readonly InventoryFarm[]> {
  const farms = await loadFarms(db, playerId);
  const farmIds = farms.map((farm) => farm.id);
  const storage = await loadFarmStorage(db, farmIds);
  const stock = await loadFarmStock(db, farmIds);
  return farms.map((farm) =>
    toInventoryFarm(
      farm,
      storage.filter((row) => row.farmId === farm.id),
      stock.filter((row) => row.farmId === farm.id),
    ),
  );
}

/** The whole `GET /api/inventory` reply. */
export async function buildInventoryReply(
  db: Db,
  playerId: PlayerId,
  atGameMs: GameMs,
): Promise<InventoryReply> {
  return {
    farms: [...(await buildInventoryFarms(db, playerId))],
    atGameMs: toWireGameMs(atGameMs),
  };
}
