// The port through which the world renderer reads state.
//
// Owner: workflow W4-D (world rendering).
//
// Why a port and not a store import. The zone rule of `eslint.config.js` forbids
// `frontend/app/game` from importing `frontend/app/stores`, and it is the mechanical
// half of the pillar of plan section 9: Phaser owns the canvas and never the server
// state. So the scene declares what it needs as an interface and somebody outside the
// canvas binds it. The binding is `createStoreWorldSource`, which lives here and yet
// imports nothing from `app/stores`: it declares the shape of the store structurally,
// exactly as `game/index.ts` declares the shell bridge, so a renamed method stops the
// compilation at the call site, which is where the mismatch belongs.
//
// What travels and what does not (ADR-0010). The terrain is a pure function of the
// seed and the coordinate and never crosses the network: the client reproduces it with
// the same deterministic generator the server runs. Only the modification layer is
// fetched, and only it carries a version.

import {
  CELL_PX,
  CHUNK_SIZE,
  cellKey,
  generateChunkTerrain,
  worldFromChunk,
  type Bp,
  type ChunkCellPatch,
  type ChunkResult,
  type CropCycleState,
} from '~/shared/index';

/** One chunk as the renderer reads it. Structurally satisfied by the world store. */
export interface WorldChunkView {
  readonly chunkX: number;
  readonly chunkY: number;
  /** Version of the modification layer. Zero means never modified. */
  readonly version: number;
  /** Locally generated terrain, one byte per cell in row major order. */
  readonly terrain: Uint8Array;
  /** Only modified cells, by index inside the chunk (GDD section 58). */
  readonly patches: ReadonlyMap<number, ChunkCellPatch>;
  /** True when a version jump was seen and the chunk has to be reloaded. */
  readonly stale: boolean;
}

/**
 * What the usage layer needs about a field and the chunk layer does not carry.
 *
 * The state of the crop cycle lives on the field and never on the cell (ADR-0010),
 * so the renderer resolves it by identifier. `growthProgressBp` travels as a tint and
 * never as more tiles (plan section 9.3).
 */
export interface FieldRenderState {
  readonly cropCycleState: CropCycleState;
  /** Progress inside the growing phase, in basis points (ADR-0013). */
  readonly growthProgressBp: Bp;
}

/** One chunk of a batch request, with the version the client already holds. */
export interface ChunkFetchRequest {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly rev?: number | undefined;
}

/** Everything the world scene reads. Nothing here writes domain state. */
export interface WorldSource {
  /** Seed of the terrain generator. Drives the tile variant as well (ADR-0020). */
  readonly seed: number;
  readonly chunkSize: number;
  readonly cellPx: number;
  /** Player the ownership colours are resolved against. */
  viewerPlayerId(): string | null;
  /** Bumped whenever the cached data changed. The scene watches one number. */
  revision(): number;
  chunk(chunkX: number, chunkY: number): WorldChunkView | undefined;
  /** Generates the terrain of a chunk if needed and returns it. */
  ensureChunk(chunkX: number, chunkY: number): WorldChunkView;
  /** Version held, for the `rev` of a batch request. Undefined when absent. */
  heldVersion(chunkX: number, chunkY: number): number | undefined;
  evictChunk(chunkX: number, chunkY: number): void;
  /** Chunks whose version jumped and which must be refetched (plan section 9.5). */
  staleKeys(): readonly string[];
  /** Fetches the modification layer. Resolves once the source has applied it. */
  fetch(requests: readonly ChunkFetchRequest[]): Promise<void>;
  fieldState(fieldId: string): FieldRenderState | undefined;
  /** Cells awaiting the answer of the server, as cell keys (plan section 7). */
  pendingCells(): ReadonlySet<number>;
}

/** Key of a chunk in the cache. The same string the world store uses. */
export function chunkKeyOf(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`;
}

/** Inverse of `chunkKeyOf`. Null for anything that is not a chunk key. */
export function parseChunkKey(key: string): { chunkX: number; chunkY: number } | null {
  const separator = key.indexOf(':');
  if (separator <= 0) {
    return null;
  }
  const chunkX = Number(key.slice(0, separator));
  const chunkY = Number(key.slice(separator + 1));
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) {
    return null;
  }
  return { chunkX, chunkY };
}

// ---------------------------------------------------------------------------
// Binding to the world store
// ---------------------------------------------------------------------------

/**
 * The shape of `app/stores/world.ts`, declared structurally.
 *
 * A Pinia setup store unwraps its computed refs on the proxy, so `store.seed` is a
 * number and reading it again gives the current value. That is why every accessor
 * below is read on each call and never captured at construction.
 */
export interface WorldStoreLike {
  readonly seed: number;
  readonly chunkSize: number;
  readonly cellPx: number;
  readonly revision: number;
  readonly staleChunkKeys: readonly string[];
  ensureChunk(chunkX: number, chunkY: number, atRealMs: number): WorldChunkView;
  getChunk(chunkX: number, chunkY: number): WorldChunkView | undefined;
  heldVersion(chunkX: number, chunkY: number): number | undefined;
  applyChunkResult(result: ChunkResult, atRealMs: number): void;
  evictChunk(chunkX: number, chunkY: number): void;
  clearStale(keys: readonly string[]): void;
}

/** What the binding needs beyond the store itself. */
export interface StoreWorldSourceDeps {
  readonly store: WorldStoreLike;
  readonly viewerPlayerId: () => string | null;
  /** Issues `POST /api/world/chunks` and returns the results of the contract. */
  readonly requestChunks: (
    requests: readonly ChunkFetchRequest[],
  ) => Promise<readonly ChunkResult[]>;
  readonly fieldState?: (fieldId: string) => FieldRenderState | undefined;
  readonly pendingCells?: () => ReadonlySet<number>;
  /**
   * Real clock. Injected rather than read from the ambient one, so a test fixes it
   * and so no rendering path reaches for `Date.now`.
   */
  readonly nowRealMs?: () => number;
}

const NO_PENDING: ReadonlySet<number> = new Set<number>();

/**
 * Binds the world store to the port.
 *
 * Roughly twenty lines, and every one of them is a translation and not a decision:
 * the store already holds the decoded cache, applies the per chunk gap rule and
 * exposes the eviction the LRU of the streamer drives (plan section 9.5).
 */
export function createStoreWorldSource(deps: StoreWorldSourceDeps): WorldSource {
  const now = deps.nowRealMs ?? ((): number => performance.now());
  return {
    get seed(): number {
      return deps.store.seed;
    },
    get chunkSize(): number {
      return deps.store.chunkSize;
    },
    get cellPx(): number {
      return deps.store.cellPx;
    },
    viewerPlayerId: () => deps.viewerPlayerId(),
    revision: () => deps.store.revision,
    chunk: (chunkX, chunkY) => deps.store.getChunk(chunkX, chunkY),
    ensureChunk: (chunkX, chunkY) => deps.store.ensureChunk(chunkX, chunkY, now()),
    heldVersion: (chunkX, chunkY) => deps.store.heldVersion(chunkX, chunkY),
    evictChunk: (chunkX, chunkY) => {
      deps.store.evictChunk(chunkX, chunkY);
    },
    staleKeys: () => deps.store.staleChunkKeys,
    fetch: async (requests) => {
      if (requests.length === 0) {
        return;
      }
      const results = await deps.requestChunks(requests);
      const atRealMs = now();
      for (const result of results) {
        deps.store.applyChunkResult(result, atRealMs);
      }
    },
    fieldState: (fieldId) => deps.fieldState?.(fieldId),
    pendingCells: () => deps.pendingCells?.() ?? NO_PENDING,
  };
}

// ---------------------------------------------------------------------------
// A source with no network
// ---------------------------------------------------------------------------

/** Options of the offline source. Everything has a default so a test states one fact. */
export interface StaticWorldSourceOptions {
  readonly seed?: number;
  readonly chunkSize?: number;
  readonly cellPx?: number;
  readonly viewerPlayerId?: string | null;
  /** Modification layer of a chunk, generated on demand. Empty by default. */
  readonly patchesOf?: (chunkX: number, chunkY: number) => readonly ChunkCellPatch[];
  readonly fieldState?: (fieldId: string) => FieldRenderState | undefined;
}

/**
 * A source that generates everything locally and never touches the network.
 *
 * Two users, and both matter. The unit tests of the pure modules need a chunk without
 * a Pinia instance, and the measurement route needs a source whose cost is the cost of
 * the renderer and not of a mock HTTP round trip: a budget measured through a fetch
 * measures the fetch.
 */
export function createStaticWorldSource(options: StaticWorldSourceOptions = {}): WorldSource {
  const seed = options.seed ?? 1;
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const cellPx = options.cellPx ?? CELL_PX;
  const viewer = options.viewerPlayerId ?? null;
  const cache = new Map<string, WorldChunkView>();
  let revision = 0;

  function build(chunkX: number, chunkY: number): WorldChunkView {
    const patches = new Map<number, ChunkCellPatch>();
    for (const patch of options.patchesOf?.(chunkX, chunkY) ?? []) {
      patches.set(patch.idx, patch);
    }
    return {
      chunkX,
      chunkY,
      version: patches.size === 0 ? 0 : 1,
      terrain: generateChunkTerrain(seed, { chunkX, chunkY }, { chunkSize }),
      patches,
      stale: false,
    };
  }

  return {
    seed,
    chunkSize,
    cellPx,
    viewerPlayerId: () => viewer,
    revision: () => revision,
    chunk: (chunkX, chunkY) => cache.get(chunkKeyOf(chunkX, chunkY)),
    ensureChunk: (chunkX, chunkY) => {
      const key = chunkKeyOf(chunkX, chunkY);
      const held = cache.get(key);
      if (held !== undefined) {
        return held;
      }
      const created = build(chunkX, chunkY);
      cache.set(key, created);
      revision += 1;
      return created;
    },
    heldVersion: (chunkX, chunkY) => cache.get(chunkKeyOf(chunkX, chunkY))?.version,
    evictChunk: (chunkX, chunkY) => {
      if (cache.delete(chunkKeyOf(chunkX, chunkY))) {
        revision += 1;
      }
    },
    staleKeys: () => [],
    fetch: () => Promise.resolve(),
    fieldState: (fieldId) => options.fieldState?.(fieldId),
    pendingCells: () => NO_PENDING,
  };
}

/**
 * A deterministic modification layer for the measurement route.
 *
 * It is not decoration. The near level of detail draws two tilemap layers and the
 * outline pass extracts border segments, and both are proportional to how much of the
 * chunk is owned and used: a bench over an empty world would measure the cheap half of
 * the renderer and report a budget nobody can rely on. The shape is fixed by the chunk
 * coordinate, so two runs measure the same scene.
 */
export function benchPatchesOf(
  ownerPlayerId: string,
  chunkSize: number = CHUNK_SIZE,
): (chunkX: number, chunkY: number) => readonly ChunkCellPatch[] {
  return (chunkX: number, chunkY: number): readonly ChunkCellPatch[] => {
    const patches: ChunkCellPatch[] = [];
    const fieldId = `field-${((chunkX * 31 + chunkY * 17) & 3) + 1}`;
    for (let idx = 0; idx < chunkSize * chunkSize; idx += 1) {
      const localX = idx % chunkSize;
      const localY = Math.floor(idx / chunkSize);
      // Half the chunk is owned; a square inside it is a field. Both shapes have a
      // real perimeter, which is what the outline pass has to extract.
      const owned = localY >= chunkSize / 4;
      if (!owned) {
        continue;
      }
      const isField = localX >= 6 && localX < chunkSize - 6 && localY >= 12 && localY < 26;
      patches.push({
        idx,
        terrainOverride: null,
        ownerPlayerId,
        landUse: isField ? 'FIELD' : 'OWNED',
        fieldId: isField ? fieldId : null,
        forestPlotId: null,
        buildingId: null,
        hasStandingTree: false,
      });
    }
    return patches;
  };
}

/** Cell key of a cell of a chunk, so a caller does not redo the index arithmetic. */
export function cellKeyOfChunkIndex(
  chunkX: number,
  chunkY: number,
  idx: number,
  chunkSize: number = CHUNK_SIZE,
): number {
  const cell = worldFromChunk({ chunkX, chunkY }, idx, chunkSize);
  return cellKey(cell.cellX, cell.cellY);
}
