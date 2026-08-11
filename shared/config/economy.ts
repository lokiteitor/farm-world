// Economic constants: starting capital, land price, debt and liquidation.
//
// Owner: workflow W2 (vocabulary).
//
// Every figure comes from the GDD without adjustment, by decision of the plan
// (section 1). The numbers of GDD sections 118, 119 and 138 that do not reproduce
// with this catalogue are documented as deviations in the balance report, and
// nothing is tuned to make them fit.

import { type TerrainType } from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { bp, type Bp } from '../domain/units.js';

/**
 * Starting capital (GDD section 117). Sized there as 13 900 above the 146 100 of
 * the minimum setup, so that the player cannot afford the workshop, a second worker
 * or the cultivator on day one.
 */
export const STARTING_CAPITAL = Money.fromUnits(160_000);

/**
 * Base price of a cell by terrain (GDD section 115). Mountain and water are not
 * purchasable (GDD sections 8, 11 and 12), which is expressed as the absence of a
 * price rather than as a flag: a null price and a "not purchasable" flag would be
 * two sources of the same truth.
 */
export const BASE_PRICE_BY_TERRAIN: Readonly<Record<TerrainType, Money | null>> = {
  GRASS: Money.fromUnits(120),
  FOREST: Money.fromUnits(70),
  MOUNTAIN: null,
  WATER: null,
};

/**
 * Location and accessibility multipliers, fixed at 1.0 for the MVP (GDD sections
 * 115 and 126). They exist as constants so that the price formula of shared/rules
 * has its final shape from the start.
 */
export const LOCATION_MULTIPLIER_BP: Bp = bp(10_000);
export const ACCESSIBILITY_MULTIPLIER_BP: Bp = bp(10_000);

/**
 * Overdraft interest per game hour, as a fraction of the negative balance. Zero by
 * default (plan section 6.6): it is the fourth kind of accrual and exists so that
 * debt has a lever available without a migration, but with the unadjusted values of
 * GDD sections 118 and 119 a negative balance is the expected state of the first
 * cycle, and charging interest on it would only deepen a deficit the GDD already
 * documents.
 */
export const OVERDRAFT_INTEREST_BP_PER_GAME_HOUR: Bp = bp(0);

/**
 * Fraction of the purchase price recovered when an asset is sold back, whether
 * voluntarily or in a forced liquidation. Invented value: the GDD defines no resale
 * price. 60 % keeps buying and immediately reselling from being a free option,
 * which would otherwise turn the garage capacity of GDD section 96 into a
 * reversible decision and remove the strategic weight GDD section 65 asks for.
 *
 * For machinery the resale value is additionally scaled by condition, so a worn
 * machine is worth less; the formula lives in shared/rules/pricing.
 */
export const RESALE_FACTOR_BP: Bp = bp(6000);

/**
 * Debt threshold that triggers forced liquidation, as a fraction of the liquidatable
 * value of the holding (plan section 6.6). Invented value: the GDD does not define
 * bankruptcy. 30 % leaves room for the deficit of the first cycle, which GDD section
 * 119 already predicts, without letting the debt grow past the point where selling
 * assets can still cover it.
 */
export const LIQUIDATION_DEBT_THRESHOLD_BP: Bp = bp(3000);

/**
 * Deterministic and published order of a forced liquidation (plan section 6.6). One
 * ledger entry per asset, so that the return summary can explain what was sold.
 * Stock first because it is fungible and its sale destroys no capability; land
 * without a field last because it is the only asset whose loss is irreversible in
 * practice, as buying it back competes with the debt itself.
 */
export const LIQUIDATION_STEPS = [
  'INVENTORY',
  'IDLE_MACHINES',
  'CANCEL_TASKS',
  'WORKERS',
  'BUILDINGS',
  'UNUSED_LAND',
] as const;
export type LiquidationStep = (typeof LIQUIDATION_STEPS)[number];
