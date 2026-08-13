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
//   3. Storage of wheat and of wood (GDD sections 27 and 136). Aggregated per farm,
//      because grain and wood are fungible, and maintained by the trigger
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
//   `reserveStorage`  conditional update with a row count. Called when a harvest is
//                     assigned, so an overflow is an actionable rejection instead of a
//                     silent loss when the job completes.
//   `depositStorage`  one bounded statement that computes what fits and reports the rest
//                     as waste. It cannot violate the constraint by construction, which is
//                     what keeps a completion job from ever retrying.
//   `withdrawStorage` conditional update with a row count, for a sale.
//
// All three are raw SQL for one reason: the bound compares two columns of the same row
// (`stored + reserved <= capacity`), and the typed client expresses no arithmetic between
// columns. Every value is a bound parameter; the only text built is a column name taken
// from the closed table `STORAGE_COLUMNS`, never from a request.

import { type Db, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  BuildingType,
  ValidationCode,
  capacityExceeded,
  notFound,
  notOwned,
  type BuildingId,
  type FarmId,
  type PlayerId,
  type SlotUsage,
  type StorageResource,
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
  /** Silo occupancy in litres (GDD sections 27 and 83). */
  readonly wheat: StorageUsage;
  /** Wood store occupancy in cubic decimetres (GDD sections 136 and 138). */
  readonly wood: StorageUsage;
  /** Whether a workshop stands on the farm, which is what repair requires (GDD section 29). */
  readonly hasWorkshop: boolean;
  readonly buildingCount: number;
}

/** The columns of one fungible resource, and the code its overflow reports. */
interface StorageColumns {
  readonly stored: string;
  readonly reserved: string;
  readonly capacity: string;
  readonly exceeded:
    | typeof ValidationCode.SILO_CAPACITY_EXCEEDED
    | typeof ValidationCode.WOOD_STORAGE_CAPACITY_EXCEEDED;
  /** The building type that grants this capacity, named in the error details. */
  readonly grantedBy: BuildingType;
}

/**
 * Closed table of column names. It is what makes the raw statements below safe: the only
 * text that is interpolated comes from here, and there is no path from a request to it.
 */
export const STORAGE_COLUMNS: Readonly<Record<StorageResource, StorageColumns>> = {
  WHEAT_LITERS: {
    stored: 'storedWheatLiters',
    reserved: 'reservedWheatLiters',
    capacity: 'capacityWheatLiters',
    exceeded: ValidationCode.SILO_CAPACITY_EXCEEDED,
    grantedBy: BuildingType.SILO,
  },
  WOOD_M3: {
    stored: 'storedWoodDm3',
    reserved: 'reservedWoodDm3',
    capacity: 'capacityWoodDm3',
    exceeded: ValidationCode.WOOD_STORAGE_CAPACITY_EXCEEDED,
    grantedBy: BuildingType.WOOD_STORAGE,
  },
};

/** The row of a farm, as this module reads it. */
export interface FarmRow {
  readonly id: string;
  readonly playerId: string;
  readonly name: string;
  readonly storedWheatLiters: number;
  readonly reservedWheatLiters: number;
  readonly capacityWheatLiters: number;
  readonly storedWoodDm3: number;
  readonly reservedWoodDm3: number;
  readonly capacityWoodDm3: number;
  readonly createdAtGameMs: bigint;
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
  storedWheatLiters: true,
  reservedWheatLiters: true,
  capacityWheatLiters: true,
  storedWoodDm3: true,
  reservedWoodDm3: true,
  capacityWoodDm3: true,
  createdAtGameMs: true,
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

/** The storage reading of one resource on a farm row. */
export function storageUsageOf(farm: FarmRow, resource: StorageResource): StorageUsage {
  if (resource === 'WHEAT_LITERS') {
    return {
      storedUnits: farm.storedWheatLiters,
      reservedUnits: farm.reservedWheatLiters,
      capacityUnits: farm.capacityWheatLiters,
      occupancyBp: occupancyBp(
        farm.storedWheatLiters,
        farm.reservedWheatLiters,
        farm.capacityWheatLiters,
      ),
    };
  }
  return {
    storedUnits: farm.storedWoodDm3,
    reservedUnits: farm.reservedWoodDm3,
    capacityUnits: farm.capacityWoodDm3,
    occupancyBp: occupancyBp(farm.storedWoodDm3, farm.reservedWoodDm3, farm.capacityWoodDm3),
  };
}

/** Free units of a resource: capacity less what is stored and what is already committed. */
export function freeStorageUnits(farm: FarmRow, resource: StorageResource): number {
  const usage = storageUsageOf(farm, resource);
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
export function capacitiesOf(farm: FarmRow, buildings: readonly BuildingRow[]): FarmCapacities {
  return {
    farmId: farm.id as FarmId,
    playerId: farm.playerId as PlayerId,
    name: farm.name,
    machineSlots: slotUsageOf(buildings, 'MACHINES'),
    workerSlots: slotUsageOf(buildings, 'WORKERS'),
    wheat: storageUsageOf(farm, 'WHEAT_LITERS'),
    wood: storageUsageOf(farm, 'WOOD_M3'),
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
  return capacitiesOf(farm, buildings);
}

/** The capacities of every farm of a player. Two statements, whatever the number of farms. */
export async function playerFarmCapacities(
  db: Db,
  playerId: PlayerId,
): Promise<readonly FarmCapacities[]> {
  const farms = await loadFarms(db, playerId);
  const buildings = await loadBuildings(
    db,
    farms.map((farm) => farm.id),
  );
  return farms.map((farm) =>
    capacitiesOf(
      farm,
      buildings.filter((building) => building.farmId === farm.id),
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
  resource: StorageResource,
  usage: StorageUsage,
  requiredUnits: number,
): ApiError {
  const columns = STORAGE_COLUMNS[resource];
  if (usage.capacityUnits === 0) {
    return new ApiError(ValidationCode.STORAGE_REQUIRED, {
      entityKind: columns.grantedBy,
      requiredUnits,
      availableUnits: 0,
    });
  }
  return new ApiError(columns.exceeded, {
    occupancy: usage.storedUnits + usage.reservedUnits,
    capacity: usage.capacityUnits,
    requiredUnits,
    availableUnits: usage.capacityUnits - usage.storedUnits - usage.reservedUnits,
  });
}

/** Reads back the row after a storage statement, so every outcome reports the truth. */
async function readStorage(
  db: Db,
  targetFarmId: string,
  resource: StorageResource,
): Promise<StorageUsage> {
  const farm = await db.farm.findUniqueOrThrow({
    where: { id: targetFarmId },
    select: FARM_SELECT,
  });
  return storageUsageOf(farm, resource);
}

/**
 * Commits capacity for a harvest that is about to start (plan section 5.4, layer one).
 *
 * A conditional update whose row count is the decision: the reservation only applies if
 * the farm still has room for it, so two harvests assigned to the same silo cannot both
 * believe they fit. This is the layer that turns an overflow into an actionable rejection
 * at assignment time, which is the whole point of `reserved...` existing as a column.
 */
export async function reserveStorage(
  tx: Tx,
  targetFarmId: string,
  resource: StorageResource,
  units: number,
): Promise<StorageWriteOutcome> {
  const columns = STORAGE_COLUMNS[resource];
  const amount = wholeUnits(units);
  const affected = await tx.$executeRawUnsafe(
    `UPDATE "farms" SET "${columns.reserved}" = "${columns.reserved}" + $2::int ` +
      `WHERE "id" = $1::uuid ` +
      `AND "${columns.stored}" + "${columns.reserved}" + $2::int <= "${columns.capacity}"`,
    targetFarmId,
    amount,
  );
  return { ok: affected === 1, usage: await readStorage(tx, targetFarmId, resource) };
}

/**
 * Gives back capacity a cancelled or completed task had committed.
 *
 * Floored at zero rather than refused: releasing more than was reserved is a bug of the
 * caller and leaving the column negative would take the farm out of the range its own
 * `CHECK` accepts, which would then block every later write for a reason unrelated to it.
 */
export async function releaseStorageReservation(
  tx: Tx,
  targetFarmId: string,
  resource: StorageResource,
  units: number,
): Promise<StorageUsage> {
  const columns = STORAGE_COLUMNS[resource];
  await tx.$executeRawUnsafe(
    `UPDATE "farms" SET "${columns.reserved}" = GREATEST(0, "${columns.reserved}" - $2::int) ` +
      `WHERE "id" = $1::uuid`,
    targetFarmId,
    wholeUnits(units),
  );
  return readStorage(tx, targetFarmId, resource);
}

/**
 * Puts a harvest into the store, accepting what fits and reporting the rest as waste
 * (GDD sections 83 and 97, plan section 5.4, layer two).
 *
 * One bounded statement. `LEAST` is computed against the values the row held before the
 * update, because in PostgreSQL every column reference on the right hand side of a `SET`
 * reads the old row, so the result cannot exceed the capacity and cannot violate
 * `farms_stock_check` whatever the caller asked for. That property is not cosmetic: this
 * runs inside a completion job, and a constraint violation there would be retried for
 * ever.
 *
 * `releaseReservedUnits` is what the task reserved when it was assigned. It is released in
 * the same statement so that the room the harvest reserved for itself is exactly the room
 * it may now occupy.
 */
export async function depositStorage(
  tx: Tx,
  targetFarmId: string,
  resource: StorageResource,
  units: number,
  options: { readonly releaseReservedUnits?: number } = {},
): Promise<StorageDepositOutcome> {
  const columns = STORAGE_COLUMNS[resource];
  const amount = wholeUnits(units);
  const release = wholeUnits(options.releaseReservedUnits ?? 0);

  const rows = await tx.$queryRawUnsafe<{ storedBefore: number; storedAfter: number }[]>(
    `WITH "before" AS (SELECT "id", "${columns.stored}" AS "storedBefore" FROM "farms" WHERE "id" = $1::uuid) ` +
      `UPDATE "farms" f SET ` +
      `"${columns.reserved}" = GREATEST(0, f."${columns.reserved}" - $3::int), ` +
      `"${columns.stored}" = f."${columns.stored}" + LEAST($2::int, GREATEST(0, ` +
      `f."${columns.capacity}" - f."${columns.stored}" - GREATEST(0, f."${columns.reserved}" - $3::int))) ` +
      `FROM "before" b WHERE f."id" = b."id" ` +
      `RETURNING b."storedBefore" AS "storedBefore", f."${columns.stored}" AS "storedAfter"`,
    targetFarmId,
    amount,
    release,
  );
  const row = rows[0];
  if (row === undefined) {
    throw notFound('Farm', targetFarmId);
  }
  const accepted = Number(row.storedAfter) - Number(row.storedBefore);
  return {
    acceptedUnits: accepted,
    wastedUnits: amount - accepted,
    usage: await readStorage(tx, targetFarmId, resource),
  };
}

/**
 * Takes stock out of the store for a sale (GDD section 123).
 *
 * A conditional update with a row count, for the same reason as `charge` in
 * `lib/ledger.ts`: two concurrent sales of the same grain must not both succeed, and the
 * row they both have to write is the one that decides.
 */
export async function withdrawStorage(
  tx: Tx,
  targetFarmId: string,
  resource: StorageResource,
  units: number,
): Promise<StorageWriteOutcome> {
  const columns = STORAGE_COLUMNS[resource];
  const amount = wholeUnits(units);
  const affected = await tx.$executeRawUnsafe(
    `UPDATE "farms" SET "${columns.stored}" = "${columns.stored}" - $2::int ` +
      `WHERE "id" = $1::uuid AND "${columns.stored}" >= $2::int`,
    targetFarmId,
    amount,
  );
  return { ok: affected === 1, usage: await readStorage(tx, targetFarmId, resource) };
}

/** A quantity as the stored unit demands: a non negative whole number (ADR-0013). */
function wholeUnits(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Una cantidad almacenada tiene que ser finita: ${value}`);
  }
  const whole = Math.floor(value);
  return whole > 0 ? whole : 0;
}
