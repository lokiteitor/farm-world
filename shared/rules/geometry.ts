// Grid geometry: chunk arithmetic, connectivity and border extraction.
//
// Owner: workflow W2 (pure rules).
//
// All the geometry of the game is aligned to the cell grid, which is why there is no
// geospatial extension in the database and no floating point anywhere in this module
// (plan section 5.1). Three groups of functions:
//
//   - Chunk arithmetic. A cell belongs to exactly one chunk and has one index inside
//     it, row major. The conversion has to agree byte for byte between the generator,
//     the cell repository and the renderer, so it lives here and nowhere else.
//   - Connectivity. Contiguity of a field (GDD section 17) is a property of a graph
//     that no declarative constraint expresses, so it is application logic by
//     necessity (plan section 5.4), bounded by the same ceiling of 2 000 cells that
//     the client applies while dragging.
//   - Border extraction. The outlines of ownership, field and farm footprint are
//     drawn as edge segments of a set of cells in a single `Graphics` (plan section
//     9.3), and the same extraction feeds the outline of a selection.

import { CHUNK_SIZE, MAX_SELECTION_CELLS } from '../config/world.js';
import { type CellCoord, type ChunkCoord } from '../domain/entities.js';

/**
 * Bound on the magnitude of a cell coordinate, so that a cell can be keyed by a
 * single safe integer. It is 2^25 cells, that is 335 000 km from the origin with the
 * 10 m cell of plan section 2, which is far beyond anywhere the spawn allocator
 * places a player.
 */
export const MAX_ABSOLUTE_CELL_COORDINATE = 33_554_432;

const KEY_OFFSET = MAX_ABSOLUTE_CELL_COORDINATE;
const KEY_STRIDE = 2 * MAX_ABSOLUTE_CELL_COORDINATE + 1;

/**
 * Single integer key of a cell, for sets and maps on the hot paths. Numeric rather
 * than a string because the connectivity check and the spawn allocator visit
 * millions of cells in the test suite.
 */
export function cellKey(cellX: number, cellY: number): number {
  if (
    !Number.isInteger(cellX) ||
    !Number.isInteger(cellY) ||
    Math.abs(cellX) > MAX_ABSOLUTE_CELL_COORDINATE ||
    Math.abs(cellY) > MAX_ABSOLUTE_CELL_COORDINATE
  ) {
    throw new RangeError(`Cell coordinate out of the keyable range: (${cellX}, ${cellY})`);
  }
  return (cellX + KEY_OFFSET) * KEY_STRIDE + (cellY + KEY_OFFSET);
}

/** The cell a key came from. */
export function cellFromKey(key: number): CellCoord {
  const y = (key % KEY_STRIDE) - KEY_OFFSET;
  const x = (key - (y + KEY_OFFSET)) / KEY_STRIDE - KEY_OFFSET;
  return { cellX: x, cellY: y };
}

/**
 * Euclidean modulus: the result has the sign of the divisor, so it is never negative
 * for a positive chunk size. The native `%` truncates towards zero and would place
 * cell -1 at local index -1 instead of at the last column of the previous chunk.
 */
export function floorMod(value: number, modulus: number): number {
  if (modulus <= 0) {
    throw new RangeError(`The modulus must be positive: ${modulus}`);
  }
  const remainder = value % modulus;
  if (remainder < 0) {
    return remainder + modulus;
  }
  // The native remainder yields negative zero for a negative multiple of the modulus,
  // for example `-32 % 32`. It behaves like zero in arithmetic but compares unequal to it
  // under `Object.is`, so it is normalised here and no caller has to know.
  return remainder === 0 ? 0 : remainder;
}

/** Chunk a cell belongs to (GDD sections 6 and 7). */
export function chunkOf(cellX: number, cellY: number, chunkSize: number = CHUNK_SIZE): ChunkCoord {
  return {
    chunkX: Math.floor(cellX / chunkSize),
    chunkY: Math.floor(cellY / chunkSize),
  };
}

/** Position of a cell inside its chunk. */
export function localCellOf(
  cellX: number,
  cellY: number,
  chunkSize: number = CHUNK_SIZE,
): { readonly localX: number; readonly localY: number } {
  return { localX: floorMod(cellX, chunkSize), localY: floorMod(cellY, chunkSize) };
}

/** Index of a cell inside its chunk, row major: `localY * chunkSize + localX`. */
export function cellIndex(cellX: number, cellY: number, chunkSize: number = CHUNK_SIZE): number {
  const local = localCellOf(cellX, cellY, chunkSize);
  return local.localY * chunkSize + local.localX;
}

/** Absolute coordinate of the cell at an index inside a chunk. Inverse of `cellIndex`. */
export function worldFromChunk(
  chunk: ChunkCoord,
  idx: number,
  chunkSize: number = CHUNK_SIZE,
): CellCoord {
  if (!Number.isInteger(idx) || idx < 0 || idx >= chunkSize * chunkSize) {
    throw new RangeError(`Cell index out of the chunk: ${idx}`);
  }
  return {
    cellX: chunk.chunkX * chunkSize + (idx % chunkSize),
    cellY: chunk.chunkY * chunkSize + Math.floor(idx / chunkSize),
  };
}

/** North west cell of a chunk. */
export function chunkOriginCell(chunk: ChunkCoord, chunkSize: number = CHUNK_SIZE): CellCoord {
  return { cellX: chunk.chunkX * chunkSize, cellY: chunk.chunkY * chunkSize };
}

/**
 * Chunks covered by a rectangle of cells, in row major order. Rectangular queries
 * are resolved by deriving the chunks they cover and not by a range over the cell
 * columns, which a btree index would only exploit in its first column (plan section
 * 5.1).
 */
export function chunksCovering(
  minCellX: number,
  minCellY: number,
  maxCellX: number,
  maxCellY: number,
  chunkSize: number = CHUNK_SIZE,
): readonly ChunkCoord[] {
  const first = chunkOf(Math.min(minCellX, maxCellX), Math.min(minCellY, maxCellY), chunkSize);
  const last = chunkOf(Math.max(minCellX, maxCellX), Math.max(minCellY, maxCellY), chunkSize);
  const chunks: ChunkCoord[] = [];
  for (let chunkY = first.chunkY; chunkY <= last.chunkY; chunkY += 1) {
    for (let chunkX = first.chunkX; chunkX <= last.chunkX; chunkX += 1) {
      chunks.push({ chunkX, chunkY });
    }
  }
  return chunks;
}

/** Axis aligned bounding box of a set of cells, or null when the set is empty. */
export function boundingBox(cells: Iterable<CellCoord>): {
  readonly minCellX: number;
  readonly minCellY: number;
  readonly maxCellX: number;
  readonly maxCellY: number;
} | null {
  let minCellX = Number.POSITIVE_INFINITY;
  let minCellY = Number.POSITIVE_INFINITY;
  let maxCellX = Number.NEGATIVE_INFINITY;
  let maxCellY = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const cell of cells) {
    seen = true;
    minCellX = Math.min(minCellX, cell.cellX);
    minCellY = Math.min(minCellY, cell.cellY);
    maxCellX = Math.max(maxCellX, cell.cellX);
    maxCellY = Math.max(maxCellY, cell.cellY);
  }
  return seen ? { minCellX, minCellY, maxCellX, maxCellY } : null;
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

/** The four edge neighbours of a cell. Diagonals do not connect (GDD section 17). */
export const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface FloodFillResult {
  /** Cells reached, in visit order. Bounded by `maxVisited`. */
  readonly cells: readonly CellCoord[];
  /** True when the search stopped because it hit the ceiling. */
  readonly truncated: boolean;
}

/**
 * Bounded breadth first traversal of the cells a predicate accepts, from one start.
 *
 * The ceiling is not an optimisation: it is the same 2 000 cell ceiling the client
 * applies to a selection, and it keeps a malformed request from walking an unbounded
 * region of a virtually infinite world.
 */
export function boundedBreadthFirst(
  startX: number,
  startY: number,
  contains: (cellX: number, cellY: number) => boolean,
  maxVisited: number = MAX_SELECTION_CELLS,
): FloodFillResult {
  if (!contains(startX, startY) || maxVisited <= 0) {
    return { cells: [], truncated: false };
  }
  const seen = new Set<number>([cellKey(startX, startY)]);
  const cells: CellCoord[] = [{ cellX: startX, cellY: startY }];
  let head = 0;
  while (head < cells.length) {
    const current = cells[head];
    head += 1;
    if (current === undefined) {
      continue;
    }
    for (const offset of NEIGHBOUR_OFFSETS) {
      const nextX = current.cellX + offset[0];
      const nextY = current.cellY + offset[1];
      if (!contains(nextX, nextY)) {
        continue;
      }
      const key = cellKey(nextX, nextY);
      if (seen.has(key)) {
        continue;
      }
      if (cells.length >= maxVisited) {
        return { cells, truncated: true };
      }
      seen.add(key);
      cells.push({ cellX: nextX, cellY: nextY });
    }
  }
  return { cells, truncated: false };
}

/**
 * Whether a set of cells forms one contiguous surface (GDD section 17). An empty set
 * is not contiguous: the caller reports `SELECTION_EMPTY`, which is a different and
 * more useful reason.
 */
export function isContiguous(
  cells: Iterable<CellCoord>,
  maxCells: number = MAX_SELECTION_CELLS,
): boolean {
  const members = new Set<number>();
  let first: CellCoord | null = null;
  for (const cell of cells) {
    if (first === null) {
      first = cell;
    }
    members.add(cellKey(cell.cellX, cell.cellY));
  }
  if (first === null || members.size === 0) {
    return false;
  }
  if (members.size > maxCells) {
    return false;
  }
  const reached = boundedBreadthFirst(
    first.cellX,
    first.cellY,
    (x, y) => members.has(cellKey(x, y)),
    members.size,
  );
  return !reached.truncated && reached.cells.length === members.size;
}

/**
 * Whether a set of cells touches another set along at least one edge (GDD section
 * 20). Overlap is not adjacency and is checked separately, because the reason a cell
 * is refused differs: an overlapping cell is already in use.
 */
export function isAdjacentTo(cells: Iterable<CellCoord>, target: Iterable<CellCoord>): boolean {
  const targetKeys = new Set<number>();
  for (const cell of target) {
    targetKeys.add(cellKey(cell.cellX, cell.cellY));
  }
  if (targetKeys.size === 0) {
    return false;
  }
  for (const cell of cells) {
    for (const offset of NEIGHBOUR_OFFSETS) {
      if (targetKeys.has(cellKey(cell.cellX + offset[0], cell.cellY + offset[1]))) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Border extraction
// ---------------------------------------------------------------------------

/**
 * One segment of the outline of a set of cells, in grid corner coordinates: corner
 * `(x, y)` is the north west corner of cell `(x, y)`, so a cell spans corners `x` to
 * `x + 1`. The renderer multiplies by the cell size in pixels.
 */
export interface EdgeSegment {
  readonly fromCornerX: number;
  readonly fromCornerY: number;
  readonly toCornerX: number;
  readonly toCornerY: number;
}

/**
 * Outline of a set of cells: every edge whose neighbour is outside the set.
 *
 * The order is deterministic, by cell in row major order and then north, east, south,
 * west, so that two runs produce the same geometry and a test can compare outlines
 * literally.
 */
export function borderSegments(cells: Iterable<CellCoord>): readonly EdgeSegment[] {
  const members: CellCoord[] = [];
  const keys = new Set<number>();
  for (const cell of cells) {
    const key = cellKey(cell.cellX, cell.cellY);
    if (!keys.has(key)) {
      keys.add(key);
      members.push(cell);
    }
  }
  members.sort((left, right) =>
    left.cellY === right.cellY ? left.cellX - right.cellX : left.cellY - right.cellY,
  );
  const segments: EdgeSegment[] = [];
  for (const cell of members) {
    const { cellX, cellY } = cell;
    if (!keys.has(cellKey(cellX, cellY - 1))) {
      segments.push({
        fromCornerX: cellX,
        fromCornerY: cellY,
        toCornerX: cellX + 1,
        toCornerY: cellY,
      });
    }
    if (!keys.has(cellKey(cellX + 1, cellY))) {
      segments.push({
        fromCornerX: cellX + 1,
        fromCornerY: cellY,
        toCornerX: cellX + 1,
        toCornerY: cellY + 1,
      });
    }
    if (!keys.has(cellKey(cellX, cellY + 1))) {
      segments.push({
        fromCornerX: cellX,
        fromCornerY: cellY + 1,
        toCornerX: cellX + 1,
        toCornerY: cellY + 1,
      });
    }
    if (!keys.has(cellKey(cellX - 1, cellY))) {
      segments.push({
        fromCornerX: cellX,
        fromCornerY: cellY,
        toCornerX: cellX,
        toCornerY: cellY + 1,
      });
    }
  }
  return segments;
}
