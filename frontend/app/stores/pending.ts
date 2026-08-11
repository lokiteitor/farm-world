// Optimistic state, isolated.
//
// Owner: W3-C.
//
// This is the store that keeps the client honest. The pillar of the whole design is that
// the server is authoritative (GDD section 54) and the client is a cache (plan section 7),
// and the usual way a client betrays that pillar is optimistic updates: it writes the
// expected outcome into the domain state, and from that moment the interface is showing a
// prediction it cannot distinguish from a fact.
//
// So the optimistic state lives here, indexed by idempotency key, and it decorates the
// rendering and nothing else: cells drawn as pending, a button disabled, a spinner on a
// row. No domain store is ever written before the server answers. The index is the
// idempotency key because that is what identifies one attempt of the player across its
// retries, which is exactly the identity a "this is in flight" marker needs.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { cellKey, type ApiErrorCode, type ApiRouteKey, type CellCoordWire } from '~/shared/index';

export const PendingState = {
  IN_FLIGHT: 'IN_FLIGHT',
  /** The server accepted it. Kept for a moment so the interface can settle. */
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
} as const;
export type PendingState = (typeof PendingState)[keyof typeof PendingState];

export interface PendingOperation {
  readonly idempotencyKey: string;
  readonly routeKey: ApiRouteKey;
  readonly state: PendingState;
  readonly startedAtRealMs: number;
  readonly settledAtRealMs: number | null;
  /** Cells the operation is about, drawn as pending by the renderer. */
  readonly cells: readonly CellCoordWire[];
  /** Entity the operation is about, so a row can show a spinner. */
  readonly subjectKind: string | null;
  readonly subjectId: string | null;
  /** Why it failed. Null while in flight or once confirmed. */
  readonly failureCode: ApiErrorCode | null;
}

export interface PendingStart {
  readonly idempotencyKey: string;
  readonly routeKey: ApiRouteKey;
  readonly startedAtRealMs: number;
  readonly cells?: readonly CellCoordWire[];
  readonly subjectKind?: string;
  readonly subjectId?: string;
}

export const usePendingStore = defineStore('pending', () => {
  const byKey = ref<Record<string, PendingOperation>>({});

  const all = computed<readonly PendingOperation[]>(() => Object.values(byKey.value));
  const inFlight = computed(() =>
    all.value.filter((operation) => operation.state === PendingState.IN_FLIGHT),
  );
  const busy = computed(() => inFlight.value.length > 0);

  /**
   * Cells any in flight operation is about, as a set of packed keys. The renderer paints
   * these in the pending colour, which is the whole visible effect of this store.
   */
  const pendingCellKeys = computed<ReadonlySet<number>>(() => {
    const keys = new Set<number>();
    for (const operation of inFlight.value) {
      for (const cell of operation.cells) {
        keys.add(cellKey(cell.cellX, cell.cellY));
      }
    }
    return keys;
  });

  function get(idempotencyKey: string): PendingOperation | undefined {
    return byKey.value[idempotencyKey];
  }

  /** Whether a route has an attempt in flight, which is what disables a button. */
  function isRouteBusy(routeKey: ApiRouteKey): boolean {
    return inFlight.value.some((operation) => operation.routeKey === routeKey);
  }

  /** Whether an entity has an attempt in flight, which is what disables a row. */
  function isSubjectBusy(subjectKind: string, subjectId: string): boolean {
    return inFlight.value.some(
      (operation) => operation.subjectKind === subjectKind && operation.subjectId === subjectId,
    );
  }

  function start(input: PendingStart): void {
    byKey.value[input.idempotencyKey] = {
      idempotencyKey: input.idempotencyKey,
      routeKey: input.routeKey,
      state: PendingState.IN_FLIGHT,
      startedAtRealMs: input.startedAtRealMs,
      settledAtRealMs: null,
      cells: input.cells ?? [],
      subjectKind: input.subjectKind ?? null,
      subjectId: input.subjectId ?? null,
      failureCode: null,
    };
  }

  function confirm(idempotencyKey: string, atRealMs: number): void {
    const operation = byKey.value[idempotencyKey];
    if (operation === undefined) {
      return;
    }
    byKey.value[idempotencyKey] = {
      ...operation,
      state: PendingState.CONFIRMED,
      settledAtRealMs: atRealMs,
    };
  }

  function fail(idempotencyKey: string, code: ApiErrorCode, atRealMs: number): void {
    const operation = byKey.value[idempotencyKey];
    if (operation === undefined) {
      return;
    }
    byKey.value[idempotencyKey] = {
      ...operation,
      state: PendingState.FAILED,
      settledAtRealMs: atRealMs,
      failureCode: code,
    };
  }

  function forget(idempotencyKey: string): void {
    delete byKey.value[idempotencyKey];
  }

  /** Drops settled entries older than a horizon, so the map does not grow forever. */
  function prune(beforeRealMs: number): void {
    for (const [key, operation] of Object.entries(byKey.value)) {
      if (operation.settledAtRealMs !== null && operation.settledAtRealMs < beforeRealMs) {
        delete byKey.value[key];
      }
    }
  }

  function reset(): void {
    byKey.value = {};
  }

  return {
    byKey,
    all,
    inFlight,
    busy,
    pendingCellKeys,
    get,
    isRouteBusy,
    isSubjectBusy,
    start,
    confirm,
    fail,
    forget,
    prune,
    reset,
  };
});
