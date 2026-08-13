// Chunk streaming: load, unload, evict, refetch and repaint.
//
// Owner: workflow W4-D (world rendering). It is the orchestration of plan section 9.5,
// and it deliberately holds no arithmetic of its own: the set difference with its
// hysteresis is `planStreaming`, the recency order is `createLruIndex`, and the drawing
// is the chunk view. What is left here is the sequencing, which is the part that has to
// be read as a story.
//
// Four rules the module exists to hold:
//
//   1. The terrain never travels (ADR-0010). A chunk is renderable the moment the seed
//      is known, so a view is created and drawn immediately and the modification layer
//      arrives afterwards and repaints it. The alternative, waiting for the network
//      before drawing anything, would show holes while panning over land nobody owns,
//      which is most of a virtually infinite world.
//   2. At most 32 chunks are loaded per tick, nearest to the camera first.
//   3. The cache holds 256 decoded chunks, and a chunk inside the survival ring is
//      never evicted however old its last use.
//   4. A `CHUNK_PATCHED` whose version is not the next one marks the chunk stale, and a
//      stale chunk is refetched in full rather than patched. That rule lives in the
//      world store (ADR-0019); what lives here is the consequence, which is asking for
//      the chunk again without a `rev`.

// The first import is `import type` and not an inline `type` keyword:
// `verbatimModuleSyntax` would keep the import statement, and with it Phaser, in a module
// that is otherwise engine free and unit tested without a canvas.
import type { ChunkQuadCount } from './chunkView';
import {
  CHUNK_CACHE_CAPACITY,
  MAX_CHUNK_LOADS_PER_TICK,
  MAX_LEVEL_UPGRADES_PER_TICK,
  PREFETCH_RING_CHUNKS,
  UNLOAD_RING_CHUNKS,
  type LevelOfDetail,
} from './config';
import { createLruIndex, type LruIndex } from './lru';
import {
  chunkKeyOf,
  parseChunkKey,
  type ChunkFetchRequest,
  type WorldChunkView,
  type WorldSource,
} from './source';
import { chunkRectContains, planStreaming, type CellRect, type ChunkRect } from './viewport';
import { MAX_CHUNKS_PER_REQUEST } from '~/shared/index';

/** What the streamer needs of a chunk on screen. `ChunkView` satisfies it. */
export interface ChunkRenderer {
  readonly key: string;
  version: number;
  apply(chunk: WorldChunkView): void;
  setLevelOfDetail(level: LevelOfDetail): void;
  /** Builds the half the current level needs, if it does not exist yet. */
  ensureLevel(chunk: WorldChunkView | undefined): void;
  /** Whether the engine object of a level already exists for this chunk. */
  hasLevel(level: LevelOfDetail): boolean;
  setCulled(culled: boolean): void;
  quads(): ChunkQuadCount;
  destroy(): void;
}

export interface ChunkStreamerDeps {
  readonly source: WorldSource;
  readonly createView: (chunk: WorldChunkView) => ChunkRenderer;
  /** Reports a failed batch. The streamer never swallows one silently. */
  readonly onFetchError?: (error: unknown) => void;
  readonly capacity?: number;
  readonly prefetchRing?: number;
  readonly unloadRing?: number;
  readonly maxLoadsPerTick?: number;
  readonly maxUpgradesPerTick?: number;
}

/** What one tick did. Read by the debug counter and by the measurement route. */
export interface StreamTickStats {
  readonly loaded: number;
  readonly unloaded: number;
  readonly evicted: number;
  readonly repainted: number;
  /** Visible chunks that built the half of the current level they still lacked. */
  readonly upgraded: number;
  readonly deferred: number;
  readonly visibleChunks: number;
  readonly liveChunks: number;
  readonly inFlightRequests: number;
  readonly visibleRect: ChunkRect;
}

export class ChunkStreamer {
  private readonly deps: ChunkStreamerDeps;

  private readonly views = new Map<string, ChunkRenderer>();

  private readonly recency: LruIndex<string>;

  /** Chunks whose modification layer has been asked for and not yet answered. */
  private readonly requested = new Set<string>();

  /**
   * Chunks whose modification layer has arrived at least once.
   *
   * Separate from `requested`, and the separation is what makes a failed batch
   * recoverable: a chunk that was asked for and never answered is not settled, so the
   * next tick asks again, whereas one that was answered is only asked for again when
   * the gap rule marks it stale.
   */
  private readonly settled = new Set<string>();

  private inFlight = 0;

  private lastRevision = -1;

  private level: LevelOfDetail;

  private destroyed = false;

  /** Visible rectangle of the last tick, so the switch can ask about what is on screen. */
  private lastVisible: ChunkRect = { minChunkX: 0, minChunkY: 0, maxChunkX: -1, maxChunkY: -1 };

  constructor(deps: ChunkStreamerDeps, level: LevelOfDetail) {
    this.deps = deps;
    this.level = level;
    this.recency = createLruIndex<string>(deps.capacity ?? CHUNK_CACHE_CAPACITY);
  }

  /** Live chunk views, for the outline pass and for the statistics. */
  live(): IterableIterator<ChunkRenderer> {
    return this.views.values();
  }

  get liveCount(): number {
    return this.views.size;
  }

  get requestsInFlight(): number {
    return this.inFlight;
  }

  /**
   * Switches the level of detail of every live chunk.
   *
   * Only visibility changes, which is the property plan section 9.3 asks for: crossing
   * the threshold must not rebuild anything that already exists.
   */
  setLevelOfDetail(level: LevelOfDetail): number {
    if (this.level === level) {
      return 0;
    }
    this.level = level;
    let pending = 0;
    for (const [key, view] of this.views) {
      const point = parseChunkKey(key);
      if (
        point !== null &&
        chunkRectContains(this.lastVisible, point.chunkX, point.chunkY) &&
        !view.hasLevel(level)
      ) {
        pending += 1;
      }
      // Visibility only. What is missing is built by the tick loop, a bounded number of
      // chunks at a time; see `ChunkView.ensureLevel`.
      view.setLevelOfDetail(level);
    }
    // Visible chunks that have never been drawn at this level. Counted over the visible
    // rectangle and not over the whole cache, because a chunk the camera cannot see is
    // never built at all and counting it would make the number say nothing. The
    // measurement route asserts it is zero once the visible chunks have seen both levels.
    return pending;
  }

  /** One streaming tick. Not once per frame: `STREAM_TICK_MS` throttles the caller. */
  tick(view: CellRect): StreamTickStats {
    if (this.destroyed) {
      return this.emptyStats();
    }
    const source = this.deps.source;
    const plan = planStreaming({
      view,
      chunkSize: source.chunkSize,
      loaded: this.views.keys(),
      prefetchRing: this.deps.prefetchRing ?? PREFETCH_RING_CHUNKS,
      unloadRing: this.deps.unloadRing ?? UNLOAD_RING_CHUNKS,
      maxLoadsPerTick: this.deps.maxLoadsPerTick ?? MAX_CHUNK_LOADS_PER_TICK,
    });

    // 1. Load. The terrain is generated locally, so the view exists and draws at once.
    let loaded = 0;
    for (const point of plan.load) {
      const chunk = source.ensureChunk(point.chunkX, point.chunkY);
      const created = this.deps.createView(chunk);
      this.views.set(created.key, created);
      this.recency.touch(created.key);
      created.setLevelOfDetail(this.level);
      loaded += 1;
    }

    // 2. Unload what left the survival ring.
    let unloaded = 0;
    for (const key of plan.unload) {
      if (this.drop(key)) {
        unloaded += 1;
      }
    }

    // 3. Evict down to capacity, never touching what the camera needs.
    let evicted = 0;
    for (const key of this.recency.overflow(plan.keep)) {
      if (this.drop(key)) {
        evicted += 1;
      }
    }

    // 4. Ask for the modification layer of everything that needs it: a chunk that has
    //    never been answered, and a chunk the gap rule marked stale (ADR-0019). The
    //    ceiling is the same as for loads, so a burst of failures cannot turn into a
    //    burst of requests.
    const stale = new Set(source.staleKeys());
    const ceiling = this.deps.maxLoadsPerTick ?? MAX_CHUNK_LOADS_PER_TICK;
    const upgradeCeiling = this.deps.maxUpgradesPerTick ?? MAX_LEVEL_UPGRADES_PER_TICK;
    const pending: ChunkFetchRequest[] = [];
    for (const key of this.views.keys()) {
      if (pending.length >= ceiling) {
        break;
      }
      if (this.requested.has(key)) {
        continue;
      }
      const isStale = stale.has(key);
      if (this.settled.has(key) && !isStale) {
        continue;
      }
      const point = parseChunkKey(key);
      if (point === null) {
        continue;
      }
      this.requested.add(key);
      pending.push({
        chunkX: point.chunkX,
        chunkY: point.chunkY,
        // A stale chunk is one whose delta cannot be applied, so the whole layer is
        // asked for again and `rev` is deliberately omitted; anything else would let
        // the server answer `unchanged` to a client that is not.
        rev: isStale ? undefined : source.heldVersion(point.chunkX, point.chunkY),
      });
    }

    // 5. Repaint whatever changed version since the last tick.
    let repainted = 0;
    const revision = source.revision();
    if (revision !== this.lastRevision) {
      this.lastRevision = revision;
      for (const [key, held] of this.views) {
        const point = parseChunkKey(key);
        if (point === null) {
          continue;
        }
        const chunk = source.chunk(point.chunkX, point.chunkY);
        if (chunk === undefined || chunk.version === held.version) {
          continue;
        }
        held.apply(chunk);
        repainted += 1;
      }
    }

    // 6. Cull, touch, and build what a visible chunk still lacks.
    //
    //    A chunk the camera can see is used, which is what keeps it out of the eviction
    //    list, and a chunk it cannot see costs no draw call. The build is bounded by the
    //    same per tick ceiling as a load, and only visible chunks are built: after a
    //    threshold crossing that is a few ticks of catching up instead of one frame in
    //    which every live chunk builds a texture.
    let visibleChunks = 0;
    let upgraded = 0;
    for (const [key, held] of this.views) {
      const point = parseChunkKey(key);
      if (point === null) {
        continue;
      }
      const onScreen = chunkRectContains(plan.visible, point.chunkX, point.chunkY);
      held.setCulled(!onScreen);
      if (!onScreen) {
        continue;
      }
      visibleChunks += 1;
      this.recency.touch(key);
      if (upgraded < upgradeCeiling && !held.hasLevel(this.level)) {
        held.ensureLevel(source.chunk(point.chunkX, point.chunkY));
        upgraded += 1;
      }
    }

    this.lastVisible = plan.visible;
    this.dispatch(pending);

    return {
      loaded,
      unloaded,
      evicted,
      repainted,
      upgraded,
      deferred: plan.deferred,
      visibleChunks,
      liveChunks: this.views.size,
      inFlightRequests: this.inFlight,
      visibleRect: plan.visible,
    };
  }

  /** Forces every live chunk to be asked for again. Used after a full snapshot. */
  invalidateAll(): void {
    this.settled.clear();
    this.lastRevision = -1;
  }

  /** Drops every view and empties the index. */
  destroy(): void {
    this.destroyed = true;
    for (const view of this.views.values()) {
      view.destroy();
    }
    this.views.clear();
    this.recency.clear();
    this.requested.clear();
    this.settled.clear();
  }

  private drop(key: string): boolean {
    const held = this.views.get(key);
    if (held === undefined) {
      this.recency.delete(key);
      return false;
    }
    held.destroy();
    this.views.delete(key);
    this.recency.delete(key);
    this.requested.delete(key);
    this.settled.delete(key);
    const point = parseChunkKey(key);
    if (point !== null) {
      // The decoded chunk goes too: the cache of the store and the views of the scene
      // have one lifetime, so a chunk cannot be held by one and forgotten by the other.
      this.deps.source.evictChunk(point.chunkX, point.chunkY);
    }
    return true;
  }

  /** Issues the batch requests, respecting the ceiling of the contract. */
  private dispatch(requests: readonly ChunkFetchRequest[]): void {
    for (let start = 0; start < requests.length; start += MAX_CHUNKS_PER_REQUEST) {
      const batch = requests.slice(start, start + MAX_CHUNKS_PER_REQUEST);
      this.inFlight += 1;
      void this.deps.source
        .fetch(batch)
        .then(() => {
          for (const request of batch) {
            this.settled.add(chunkKeyOf(request.chunkX, request.chunkY));
          }
        })
        .catch((error: unknown) => {
          this.deps.onFetchError?.(error);
        })
        .finally(() => {
          this.inFlight -= 1;
          for (const request of batch) {
            this.requested.delete(chunkKeyOf(request.chunkX, request.chunkY));
          }
        });
    }
  }

  private emptyStats(): StreamTickStats {
    return {
      loaded: 0,
      unloaded: 0,
      evicted: 0,
      repainted: 0,
      upgraded: 0,
      deferred: 0,
      visibleChunks: 0,
      liveChunks: 0,
      inFlightRequests: 0,
      visibleRect: { minChunkX: 0, minChunkY: 0, maxChunkX: -1, maxChunkY: -1 },
    };
  }
}
