// The debt policy of plan section 6.6, in its readable part.
//
// Owner: workflow W5-C. Module `economy`.
//
// The GDD does not define bankruptcy and, with its values left unadjusted, a negative
// balance is the expected state of the first cycle: GDD section 118 costs 27 625 of holding
// against the 13 900 cushion of GDD section 117, and GDD section 119 answers with 4 554 of
// revenue. Debt is therefore not an edge case to be handled defensively; it is on the
// critical path and it has to be a designed state.
//
// The invariant the whole policy rests on: the balance only ever turns negative through the
// passage of time. Every acquisition compares against the settled balance inside its own
// transaction, and `lib/ledger.ts` enforces that structurally by giving `charge` a
// conditional update and reserving `accrue` for the four continuous kinds. So a debt is
// always the consequence of holding costs and is always explicable in the return summary.
//
// Four steps, and this file holds the first two:
//
//   1. A negative settled balance implies `IN_DEBT`. It blocks discretionary spending and
//      never blocks selling or assigning tasks, which are the only source of income;
//      blocking them would produce a permanent deadlock for a player whose only way out is
//      to sell. The derived status is applied by `applyDebtPolicy` of `lib/advancePlayer.ts`
//      on every advance; what this file adds is the refusal a spending path raises, with the
//      code the contract reserves for it (`SPENDING_BLOCKED_IN_DEBT`).
//   2. Overdraft interest as a fourth kind of accrual with a rate of zero. It is implemented
//      end to end — `OVERDRAFT_INTEREST` is one of `ACCRUAL_LEDGER_TYPES`, the integral is in
//      `shared/rules/holding.ts` and the settlement writes it like any other category — and
//      `OVERDRAFT_INTEREST_BP_PER_GAME_HOUR` is zero, so no entry is ever written today. That
//      is the point: it is a lever available without a migration, and charging interest on a
//      deficit the GDD itself documents would only deepen it.
//   3. Forced liquidation above a threshold. `liquidation.ts`.
//   4. `BANKRUPT` reserved and never produced.
//
// Why `assertDiscretionarySpendingAllowed` exists although `charge` would refuse anyway. A
// negative balance can never cover a positive amount, so `charge` returns
// `INSUFFICIENT_FUNDS` and nothing is spent either way; the distinction is what the player is
// told. "You cannot afford this" invites saving up, and "spending is blocked while you are in
// debt" names the state and points at the only exit. The two codes are separate in the
// contract for exactly that reason, and a spending route is expected to call this before it
// computes a price.

import {
  LIQUIDATION_DEBT_THRESHOLD_BP,
  Money,
  spendingBlockedInDebt,
  toWireMoney,
  type Bp,
  type LiquidationValueBreakdown,
} from '../../shared/index.js';

/** The debt of a balance: its negative part, as a positive magnitude. Zero when solvent. */
export function debtOf(settledBalance: Money): Money {
  return Money.isNegative(settledBalance) ? Money.negate(settledBalance) : Money.ZERO;
}

/** Whether the settled balance puts the player in `IN_DEBT` (plan section 6.6). */
export function isInDebt(settledBalance: Money): boolean {
  return Money.isNegative(settledBalance);
}

/**
 * Refuses discretionary spending while the settled balance is negative.
 *
 * The balance must be the settled one, read from the column inside the transaction, never
 * the projection: a check against the projection would let two concurrent purchases both
 * project the same unsettled costs away and create money out of nothing (plan section 6.2).
 */
export function assertDiscretionarySpendingAllowed(settledBalance: Money): void {
  if (isInDebt(settledBalance)) {
    throw spendingBlockedInDebt(toWireMoney(settledBalance));
  }
}

/** The reading that decides whether a forced liquidation runs. */
export interface LiquidationTrigger {
  /** Debt as a positive magnitude, zero when the balance is not negative. */
  readonly debt: Money;
  /** What the holding would fetch, in the order of `LIQUIDATION_STEPS`. */
  readonly liquidatable: LiquidationValueBreakdown;
  /** The fraction of the liquidatable value the debt has to pass. */
  readonly thresholdBp: Bp;
  /** The amount that fraction comes to. */
  readonly thresholdAmount: Money;
  readonly triggered: boolean;
}

/**
 * Whether the debt has passed the threshold of plan section 6.6.
 *
 * The threshold is proportional to what the holding could be sold for and not an absolute
 * figure, which is what makes it scale with the player: 30 % of the liquidatable value
 * leaves room for the deficit of the first cycle that GDD section 119 already predicts,
 * without letting the debt grow past the point where selling assets could still cover it.
 *
 * A holding worth nothing gives a threshold of zero, so any debt at all is "past" it. That
 * is correct and harmless: the liquidation then finds nothing to sell, writes nothing and
 * costs one query, because a player with no assets has nothing the policy could take.
 */
export function liquidationTrigger(
  settledBalance: Money,
  liquidatable: LiquidationValueBreakdown,
  thresholdBp: Bp = LIQUIDATION_DEBT_THRESHOLD_BP,
): LiquidationTrigger {
  const debt = debtOf(settledBalance);
  const thresholdAmount = Money.mulBp(liquidatable.total, thresholdBp);
  return {
    debt,
    liquidatable,
    thresholdBp,
    thresholdAmount,
    triggered: !Money.isZero(debt) && Money.compare(debt, thresholdAmount) > 0,
  };
}
