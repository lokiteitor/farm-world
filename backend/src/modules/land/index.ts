// Module `land`: the quote of a selection and the purchase of the cells it can buy.
//
// Owner: workflow W4-A. Replaces the scaffolding workflow W3-A left with the definitive
// path and signature (plan section 11, rule 3): `src/app.ts` and the route registry were
// not touched, only the body of this module. `defineStubRoute` became `defineRoute`, in
// place.
//
// The shape of the module:
//
//   - `service.ts` is the domain: the normalisation of a selection, the quote and the
//     purchase. It knows nothing about HTTP.
//   - `routes.ts` is the HTTP surface, which is the conversion between the wire types and
//     the domain types and nothing else.
//
// The grid is reached only through `modules/world/service.ts`, which is the internal API
// of the earlier phase and the one place that defines effective terrain, ownership and
// claiming. `land`, `farms` and `fields` are siblings of this phase and never import each
// other; anything they share goes through the world module (`docs/ownership.md`, rule 4).
//
// The two rules of the GDD this module enforces, and where they live:
//
//   - Only grass and forest can be bought, and a cell that already has an owner is not on
//     the market (GDD sections 8, 13 and 14). The rule is `canPurchase` of
//     `shared/rules/selection.ts`, which the client calls while dragging.
//   - The price is `basePriceByTerrain x locationMultiplier x accessibilityMultiplier`,
//     with grass at 120, forest at 70 and both multipliers fixed at 1.0 for the MVP (GDD
//     section 115). The rule is `cellPrice` of `shared/rules/pricing.ts` and the numbers
//     are in `shared/config/economy.ts`.
//
// Buying changes ownership and nothing else: it creates no field (GDD sections 13 and 14),
// and buying forest materialises no trees, which happens when the forest plot is created
// (plan section 2.2).

export { registerLandRoutes } from './routes.js';

export {
  normaliseSelection,
  purchaseLand,
  quoteSelection,
  type LandPurchaseInput,
  type LandPurchaseOutcome,
  type LandQuote,
  type QuotedCell,
  type TerrainSubtotal,
} from './service.js';
