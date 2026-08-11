// Economy area: inventory, market and ledger.
//
// Owner: workflow W2 (API contract).
//
// The price model is fixed and has no fluctuation (GDD section 123), so the market
// route exists to say what the price is and to sell at it, never to negotiate. The
// player may postpone a sale, but the price does not change for it in the MVP.
//
// The ledger is a single entry with a signed amount (plan section 5.3): negative is an
// outflow for the player. `balanceAfter` travels because it is stored, and it is
// stored on purpose: it makes the ledger self auditable with an executable test and
// lets the history be drawn without window functions. `idempotencyKey` does not
// travel: it is an internal guarantee and no client has any use for it.

import { z } from 'zod';
import { LedgerType, StorageResource } from '../../domain/enums.js';
import {
  countSchema,
  cursorSchema,
  DEFAULT_LEDGER_PAGE,
  farmIdSchema,
  gameMsSchema,
  jsonObjectSchema,
  ledgerEntryIdSchema,
  limitQuerySchema,
  MAX_LEDGER_PAGE,
  moneySchema,
  seqSchema,
  storageUnitsSchema,
} from './common.js';
import { storageUsageSchema } from './farms.js';

// ---------------------------------------------------------------------------
// GET /api/inventory
// ---------------------------------------------------------------------------

/**
 * Stock of one resource on one farm, with the unit it is stored in and the unit the
 * interface shows. Wood is stored in cubic decimetres and shown in cubic metres, which
 * is why the divisor travels: the interface divides and the server never does, so a
 * rounded figure cannot leak back into a calculation.
 */
export const inventoryLineSchema = z.strictObject({
  resource: z.enum(StorageResource),
  storedUnit: z.string().min(1),
  displayUnit: z.string().min(1),
  displayDivisor: z.number().int().positive(),
  usage: storageUsageSchema,
  /** Value of the stock at the fixed sale price (GDD sections 123 and 133). */
  marketValue: moneySchema,
});
export type InventoryLine = z.infer<typeof inventoryLineSchema>;

export const inventoryFarmSchema = z.strictObject({
  farmId: farmIdSchema,
  lines: z.array(inventoryLineSchema),
});
export type InventoryFarm = z.infer<typeof inventoryFarmSchema>;

export const inventoryReplySchema = z.strictObject({
  farms: z.array(inventoryFarmSchema),
  atGameMs: gameMsSchema,
});
export type InventoryReply = z.infer<typeof inventoryReplySchema>;

// ---------------------------------------------------------------------------
// GET /api/market/prices
// ---------------------------------------------------------------------------

export const marketPriceSchema = z.strictObject({
  resource: z.enum(StorageResource),
  /**
   * Price per stored unit, as a decimal string: per litre for wheat (GDD section 82)
   * and per cubic decimetre for wood, which is the 45 per cubic metre of GDD section
   * 133 divided by a thousand. Quoting per stored unit rather than per display unit is
   * what keeps `revenue = price x quantity` exact in integer arithmetic.
   */
  pricePerStoredUnit: moneySchema,
  storedUnit: z.string().min(1),
  /** Price per display unit, for the panel. Derived, and never used in a calculation. */
  pricePerDisplayUnit: moneySchema,
  displayUnit: z.string().min(1),
});
export type MarketPrice = z.infer<typeof marketPriceSchema>;

export const marketPricesReplySchema = z.strictObject({
  prices: z.array(marketPriceSchema),
  atGameMs: gameMsSchema,
});
export type MarketPricesReply = z.infer<typeof marketPricesReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/market/sell
// ---------------------------------------------------------------------------

/**
 * Selling is the one income route that stays open while the player is in debt (plan
 * section 6.6): blocking it would produce a permanent deadlock, since it is the only
 * way out. The quantity is in the stored unit of the resource and is always an integer.
 */
export const sellBodySchema = z.strictObject({
  farmId: farmIdSchema,
  resource: z.enum(StorageResource),
  /** Quantity in the stored unit. Omitted means the whole free stock of that resource. */
  quantityUnits: storageUnitsSchema.positive().optional(),
});
export type SellBody = z.infer<typeof sellBodySchema>;

export const sellResultSchema = z.strictObject({
  resource: z.enum(StorageResource),
  quantitySoldUnits: storageUnitsSchema,
  revenue: moneySchema,
  balanceAfter: moneySchema,
  usage: storageUsageSchema,
});
export type SellResult = z.infer<typeof sellResultSchema>;

// ---------------------------------------------------------------------------
// GET /api/economy/ledger
// ---------------------------------------------------------------------------

export const ledgerEntryDtoSchema = z.strictObject({
  id: ledgerEntryIdSchema,
  /** Monotonic per player. Gives a total order and breaks ties of the timestamp. */
  seq: seqSchema,
  type: z.enum(LedgerType),
  /** Signed: negative is an outflow for the player. */
  amount: moneySchema,
  balanceAfter: moneySchema,
  atGameMs: gameMsSchema,
  /** Polymorphic reference to the origin, with no foreign key (plan section 5.3). */
  refType: z.string().max(64).nullable(),
  refId: z.string().max(64).nullable(),
  meta: jsonObjectSchema.nullable(),
});
export type LedgerEntryDto = z.infer<typeof ledgerEntryDtoSchema>;

export const ledgerQuerySchema = z.strictObject({
  limit: limitQuerySchema(MAX_LEDGER_PAGE, DEFAULT_LEDGER_PAGE),
  cursor: cursorSchema.optional(),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const ledgerReplySchema = z.strictObject({
  entries: z.array(ledgerEntryDtoSchema),
  nextCursor: cursorSchema.nullable(),
  /** Settled balance the newest entry left behind, for the self audit of the client. */
  balance: moneySchema,
  entryCount: countSchema,
});
export type LedgerReply = z.infer<typeof ledgerReplySchema>;
