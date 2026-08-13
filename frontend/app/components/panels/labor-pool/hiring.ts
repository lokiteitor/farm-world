// The hiring decision, as a pure function.
//
// Owner: W5-F. Read by the hiring pool panel and by its suite.
//
// GDD section 102 states the rule in one line — `HIRE(candidateId) -> validar dinero +
// espacio en Worker Home` — and the server implements it in that order
// (`backend/src/modules/workers/service.ts`): the candidate must still be offered, the
// balance must not be negative, and the home must have a place. This module is that order
// and nothing else, so the panel and the 400 cannot disagree (ADR-0032).
//
// What "validar dinero" means is worth stating, because it is not what it looks like.
// Hiring charges nothing: there is no hiring fee in the catalogue and no severance in GDD
// section 109, so both routes of the area move no money and carry no idempotency key. The
// money check is the debt gate of plan section 6.6, which blocks discretionary commitments
// while the settled balance is negative. What the player is really deciding about is the
// burn rate of GDD section 107, and that is why `payrollAfterHire` exists.

import {
  Money,
  ValidationCode,
  fromWireMoney,
  type GameMs,
  type WorkerCandidateDto,
} from '~/shared/index';

export interface HireSituation {
  /** The candidate, or null when it is no longer in the pool the client holds. */
  readonly candidate: WorkerCandidateDto | null;
  /** Settled balance. Negative blocks discretionary commitments (plan section 6.6). */
  readonly settledBalance: Money;
  /** Free places over the worker homes of the farm (GDD section 108). */
  readonly freeHomeSlots: number;
}

/** Why a hire would be refused, or null when it would be accepted. */
export function hireBlockingCode(situation: HireSituation): ValidationCode | null {
  if (situation.candidate === null) {
    return ValidationCode.CANDIDATE_NOT_AVAILABLE;
  }
  if (Money.isNegative(situation.settledBalance)) {
    return ValidationCode.SPENDING_BLOCKED_IN_DEBT;
  }
  if (situation.freeHomeSlots <= 0) {
    return ValidationCode.HOME_CAPACITY_EXCEEDED;
  }
  return null;
}

/**
 * Wage bill per game hour once this candidate is on the payroll (GDD section 107).
 *
 * The asking salary is the salary: GDD section 102 puts negotiation outside the MVP, so
 * there is no offer to make and the figure the pool shows is the figure that will be
 * accrued from the moment of the hire.
 */
export function payrollAfterHire(
  currentTotalPerGameHour: Money,
  candidate: WorkerCandidateDto,
): Money {
  return Money.add(currentTotalPerGameHour, fromWireMoney(candidate.askingSalaryPerGameHour));
}

/**
 * Game time left until the pool is replaced, or null when the world is paused or the
 * server reported no next refresh.
 *
 * Clamped at zero rather than allowed to go negative: a refresh that is overdue because the
 * scheduled job has not run yet is "ahora" and not a negative countdown, which is the same
 * reading the rest of the interface gives to a materialising job that lags behind its
 * projection (plan section 6.5).
 */
export function refreshCountdown(nextRefreshAtGameMs: GameMs | null, nowGameMs: GameMs): bigint {
  if (nextRefreshAtGameMs === null) {
    return 0n;
  }
  const remaining = nextRefreshAtGameMs - nowGameMs;
  return remaining > 0n ? remaining : 0n;
}
