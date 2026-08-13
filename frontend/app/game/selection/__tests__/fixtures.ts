// Fixtures of the selection tool tests.
//
// Owner: workflow W4-G. A grid built by hand, so a test states one fact about one shape
// instead of generating a world and hunting for a cell that happens to be owned.
//
// The reader is the same structural port the tool uses in production (`CellReader` of
// `cells.ts`, which `WorldSource` satisfies), so nothing here is a parallel
// implementation of the resolution: the tests exercise the very code the canvas runs.

import { type WorldChunkView } from '../../world/source';
import { type CellReader } from '../cells';
import {
  CHUNK_SIZE,
  LandUse,
  TERRAIN_CODE,
  TerrainType,
  cellIndex,
  chunkOf,
  type CellCoordWire,
  type ChunkCellPatch,
} from '~/shared/index';

export const VIEWER = 'player-viewer';
export const STRANGER = 'player-stranger';

/** A patch with everything null, which is what an untouched cell records. */
export function basePatch(): Omit<ChunkCellPatch, 'idx'> {
  return {
    terrainOverride: null,
    ownerPlayerId: null,
    landUse: LandUse.NONE,
    fieldId: null,
    forestPlotId: null,
    buildingId: null,
    hasStandingTree: false,
  };
}

export interface GridOptions {
  /** Terrain every unpatched cell has. Grass by default, which is arable and buildable. */
  readonly terrain?: TerrainType;
  /** Chunks the reader knows about. Everything else resolves to "not loaded". */
  readonly loadedChunks?: readonly { readonly chunkX: number; readonly chunkY: number }[];
  readonly viewerPlayerId?: string | null;
}

/**
 * A reader over a set of chunks, with per cell patches written by coordinate.
 *
 * Chunks are created on demand for the coordinates the test declares as loaded, which is
 * what makes "this cell is unknown because its chunk has not arrived" expressible: a
 * coordinate outside `loadedChunks` resolves to null and feeds `unresolvedCount`.
 */
export function makeGrid(options: GridOptions = {}): {
  readonly reader: CellReader;
  /** Writes a patch at a cell of a loaded chunk. */
  set(cell: CellCoordWire, values: Partial<ChunkCellPatch>): void;
  /** Writes the same patch over a rectangle of cells. */
  fill(from: CellCoordWire, to: CellCoordWire, values: Partial<ChunkCellPatch>): void;
} {
  const terrainCode = TERRAIN_CODE[options.terrain ?? TerrainType.GRASS];
  const viewer = options.viewerPlayerId === undefined ? VIEWER : options.viewerPlayerId;
  const loaded = new Set(
    (options.loadedChunks ?? [{ chunkX: 0, chunkY: 0 }]).map(
      (chunk) => `${chunk.chunkX}:${chunk.chunkY}`,
    ),
  );
  const chunks = new Map<string, WorldChunkView>();

  function chunkAt(chunkX: number, chunkY: number): WorldChunkView | undefined {
    const key = `${chunkX}:${chunkY}`;
    if (!loaded.has(key)) {
      return undefined;
    }
    const held = chunks.get(key);
    if (held !== undefined) {
      return held;
    }
    const terrain = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    terrain.fill(terrainCode);
    const created: WorldChunkView = {
      chunkX,
      chunkY,
      version: 0,
      terrain,
      patches: new Map<number, ChunkCellPatch>(),
      stale: false,
    };
    chunks.set(key, created);
    return created;
  }

  function set(cell: CellCoordWire, values: Partial<ChunkCellPatch>): void {
    const chunk = chunkOf(cell.cellX, cell.cellY, CHUNK_SIZE);
    const held = chunkAt(chunk.chunkX, chunk.chunkY);
    if (held === undefined) {
      return;
    }
    const idx = cellIndex(cell.cellX, cell.cellY, CHUNK_SIZE);
    const previous = held.patches.get(idx);
    const next: ChunkCellPatch = { idx, ...basePatch(), ...(previous ?? {}), ...values };
    (held.patches as Map<number, ChunkCellPatch>).set(idx, next);
  }

  return {
    reader: {
      chunkSize: CHUNK_SIZE,
      chunk: (chunkX, chunkY) => chunkAt(chunkX, chunkY),
      viewerPlayerId: () => viewer,
    },
    set,
    fill(from, to, values) {
      const minX = Math.min(from.cellX, to.cellX);
      const maxX = Math.max(from.cellX, to.cellX);
      const minY = Math.min(from.cellY, to.cellY);
      const maxY = Math.max(from.cellY, to.cellY);
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        for (let cellX = minX; cellX <= maxX; cellX += 1) {
          set({ cellX, cellY }, values);
        }
      }
    },
  };
}

/** Cells of a rectangle, row major. */
export function rectCells(from: CellCoordWire, to: CellCoordWire): CellCoordWire[] {
  const cells: CellCoordWire[] = [];
  const minX = Math.min(from.cellX, to.cellX);
  const maxX = Math.max(from.cellX, to.cellX);
  const minY = Math.min(from.cellY, to.cellY);
  const maxY = Math.max(from.cellY, to.cellY);
  for (let cellY = minY; cellY <= maxY; cellY += 1) {
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      cells.push({ cellX, cellY });
    }
  }
  return cells;
}

/**
 * A deterministic integer generator.
 *
 * `Math.random` is banned in `shared/` and in the backend domain modules by
 * `eslint.config.js`, and a random shape test that cannot be replayed is worth very
 * little anyway: a failure has to be reproducible from the seed printed in the name.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    state = (Math.imul(state ^ (state >>> 13), 0x297a2d39) + 0x85ebca6b) >>> 0;
    return (state ^ (state >>> 16)) >>> 0;
  };
}
