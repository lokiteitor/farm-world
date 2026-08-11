import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, MAX_SELECTION_CELLS } from '../../config/world.js';
import { type CellCoord } from '../../domain/entities.js';
import {
  MAX_ABSOLUTE_CELL_COORDINATE,
  borderSegments,
  boundedBreadthFirst,
  boundingBox,
  cellFromKey,
  cellIndex,
  cellKey,
  chunkOf,
  chunkOriginCell,
  chunksCovering,
  floorMod,
  isAdjacentTo,
  isContiguous,
  localCellOf,
  worldFromChunk,
} from '../geometry.js';

// Grid geometry. The negative coordinate cases are the ones that matter: the world is
// virtually infinite in both directions (GDD section 5) and the native remainder
// operator would place cell -1 at local index -1.

function rectangle(originX: number, originY: number, width: number, height: number): CellCoord[] {
  const cells: CellCoord[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push({ cellX: originX + x, cellY: originY + y });
    }
  }
  return cells;
}

describe('chunk arithmetic', () => {
  it('uses a chunk of 32 cells on a side (GDD section 6)', () => {
    expect(CHUNK_SIZE).toBe(32);
  });

  it('places a cell in its chunk, including negative coordinates', () => {
    expect(chunkOf(0, 0)).toEqual({ chunkX: 0, chunkY: 0 });
    expect(chunkOf(31, 31)).toEqual({ chunkX: 0, chunkY: 0 });
    expect(chunkOf(32, 32)).toEqual({ chunkX: 1, chunkY: 1 });
    expect(chunkOf(-1, -1)).toEqual({ chunkX: -1, chunkY: -1 });
    expect(chunkOf(-32, -33)).toEqual({ chunkX: -1, chunkY: -2 });
  });

  it('indexes a cell inside its chunk in row major order', () => {
    expect(cellIndex(0, 0)).toBe(0);
    expect(cellIndex(31, 0)).toBe(31);
    expect(cellIndex(0, 1)).toBe(32);
    expect(cellIndex(31, 31)).toBe(1023);
    // Cell -1 is the last column of the previous chunk, not index -1.
    expect(cellIndex(-1, -1)).toBe(1023);
    expect(localCellOf(-1, -1)).toEqual({ localX: 31, localY: 31 });
  });

  it('round trips between an absolute cell and a chunk index', () => {
    for (const cell of [
      { cellX: 0, cellY: 0 },
      { cellX: -1, cellY: -1 },
      { cellX: 1_000, cellY: -2_000 },
      { cellX: -33, cellY: 64 },
    ]) {
      const chunk = chunkOf(cell.cellX, cell.cellY);
      expect(worldFromChunk(chunk, cellIndex(cell.cellX, cell.cellY))).toEqual(cell);
    }
  });

  it('rejects an index outside the chunk', () => {
    expect(() => worldFromChunk({ chunkX: 0, chunkY: 0 }, 1024)).toThrow(RangeError);
    expect(() => worldFromChunk({ chunkX: 0, chunkY: 0 }, -1)).toThrow(RangeError);
  });

  it('gives the north west cell of a chunk', () => {
    expect(chunkOriginCell({ chunkX: 2, chunkY: -3 })).toEqual({ cellX: 64, cellY: -96 });
  });

  it('uses a euclidean modulus', () => {
    expect(floorMod(5, 32)).toBe(5);
    expect(floorMod(-5, 32)).toBe(27);
    expect(floorMod(-32, 32)).toBe(0);
    expect(() => floorMod(5, 0)).toThrow(RangeError);
  });

  it('lists the chunks a rectangle covers, in row major order', () => {
    expect(chunksCovering(0, 0, 31, 31)).toEqual([{ chunkX: 0, chunkY: 0 }]);
    expect(chunksCovering(30, 30, 33, 33)).toEqual([
      { chunkX: 0, chunkY: 0 },
      { chunkX: 1, chunkY: 0 },
      { chunkX: 0, chunkY: 1 },
      { chunkX: 1, chunkY: 1 },
    ]);
    // The corners may arrive in any order.
    expect(chunksCovering(33, 33, 30, 30)).toHaveLength(4);
  });

  it('keys a cell as one safe integer and back', () => {
    for (const cell of [
      { cellX: 0, cellY: 0 },
      { cellX: -1, cellY: 5 },
      { cellX: 1_000_000, cellY: -1_000_000 },
    ]) {
      const key = cellKey(cell.cellX, cell.cellY);
      expect(Number.isSafeInteger(key)).toBe(true);
      expect(cellFromKey(key)).toEqual(cell);
    }
    expect(cellKey(1, 2)).not.toBe(cellKey(2, 1));
    expect(() => cellKey(MAX_ABSOLUTE_CELL_COORDINATE + 1, 0)).toThrow(RangeError);
    expect(() => cellKey(0.5, 0)).toThrow(RangeError);
  });

  it('bounds a set of cells', () => {
    expect(boundingBox(rectangle(-5, 10, 3, 4))).toEqual({
      minCellX: -5,
      minCellY: 10,
      maxCellX: -3,
      maxCellY: 13,
    });
    expect(boundingBox([])).toBeNull();
  });
});

describe('contiguity (GDD section 17)', () => {
  it('accepts a rectangle and an L shape', () => {
    expect(isContiguous(rectangle(0, 0, 10, 25))).toBe(true);
    expect(isContiguous([...rectangle(0, 0, 5, 1), ...rectangle(0, 1, 1, 5)])).toBe(true);
  });

  it('rejects two detached groups and a diagonal contact', () => {
    expect(isContiguous([...rectangle(0, 0, 3, 3), ...rectangle(10, 10, 3, 3)])).toBe(false);
    // Diagonals do not connect: the two cells share only a corner.
    expect(
      isContiguous([
        { cellX: 0, cellY: 0 },
        { cellX: 1, cellY: 1 },
      ]),
    ).toBe(false);
  });

  it('rejects an empty selection, which the caller reports as empty instead', () => {
    expect(isContiguous([])).toBe(false);
  });

  it('spans chunks, since a field is independent of them (GDD sections 16 and 18)', () => {
    const acrossChunks = rectangle(30, 0, 6, 4);
    expect(new Set(acrossChunks.map((cell) => chunkOf(cell.cellX, cell.cellY).chunkX)).size).toBe(
      2,
    );
    expect(isContiguous(acrossChunks)).toBe(true);
  });

  it('rejects a selection over the shared ceiling instead of walking it', () => {
    const tooLarge = rectangle(0, 0, 50, 41);
    expect(tooLarge).toHaveLength(2_050);
    expect(tooLarge.length).toBeGreaterThan(MAX_SELECTION_CELLS);
    expect(isContiguous(tooLarge)).toBe(false);
  });

  it('ignores duplicated cells', () => {
    const cells = rectangle(0, 0, 2, 2);
    expect(isContiguous([...cells, ...cells])).toBe(true);
  });
});

describe('boundedBreadthFirst', () => {
  it('stops at the ceiling and says so', () => {
    const all = (): boolean => true;
    const bounded = boundedBreadthFirst(0, 0, all, 100);
    expect(bounded.cells).toHaveLength(100);
    expect(bounded.truncated).toBe(true);
  });

  it('returns nothing when the start is not a member', () => {
    const result = boundedBreadthFirst(0, 0, () => false, 100);
    expect(result.cells).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it('walks only what the predicate accepts', () => {
    // A one cell wide corridor of ten cells.
    const corridor = boundedBreadthFirst(0, 0, (x, y) => y === 0 && x >= 0 && x < 10, 1_000);
    expect(corridor.cells).toHaveLength(10);
    expect(corridor.truncated).toBe(false);
  });
});

describe('isAdjacentTo (GDD section 20)', () => {
  const field = rectangle(0, 0, 4, 4);

  it('accepts a selection that touches along an edge', () => {
    expect(isAdjacentTo(rectangle(4, 0, 2, 4), field)).toBe(true);
    expect(isAdjacentTo(rectangle(0, -1, 4, 1), field)).toBe(true);
  });

  it('rejects a selection that only touches a corner or is detached', () => {
    expect(isAdjacentTo([{ cellX: 4, cellY: 4 }], field)).toBe(false);
    expect(isAdjacentTo(rectangle(10, 10, 2, 2), field)).toBe(false);
  });

  it('rejects an empty target', () => {
    expect(isAdjacentTo(field, [])).toBe(false);
  });
});

describe('borderSegments', () => {
  it('gives four segments for a single cell, in corner coordinates', () => {
    expect(borderSegments([{ cellX: 0, cellY: 0 }])).toEqual([
      { fromCornerX: 0, fromCornerY: 0, toCornerX: 1, toCornerY: 0 },
      { fromCornerX: 1, fromCornerY: 0, toCornerX: 1, toCornerY: 1 },
      { fromCornerX: 0, fromCornerY: 1, toCornerX: 1, toCornerY: 1 },
      { fromCornerX: 0, fromCornerY: 0, toCornerX: 0, toCornerY: 1 },
    ]);
  });

  it('omits the shared edge between two neighbours', () => {
    const segments = borderSegments([
      { cellX: 0, cellY: 0 },
      { cellX: 1, cellY: 0 },
    ]);
    expect(segments).toHaveLength(6);
    // The edge at corner x = 1 between the two cells appears in neither outline.
    expect(
      segments.some(
        (segment) =>
          segment.fromCornerX === 1 && segment.toCornerX === 1 && segment.fromCornerY === 0,
      ),
    ).toBe(false);
  });

  it('gives the perimeter of a rectangle', () => {
    // A 5 x 4 rectangle has a perimeter of 2 x (5 + 4) = 18 unit segments.
    expect(borderSegments(rectangle(0, 0, 5, 4))).toHaveLength(18);
  });

  it('traces the hole in a ring, which is what an outline has to show', () => {
    const ring = rectangle(0, 0, 3, 3).filter((cell) => !(cell.cellX === 1 && cell.cellY === 1));
    // Outer perimeter of 12 plus the four edges around the hole.
    expect(borderSegments(ring)).toHaveLength(16);
  });

  it('is deterministic and ignores duplicates and input order', () => {
    const cells = rectangle(0, 0, 3, 2);
    const shuffled = [...cells].reverse();
    expect(borderSegments(shuffled)).toEqual(borderSegments(cells));
    expect(borderSegments([...cells, ...cells])).toEqual(borderSegments(cells));
  });

  it('is empty for an empty set', () => {
    expect(borderSegments([])).toEqual([]);
  });
});
