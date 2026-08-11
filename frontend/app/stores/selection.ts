// The selection: the set of cells the player is drawing, and its verdict.
//
// Owner: W3-C. The interaction machine of W5-E drives it; the panels read it.
//
// The rectangle is the tool and the set is the state. GDD section 17 asks for arbitrary
// shapes and plan section 9.5 resolves that without a freehand tool: union, subtraction
// and per cell toggling over rectangles produce every shape the domain needs, and what
// travels to the server is the explicit set of cells, never a list of rectangles
// (shared/api/schemas/common.ts).
//
// The verdict is computed with `validateSelection` from shared/rules, which is the same
// function the server validates with. That is what makes it impossible for a selection
// the client painted green to come back as a 409, and it is why the reasons are
// aggregated by code with a first offending cell: the interface can then say "two hundred
// cells already have an owner" and jump the camera to the first one, instead of listing
// two hundred identical complaints.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  DEFAULT_SELECTION_CONFIG,
  MAX_SELECTION_CELLS,
  type SelectionPurpose,
  cellFromKey,
  cellKey,
  validateSelection,
  type BuildingType,
  type CellCoordWire,
  type SelectionCell,
  type SelectionValidation,
} from '~/shared/index';
import { usePlayerStore } from '~/stores/player';
import { useWorldStore } from '~/stores/world';

/** What the selection will be turned into once the player confirms. */
export interface SelectionIntent {
  readonly purpose: SelectionPurpose;
  /** Field being extended or split, for the purposes that need one. */
  readonly fieldId?: string;
  /** Forest plot the cells are leaving, for `CLEAR_LAND`. */
  readonly forestPlotId?: string;
  /** Building being placed, whose footprint fixes the cell count. */
  readonly buildingType?: BuildingType;
}

export const useSelectionStore = defineStore('selection', () => {
  const world = useWorldStore();
  const player = usePlayerStore();

  const intent = ref<SelectionIntent | null>(null);
  /** Cells in the order they were added, which is the order the issues report. */
  const cellKeys = ref<readonly number[]>([]);
  /** Cell under the pointer, so the inspector can follow it without a selection. */
  const hoverCellKey = ref<number | null>(null);
  /** Cells the selection must touch, for `FIELD_EXTEND` (GDD section 20). */
  const adjacentTo = ref<readonly CellCoordWire[]>([]);

  const active = computed(() => intent.value !== null);
  const purpose = computed(() => intent.value?.purpose ?? null);
  const count = computed(() => cellKeys.value.length);
  const atCeiling = computed(() => cellKeys.value.length >= MAX_SELECTION_CELLS);

  const cells = computed<readonly CellCoordWire[]>(() =>
    cellKeys.value.map((key) => {
      const cell = cellFromKey(key);
      return { cellX: cell.cellX, cellY: cell.cellY };
    }),
  );

  const hoverCell = computed<CellCoordWire | null>(() => {
    if (hoverCellKey.value === null) {
      return null;
    }
    const cell = cellFromKey(hoverCellKey.value);
    return { cellX: cell.cellX, cellY: cell.cellY };
  });

  /**
   * The selected cells resolved against the chunk cache.
   *
   * `world.revision` is read on purpose: the chunk cache is a plain `Map` outside the
   * reactivity graph, so the counter is the only dependency that tells this value to
   * recompute when a chunk arrives or a patch lands.
   */
  const resolvedCells = computed<readonly SelectionCell[]>(() => {
    void world.revision;
    const viewer = player.id;
    const resolved: SelectionCell[] = [];
    for (const key of cellKeys.value) {
      const coord = cellFromKey(key);
      const cell = world.selectionCellAt(coord.cellX, coord.cellY, viewer);
      if (cell !== null) {
        resolved.push(cell);
      }
    }
    return resolved;
  });

  /** Cells of the selection whose chunk is not loaded, and are therefore undecided. */
  const unresolvedCount = computed(() => cellKeys.value.length - resolvedCells.value.length);

  /**
   * The verdict, aggregated and actionable. Null while there is no selection.
   *
   * With cells still unresolved the verdict is provisional and the caller must not treat
   * a green result as a licence to send: `unresolvedCount` is what says so.
   */
  const validation = computed<SelectionValidation | null>(() => {
    const current = intent.value;
    if (current === null || cellKeys.value.length === 0) {
      return null;
    }
    return validateSelection(
      {
        purpose: current.purpose,
        cells: resolvedCells.value,
        adjacentTo: adjacentTo.value.length === 0 ? undefined : adjacentTo.value,
      },
      { ...DEFAULT_SELECTION_CONFIG, maxSelectionCells: world.maxSelectionCells },
    );
  });

  const ok = computed(() => validation.value?.ok === true && unresolvedCount.value === 0);
  const price = computed(() => validation.value?.price ?? null);
  const issues = computed(() => validation.value?.issues ?? []);
  /** First cell that caused a rejection, so the camera can jump to the conflict. */
  const firstConflict = computed<CellCoordWire | null>(() => {
    for (const issue of issues.value) {
      if (issue.firstCell !== null) {
        return { cellX: issue.firstCell.cellX, cellY: issue.firstCell.cellY };
      }
    }
    return null;
  });

  const keySet = computed<ReadonlySet<number>>(() => new Set(cellKeys.value));

  function has(cellX: number, cellY: number): boolean {
    return keySet.value.has(cellKey(cellX, cellY));
  }

  function begin(next: SelectionIntent, touching: readonly CellCoordWire[] = []): void {
    intent.value = next;
    cellKeys.value = [];
    adjacentTo.value = touching;
  }

  function cancel(): void {
    intent.value = null;
    cellKeys.value = [];
    adjacentTo.value = [];
  }

  function clearCells(): void {
    cellKeys.value = [];
  }

  function setHover(cell: CellCoordWire | null): void {
    hoverCellKey.value = cell === null ? null : cellKey(cell.cellX, cell.cellY);
  }

  /**
   * Adds a rectangle. The ceiling is applied here and not only when sending, with the
   * same constant the server validates with, so a drag stops growing at the limit
   * instead of producing a request that will be refused (plan section 5.2).
   */
  function addRect(from: CellCoordWire, to: CellCoordWire): void {
    const next = [...cellKeys.value];
    const present = new Set(next);
    const minX = Math.min(from.cellX, to.cellX);
    const maxX = Math.max(from.cellX, to.cellX);
    const minY = Math.min(from.cellY, to.cellY);
    const maxY = Math.max(from.cellY, to.cellY);
    for (let cellY = minY; cellY <= maxY; cellY += 1) {
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        if (next.length >= MAX_SELECTION_CELLS) {
          cellKeys.value = next;
          return;
        }
        const key = cellKey(cellX, cellY);
        if (!present.has(key)) {
          present.add(key);
          next.push(key);
        }
      }
    }
    cellKeys.value = next;
  }

  /** Subtracts a rectangle, which is the other half of composing an arbitrary shape. */
  function removeRect(from: CellCoordWire, to: CellCoordWire): void {
    const minX = Math.min(from.cellX, to.cellX);
    const maxX = Math.max(from.cellX, to.cellX);
    const minY = Math.min(from.cellY, to.cellY);
    const maxY = Math.max(from.cellY, to.cellY);
    const dropped = new Set<number>();
    for (let cellY = minY; cellY <= maxY; cellY += 1) {
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        dropped.add(cellKey(cellX, cellY));
      }
    }
    cellKeys.value = cellKeys.value.filter((key) => !dropped.has(key));
  }

  function toggleCell(cell: CellCoordWire): void {
    const key = cellKey(cell.cellX, cell.cellY);
    if (keySet.value.has(key)) {
      cellKeys.value = cellKeys.value.filter((candidate) => candidate !== key);
      return;
    }
    if (cellKeys.value.length >= MAX_SELECTION_CELLS) {
      return;
    }
    cellKeys.value = [...cellKeys.value, key];
  }

  /** Replaces the whole set, for a footprint the catalogue fixes the shape of. */
  function replaceCells(next: readonly CellCoordWire[]): void {
    const keys: number[] = [];
    const present = new Set<number>();
    for (const cell of next.slice(0, MAX_SELECTION_CELLS)) {
      const key = cellKey(cell.cellX, cell.cellY);
      if (!present.has(key)) {
        present.add(key);
        keys.push(key);
      }
    }
    cellKeys.value = keys;
  }

  function reset(): void {
    cancel();
    hoverCellKey.value = null;
  }

  return {
    intent,
    cellKeys,
    hoverCellKey,
    adjacentTo,
    active,
    purpose,
    count,
    atCeiling,
    cells,
    hoverCell,
    resolvedCells,
    unresolvedCount,
    validation,
    ok,
    price,
    issues,
    firstConflict,
    keySet,
    has,
    begin,
    cancel,
    clearCells,
    setHover,
    addRect,
    removeRect,
    toggleCell,
    replaceCells,
    reset,
  };
});
