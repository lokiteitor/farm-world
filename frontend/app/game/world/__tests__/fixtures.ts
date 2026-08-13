// Fixtures of the world renderer tests.
//
// Owner: workflow W4-D. A chunk view built by hand, so a test states one fact about one
// shape instead of generating a world and hunting for a cell that happens to be owned.

import { type WorldChunkView } from '../source';
import { CHUNK_SIZE, LandUse, type ChunkCellPatch, type TerrainType } from '~/shared/index';

export const VIEWER = 'player-viewer';
export const STRANGER = 'player-stranger';

/** A patch with everything null but what the test cares about. */
export function patch(overrides: Partial<ChunkCellPatch> & { idx: number }): ChunkCellPatch {
  return {
    terrainOverride: null,
    ownerPlayerId: null,
    landUse: LandUse.NONE,
    fieldId: null,
    forestPlotId: null,
    buildingId: null,
    hasStandingTree: false,
    ...overrides,
  };
}

export interface ChunkFixture {
  readonly chunkX?: number;
  readonly chunkY?: number;
  readonly version?: number;
  readonly terrainCode?: number;
  readonly patches?: readonly ChunkCellPatch[];
}

/** A chunk whose generated terrain is one uniform code and whose patches are given. */
export function makeChunk(fixture: ChunkFixture = {}): WorldChunkView {
  const terrain = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  terrain.fill(fixture.terrainCode ?? 0);
  const patches = new Map<number, ChunkCellPatch>();
  for (const entry of fixture.patches ?? []) {
    patches.set(entry.idx, entry);
  }
  return {
    chunkX: fixture.chunkX ?? 0,
    chunkY: fixture.chunkY ?? 0,
    version: fixture.version ?? (patches.size === 0 ? 0 : 1),
    terrain,
    patches,
    stale: false,
  };
}

/** Index of a cell inside a chunk, row major. */
export function idxOf(localX: number, localY: number): number {
  return localY * CHUNK_SIZE + localX;
}

/** A rectangle of patches inside one chunk. */
export function rect(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  build: (idx: number) => ChunkCellPatch,
): readonly ChunkCellPatch[] {
  const cells: ChunkCellPatch[] = [];
  for (let y = fromY; y <= toY; y += 1) {
    for (let x = fromX; x <= toX; x += 1) {
      cells.push(build(idxOf(x, y)));
    }
  }
  return cells;
}

/** Terrain codes, so a test does not have to remember the wire encoding. */
export const TERRAIN: Readonly<Record<TerrainType, number>> = {
  GRASS: 0,
  FOREST: 1,
  MOUNTAIN: 2,
  WATER: 3,
};
