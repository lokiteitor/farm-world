// Ordering and filtering of the field listing.
//
// Owner: W4-E.
//
// Pure and separate from the component for one reason: the order of a table is the part a
// reader of the code cannot check by looking at a template, and the part a change of
// requirement touches most often. Nothing here reads a store, a clock or a locale that is
// not passed in.
//
// The row itself is built by the panel, because it needs the projections of
// `stores/fields.ts` at the instant of the local clock; what this module takes is the
// finished row.

import { type CropCycleState, type CropId, type TaskOperation } from '~/shared/index';

/** One line of the listing, already projected to the instant the panel is showing. */
export interface FieldRow {
  readonly id: string;
  readonly name: string;
  readonly cellCount: number;
  readonly hectares: number;
  readonly state: CropCycleState;
  readonly cropId: CropId | null;
  /** Game milliseconds until the next automatic boundary, or null when there is none. */
  readonly remainingGameMs: bigint | null;
  readonly operation: TaskOperation | null;
  readonly hasActiveTask: boolean;
  readonly expectedYieldLiters: number;
}

export const FieldSort = {
  NAME: 'NAME',
  SURFACE: 'SURFACE',
  STATE: 'STATE',
  REMAINING: 'REMAINING',
  YIELD: 'YIELD',
} as const;
export type FieldSort = (typeof FieldSort)[keyof typeof FieldSort];

export const FIELD_SORT_LABELS: Readonly<Record<FieldSort, string>> = {
  NAME: 'Nombre',
  SURFACE: 'Superficie',
  STATE: 'Estado',
  REMAINING: 'Tiempo restante',
  YIELD: 'Rendimiento previsto',
};

export const FieldFilter = {
  ALL: 'ALL',
  /** Fields whose cycle is waiting for the player rather than for the clock. */
  ACTIONABLE: 'ACTIONABLE',
  WITH_TASK: 'WITH_TASK',
  READY: 'READY',
} as const;
export type FieldFilter = (typeof FieldFilter)[keyof typeof FieldFilter];

export const FIELD_FILTER_LABELS: Readonly<Record<FieldFilter, string>> = {
  ALL: 'Todos',
  ACTIONABLE: 'A la espera del jugador',
  WITH_TASK: 'Con tarea en curso',
  READY: 'Listos para cosechar',
};

/**
 * States in which nothing happens without an order of the player.
 *
 * Taken from the trigger of the transition table and not from a list written here: a state
 * whose only outgoing transitions are automatic is waiting for the clock, and any other is
 * waiting for a task (GDD section 76, shared/config/transitions.ts). The panel passes the
 * set it derived, so this module states no rule of its own.
 */
export function isActionable(
  row: FieldRow,
  actionableStates: ReadonlySet<CropCycleState>,
): boolean {
  return !row.hasActiveTask && actionableStates.has(row.state);
}

export function matchesFilter(
  row: FieldRow,
  filter: FieldFilter,
  actionableStates: ReadonlySet<CropCycleState>,
  readyState: CropCycleState,
): boolean {
  switch (filter) {
    case FieldFilter.ALL:
      return true;
    case FieldFilter.ACTIONABLE:
      return isActionable(row, actionableStates);
    case FieldFilter.WITH_TASK:
      return row.hasActiveTask;
    case FieldFilter.READY:
      return row.state === readyState;
  }
}

/** Case and accent insensitive contains, which is what a Spanish name search needs. */
export function matchesText(row: FieldRow, text: string): boolean {
  const needle = normalise(text);
  return needle.length === 0 || normalise(row.name).includes(needle);
}

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es-ES');
}

/**
 * Sorts a copy of the rows.
 *
 * `remainingGameMs` sorts nulls last whatever the direction: a field with no countdown is
 * not "in zero hours", it is out of the timed part of the cycle, and putting it first would
 * bury the field that is about to be ready.
 */
export function sortRows(
  rows: readonly FieldRow[],
  sort: FieldSort,
  descending: boolean,
  stateOrder: readonly CropCycleState[],
): readonly FieldRow[] {
  const direction = descending ? -1 : 1;
  const rank = (state: CropCycleState): number => {
    const index = stateOrder.indexOf(state);
    return index < 0 ? stateOrder.length : index;
  };
  return [...rows].sort((left, right) => {
    switch (sort) {
      case FieldSort.NAME:
        return direction * left.name.localeCompare(right.name, 'es-ES');
      case FieldSort.SURFACE:
        return direction * (left.hectares - right.hectares);
      case FieldSort.STATE:
        return direction * (rank(left.state) - rank(right.state));
      case FieldSort.YIELD:
        return direction * (left.expectedYieldLiters - right.expectedYieldLiters);
      case FieldSort.REMAINING: {
        if (left.remainingGameMs === null && right.remainingGameMs === null) {
          return 0;
        }
        if (left.remainingGameMs === null) {
          return 1;
        }
        if (right.remainingGameMs === null) {
          return -1;
        }
        const delta = left.remainingGameMs - right.remainingGameMs;
        return direction * (delta === 0n ? 0 : delta < 0n ? -1 : 1);
      }
    }
  });
}
