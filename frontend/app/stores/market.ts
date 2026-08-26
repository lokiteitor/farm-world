// Market prices.
//
// Owner: W3-C.
//
// The price model is fixed and does not fluctuate (GDD section 123), so this store holds
// a table and not a series. It exists as a store rather than as a constant because the
// prices are quoted per stored unit on the wire and the panel needs both readings, and
// because the day a fluctuation appears the shape of the state does not have to change.
//
// The revenue of a sale is computed with the shared rule and per stored unit, which is
// what keeps `revenue = price x quantity` exact in integer arithmetic.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  CROPS,
  Money,
  TREE_SPECIES_CATALOGUE,
  TreeSpecies,
  cropSaleRevenue,
  fromWireMoney,
  multiplyByCount,
  woodSaleRevenue,
  type MarketPrice,
  type StockItem,
  type StorageResource,
} from '~/shared/index';

export const useMarketStore = defineStore('market', () => {
  const prices = ref<readonly MarketPrice[]>([]);
  const atGameMs = ref<string | null>(null);

  const byItem = computed<Readonly<Record<string, MarketPrice>>>(() => {
    const index: Record<string, MarketPrice> = {};
    for (const price of prices.value) {
      index[price.item] = price;
    }
    return index;
  });

  function priceOf(item: StockItem): MarketPrice | undefined {
    return byItem.value[item];
  }

  /** Every price of one storage category, so the panel can group its rows. */
  function pricesOfCategory(category: StorageResource): readonly MarketPrice[] {
    return prices.value.filter((price) => price.category === category);
  }

  /**
   * Value of a quantity at the quoted price, in the stored unit of the resource. Exact:
   * `multiplyByCount` is integer arithmetic over the scaled amount, which is why the
   * quotation is per stored unit and not per display unit.
   */
  function valueOf(item: StockItem, quantityUnits: number): Money {
    const price = priceOf(item);
    if (price === undefined || quantityUnits <= 0) {
      return Money.ZERO;
    }
    return multiplyByCount(fromWireMoney(price.pricePerStoredUnit), Math.trunc(quantityUnits));
  }

  /**
   * Revenue of a sale computed with the shared rule instead of with the wire price.
   *
   * Both give the same figure, and this one is the answer to a different question: it is
   * the one `tools/balance` and the server use, so a panel that previews a sale with it
   * cannot drift from the amount the ledger will record (GDD sections 123 and 133).
   */
  function revenueOf(item: StockItem, quantityUnits: number): Money {
    if (quantityUnits <= 0) {
      return Money.ZERO;
    }
    // The price belongs to the crop, so the pile decides the figure. Wood is the one pile
    // the crop catalogue does not hold.
    return item === 'WOOD'
      ? woodSaleRevenue(TREE_SPECIES_CATALOGUE[TreeSpecies.PINE], quantityUnits)
      : cropSaleRevenue(CROPS[item], quantityUnits);
  }

  function applyPrices(next: {
    readonly prices: readonly MarketPrice[];
    readonly atGameMs: string;
  }) {
    prices.value = next.prices;
    atGameMs.value = next.atGameMs;
  }

  function reset(): void {
    prices.value = [];
    atGameMs.value = null;
  }

  return {
    prices,
    atGameMs,
    byItem,
    priceOf,
    pricesOfCategory,
    valueOf,
    revenueOf,
    applyPrices,
    reset,
  };
});
