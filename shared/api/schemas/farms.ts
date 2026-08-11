// Farms area: the farm, its buildings and the capacities they grant.
//
// Owner: workflow W2 (API contract).
//
// A farm holds the fungible stock, because grain and wood have no individual
// identity; the buildings hold the capacity, because a machine and a worker do have
// one and their capacity is checked per building (plan section 5.4). The reply
// exposes both readings, aggregated per farm and detailed per building, so the
// panels of plan section 9.6 need no derivation of their own.
//
// On the price of a building: GDD section 116 defines
// `realBuildingCost = purchasePrice + footprint x cellPrice`, which charges the land
// twice for a player who already owns the plot. Plan section 2.2 resolves it: the
// formula is planning help and the transactional price is `purchasePrice` plus, only
// if the cells are not owned yet and the request asks for it, the cells at the price
// of GDD section 115. That is what `purchaseFootprintLand` selects.

import { z } from 'zod';
import { BuildingType } from '../../domain/enums.js';
import {
  buildingIdSchema,
  cellCoordSchema,
  cellOrdinateSchema,
  countSchema,
  farmIdSchema,
  gameMsSchema,
  moneySchema,
  nameSchema,
  storageUnitsSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/** Occupancy of a counted capacity: machines in a garage, workers in a home. */
export const slotUsageSchema = z.strictObject({
  used: countSchema,
  total: countSchema,
});
export type SlotUsage = z.infer<typeof slotUsageSchema>;

/**
 * Stock of one fungible resource on a farm, in the stored unit of that resource
 * (`STORAGE_RESOURCE_UNITS`): litres for wheat, cubic decimetres for wood.
 *
 * `reservedUnits` is capacity committed by tasks in flight: a harvest reserves room
 * in the silo when it is assigned, so that an overflow is an actionable rejection
 * instead of a silent loss at completion time (plan section 5.4).
 */
export const storageUsageSchema = z.strictObject({
  storedUnits: storageUnitsSchema,
  reservedUnits: storageUnitsSchema,
  capacityUnits: storageUnitsSchema,
  /** Occupancy including the reservation, in basis points of the capacity. */
  occupancyBp: z.number().int().min(0).max(10_000),
});
export type StorageUsage = z.infer<typeof storageUsageSchema>;

export const farmDtoSchema = z.strictObject({
  id: farmIdSchema,
  name: nameSchema,
  wheat: storageUsageSchema,
  wood: storageUsageSchema,
  machineSlots: slotUsageSchema,
  workerSlots: slotUsageSchema,
  /** Whether the farm has a workshop, which is what repair requires (GDD sections 29 and 93). */
  hasWorkshop: z.boolean(),
  buildingCount: countSchema,
  createdAtGameMs: gameMsSchema,
});
export type FarmDto = z.infer<typeof farmDtoSchema>;

export const buildingDtoSchema = z.strictObject({
  id: buildingIdSchema,
  farmId: farmIdSchema,
  type: z.enum(BuildingType),
  /** North west corner of the footprint, in absolute cell coordinates. */
  originCellX: cellOrdinateSchema,
  originCellY: cellOrdinateSchema,
  widthCells: z.number().int().positive(),
  heightCells: z.number().int().positive(),
  /** Capacity as it was when the building was raised, in the unit its type implies. */
  capacity: countSchema,
  /** What occupies it now. Storage buildings keep it at zero: their contents are on the farm. */
  occupancy: countSchema,
  builtAtGameMs: gameMsSchema,
  /** What retiring it would return, at the resale factor (plan section 6.6). */
  resaleValue: moneySchema,
});
export type BuildingDto = z.infer<typeof buildingDtoSchema>;

export const farmsReplySchema = z.strictObject({
  farms: z.array(farmDtoSchema),
  buildings: z.array(buildingDtoSchema),
});
export type FarmsReply = z.infer<typeof farmsReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/farms
// ---------------------------------------------------------------------------

/**
 * Creating a farm costs nothing and occupies nothing: the farm is the bookkeeping
 * unit and the buildings are what occupy cells (GDD sections 23 and 24, and the
 * `Farm` entity, which carries no geometry). It is therefore not a money moving
 * request and needs no idempotency key.
 */
export const createFarmBodySchema = z.strictObject({
  name: nameSchema,
});
export type CreateFarmBody = z.infer<typeof createFarmBodySchema>;

export const createFarmResultSchema = z.strictObject({
  farm: farmDtoSchema,
});
export type CreateFarmResult = z.infer<typeof createFarmResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/farms/:farmId/buildings
// ---------------------------------------------------------------------------

export const farmParamsSchema = z.strictObject({ farmId: farmIdSchema });
export type FarmParams = z.infer<typeof farmParamsSchema>;

export const buildingParamsSchema = z.strictObject({ buildingId: buildingIdSchema });
export type BuildingParams = z.infer<typeof buildingParamsSchema>;

export const placeBuildingBodySchema = z.strictObject({
  type: z.enum(BuildingType),
  originCellX: cellOrdinateSchema,
  originCellY: cellOrdinateSchema,
  /**
   * Whether the request also buys the cells of the footprint that are not owned yet,
   * at the price of GDD section 115. False means the request is rejected if any cell
   * of the footprint is not already owned, which is the safe default for a client
   * that showed the player only the price of the building.
   */
  purchaseFootprintLand: z.boolean(),
  /**
   * Total the client showed the player, as a decimal string. When present the server
   * rejects the request if its own total differs, so a stale quote cannot be charged
   * silently. Optional because the first request of a scripted client has no quote.
   */
  expectedTotal: moneySchema.optional(),
});
export type PlaceBuildingBody = z.infer<typeof placeBuildingBodySchema>;

export const placeBuildingResultSchema = z.strictObject({
  building: buildingDtoSchema,
  farm: farmDtoSchema,
  /** Cells of the footprint that this request bought. Zero when the land was already owned. */
  landPurchasedCells: countSchema,
  buildingPaid: moneySchema,
  landPaid: moneySchema,
  totalPaid: moneySchema,
  balanceAfter: moneySchema,
  /** The cells the footprint now occupies, so the renderer patches without a chunk round trip. */
  footprintCells: z.array(cellCoordSchema),
});
export type PlaceBuildingResult = z.infer<typeof placeBuildingResultSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/buildings/:buildingId
// ---------------------------------------------------------------------------

/**
 * Retiring a building returns money, so it carries an idempotency key like every
 * other money moving route. The cells return to owned land with no use; the land
 * itself is not sold.
 */
export const removeBuildingResultSchema = z.strictObject({
  buildingId: buildingIdSchema,
  farm: farmDtoSchema,
  refund: moneySchema,
  balanceAfter: moneySchema,
  releasedCells: z.array(cellCoordSchema),
});
export type RemoveBuildingResult = z.infer<typeof removeBuildingResultSchema>;
