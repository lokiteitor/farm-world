// The world: its description, and the decoded chunk cache.
//
// Owner: W3-C. The renderer of W4-D reads this store and never writes it.
//
// Two decisions shape this module.
//
// First, the terrain does not travel. It is a pure function of the seed and the
// coordinate and the same deterministic generator lives in shared/world, so the client
// reproduces it locally and only the layer of modifications is downloaded (plan section
// 5.1). A chunk is therefore renderable as soon as the seed is known, and the reply only
// decides ownership, use and cleared forest.
//
// Second, the cache is a plain `Map` and not reactive state, and the components watch a
// revision counter instead. Two hundred and fifty six cached chunks of a thousand cells
// each is a quarter of a million objects; making them deeply reactive would spend the
// whole frame budget on dependency tracking for data that only the canvas reads. The
// counter gives the panels the invalidation they need without paying for it per cell.
//
// The gap rule applies per chunk exactly as it applies to the sequence (plan section 9.5):
// a `CHUNK_PATCHED` frame whose version is the next one is applied, an older one is
// discarded, and a jump marks the chunk stale so that the streaming path reloads it.

import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import {
  CELLS_PER_CHUNK,
  CELL_PX,
  CELL_SIZE_M,
  CHUNK_SIZE,
  CellOwnership,
  LandUse,
  MAX_SELECTION_CELLS,
  cellIndex,
  chunkOf,
  chunksCovering,
  generateChunkTerrain,
  terrainFromCode,
  type CellCoordWire,
  type ChunkCellPatch,
  type ChunkCoordWire,
  type ChunkPatchedPayload,
  type ChunkResult,
  type SelectionCell,
  type TerrainType,
  type WorldInfoReply,
} from '~/shared/index';

/** One chunk as the client holds it. */
export interface CachedChunk {
  readonly chunkX: number;
  readonly chunkY: number;
  /** Version of the modification layer. Zero means never modified. */
  version: number;
  /** Locally generated terrain, one byte per cell in row major order. */
  readonly terrain: Uint8Array;
  /** Only modified cells, by index inside the chunk (GDD section 58). */
  readonly patches: Map<number, ChunkCellPatch>;
  /** True when a version jump was seen and the chunk has to be reloaded. */
  stale: boolean;
  readonly loadedAtRealMs: number;
}

/** How a chunk patch was treated, which is the per chunk form of the sequence rule. */
export const ChunkPatchVerdict = {
  APPLIED: 'APPLIED',
  DISCARDED: 'DISCARDED',
  STALE: 'STALE',
  UNKNOWN_CHUNK: 'UNKNOWN_CHUNK',
} as const;
export type ChunkPatchVerdict = (typeof ChunkPatchVerdict)[keyof typeof ChunkPatchVerdict];

export function chunkCacheKey(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`;
}

export const useWorldStore = defineStore('world', () => {
  const info = shallowRef<WorldInfoReply | null>(null);
  /** Bumped whenever the cache changes, so a component can watch one number. */
  const revision = ref(0);
  /** Chunks whose version jumped and that the streaming path must reload. */
  const staleChunkKeys = ref<readonly string[]>([]);

  const cache = new Map<string, CachedChunk>();

  const ready = computed(() => info.value !== null);
  const seed = computed(() => info.value?.seed ?? 0);
  const chunkSize = computed(() => info.value?.chunkSize ?? CHUNK_SIZE);
  const cellPx = computed(() => info.value?.cellPx ?? CELL_PX);
  const cellSizeM = computed(() => info.value?.cellSizeM ?? CELL_SIZE_M);
  const maxSelectionCells = computed(() => info.value?.maxSelectionCells ?? MAX_SELECTION_CELLS);
  const contractVersion = computed(() => info.value?.contractVersion ?? null);
  const loadedChunkCount = computed(() => {
    // `revision` is read so that this value is invalidated when the cache changes; the
    // cache itself is deliberately outside the reactivity graph.
    void revision.value;
    return cache.size;
  });

  /** Where a new player was placed, so the camera can start there (plan section 2). */
  const spawnCell = computed<CellCoordWire | null>(() => {
    const current = info.value;
    if (current === null || current.spawnCellX === null || current.spawnCellY === null) {
      return null;
    }
    return { cellX: current.spawnCellX, cellY: current.spawnCellY };
  });

  function touch(): void {
    revision.value += 1;
  }

  function markStale(key: string): void {
    if (!staleChunkKeys.value.includes(key)) {
      staleChunkKeys.value = [...staleChunkKeys.value, key];
    }
  }

  function clearStale(keys: readonly string[]): void {
    const dropped = new Set(keys);
    staleChunkKeys.value = staleChunkKeys.value.filter((key) => !dropped.has(key));
  }

  /**
   * Ensures the terrain of a chunk is generated and cached. Generating is cheap, a
   * thousand chunks in about a hundred and thirty milliseconds, and it is the reason no
   * terrain is downloaded at all.
   */
  function ensureChunk(chunkX: number, chunkY: number, atRealMs: number): CachedChunk {
    const key = chunkCacheKey(chunkX, chunkY);
    const held = cache.get(key);
    if (held !== undefined) {
      return held;
    }
    const created: CachedChunk = {
      chunkX,
      chunkY,
      version: 0,
      terrain: generateChunkTerrain(seed.value, { chunkX, chunkY }),
      patches: new Map<number, ChunkCellPatch>(),
      stale: false,
      loadedAtRealMs: atRealMs,
    };
    cache.set(key, created);
    touch();
    return created;
  }

  function getChunk(chunkX: number, chunkY: number): CachedChunk | undefined {
    return cache.get(chunkCacheKey(chunkX, chunkY));
  }

  /** Version the client holds, for the `rev` of a batch request. Undefined when absent. */
  function heldVersion(chunkX: number, chunkY: number): number | undefined {
    return cache.get(chunkCacheKey(chunkX, chunkY))?.version;
  }

  /** Applies one entry of the reply of `POST /api/world/chunks`. */
  function applyChunkResult(result: ChunkResult, atRealMs: number): void {
    const chunk = ensureChunk(result.chunkX, result.chunkY, atRealMs);
    if (result.unchanged) {
      chunk.version = result.version;
      chunk.stale = false;
      clearStale([chunkCacheKey(result.chunkX, result.chunkY)]);
      touch();
      return;
    }
    chunk.patches.clear();
    for (const cell of result.cells) {
      chunk.patches.set(cell.idx, cell);
    }
    chunk.version = result.version;
    chunk.stale = false;
    clearStale([chunkCacheKey(result.chunkX, result.chunkY)]);
    touch();
  }

  /**
   * Applies a live patch, with the gap rule per chunk.
   *
   * A patch is a delta of the modified cells and not the whole layer, so it can only be
   * applied on top of the exact version it follows. Anything else is a reload: guessing
   * would leave the renderer showing a cell that no longer belongs to the field it is
   * drawn inside.
   */
  function applyChunkPatch(payload: ChunkPatchedPayload): ChunkPatchVerdict {
    const key = chunkCacheKey(payload.chunkX, payload.chunkY);
    const chunk = cache.get(key);
    if (chunk === undefined) {
      // Not loaded, so nothing to invalidate: the streaming path will fetch it at its
      // current version when the camera needs it.
      return ChunkPatchVerdict.UNKNOWN_CHUNK;
    }
    if (payload.version <= chunk.version) {
      return ChunkPatchVerdict.DISCARDED;
    }
    if (payload.version > chunk.version + 1) {
      chunk.stale = true;
      markStale(key);
      touch();
      return ChunkPatchVerdict.STALE;
    }
    for (const cell of payload.cells) {
      chunk.patches.set(cell.idx, cell);
    }
    chunk.version = payload.version;
    touch();
    return ChunkPatchVerdict.APPLIED;
  }

  /**
   * Drops every cached modification layer, keeping the generated terrain.
   *
   * This is what a full snapshot resynchronisation triggers: the snapshot rebuilds the
   * entities and says nothing about the grid, so the grid has to be re-read rather than
   * trusted (plan section 7).
   */
  function invalidateModifications(): void {
    for (const [key, chunk] of cache) {
      chunk.patches.clear();
      chunk.version = 0;
      chunk.stale = true;
      markStale(key);
    }
    touch();
  }

  /** Forgets a chunk entirely. Used by the LRU eviction of the streaming path. */
  function evictChunk(chunkX: number, chunkY: number): void {
    const key = chunkCacheKey(chunkX, chunkY);
    if (cache.delete(key)) {
      clearStale([key]);
      touch();
    }
  }

  /** The modification record of one cell, or undefined for an untouched cell. */
  function patchAt(cellX: number, cellY: number): ChunkCellPatch | undefined {
    const chunk = chunkOf(cellX, cellY, chunkSize.value);
    const held = cache.get(chunkCacheKey(chunk.chunkX, chunk.chunkY));
    if (held === undefined) {
      return undefined;
    }
    return held.patches.get(cellIndex(cellX, cellY, chunkSize.value));
  }

  /** Effective terrain of a cell: the override of a cleared forest, or the generated one. */
  function terrainAtCell(cellX: number, cellY: number): TerrainType | null {
    const chunk = chunkOf(cellX, cellY, chunkSize.value);
    const held = cache.get(chunkCacheKey(chunk.chunkX, chunk.chunkY));
    if (held === undefined) {
      return null;
    }
    const index = cellIndex(cellX, cellY, chunkSize.value);
    const patch = held.patches.get(index);
    if (patch?.terrainOverride != null) {
      return patch.terrainOverride;
    }
    return terrainFromCode(held.terrain[index] ?? 0);
  }

  /**
   * The cell as the shared selection rules want it (`SelectionCell`).
   *
   * This is the function that makes the green highlight of a drag and the 409 of the
   * server impossible to disagree: both sides evaluate the same rule over the same shape,
   * and the only thing the client adds is the resolution of "whose is it" from the point
   * of view of this player. Null when the chunk is not loaded, which the caller has to
   * treat as undecided rather than as invalid.
   */
  function selectionCellAt(
    cellX: number,
    cellY: number,
    viewerPlayerId: string | null,
  ): SelectionCell | null {
    const terrain = terrainAtCell(cellX, cellY);
    if (terrain === null) {
      return null;
    }
    const patch = patchAt(cellX, cellY);
    if (patch === undefined) {
      return {
        cellX,
        cellY,
        terrain,
        ownership: CellOwnership.UNOWNED,
        landUse: LandUse.NONE,
        hasStandingTree: false,
      };
    }
    const ownership =
      patch.ownerPlayerId === null
        ? CellOwnership.UNOWNED
        : patch.ownerPlayerId === viewerPlayerId
          ? CellOwnership.PLAYER
          : CellOwnership.OTHER;
    return {
      cellX,
      cellY,
      terrain,
      ownership,
      landUse: patch.landUse,
      hasStandingTree: patch.hasStandingTree,
    };
  }

  /** Chunks a rectangle of cells covers, which is what a batch request asks for. */
  function chunksForArea(
    fromCellX: number,
    fromCellY: number,
    toCellX: number,
    toCellY: number,
  ): readonly ChunkCoordWire[] {
    return chunksCovering(fromCellX, fromCellY, toCellX, toCellY, chunkSize.value);
  }

  function applyWorldInfo(next: WorldInfoReply): void {
    const previous = info.value;
    info.value = next;
    // A change of seed, of generator version or of chunk size invalidates every
    // coordinate already cached. It should never happen inside one session; if it does,
    // dropping the cache is the only safe response.
    if (
      previous !== null &&
      (previous.seed !== next.seed ||
        previous.generatorVersion !== next.generatorVersion ||
        previous.chunkSize !== next.chunkSize)
    ) {
      cache.clear();
      staleChunkKeys.value = [];
      touch();
    }
  }

  function reset(): void {
    info.value = null;
    cache.clear();
    staleChunkKeys.value = [];
    revision.value = 0;
  }

  return {
    info,
    revision,
    staleChunkKeys,
    ready,
    seed,
    chunkSize,
    cellPx,
    cellSizeM,
    maxSelectionCells,
    contractVersion,
    loadedChunkCount,
    spawnCell,
    cellsPerChunk: CELLS_PER_CHUNK,
    ensureChunk,
    getChunk,
    heldVersion,
    applyChunkResult,
    applyChunkPatch,
    invalidateModifications,
    evictChunk,
    clearStale,
    patchAt,
    terrainAtCell,
    selectionCellAt,
    chunksForArea,
    applyWorldInfo,
    reset,
  };
});
