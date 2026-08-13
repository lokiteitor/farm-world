// The set algebra of the selection: union, subtraction and per cell toggling.
//
// Owner: workflow W4-G (selection tool). Pure: keys in, keys out, no Phaser and no store.
//
// The rectangle is the primitive and the set is the state. GDD section 17 asks for
// arbitrary shapes and plan section 9.5 resolves that without a freehand tool: a
// rectangle added with shift, subtracted with alt or a single cell toggled with control
// composes every shape the domain needs, and what travels to the server is the explicit
// set of cells and never a list of rectangles.
//
// Order matters and is preserved. `validateSelection` reports the first offending cell in
// the order the selection was sent, and that is what the jump to the conflict moves the
// camera to, so a set that reordered itself would move the camera somewhere the player
// did not draw first.
//
// The ceiling is applied while the rectangle is being walked and not after it. A drag of
// five thousand by five thousand cells is twenty five million keys, and building the
// array first to trim it afterwards is the version that freezes the tab. That is the same
// reason `boundedBreadthFirst` of shared/rules/geometry.ts carries its own ceiling.

import { MAX_SELECTION_CELLS, cellFromKey, cellKey, type CellCoordWire } from '~/shared/index';

/** A set of cells, in insertion order, and whether it hit the ceiling. */
export interface CellSet {
  readonly keys: readonly number[];
  /**
   * True when the last operation stopped because it reached the ceiling. It is what the
   * live readout turns into a warning, so a drag that stops growing is explained instead
   * of feeling broken.
   */
  readonly capped: boolean;
}

export const EMPTY_CELL_SET: CellSet = { keys: [], capped: false };

/** Corners of a rectangle in cells, in any order. */
export interface CellRectCorners {
  readonly from: CellCoordWire;
  readonly to: CellCoordWire;
}

interface NormalisedRect {
  readonly minCellX: number;
  readonly minCellY: number;
  readonly maxCellX: number;
  readonly maxCellY: number;
}

function normalise(corners: CellRectCorners): NormalisedRect {
  return {
    minCellX: Math.min(corners.from.cellX, corners.to.cellX),
    minCellY: Math.min(corners.from.cellY, corners.to.cellY),
    maxCellX: Math.max(corners.from.cellX, corners.to.cellX),
    maxCellY: Math.max(corners.from.cellY, corners.to.cellY),
  };
}

/** Cells a rectangle covers, without building it. */
export function rectCellCount(corners: CellRectCorners): number {
  const rect = normalise(corners);
  return (rect.maxCellX - rect.minCellX + 1) * (rect.maxCellY - rect.minCellY + 1);
}

/**
 * Adds a rectangle to a set (GDD section 17, union half).
 *
 * The ceiling is the shared one and is applied here and not only when sending, so a drag
 * stops growing at the limit instead of producing a request the server will refuse with
 * `SELECTION_TOO_LARGE` (ADR-0012).
 */
export function unionRect(
  base: CellSet,
  corners: CellRectCorners,
  ceiling: number = MAX_SELECTION_CELLS,
): CellSet {
  const rect = normalise(corners);
  const keys = [...base.keys];
  const present = new Set(keys);
  for (let cellY = rect.minCellY; cellY <= rect.maxCellY; cellY += 1) {
    for (let cellX = rect.minCellX; cellX <= rect.maxCellX; cellX += 1) {
      if (keys.length >= ceiling) {
        return { keys, capped: true };
      }
      const key = cellKey(cellX, cellY);
      if (!present.has(key)) {
        present.add(key);
        keys.push(key);
      }
    }
  }
  return { keys, capped: false };
}

/** Removes a rectangle from a set (GDD section 17, subtraction half). */
export function subtractRect(base: CellSet, corners: CellRectCorners): CellSet {
  const rect = normalise(corners);
  const keys = base.keys.filter((key) => {
    const cell = cellFromKey(key);
    return !(
      cell.cellX >= rect.minCellX &&
      cell.cellX <= rect.maxCellX &&
      cell.cellY >= rect.minCellY &&
      cell.cellY <= rect.maxCellY
    );
  });
  return { keys, capped: false };
}

/** A rectangle on its own, replacing whatever the set held. */
export function replaceWithRect(
  corners: CellRectCorners,
  ceiling: number = MAX_SELECTION_CELLS,
): CellSet {
  return unionRect(EMPTY_CELL_SET, corners, ceiling);
}

/** Adds a cell if it is absent, removes it if it is present (GDD section 17). */
export function toggleCell(
  base: CellSet,
  cell: CellCoordWire,
  ceiling: number = MAX_SELECTION_CELLS,
): CellSet {
  const key = cellKey(cell.cellX, cell.cellY);
  if (base.keys.includes(key)) {
    return { keys: base.keys.filter((candidate) => candidate !== key), capped: false };
  }
  if (base.keys.length >= ceiling) {
    return { keys: [...base.keys], capped: true };
  }
  return { keys: [...base.keys, key], capped: false };
}

/** Replaces the whole set, for a footprint whose shape the catalogue fixes. */
export function replaceCells(
  cells: Iterable<CellCoordWire>,
  ceiling: number = MAX_SELECTION_CELLS,
): CellSet {
  const keys: number[] = [];
  const present = new Set<number>();
  let capped = false;
  for (const cell of cells) {
    if (keys.length >= ceiling) {
      capped = true;
      break;
    }
    const key = cellKey(cell.cellX, cell.cellY);
    if (!present.has(key)) {
      present.add(key);
      keys.push(key);
    }
  }
  return { keys, capped };
}

/** The coordinates of a set, in its own order. */
export function cellsOf(set: CellSet): readonly CellCoordWire[] {
  return set.keys.map((key) => {
    const cell = cellFromKey(key);
    return { cellX: cell.cellX, cellY: cell.cellY };
  });
}

/** Whether two sets hold the same keys in the same order. */
export function sameCells(left: CellSet, right: CellSet): boolean {
  if (left.keys.length !== right.keys.length) {
    return false;
  }
  for (let index = 0; index < left.keys.length; index += 1) {
    if (left.keys[index] !== right.keys[index]) {
      return false;
    }
  }
  return true;
}
