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
// WHAT IS PRICED, since this is what changed when the catalogue grew past one crop. The
// price belongs to the crop and not to the storage category: pricing by category would make
// the twenty two crops of `GRAIN_LITERS` worth the same per litre, and the player would
// always sow whichever yields the most litres per hour, collapsing sixty two crops into
// four decisions. So stock is held as one pile per crop (`farm_stock`) and a sale names a
// pile, while the category only decides which store had to be built.
//
// The unit is the part that is easy to get wrong. Stock is always an integer in the stored
// unit (ADR-0013): litres for every crop, cubic decimetres for wood. The sale price of GDD
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
  CROPS,
  CROP_IDS,
  DM3_PER_M3,
  LedgerType,
  Money,
  PINE,
  STORAGE_RESOURCE_UNITS,
  StorageResource,
  ValidationCode,
  cropSaleRevenue,
  insufficientStock,
  woodSaleRevenue,
  type FarmId,
  type LedgerEntry,
  type MarketPrice,
  type StockItem,
  type StorageUsage,
} from '../../shared/index.js';
import {
  loadFarmStock,
  loadFarmStorage,
  requireFarm,
  storageUsageOf,
  withdrawStorage,
  type FarmStockRow,
} from '../farms/service.js';

/** Whether a pile is timber rather than a crop. The one case the catalogue does not hold. */
function isWood(item: StockItem): item is 'WOOD' {
  return item === 'WOOD';
}

/** The storage category a pile belongs to. Mirrors `farm_world_stock_item_category`. */
export function categoryOfItem(item: StockItem): StorageResource {
  return isWood(item) ? StorageResource.WOOD_M3 : CROPS[item].storageResource;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * The ledger kind a sale of each category is recorded under. Declared as a table keyed by
 * the union so that a category added to the vocabulary does not compile until it has a
 * kind, instead of falling through a `switch` into a wrong entry.
 *
 * Keyed by category and not by pile on purpose: sixty two entries all reading `CROP_SALE`
 * would be a table that says nothing, and the ledger has never distinguished one crop from
 * another.
 */
export const SALE_LEDGER_TYPE: Readonly<Record<StorageResource, LedgerType>> = {
  GRAIN_LITERS: LedgerType.CROP_SALE,
  FORAGE_LITERS: LedgerType.CROP_SALE,
  PRODUCE_LITERS: LedgerType.CROP_SALE,
  INDUSTRIAL_LITERS: LedgerType.CROP_SALE,
  WOOD_M3: LedgerType.WOOD_SALE,
};

/**
 * Price of one stored unit (GDD sections 82, 123 and 133).
 *
 * A crop is priced per litre and the stored unit is the litre, so the catalogue value is
 * used unchanged. Wood is priced per cubic metre and stored per cubic decimetre, so the
 * catalogue value is divided by `DM3_PER_M3` over the scaled integer representation, never
 * with floating point.
 */
export function pricePerStoredUnit(item: StockItem): Money {
  return isWood(item)
    ? Money.fromScaled(Money.toScaled(PINE.sellPricePerM3) / BigInt(DM3_PER_M3))
    : CROPS[item].sellPricePerLiter;
}

/** Price of one display unit, for the panel. Derived, and never used in a calculation. */
export function pricePerDisplayUnit(item: StockItem): Money {
  return isWood(item) ? PINE.sellPricePerM3 : CROPS[item].sellPricePerLiter;
}

/**
 * Revenue of selling a quantity in the stored unit (GDD sections 123 and 133).
 *
 * It goes through the shared rules rather than multiplying by `pricePerStoredUnit`, so the
 * figure the market pays and the figure `liquidationValue` uses to decide whether a forced
 * liquidation is needed come from one implementation.
 */
export function saleRevenue(item: StockItem, units: number): Money {
  const whole = units > 0 ? Math.floor(units) : 0;
  return isWood(item) ? woodSaleRevenue(PINE, whole) : cropSaleRevenue(CROPS[item], whole);
}

/**
 * The whole price list: one line per crop, plus timber.
 *
 * `CROP_IDS` is walked explicitly rather than `Object.keys(CROPS)`, so the order of the
 * reply is the catalogue order and not whatever the object literal happens to enumerate.
 */
export function marketPrices(): readonly MarketPrice[] {
  const items: readonly StockItem[] = [...CROP_IDS, 'WOOD'];
  return items.map((item): MarketPrice => {
    const category = categoryOfItem(item);
    const units = STORAGE_RESOURCE_UNITS[category];
    return {
      item,
      category,
      pricePerStoredUnit: Money.toString(pricePerStoredUnit(item)),
      storedUnit: units.storedUnit,
      pricePerDisplayUnit: Money.toString(pricePerDisplayUnit(item)),
      displayUnit: units.displayUnit,
    };
  });
}

/** Market value of one pile, which is what the inventory reply reports per line. */
export function stockMarketValue(stock: FarmStockRow): Money {
  return saleRevenue(stock.item, stock.storedUnits);
}

// ---------------------------------------------------------------------------
// The sale
// ---------------------------------------------------------------------------

export interface SellStockInput {
  readonly farmId: string;
  /** The pile being sold: one crop, or timber. */
  readonly item: StockItem;
  /** Quantity in the stored unit, or null for the whole stock of that pile. */
  readonly quantityUnits: number | null;
  /** Idempotency key of the ledger entry, derived from the header by the route. */
  readonly idempotencyKey: string;
}

export interface SellStockOutcome {
  readonly farmId: FarmId;
  readonly item: StockItem;
  readonly category: StorageResource;
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

  const category = categoryOfItem(input.item);
  const existing = await findEntryByKey(tx, playerId, input.idempotencyKey);
  if (existing !== null) {
    const farm = await requireFarm(tx, playerId, input.farmId);
    const storage = await loadFarmStorage(tx, [farm.id]);
    return {
      farmId: farm.id as FarmId,
      item: input.item,
      category,
      quantitySoldUnits: unitsOfEntry(existing),
      revenue: existing.amount,
      balanceAfter: existing.balanceAfter,
      usage: storageUsageOf(storage, category),
      entry: existing,
      replayed: true,
    };
  }

  const farm = await requireFarm(tx, playerId, input.farmId);
  // The stock of the pile, not of the category: a farm holding barley must not be able to
  // sell wheat it does not have, even though both count against the same silo.
  const stock = await loadFarmStock(tx, [farm.id]);
  const available = stock.find((row) => row.item === input.item)?.storedUnits ?? 0;
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

  const withdrawal = await withdrawStorage(tx, farm.id, input.item, category, requested);
  if (!withdrawal.ok) {
    // The stock moved between the reading and the update, which is the concurrent sale.
    throw insufficientStock(requested, withdrawal.usage.storedUnits);
  }

  const revenue = saleRevenue(input.item, requested);
  const type = SALE_LEDGER_TYPE[category];
  const written = await credit(tx, ctx.lock, {
    type,
    amount: revenue,
    atGameMs: reading.gameNow,
    atRealMs: reading.atRealMs,
    idempotencyKey: input.idempotencyKey,
    refType: 'FARM',
    refId: farm.id,
    meta: {
      item: input.item,
      category,
      units: requested,
      pricePerStoredUnit: Money.toString(pricePerStoredUnit(input.item)),
      gddSection: 123,
    },
  });
  services.metrics.ledgerEntries.inc({ type });

  return {
    farmId: farm.id as FarmId,
    item: input.item,
    category,
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
