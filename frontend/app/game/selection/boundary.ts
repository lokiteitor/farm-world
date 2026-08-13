// The cell boundary throttle.
//
// Owner: workflow W4-G (selection tool). Pure and tiny, and it is the single reason a
// drag over thousands of cells stays at sixty frames per second (plan section 9.5).
//
// A pointer move fires per pixel. At zoom 1 a cell is sixteen pixels (ADR-0012), so a
// drag across the viewport produces roughly sixteen times more events than it produces
// cells, and each one would rebuild the set, revalidate it against the shared rules and
// redraw the `Graphics`. Recomputing on the crossing of a cell boundary instead makes the
// cost proportional to what the player actually selected, which is what plan section 9.5
// means by "the update only happens when a cell boundary is crossed".
//
// `WorldScene.emitHover` applies the same rule to its hover event; the two are separate
// because the tool has to keep its own last cell, and sharing one would couple the
// highlight to whether anybody is listening to the bridge.

import { type CellCoordWire } from '~/shared/index';

export interface BoundaryThrottle {
  /**
   * Whether the pointer moved into a different cell. True exactly once per cell entered,
   * and the cell becomes the current one.
   */
  accept(cellX: number, cellY: number): boolean;
  /** The last accepted cell, or null before the first one. */
  readonly current: CellCoordWire | null;
  /** Forgets the current cell, so the next move is a crossing whatever it is. */
  reset(): void;
}

export function createBoundaryThrottle(): BoundaryThrottle {
  let current: CellCoordWire | null = null;
  return {
    accept(cellX: number, cellY: number): boolean {
      if (current !== null && current.cellX === cellX && current.cellY === cellY) {
        return false;
      }
      current = { cellX, cellY };
      return true;
    },
    get current(): CellCoordWire | null {
      return current;
    },
    reset(): void {
      current = null;
    },
  };
}
