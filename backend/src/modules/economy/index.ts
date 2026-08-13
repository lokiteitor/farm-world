// Module `economy`: stock, fixed prices, the ledger, the sale and the debt policy.
//
// Owner: workflow W5-C. Replaces the scaffolding workflow W3-A left with the definitive path
// and signature (plan section 11, rule 3): `src/app.ts` and the route registry were not
// touched, only the body of this module. `defineStubRoute` became `defineRoute`, in place.
//
// The shape of the module:
//
//   `market.ts`      the price of GDD section 123 and the sale of stock.
//   `readModel.ts`   the inventory as the contract carries it (GDD sections 27, 49 and 136).
//   `ledger.ts`      the query of the history, paged by sequence.
//   `debt.ts`        the readable half of the debt policy of plan section 6.6.
//   `liquidation.ts` the forced liquidation, in the published order.
//   `jobs.ts`        the registration of the liquidation as an extension of the sweep.
//   `routes.ts`      the HTTP surface, which converts and decides nothing.
//
// What this module is responsible for, stated once so the boundary is not guessed:
//
//   - It is the only place that turns stock into money. Farms hold the stock and
//     `modules/farms/service.ts` writes it; this module decides what a unit is worth and
//     when it changes hands.
//   - It owns the debt policy: the refusal a spending path raises while the balance is
//     negative, the overdraft interest as a fourth accrual with a rate of zero, and the
//     forced liquidation of plan section 6.6.
//   - It does not create, move or retire machines, workers or buildings as a service to
//     anybody. The forced liquidation disposes of them, which is the one path in the game
//     where an asset leaves the holding without the player asking, and it is described in
//     `liquidation.ts` rather than exposed as an API.
//
// The three siblings of this phase — `machinery`, `workers` and `economy` — never import each
// other (plan section 11, rule 4), so `assertDiscretionarySpendingAllowed` is exported for
// the workflows that come after and is not consumed by W5-A or W5-B. Until then a purchase
// with a negative balance is still refused, because `charge` of `lib/ledger.ts` is a
// conditional update and a negative balance covers nothing; what the shared helper adds is
// the code that names the state instead of the one that names the shortfall
// (`docs/handoff/NOTES-w5c.md`, item 3.5).

import { type FastifyInstance } from 'fastify';
import { registerEconomySweepHooks } from './jobs.js';
import { registerEconomyRoutes as registerRoutes } from './routes.js';

/**
 * Registers the routes of the area and the extension of the settlement sweep.
 *
 * The two are registered together because they are two halves of one policy: the sale is the
 * way out of debt and the liquidation is what happens when it is not taken. Invoked once by
 * `src/app.ts`.
 */
export function registerEconomyRoutes(app: FastifyInstance): void {
  registerRoutes(app);
  registerEconomySweepHooks();
}

export {
  forcedLiquidationHook,
  registerEconomySweepHooks,
  resetEconomySweepHookRegistration,
} from './jobs.js';

export {
  assertDiscretionarySpendingAllowed,
  debtOf,
  isInDebt,
  liquidationTrigger,
  type LiquidationTrigger,
} from './debt.js';

export {
  loadLiquidatableHolding,
  liquidationKey,
  runForcedLiquidation,
  type LiquidatedAsset,
  type LiquidationOutcome,
  type SkippedStep,
} from './liquidation.js';

export {
  SALE_LEDGER_TYPE,
  marketPrices,
  pricePerDisplayUnit,
  pricePerStoredUnit,
  saleRevenue,
  sellStock,
  stockMarketValue,
  type SellStockInput,
  type SellStockOutcome,
} from './market.js';

export {
  NO_LEDGER_FILTER,
  parseLedgerCursor,
  queryLedger,
  sumLedger,
  type LedgerPage,
  type LedgerQueryInput,
} from './ledger.js';

export {
  buildInventoryFarms,
  buildInventoryReply,
  toInventoryFarm,
  toInventoryLine,
} from './readModel.js';
