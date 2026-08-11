// Land area: the quote and the purchase of cells.
//
// Owner: workflow W2 (API contract).
//
// Two routes and one shape. The quote is a POST because it carries a selection of up
// to two thousand cells, which does not fit in a query string; it mutates nothing and
// therefore carries no idempotency key. The purchase is the same selection with money
// attached, and it is the canonical money moving route of the contract.
//
// Partial purchase. A selection may contain cells that are not purchasable, and the
// server buys what it can and charges only that: the unique key on the cell with an
// insertion that ignores conflicts is what makes a concurrent double purchase of the
// same cell impossible (plan section 5.4), and it naturally yields "what was actually
// acquired". The quote therefore reports the reason per cell, so the interface can
// highlight and explain before the player commits.

import { z } from 'zod';
import { TerrainType } from '../../domain/enums.js';
import { apiErrorCodeSchema } from '../errors.js';
import {
  cellCoordSchema,
  cellOrdinateSchema,
  cellSelectionSchema,
  countSchema,
  moneySchema,
} from './common.js';

// ---------------------------------------------------------------------------
// POST /api/land/quote
// ---------------------------------------------------------------------------

export const landQuoteBodySchema = cellSelectionSchema;
export type LandQuoteBody = z.infer<typeof landQuoteBodySchema>;

/**
 * One cell of the quote. `price` is null exactly when `blockedBy` is not null, so the
 * interface never has to decide between two contradictory signals.
 */
export const landQuoteCellSchema = z.strictObject({
  cellX: cellOrdinateSchema,
  cellY: cellOrdinateSchema,
  terrain: z.enum(TerrainType),
  price: moneySchema.nullable(),
  /** Reason the cell cannot be bought, or null when it can. */
  blockedBy: apiErrorCodeSchema.nullable(),
});
export type LandQuoteCell = z.infer<typeof landQuoteCellSchema>;

export const landQuoteReplySchema = z.strictObject({
  cells: z.array(landQuoteCellSchema),
  purchasableCount: countSchema,
  blockedCount: countSchema,
  /** Sum of the prices of the purchasable cells only. */
  total: moneySchema,
  /** Settled balance, so the panel can say whether the total is affordable. */
  balance: moneySchema,
  affordable: z.boolean(),
  /** First blocked cell, so the interface can jump the camera to the conflict. */
  firstBlockedCell: cellCoordSchema.nullable(),
});
export type LandQuoteReply = z.infer<typeof landQuoteReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/land/purchase
// ---------------------------------------------------------------------------

export const landPurchaseBodySchema = z.strictObject({
  cells: cellSelectionSchema.shape.cells,
  /**
   * Total the client showed the player, as a decimal string. When present the server
   * rejects the request if its own total differs, which is what stops a stale quote
   * from being charged silently after somebody else bought a cell of the selection.
   */
  expectedTotal: moneySchema.optional(),
  /**
   * Whether a selection that contains non purchasable cells is acceptable. False, the
   * safe default, rejects the whole request; true buys what it can. The flag exists
   * because the two behaviours are both legitimate and the client, not the server,
   * knows whether the player saw the quote.
   */
  allowPartial: z.boolean(),
});
export type LandPurchaseBody = z.infer<typeof landPurchaseBodySchema>;

export const landPurchaseResultSchema = z.strictObject({
  purchasedCells: z.array(cellCoordSchema),
  purchasedCount: countSchema,
  skippedCount: countSchema,
  totalPaid: moneySchema,
  balanceAfter: moneySchema,
});
export type LandPurchaseResult = z.infer<typeof landPurchaseResultSchema>;
