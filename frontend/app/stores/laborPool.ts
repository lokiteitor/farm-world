// The hiring pool.
//
// Owner: W3-C.
//
// The pool is per player and is replaced whole (`WORKER_POOL_UPSERTED`), so this is the
// one collection that is not keyed by identifier: a candidate has no life of its own
// between refreshes and the order the server sent is the order the panel shows. A pool
// per player is what keeps two players from contending for the same candidate, which is
// the contention the MVP avoids explicitly (plan section 5.2).

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  Money,
  POOL_REFRESH_INTERVAL_GAME_HOURS,
  bp,
  fromWireGameMs,
  fromWireMoney,
  skillFactor,
  type GameMs,
  type WorkerCandidateDto,
} from '~/shared/index';

export const useLaborPoolStore = defineStore('laborPool', () => {
  const candidates = ref<readonly WorkerCandidateDto[]>([]);
  /** Wire form kept as sent, so nothing is lost when the world is paused. */
  const nextRefreshAtGameMs = ref<string | null>(null);

  const count = computed(() => candidates.value.length);

  const nextRefresh = computed<GameMs | null>(() =>
    nextRefreshAtGameMs.value === null ? null : fromWireGameMs(nextRefreshAtGameMs.value),
  );

  /** Cheapest asking wage of the pool, which is the figure the tab badge shows. */
  const cheapestSalary = computed(() => {
    const wages = candidates.value.map((candidate) =>
      fromWireMoney(candidate.askingSalaryPerGameHour),
    );
    return wages.length === 0 ? null : wages.reduce((best, wage) => Money.min(best, wage));
  });

  /** Interval between refreshes, in game hours (GDD section 102, plan section 2.2). */
  const refreshIntervalGameHours = POOL_REFRESH_INTERVAL_GAME_HOURS;

  function get(candidateId: string): WorkerCandidateDto | undefined {
    return candidates.value.find((candidate) => candidate.id === candidateId);
  }

  /** Duration multiplier a candidate would bring (GDD section 103). */
  function factorOf(candidateId: string): number {
    const candidate = get(candidateId);
    return candidate === undefined ? 0 : skillFactor(bp(candidate.skillBp));
  }

  function applyPool(next: {
    readonly candidates: readonly WorkerCandidateDto[];
    readonly nextRefreshAtGameMs: string | null;
  }): void {
    candidates.value = next.candidates;
    nextRefreshAtGameMs.value = next.nextRefreshAtGameMs;
  }

  function reset(): void {
    candidates.value = [];
    nextRefreshAtGameMs.value = null;
  }

  return {
    candidates,
    nextRefreshAtGameMs,
    count,
    nextRefresh,
    cheapestSalary,
    refreshIntervalGameHours,
    get,
    factorOf,
    applyPool,
    reset,
  };
});
