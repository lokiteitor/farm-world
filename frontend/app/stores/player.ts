// The player: identity, balance, day counter and the recent ledger.
//
// Owner: W3-C.
//
// Two balances travel and the store keeps both apart, because merging them would create
// money out of nothing (shared/api/schemas/state.ts): `balance` is settled and is what
// an affordability check compares against, `projectedBalance` is the same figure carried
// forward by the continuous costs and is what the top bar shows. The interface shows the
// projection and every "can I pay for this" question is answered by the server against
// the settled one.
//
// The recent ledger lives here and not in a store of its own. The store list of plan
// section 9.6 has no ledger slice, `ledgerSeq` is a column of the player, and what the
// interface needs is the last few entries so that the top bar can explain a balance that
// just moved. A page of history is a request, not state.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  GAME_HOURS_PER_GAME_DAY,
  MS_PER_GAME_HOUR,
  Money,
  PlayerStatus,
  fromWireGameMs,
  fromWireMoney,
  holdingRatePerGameHour,
  type GameMs,
  type HoldingRate,
  type LedgerEntryDto,
  type PlayerDto,
} from '~/shared/index';
import { useMachinesStore } from '~/stores/machines';
import { useWorkersStore } from '~/stores/workers';

/** Entries kept for the top bar and the notice layer. A page of history is a request. */
export const RECENT_LEDGER_LIMIT = 50;

export const usePlayerStore = defineStore('player', () => {
  const dto = ref<PlayerDto | null>(null);
  const recentLedger = ref<readonly LedgerEntryDto[]>([]);
  const firstSession = ref(false);
  const welcomeBackPending = ref(false);

  const machines = useMachinesStore();
  const workers = useWorkersStore();

  const id = computed(() => dto.value?.id ?? null);
  const displayName = computed(() => dto.value?.displayName ?? '');
  const settledBalance = computed(() =>
    dto.value === null ? Money.ZERO : fromWireMoney(dto.value.balance),
  );
  const projectedBalance = computed(() =>
    dto.value === null ? Money.ZERO : fromWireMoney(dto.value.projectedBalance),
  );
  const inDebt = computed(() => dto.value?.status === PlayerStatus.IN_DEBT);
  const eventSeq = computed(() => dto.value?.eventSeq ?? 0);

  /**
   * Hourly burn rate as the server reported it (GDD section 107). It is authoritative
   * and is what the top bar shows.
   */
  const holdingCostPerGameHour = computed(() =>
    dto.value === null ? Money.ZERO : fromWireMoney(dto.value.holdingCostPerGameHour),
  );

  /**
   * The same rate recomputed locally from the payroll and the machinery, with the shared
   * rule and the shared catalogue.
   *
   * It is not redundant: it is what lets a panel show the breakdown into wages,
   * maintenance and operation without a request, and it is the figure a "what if I hire
   * this candidate" preview is built on. A divergence from the server figure is a
   * synchronisation problem and is worth surfacing rather than hiding, which is what
   * `holdingCostMatchesServer` is for.
   */
  const localHoldingRate = computed<HoldingRate>(() =>
    holdingRatePerGameHour({
      workers: workers.all.map((worker) => ({
        salaryPerGameHour: fromWireMoney(worker.salaryPerGameHour),
      })),
      machines: machines.all.map((machine) => ({ type: machine.type, status: machine.status })),
    }),
  );

  const holdingCostMatchesServer = computed(
    () =>
      Money.compare(localHoldingRate.value.totalPerGameHour, holdingCostPerGameHour.value) === 0,
  );

  /**
   * The player's own day number (GDD section 61, plan section 2.2). The server sends it
   * and the client recomputes it from `startedAtGameMs` so that the counter advances
   * between replies instead of freezing until the next one.
   */
  function dayNumberAt(atGameMs: GameMs): number {
    const current = dto.value;
    if (current === null) {
      return 1;
    }
    const started = fromWireGameMs(current.startedAtGameMs);
    const elapsed = atGameMs - started;
    if (elapsed <= 0n) {
      return 1;
    }
    const hours = elapsed / MS_PER_GAME_HOUR;
    return Number(hours / BigInt(GAME_HOURS_PER_GAME_DAY)) + 1;
  }

  function applyPlayer(next: PlayerDto): void {
    dto.value = next;
  }

  /** Patches the balance from the `balanceAfter` of a mutating reply. */
  function applyBalance(balance: string): void {
    const current = dto.value;
    if (current === null) {
      return;
    }
    dto.value = { ...current, balance, projectedBalance: balance };
  }

  function applyLastSummaryGameMs(lastSummaryGameMs: string): void {
    const current = dto.value;
    if (current === null) {
      return;
    }
    dto.value = { ...current, lastSummaryGameMs };
    welcomeBackPending.value = false;
  }

  function appendLedger(entries: readonly LedgerEntryDto[]): void {
    const merged = [...recentLedger.value, ...entries];
    merged.sort((left, right) => left.seq - right.seq);
    const deduplicated: LedgerEntryDto[] = [];
    for (const entry of merged) {
      if (deduplicated.at(-1)?.seq !== entry.seq) {
        deduplicated.push(entry);
      }
    }
    recentLedger.value = deduplicated.slice(-RECENT_LEDGER_LIMIT);
  }

  function setFirstSession(value: boolean): void {
    firstSession.value = value;
  }

  function setWelcomeBackPending(value: boolean): void {
    welcomeBackPending.value = value;
  }

  function reset(): void {
    dto.value = null;
    recentLedger.value = [];
    firstSession.value = false;
    welcomeBackPending.value = false;
  }

  return {
    dto,
    recentLedger,
    firstSession,
    welcomeBackPending,
    id,
    displayName,
    settledBalance,
    projectedBalance,
    inDebt,
    eventSeq,
    holdingCostPerGameHour,
    localHoldingRate,
    holdingCostMatchesServer,
    dayNumberAt,
    applyPlayer,
    applyBalance,
    applyLastSummaryGameMs,
    appendLedger,
    setFirstSession,
    setWelcomeBackPending,
    reset,
  };
});
