// The market: the fixed price of each resource and the sale of stock.
//
// Owner: workflow W5-C. Module `economy`.
//
// GDD section 123 fixes the model in one line: `sellPrice = sellPricePerLiter x quantity`,
// with no fluctuation. The player may postpone a sale (GDD section 49) but the price does
// not move for it in the MVP, so this module has no notion of an order book, a spread or a
// quote that expires. What it does have is one place where the price is defined, which is
// why `GET /api/market/prices` exists at all: without it the panel would have to restate
// 0.22 and 45, and the day the catalogue is retuned the interface would quote a figure the
// server refuses to pay.
//
// The unit is the part that is easy to get wrong. Stock is always an integer in the stored
// unit (ADR-0013): litres for wheat, cubic decimetres for wood. The sale price of GDD
// section 133 is per cubic metre, so the price per stored unit is that figure divided by a
// thousand. The division is exact for the current catalogue (45 / 1000 = 0.0450, and money
// keeps four decimals), and the revenue is nevertheless computed with `woodSaleRevenue` of
// `shared/rules/pricing.ts`, which multiplies first and divides once. Those two agree today
// and the suite asserts that they do; if a future price makes them diverge, the shared rule
// is the authority and the per unit price becomes a display figure only.
//
// Selling is the one income route that stays open while the player is in debt (plan section
// 6.6), so nothing in this file consults the debt policy. The refusal it does implement is
// physical and not financial: a player cannot sell grain that is not in the silo.

import { type MutationContext } from '../../lib/advancePlayer.js';
import { credit, findEntryByKey } from '../../lib/ledger.js';
import {
  ApiError,
  DM3_PER_M3,
  LedgerType,
  Money,
  PINE,
  STORAGE_RESOURCE_UNITS,
  StorageResource,
  ValidationCode,
  WHEAT,
  cropSaleRevenue,
  insufficientStock,
  woodSaleRevenue,
  type FarmId,
  type LedgerEntry,
  type MarketPrice,
  type StorageUsage,
} from '../../shared/index.js';
import { requireFarm, storageUsageOf, withdrawStorage, type FarmRow } from '../farms/service.js';

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * The ledger kind a sale of each resource is recorded under. Declared as a table keyed by
 * the union so that a resource added to the vocabulary does not compile until it has a
 * kind, instead of falling through a `switch` into a wrong entry.
 */
export const SALE_LEDGER_TYPE: Readonly<Record<StorageResource, LedgerType>> = {
  WHEAT_LITERS: LedgerType.CROP_SALE,
  WOOD_M3: LedgerType.WOOD_SALE,
};

/**
 * Price of one stored unit (GDD sections 82, 123 and 133).
 *
 * Wheat is priced per litre and the stored unit is the litre, so the catalogue value is
 * used unchanged. Wood is priced per cubic metre and stored per cubic decimetre, so the
 * catalogue value is divided by `DM3_PER_M3` over the scaled integer representation, never
 * with floating point.
 */
export function pricePerStoredUnit(resource: StorageResource): Money {
  if (resource === StorageResource.WHEAT_LITERS) {
    return WHEAT.sellPricePerLiter;
  }
  return Money.fromScaled(Money.toScaled(PINE.sellPricePerM3) / BigInt(DM3_PER_M3));
}

/** Price of one display unit, for the panel. Derived, and never used in a calculation. */
export function pricePerDisplayUnit(resource: StorageResource): Money {
  if (resource === StorageResource.WHEAT_LITERS) {
    return WHEAT.sellPricePerLiter;
  }
  return PINE.sellPricePerM3;
}

/**
 * Revenue of selling a quantity in the stored unit (GDD sections 123 and 133).
 *
 * It goes through the shared rules rather than multiplying by `pricePerStoredUnit`, so the
 * figure the market pays and the figure `liquidationValue` uses to decide whether a forced
 * liquidation is needed come from one implementation.
 */
export function saleRevenue(resource: StorageResource, units: number): Money {
  const whole = units > 0 ? Math.floor(units) : 0;
  return resource === StorageResource.WHEAT_LITERS
    ? cropSaleRevenue(WHEAT, whole)
    : woodSaleRevenue(PINE, whole);
}

/** The whole price list, in the declaration order of `StorageResource`. */
export function marketPrices(): readonly MarketPrice[] {
  return Object.values(StorageResource).map((resource): MarketPrice => {
    const units = STORAGE_RESOURCE_UNITS[resource];
    return {
      resource,
      pricePerStoredUnit: Money.toString(pricePerStoredUnit(resource)),
      storedUnit: units.storedUnit,
      pricePerDisplayUnit: Money.toString(pricePerDisplayUnit(resource)),
      displayUnit: units.displayUnit,
    };
  });
}

/** Market value of a stock, which is what the inventory reply reports per line. */
export function stockMarketValue(farm: FarmRow, resource: StorageResource): Money {
  return saleRevenue(resource, storageUsageOf(farm, resource).storedUnits);
}

// ---------------------------------------------------------------------------
// The sale
// ---------------------------------------------------------------------------

export interface SellStockInput {
  readonly farmId: string;
  readonly resource: StorageResource;
  /** Quantity in the stored unit, or null for the whole stock of that resource. */
  readonly quantityUnits: number | null;
  /** Idempotency key of the ledger entry, derived from the header by the route. */
  readonly idempotencyKey: string;
}

export interface SellStockOutcome {
  readonly farmId: FarmId;
  readonly resource: StorageResource;
  readonly quantitySoldUnits: number;
  readonly revenue: Money;
  readonly balanceAfter: Money;
  readonly usage: StorageUsage;
  readonly entry: LedgerEntry;
  /** True when the key already existed and nothing moved. Success for the caller. */
  readonly replayed: boolean;
}

/**
 * Sells stock at the fixed price (GDD section 123).
 *
 * Runs inside `withPlayerAdvanced`, so the player row is locked and the accruals are already
 * settled up to this instant. The order of the steps is the design:
 *
 *   1. The idempotency key first. A retry that reached the body must not withdraw the stock
 *      a second time, and `credit` alone would not prevent it: it collapses the entry, not
 *      the withdrawal that happened before it. The HTTP guard of `plugins/auth.ts` already
 *      replays the stored response, and this is the second, independent defence.
 *   2. The farm, which is what turns an identifier of another player into a 403 rather than
 *      into a sale.
 *   3. The quantity, resolved against the stock. `null` means the whole stock, which is what
 *      the contract says and what the panel sends for "sell everything".
 *   4. The withdrawal, which is a conditional update with a row count: two concurrent sales
 *      of the same grain write the same row, so the second one takes nothing and is refused
 *      with `INSUFFICIENT_STOCK` instead of both succeeding.
 *   5. The credit, which is never refused. Selling is the only way out of debt (plan section
 *      6.6) and a negative balance must not block it.
 *
 * `reserved...` is deliberately not deducted from what may be sold: it is capacity committed
 * to a harvest that has not arrived yet, not stock. Selling stock frees no reservation.
 */
export async function sellStock(
  ctx: MutationContext,
  input: SellStockInput,
): Promise<SellStockOutcome> {
  const { tx, reading, services } = ctx;
  const playerId = ctx.lock.playerId;

  const existing = await findEntryByKey(tx, playerId, input.idempotencyKey);
  if (existing !== null) {
    const farm = await requireFarm(tx, playerId, input.farmId);
    return {
      farmId: farm.id as FarmId,
      resource: input.resource,
      quantitySoldUnits: unitsOfEntry(existing),
      revenue: existing.amount,
      balanceAfter: existing.balanceAfter,
      usage: storageUsageOf(farm, input.resource),
      entry: existing,
      replayed: true,
    };
  }

  const farm = await requireFarm(tx, playerId, input.farmId);
  const available = storageUsageOf(farm, input.resource).storedUnits;
  const requested = input.quantityUnits ?? available;

  if (requested <= 0) {
    // Reached only through "sell everything" on an empty store: the contract rejects an
    // explicit zero before the handler runs. It is a refusal and not a no-op, because a
    // reply of "sold 0" would look like a successful sale in the panel.
    throw new ApiError(ValidationCode.QUANTITY_NOT_POSITIVE, {
      requiredUnits: requested,
      availableUnits: available,
    });
  }
  if (requested > available) {
    throw insufficientStock(requested, available);
  }

  const withdrawal = await withdrawStorage(tx, farm.id, input.resource, requested);
  if (!withdrawal.ok) {
    // The stock moved between the reading and the update, which is the concurrent sale.
    throw insufficientStock(requested, withdrawal.usage.storedUnits);
  }

  const revenue = saleRevenue(input.resource, requested);
  const type = SALE_LEDGER_TYPE[input.resource];
  const written = await credit(tx, ctx.lock, {
    type,
    amount: revenue,
    atGameMs: reading.gameNow,
    atRealMs: reading.atRealMs,
    idempotencyKey: input.idempotencyKey,
    refType: 'FARM',
    refId: farm.id,
    meta: {
      resource: input.resource,
      units: requested,
      pricePerStoredUnit: Money.toString(pricePerStoredUnit(input.resource)),
      gddSection: 123,
    },
  });
  services.metrics.ledgerEntries.inc({ type });

  return {
    farmId: farm.id as FarmId,
    resource: input.resource,
    quantitySoldUnits: requested,
    revenue,
    balanceAfter: written.balanceAfter,
    usage: withdrawal.usage,
    entry: written.entry,
    replayed: written.replayed,
  };
}

/** The quantity a replayed sale reports, taken from the `meta` its entry carries. */
function unitsOfEntry(entry: LedgerEntry): number {
  const units = entry.meta === null ? undefined : entry.meta['units'];
  return typeof units === 'number' ? units : 0;
}
