// The internal capacity API of the `farms` module.
//
// Owner: workflow W4-B. Module `farms`.
//
// This is the surface `machinery` (W5-A), `workers` (W5-B), `economy` (W5-C), `tasks`
// (W6-A) and `forestry` (W6-C) consume. It exists for the same reason `world/service.ts`
// exists: five later modules need to ask the same four questions about a farm, and five
// private readings of "is there a free garage slot" is how two callers end up disagreeing
// about whether a machine can be bought.
//
// The four questions, and where each rule comes from:
//
//   1. Machine slots (GDD section 96). Counted per building and not per farm, because a
//      machine has identity and location; `Building.machineCount` is maintained by the
//      trigger `machines_garage_occupancy` and bounded by `buildings_capacity_check`.
//   2. Worker slots (GDD section 108). Same shape, through `workers_home_occupancy`.
//   3. Storage, by category (GDD sections 27 and 136). Aggregated per farm because the
//      goods are fungible, and its capacity maintained by the trigger
//      `buildings_farm_storage_capacity` from the live storage buildings.
//   4. Repair access (GDD sections 29 and 93): whether the farm has a workshop.
//
// THE DIVISION OF LABOUR WITH THE DATABASE, which is the part that is easy to get wrong.
// The counters and the CHECK constraints are the safety net and never the mechanism
// (ADR-0018): a constraint violated inside a queue job produces endless retries, and in
// PostgreSQL it aborts the whole transaction, so the handler cannot even read to explain
// itself. Every function below therefore answers the predictable case before the statement
// runs, and the module never recomputes what the trigger already maintains.
//
// The three storage writes follow the three layers of plan section 5.4 exactly:
//
//   `reserveStorage`  locks the category row, decides against it, and commits the room.
//                     Called when a harvest is assigned, so an overflow is an actionable
//                     rejection instead of a silent loss when the job completes.
//   `depositStorage`  computes what fits against the locked row and reports the rest as
//                     waste. It cannot violate the constraint by construction, which is
//                     what keeps a completion job from ever retrying.
//   `withdrawStorage` same shape, for a sale.
//
// HOW THE TWO TABLES DIVIDE THE WORK, since this is what changed when the catalogue grew
// past one crop. `farm_stock` holds one pile per crop, because the sale price belongs to
// the crop and stock therefore has to remember what it came from. `farm_storage` holds
// one row per category with the capacity and the CHECK, and a trigger recomputes its
// totals from the piles. The aggregate row is the point of serialisation: every write
// below takes `FOR UPDATE` on it first and only then decides, so two harvests of two
// different crops into the same cold store cannot both see room only one of them has.
//
// The decision is taken in TypeScript against the locked row rather than as a conditional
// UPDATE, which is what lets `depositStorage` clamp instead of failing. The CHECK stays
// what it always was: the net, never the mechanism (ADR-0018).

import { type Db, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  BuildingType,
  STORAGE_RESOURCES,
  type StorageResource,
  ValidationCode,
  capacityExceeded,
  notFound,
  notOwned,
  type BuildingId,
  type FarmId,
  type PlayerId,
  type SlotUsage,
  type StockItem,
  type StorageUsage,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A building that holds a counted capacity, as the consumers of this module see it. */
export interface BuildingSlot {
  readonly buildingId: BuildingId;
  readonly farmId: FarmId;
  readonly type: BuildingType;
  readonly used: number;
  readonly total: number;
}

/** Everything a later module needs to know about the capacity of one farm. */
export interface FarmCapacities {
  readonly farmId: FarmId;
  readonly playerId: PlayerId;
  readonly name: string;
  /** Garage slots, aggregated over the live garages of the farm (GDD section 96). */
  readonly machineSlots: SlotUsage;
  /** Worker home slots, aggregated over the live homes of the farm (GDD section 108). */
  readonly workerSlots: SlotUsage;
  /**
   * Occupancy of every storage category (GDD sections 27, 83, 136 and 138). Total over
   * the categories, so a category with no store built reads as zero of zero rather than
   * being absent, which is what the interface has to draw before the first silo exists.
   */
  readonly storage: Readonly<Record<StorageResource, StorageUsage>>;
  /** Whether a workshop stands on the farm, which is what repair requires (GDD section 29). */
  readonly hasWorkshop: boolean;
  readonly buildingCount: number;
}

/**
 * The building that grants each category, named in the error details so the interface
 * can say which store is missing rather than only that one is.
 *
 * One building per category and never two: a store granting room to two categories would
 * have to add up litres of unlike goods against one counter, or hand its capacity out
 * twice. It mirrors `capacityResource` of the building catalogue, and the coherence test
 * of shared/config cross checks the pair.
 */
export const CATEGORY_GRANTED_BY: Readonly<Record<StorageResource, BuildingType>> = {
  GRAIN_LITERS: BuildingType.SILO,
  FORAGE_LITERS: BuildingType.HAY_BARN,
  PRODUCE_LITERS: BuildingType.COLD_STORE,
  INDUSTRIAL_LITERS: BuildingType.WAREHOUSE,
  WOOD_M3: BuildingType.WOOD_STORAGE,
};

/** The row of a farm, as this module reads it. */
export interface FarmRow {
  readonly id: string;
  readonly playerId: string;
  readonly name: string;
  readonly createdAtGameMs: bigint;
}

/** The aggregate row of one storage category: capacity, occupancy and the CHECK. */
export interface FarmStorageRow {
  readonly farmId: string;
  readonly category: StorageResource;
  readonly storedUnits: number;
  readonly reservedUnits: number;
  readonly capacityUnits: number;
}

/** One pile of a fungible good, which is the breakdown behind the aggregate. */
export interface FarmStockRow {
  readonly farmId: string;
  readonly item: StockItem;
  readonly storedUnits: number;
  readonly reservedUnits: number;
}

/** The row of a building, as this module reads it. */
export interface BuildingRow {
  readonly id: string;
  readonly farmId: string;
  readonly type: BuildingType;
  readonly originCellX: number;
  readonly originCellY: number;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly capacityMachines: number;
  readonly capacityWorkers: number;
  readonly capacityStorageUnits: number;
  readonly storageResource: StorageResource | null;
  readonly machineCount: number;
  readonly workerCount: number;
  readonly builtAtGameMs: bigint;
}

const FARM_SELECT = {
  id: true,
  playerId: true,
  name: true,
  createdAtGameMs: true,
} as const;

const STORAGE_SELECT = {
  farmId: true,
  category: true,
  storedUnits: true,
  reservedUnits: true,
  capacityUnits: true,
} as const;

const STOCK_SELECT = {
  farmId: true,
  item: true,
  storedUnits: true,
  reservedUnits: true,
} as const;

const BUILDING_SELECT = {
  id: true,
  farmId: true,
  type: true,
  originCellX: true,
  originCellY: true,
  widthCells: true,
  heightCells: true,
  capacityMachines: true,
  capacityWorkers: true,
  capacityStorageUnits: true,
  storageResource: true,
  machineCount: true,
  workerCount: true,
  builtAtGameMs: true,
} as const;

// ---------------------------------------------------------------------------
// Derived readings
// ---------------------------------------------------------------------------

/**
 * Occupancy of a capacity in basis points, with an empty capacity reported as zero
 * rather than as a division by zero. A farm with no silo is at 0 % of nothing, which is
 * what the interface has to draw before the first building exists.
 */
export function occupancyBp(storedUnits: number, reservedUnits: number, capacity: number): number {
  if (capacity <= 0) {
    return 0;
  }
  const used = storedUnits + reservedUnits;
  const value = Math.round((used * 10_000) / capacity);
  return value < 0 ? 0 : value > 10_000 ? 10_000 : value;
}

/** An empty reading, which is what a category with no store built looks like. */
export const EMPTY_STORAGE_USAGE: StorageUsage = {
  storedUnits: 0,
  reservedUnits: 0,
  capacityUnits: 0,
  occupancyBp: 0,
};

/** The storage reading of one category, from the aggregate rows of a farm. */
export function storageUsageOf(
  storage: readonly FarmStorageRow[],
  category: StorageResource,
): StorageUsage {
  const row = storage.find((candidate) => candidate.category === category);
  if (row === undefined) {
    return EMPTY_STORAGE_USAGE;
  }
  return {
    storedUnits: row.storedUnits,
    reservedUnits: row.reservedUnits,
    capacityUnits: row.capacityUnits,
    occupancyBp: occupancyBp(row.storedUnits, row.reservedUnits, row.capacityUnits),
  };
}

/** Every category of a farm, so a reader never has to know which ones exist. */
export function storageUsagesOf(
  storage: readonly FarmStorageRow[],
): Readonly<Record<StorageResource, StorageUsage>> {
  const usages: Partial<Record<StorageResource, StorageUsage>> = {};
  for (const category of STORAGE_RESOURCES) {
    usages[category] = storageUsageOf(storage, category);
  }
  return usages as Record<StorageResource, StorageUsage>;
}

/** Free units of a category: capacity less what is stored and what is already committed. */
export function freeStorageUnits(
  storage: readonly FarmStorageRow[],
  category: StorageResource,
): number {
  const usage = storageUsageOf(storage, category);
  const free = usage.capacityUnits - usage.storedUnits - usage.reservedUnits;
  return free > 0 ? free : 0;
}

/** Slot usage aggregated over a set of buildings (GDD sections 96 and 108). */
export function slotUsageOf(
  buildings: readonly BuildingRow[],
  kind: 'MACHINES' | 'WORKERS',
): SlotUsage {
  let used = 0;
  let total = 0;
  for (const building of buildings) {
    if (kind === 'MACHINES') {
      used += building.machineCount;
      total += building.capacityMachines;
    } else {
      used += building.workerCount;
      total += building.capacityWorkers;
    }
  }
  return { used, total };
}

/** The capacities of a farm, from rows already loaded. Pure, so a caller batches its reads. */
export function capacitiesOf(
  farm: FarmRow,
  buildings: readonly BuildingRow[],
  storage: readonly FarmStorageRow[],
): FarmCapacities {
  return {
    farmId: farm.id as FarmId,
    playerId: farm.playerId as PlayerId,
    name: farm.name,
    machineSlots: slotUsageOf(buildings, 'MACHINES'),
    workerSlots: slotUsageOf(buildings, 'WORKERS'),
    storage: storageUsagesOf(storage),
    hasWorkshop: buildings.some((building) => building.type === BuildingType.WORKSHOP),
    buildingCount: buildings.length,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** The live farms of a player, oldest first. */
export async function loadFarms(db: Db, playerId: PlayerId): Promise<readonly FarmRow[]> {
  return db.farm.findMany({
    where: { playerId, disposedGameMs: null },
    orderBy: [{ createdAtGameMs: 'asc' }, { id: 'asc' }],
    select: FARM_SELECT,
  });
}

/** The live buildings of a set of farms, in ascending order of identifier. */
export async function loadBuildings(
  db: Db,
  farmIds: readonly string[],
): Promise<readonly BuildingRow[]> {
  if (farmIds.length === 0) {
    return [];
  }
  return db.building.findMany({
    where: { farmId: { in: [...farmIds] }, disposedGameMs: null },
    // Ascending identifier order, which is step 3 of the canonical lock order of
    // `lib/tx.ts`: a caller that goes on to update one of these rows already has them in
    // the order that cannot deadlock.
    orderBy: { id: 'asc' },
    select: BUILDING_SELECT,
  });
}

/** The storage aggregates of a set of farms, in the canonical lock order. */
export async function loadFarmStorage(
  db: Db,
  farmIds: readonly string[],
): Promise<readonly FarmStorageRow[]> {
  if (farmIds.length === 0) {
    return [];
  }
  return db.farmStorage.findMany({
    where: { farmId: { in: [...farmIds] } },
    orderBy: [{ farmId: 'asc' }, { category: 'asc' }],
    select: STORAGE_SELECT,
  });
}

/**
 * The piles of a set of farms, empty ones omitted.
 *
 * A pile with nothing in it has no row, which is what keeps the inventory of a farm
 * proportional to what it actually holds rather than to the size of the catalogue.
 */
export async function loadFarmStock(
  db: Db,
  farmIds: readonly string[],
): Promise<readonly FarmStockRow[]> {
  if (farmIds.length === 0) {
    return [];
  }
  return db.farmStock.findMany({
    where: {
      farmId: { in: [...farmIds] },
      OR: [{ storedUnits: { gt: 0 } }, { reservedUnits: { gt: 0 } }],
    },
    orderBy: [{ farmId: 'asc' }, { item: 'asc' }],
    select: STOCK_SELECT,
  });
}

/**
 * A farm that belongs to the player, or the contract error that says why not.
 *
 * A farm of another player is a 403 and not a 404, because the identifier is not a secret
 * and hiding the difference would make an interface bug indistinguishable from a
 * permission problem.
 */
export async function requireFarm(
  db: Db,
  playerId: PlayerId,
  targetFarmId: string,
): Promise<FarmRow> {
  const farm = await db.farm.findUnique({
    where: { id: targetFarmId },
    select: { ...FARM_SELECT, disposedGameMs: true },
  });
  if (farm === null || farm.disposedGameMs !== null) {
    throw notFound('Farm', targetFarmId);
  }
  if (farm.playerId !== playerId) {
    throw notOwned('Farm', targetFarmId);
  }
  return farm;
}

/** The capacities of one farm of a player. Two statements, whoever asks. */
export async function farmCapacities(
  db: Db,
  playerId: PlayerId,
  targetFarmId: string,
): Promise<FarmCapacities> {
  const farm = await requireFarm(db, playerId, targetFarmId);
  const buildings = await loadBuildings(db, [farm.id]);
  const storage = await loadFarmStorage(db, [farm.id]);
  return capacitiesOf(farm, buildings, storage);
}

/** The capacities of every farm of a player. Two statements, whatever the number of farms. */
export async function playerFarmCapacities(
  db: Db,
  playerId: PlayerId,
): Promise<readonly FarmCapacities[]> {
  const farms = await loadFarms(db, playerId);
  const farmIds = farms.map((farm) => farm.id);
  const buildings = await loadBuildings(db, farmIds);
  const storage = await loadFarmStorage(db, farmIds);
  return farms.map((farm) =>
    capacitiesOf(
      farm,
      buildings.filter((building) => building.farmId === farm.id),
      storage.filter((row) => row.farmId === farm.id),
    ),
  );
}

// ---------------------------------------------------------------------------
// Counted capacity: garages and worker homes
// ---------------------------------------------------------------------------

/** Buildings of a farm that still have a free slot of a counted capacity. */
export async function buildingsWithFreeSlot(
  db: Db,
  targetFarmId: string,
  type: typeof BuildingType.GARAGE | typeof BuildingType.WORKER_HOME,
): Promise<readonly BuildingSlot[]> {
  const rows = await db.building.findMany({
    where: { farmId: targetFarmId, type, disposedGameMs: null },
    orderBy: { id: 'asc' },
    select: BUILDING_SELECT,
  });
  return rows.map((row) => toSlot(row, type)).filter((slot) => slot.used < slot.total);
}

function toSlot(
  row: BuildingRow,
  type: typeof BuildingType.GARAGE | typeof BuildingType.WORKER_HOME,
): BuildingSlot {
  const isGarage = type === BuildingType.GARAGE;
  return {
    buildingId: row.id as BuildingId,
    farmId: row.farmId as FarmId,
    type: row.type,
    used: isGarage ? row.machineCount : row.workerCount,
    total: isGarage ? row.capacityMachines : row.capacityWorkers,
  };
}

/**
 * The garage a new machine goes into, or `GARAGE_CAPACITY_EXCEEDED` (GDD section 96).
 *
 * The lowest identifier among the garages with room, so that two purchases of the same
 * player fill one garage before starting the next and the choice is reproducible in a
 * test. The `CHECK` on the row remains the safety net: it is what settles a genuine race
 * between two transactions competing for the last slot, and this function is what keeps
 * that race from being the normal path.
 */
export async function requireGarageSlot(db: Db, targetFarmId: string): Promise<BuildingSlot> {
  const free = await buildingsWithFreeSlot(db, targetFarmId, BuildingType.GARAGE);
  const slot = free[0];
  if (slot === undefined) {
    const occupancy = await countedOccupancy(db, targetFarmId, BuildingType.GARAGE);
    throw capacityExceeded(
      ValidationCode.GARAGE_CAPACITY_EXCEEDED,
      occupancy.used,
      occupancy.total,
    );
  }
  return slot;
}

/** The worker home a new worker moves into, or `HOME_CAPACITY_EXCEEDED` (GDD section 108). */
export async function requireHomeSlot(db: Db, targetFarmId: string): Promise<BuildingSlot> {
  const free = await buildingsWithFreeSlot(db, targetFarmId, BuildingType.WORKER_HOME);
  const slot = free[0];
  if (slot === undefined) {
    const occupancy = await countedOccupancy(db, targetFarmId, BuildingType.WORKER_HOME);
    throw capacityExceeded(ValidationCode.HOME_CAPACITY_EXCEEDED, occupancy.used, occupancy.total);
  }
  return slot;
}

/** Aggregate occupancy of one counted capacity, for the details of a refusal. */
async function countedOccupancy(
  db: Db,
  targetFarmId: string,
  type: typeof BuildingType.GARAGE | typeof BuildingType.WORKER_HOME,
): Promise<SlotUsage> {
  const rows = await db.building.findMany({
    where: { farmId: targetFarmId, type, disposedGameMs: null },
    select: BUILDING_SELECT,
  });
  return slotUsageOf(rows, type === BuildingType.GARAGE ? 'MACHINES' : 'WORKERS');
}

/** Whether a workshop stands on the farm (GDD sections 29 and 93). */
export async function hasWorkshop(db: Db, targetFarmId: string): Promise<boolean> {
  const count = await db.building.count({
    where: { farmId: targetFarmId, type: BuildingType.WORKSHOP, disposedGameMs: null },
  });
  return count > 0;
}

/** Refuses a repair on a farm with no workshop (GDD sections 29 and 93). */
export async function requireWorkshop(db: Db, targetFarmId: string): Promise<void> {
  if (!(await hasWorkshop(db, targetFarmId))) {
    throw new ApiError(ValidationCode.WORKSHOP_REQUIRED, { entityId: targetFarmId });
  }
}

// ---------------------------------------------------------------------------
// Fungible stock
// ---------------------------------------------------------------------------

/** What a storage write answers. `usage` is always the reading after the statement. */
export interface StorageWriteOutcome {
  readonly ok: boolean;
  readonly usage: StorageUsage;
}

/** What a deposit accepted and what it had to waste (GDD sections 83 and 97). */
export interface StorageDepositOutcome {
  readonly acceptedUnits: number;
  readonly wastedUnits: number;
  readonly usage: StorageUsage;
}

/** The error a full store reports, with the figures the interface renders. */
export function storageCapacityError(
  category: StorageResource,
  usage: StorageUsage,
  requiredUnits: number,
): ApiError {
  const grantedBy = CATEGORY_GRANTED_BY[category];
  if (usage.capacityUnits === 0) {
    return new ApiError(ValidationCode.STORAGE_REQUIRED, {
      entityKind: grantedBy,
      requiredUnits,
      availableUnits: 0,
    });
  }
  return new ApiError(ValidationCode.STORAGE_CAPACITY_EXCEEDED, {
    entityKind: grantedBy,
    occupancy: usage.storedUnits + usage.reservedUnits,
    capacity: usage.capacityUnits,
    requiredUnits,
    availableUnits: usage.capacityUnits - usage.storedUnits - usage.reservedUnits,
  });
}

/**
 * Takes the aggregate row of a category and holds it for the rest of the transaction.
 *
 * This is the whole concurrency design in one statement. The piles of `farm_stock` are
 * per crop, so two harvests of two different crops touch two different pile rows and
 * would never contend; the room they compete for is the category's. Locking the
 * aggregate first makes them queue on the row that actually decides, which is what the
 * single storage row of the previous schema did implicitly.
 *
 * The row always exists: the migration creates every category of every farm, and a farm
 * is created with them, so this never has to insert under contention.
 */
async function lockStorage(
  tx: Tx,
  targetFarmId: string,
  category: StorageResource,
): Promise<FarmStorageRow> {
  const rows = await tx.$queryRaw<
    { storedUnits: number; reservedUnits: number; capacityUnits: number }[]
  >`SELECT "storedUnits", "reservedUnits", "capacityUnits"
      FROM "farm_storage"
     WHERE "farmId" = ${targetFarmId}::uuid AND "category" = ${category}::"StorageResource"
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) {
    throw notFound('Farm', targetFarmId);
  }
  return {
    farmId: targetFarmId,
    category,
    storedUnits: Number(row.storedUnits),
    reservedUnits: Number(row.reservedUnits),
    capacityUnits: Number(row.capacityUnits),
  };
}

/** The reading of a locked row, as the callers report it. */
function usageOfRow(row: FarmStorageRow): StorageUsage {
  return {
    storedUnits: row.storedUnits,
    reservedUnits: row.reservedUnits,
    capacityUnits: row.capacityUnits,
    occupancyBp: occupancyBp(row.storedUnits, row.reservedUnits, row.capacityUnits),
  };
}

/**
 * Moves a pile by a signed delta and returns the aggregate as it stands afterwards.
 *
 * The write goes to `farm_stock`, and the trigger `farm_stock_storage_totals` carries the
 * change into the aggregate. Reading the aggregate back rather than computing it here is
 * deliberate: the trigger is the authority on the totals, and a second implementation of
 * that sum is exactly how the two tables would come to disagree.
 */
async function moveStock(
  tx: Tx,
  targetFarmId: string,
  item: StockItem,
  category: StorageResource,
  deltas: { readonly stored?: number; readonly reserved?: number },
): Promise<StorageUsage> {
  const stored = deltas.stored ?? 0;
  const reserved = deltas.reserved ?? 0;
  if (stored !== 0 || reserved !== 0) {
    await tx.$executeRaw`
      INSERT INTO "farm_stock" ("farmId", "item", "storedUnits", "reservedUnits")
      VALUES (
        ${targetFarmId}::uuid,
        ${item}::"StockItem",
        GREATEST(0, ${stored}::int),
        GREATEST(0, ${reserved}::int)
      )
      ON CONFLICT ("farmId", "item") DO UPDATE
        SET "storedUnits" = GREATEST(0, "farm_stock"."storedUnits" + ${stored}::int),
            "reservedUnits" = GREATEST(0, "farm_stock"."reservedUnits" + ${reserved}::int)`;
  }
  const rows = await tx.$queryRaw<
    { storedUnits: number; reservedUnits: number; capacityUnits: number }[]
  >`SELECT "storedUnits", "reservedUnits", "capacityUnits"
      FROM "farm_storage"
     WHERE "farmId" = ${targetFarmId}::uuid AND "category" = ${category}::"StorageResource"`;
  const row = rows[0];
  if (row === undefined) {
    throw notFound('Farm', targetFarmId);
  }
  return usageOfRow({
    farmId: targetFarmId,
    category,
    storedUnits: Number(row.storedUnits),
    reservedUnits: Number(row.reservedUnits),
    capacityUnits: Number(row.capacityUnits),
  });
}

/**
 * Commits capacity for a harvest that is about to start (plan section 5.4, layer one).
 *
 * The lock on the aggregate is what makes the decision safe: two harvests assigned to the
 * same store cannot both believe they fit, whatever crops they are. This is the layer
 * that turns an overflow into an actionable rejection at assignment time, which is the
 * whole point of the reserved units existing at all.
 */
export async function reserveStorage(
  tx: Tx,
  targetFarmId: string,
  item: StockItem,
  category: StorageResource,
  units: number,
): Promise<StorageWriteOutcome> {
  const amount = wholeUnits(units);
  const locked = await lockStorage(tx, targetFarmId, category);
  const free = locked.capacityUnits - locked.storedUnits - locked.reservedUnits;
  if (amount > free) {
    return { ok: false, usage: usageOfRow(locked) };
  }
  return {
    ok: true,
    usage: await moveStock(tx, targetFarmId, item, category, { reserved: amount }),
  };
}

/**
 * Gives back capacity a cancelled or completed task had committed.
 *
 * Floored at zero rather than refused: releasing more than was reserved is a bug of the
 * caller, and leaving the pile negative would take the aggregate out of the range its own
 * CHECK accepts, which would then block every later write for a reason unrelated to it.
 */
export async function releaseStorageReservation(
  tx: Tx,
  targetFarmId: string,
  item: StockItem,
  category: StorageResource,
  units: number,
): Promise<StorageUsage> {
  await lockStorage(tx, targetFarmId, category);
  return moveStock(tx, targetFarmId, item, category, { reserved: -wholeUnits(units) });
}

/**
 * Puts a harvest into the store, accepting what fits and reporting the rest as waste
 * (GDD sections 83 and 97, plan section 5.4, layer two).
 *
 * What is accepted is computed against the locked row, so it cannot exceed the capacity
 * and cannot violate `farm_storage_check` whatever the caller asked for. That property is
 * not cosmetic: this runs inside a completion job, and a constraint violation there would
 * be retried for ever.
 *
 * `releaseReservedUnits` is what the task reserved when it was assigned. It is released
 * before the room is measured, so the room the harvest reserved for itself is exactly the
 * room it may now occupy.
 */
export async function depositStorage(
  tx: Tx,
  targetFarmId: string,
  item: StockItem,
  category: StorageResource,
  units: number,
  options: { readonly releaseReservedUnits?: number } = {},
): Promise<StorageDepositOutcome> {
  const amount = wholeUnits(units);
  const release = wholeUnits(options.releaseReservedUnits ?? 0);
  const locked = await lockStorage(tx, targetFarmId, category);
  const reservedAfter = Math.max(0, locked.reservedUnits - release);
  const room = Math.max(0, locked.capacityUnits - locked.storedUnits - reservedAfter);
  const accepted = Math.min(amount, room);
  const usage = await moveStock(tx, targetFarmId, item, category, {
    stored: accepted,
    reserved: -release,
  });
  return { acceptedUnits: accepted, wastedUnits: amount - accepted, usage };
}

/**
 * Takes stock out of the store for a sale (GDD section 123).
 *
 * Decided against the pile and not against the category: selling grain means selling one
 * crop's grain, and a farm holding barley must not be able to sell wheat it does not have.
 */
export async function withdrawStorage(
  tx: Tx,
  targetFarmId: string,
  item: StockItem,
  category: StorageResource,
  units: number,
): Promise<StorageWriteOutcome> {
  const amount = wholeUnits(units);
  await lockStorage(tx, targetFarmId, category);
  const affected = await tx.$executeRaw`
    UPDATE "farm_stock"
       SET "storedUnits" = "storedUnits" - ${amount}::int
     WHERE "farmId" = ${targetFarmId}::uuid
       AND "item" = ${item}::"StockItem"
       AND "storedUnits" >= ${amount}::int`;
  const usage = await moveStock(tx, targetFarmId, item, category, {});
  return { ok: affected === 1, usage };
}

/** A quantity as the stored unit demands: a non negative whole number (ADR-0013). */
function wholeUnits(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Una cantidad almacenada tiene que ser finita: ${value}`);
  }
  const whole = Math.floor(value);
  return whole > 0 ? whole : 0;
}
