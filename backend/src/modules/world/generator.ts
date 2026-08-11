// The deterministic terrain generator, wrapped in a cache.
//
// Owner: workflow W3-B. Module `world`.
//
// The generator itself is pure and lives in `shared/world/terrain.ts`, because the client
// runs the very same code: the terrain never travels in a reply, so the server and the
// browser have to agree byte for byte (GDD sections 7 and 58, ADR-0010,
// docs/handoff/NOTES-W2c.md item 1.5). What lives here is everything the pure function
// must not know about: Redis, a bounded process cache and the counters that make a hit and
// a miss observable.
//
// Why cache something that costs 135 microseconds per chunk. Not for the batch route,
// which does not send terrain at all, but for the write paths: validating a selection of
// two thousand cells, allocating a spawn or clearing a forest all ask for the terrain of
// the cells they touch, and they ask for it again on the next request over the same land.
// The generated chunk is also the unit the renderer turns into a thumbnail, so 1 024 bytes
// is the natural granularity on both sides.
//
// The key carries the seed, the generator version and the coordinate, and nothing else.
// That is the whole invalidation strategy: terrain is immutable for a given seed and
// version, so an entry can never become wrong. Tuning `TERRAIN_NOISE` requires
// incrementing `GENERATOR_VERSION`, which changes every key at once and leaves the old
// entries unreferenced (ADR-0010).
//
// Two deliberate departures from "an entry is never invalidated", both documented in
// `docs/handoff/NOTES-w3b.md`:
//
//   1. The Redis entry carries a long expiry. That is eviction and not invalidation: the
//      value is reproducible from the seed, so an expired key costs one regeneration,
//      while a cache with no expiry at all grows with the area every player has ever
//      looked at and has no ceiling.
//   2. A Redis failure is never a request failure. The generator is the source of truth
//      and the cache is an optimisation, so every Redis branch reports through the
//      counters and the logger and carries on.

import { type Redis } from 'ioredis';
import { type ServiceContext } from '../../lib/context.js';
import { DEFAULT_KEY_PREFIX, type RedisKeys } from '../../plugins/redis.js';
import {
  cellKey,
  chunkOf,
  generateChunkTerrain,
  terrainFromCode,
  type CellCoord,
  type ChunkCoord,
  type TerrainType,
  type World,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Key of a chunk inside a map of one request: the coordinate and nothing else. */
export function chunkKey(chunk: ChunkCoord): string {
  return `${chunk.chunkX}:${chunk.chunkY}`;
}

/** The coordinate a chunk key came from. */
export function chunkFromKey(key: string): ChunkCoord {
  const parts = key.split(':');
  const chunkX = Number(parts[0]);
  const chunkY = Number(parts[1]);
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) {
    throw new RangeError(`No es una clave de chunk: ${key}`);
  }
  return { chunkX, chunkY };
}

/** Requested chunks without repetitions, in the order they were first asked for. */
export function dedupeChunks(chunks: Iterable<ChunkCoord>): readonly ChunkCoord[] {
  const seen = new Set<string>();
  const unique: ChunkCoord[] = [];
  for (const chunk of chunks) {
    const key = chunkKey(chunk);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({ chunkX: chunk.chunkX, chunkY: chunk.chunkY });
  }
  return unique;
}

/**
 * The key prefix of this deployment.
 *
 * `plugins/redis.ts` is frozen and its `keyBuilders` declares only the keys of workflow
 * W3-A, so the prefix is recovered from the one builder that exposes it whole. It matters
 * for more than tidiness: the integration harness isolates itself with its own prefix, and
 * a cache that ignored it would leave entries behind that its teardown does not delete.
 * The fallback is the production default, so a future change of shape degrades to a
 * working cache and not to a crash.
 */
export function worldKeyPrefix(keys: RedisKeys): string {
  const suffix = ':events:*';
  return keys.channelPattern.endsWith(suffix)
    ? keys.channelPattern.slice(0, -suffix.length)
    : DEFAULT_KEY_PREFIX;
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/**
 * Chunks the process keeps decoded. 512 chunks are 512 KiB, which is nothing, and it is
 * above the working set of one player: the streaming ring of plan section 9.5 holds 256.
 */
export const TERRAIN_MEMORY_CAPACITY = 512;

/**
 * Expiry of a cached chunk, in real milliseconds. Seven days: long enough that a chunk a
 * player revisits between sessions is still there, short enough that a world nobody visits
 * stops costing memory.
 */
export const TERRAIN_CACHE_TTL_REAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Where each answer came from. Read by the tests and by `docs/handoff/NOTES-w3b.md`. */
export interface TerrainCacheStats {
  /** Served from the decoded map of this process. */
  readonly memoryHits: number;
  /** Served from Redis. */
  readonly redisHits: number;
  /** Not cached anywhere and therefore generated. */
  readonly misses: number;
  /** Chunks handed to `generateChunkTerrain`. Equal to `misses` unless a write failed. */
  readonly generated: number;
  /** Round trips to Redis, one per batch and not one per chunk. */
  readonly redisReads: number;
  readonly redisWrites: number;
  /** Redis commands that failed. The answer was still correct; only the cache was lost. */
  readonly redisFailures: number;
}

export interface TerrainCache {
  /** Prefix of every key this cache writes, so a test can inspect the key space. */
  readonly keyPrefix: string;
  /** The Redis key of one chunk. Public because the cache test asserts its shape. */
  redisKey(world: World, chunk: ChunkCoord): string;
  /** Terrain of one chunk, as one byte per cell in row major order. */
  chunk(world: World, chunk: ChunkCoord): Promise<Uint8Array>;
  /** Terrain of several chunks, with a single round trip to Redis for the whole batch. */
  chunks(world: World, chunks: readonly ChunkCoord[]): Promise<ReadonlyMap<string, Uint8Array>>;
  /** Generated terrain of a set of cells, keyed by `cellKey`. */
  terrainOfCells(
    world: World,
    cells: readonly CellCoord[],
  ): Promise<ReadonlyMap<number, TerrainType>>;
  stats(): TerrainCacheStats;
  resetStats(): void;
  /** Empties the process cache. For the tests, which measure hits and misses. */
  clearMemory(): void;
}

interface MutableStats {
  memoryHits: number;
  redisHits: number;
  misses: number;
  generated: number;
  redisReads: number;
  redisWrites: number;
  redisFailures: number;
}

function emptyStats(): MutableStats {
  return {
    memoryHits: 0,
    redisHits: 0,
    misses: 0,
    generated: 0,
    redisReads: 0,
    redisWrites: 0,
    redisFailures: 0,
  };
}

/** A logger with the level this module uses. Kept minimal so the cache is testable alone. */
interface CacheLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

export interface TerrainCacheDeps {
  readonly redis: Redis;
  readonly keys: RedisKeys;
  readonly logger: CacheLogger;
  readonly memoryCapacity?: number;
  readonly ttlRealMs?: number;
}

/**
 * Builds a cache. One per service context; `terrainCacheOf` below hands out the shared one.
 */
export function createTerrainCache(deps: TerrainCacheDeps): TerrainCache {
  const prefix = worldKeyPrefix(deps.keys);
  const capacity = deps.memoryCapacity ?? TERRAIN_MEMORY_CAPACITY;
  const ttlRealMs = deps.ttlRealMs ?? TERRAIN_CACHE_TTL_REAL_MS;
  const stats = emptyStats();

  // Insertion ordered map as a least recently used cache: a read re-inserts, so the first
  // key of the iterator is always the coldest. It holds `Uint8Array` and not `Buffer`,
  // which is what the shared generator produces and what the callers index.
  const memory = new Map<string, Uint8Array>();

  const remember = (key: string, cells: Uint8Array): void => {
    if (memory.has(key)) {
      memory.delete(key);
    }
    memory.set(key, cells);
    while (memory.size > capacity) {
      const coldest = memory.keys().next();
      if (coldest.done === true) {
        break;
      }
      memory.delete(coldest.value);
    }
  };

  const touch = (key: string): Uint8Array | undefined => {
    const cells = memory.get(key);
    if (cells === undefined) {
      return undefined;
    }
    memory.delete(key);
    memory.set(key, cells);
    return cells;
  };

  const redisKey = (world: World, chunk: ChunkCoord): string =>
    `${prefix}:world:terrain:${world.seed}:${world.generatorVersion}:${chunk.chunkX}:${chunk.chunkY}`;

  // Derived from the persisted row and not from the constant, which is what makes the
  // corrupt entry check below meaningful for a world of another chunk size.
  const cellsPerChunk = (world: World): number => world.chunkSize * world.chunkSize;

  const generate = (world: World, chunk: ChunkCoord): Uint8Array => {
    stats.generated += 1;
    // The options are taken from the persisted world and not from `shared/config`: the
    // start-up check of `lib/gameClock.ts` already refuses to boot when the two disagree,
    // so passing the row makes the dependency explicit instead of implicit.
    return generateChunkTerrain(world.seed, chunk, {
      generatorVersion: world.generatorVersion,
      chunkSize: world.chunkSize,
    });
  };

  const readFromRedis = async (
    keys: readonly string[],
  ): Promise<readonly (Buffer | null)[] | null> => {
    if (keys.length === 0) {
      return [];
    }
    try {
      stats.redisReads += 1;
      return await deps.redis.mgetBuffer(...keys);
    } catch (error) {
      stats.redisFailures += 1;
      deps.logger.warn(
        { err: error, keys: keys.length },
        'the chunk terrain cache could not be read',
      );
      return null;
    }
  };

  const writeToRedis = async (
    entries: readonly (readonly [string, Uint8Array])[],
  ): Promise<void> => {
    if (entries.length === 0) {
      return;
    }
    try {
      stats.redisWrites += 1;
      const pipeline = deps.redis.pipeline();
      for (const [key, cells] of entries) {
        pipeline.set(
          key,
          Buffer.from(cells.buffer, cells.byteOffset, cells.byteLength),
          'PX',
          ttlRealMs,
        );
      }
      await pipeline.exec();
    } catch (error) {
      stats.redisFailures += 1;
      deps.logger.warn(
        { err: error, entries: entries.length },
        'the chunk terrain cache could not be written',
      );
    }
  };

  const chunks = async (
    world: World,
    requested: readonly ChunkCoord[],
  ): Promise<ReadonlyMap<string, Uint8Array>> => {
    const unique = dedupeChunks(requested);
    const result = new Map<string, Uint8Array>();
    const pending: ChunkCoord[] = [];

    for (const chunk of unique) {
      const cached = touch(redisKey(world, chunk));
      if (cached === undefined) {
        pending.push(chunk);
        continue;
      }
      stats.memoryHits += 1;
      result.set(chunkKey(chunk), cached);
    }

    if (pending.length === 0) {
      return result;
    }

    const expected = cellsPerChunk(world);
    const pendingKeys = pending.map((chunk) => redisKey(world, chunk));
    const fromRedis = await readFromRedis(pendingKeys);
    const toWrite: (readonly [string, Uint8Array])[] = [];

    for (let index = 0; index < pending.length; index += 1) {
      const chunk = pending[index];
      const key = pendingKeys[index];
      if (chunk === undefined || key === undefined) {
        continue;
      }
      const buffer = fromRedis === null ? null : (fromRedis[index] ?? null);
      // A value of the wrong length is a corrupt entry, from an aborted write or from a
      // key written under another chunk size. It is treated as a miss and overwritten,
      // which is the only safe reading: a short array would index out of the chunk.
      if (buffer !== null && buffer.byteLength === expected) {
        stats.redisHits += 1;
        const cells = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        remember(key, cells);
        result.set(chunkKey(chunk), cells);
        continue;
      }
      stats.misses += 1;
      const cells = generate(world, chunk);
      remember(key, cells);
      result.set(chunkKey(chunk), cells);
      toWrite.push([key, cells]);
    }

    await writeToRedis(toWrite);
    return result;
  };

  return {
    keyPrefix: prefix,
    redisKey,
    async chunk(world, chunk) {
      const loaded = await chunks(world, [chunk]);
      const cells = loaded.get(chunkKey(chunk));
      if (cells === undefined) {
        // Unreachable: `chunks` returns an entry per requested chunk. Stated as an error
        // rather than with a non null assertion, which the lint rules forbid.
        throw new Error(`El generador no devolvio el chunk ${chunkKey(chunk)}`);
      }
      return cells;
    },
    chunks,
    async terrainOfCells(world, cells) {
      const size = world.chunkSize;
      const covering = dedupeChunks(cells.map((cell) => chunkOf(cell.cellX, cell.cellY, size)));
      const loaded = await chunks(world, covering);
      const terrain = new Map<number, TerrainType>();
      for (const cell of cells) {
        const chunk = chunkOf(cell.cellX, cell.cellY, size);
        const bytes = loaded.get(chunkKey(chunk));
        if (bytes === undefined) {
          continue;
        }
        const localX = cell.cellX - chunk.chunkX * size;
        const localY = cell.cellY - chunk.chunkY * size;
        const code = bytes[localY * size + localX];
        terrain.set(cellKey(cell.cellX, cell.cellY), terrainFromCode(code ?? 0));
      }
      return terrain;
    },
    stats() {
      return { ...stats };
    },
    resetStats() {
      Object.assign(stats, emptyStats());
    },
    clearMemory() {
      memory.clear();
    },
  };
}

/**
 * The cache of a service context.
 *
 * A weak map and not a module level singleton: two applications built in the same process,
 * which is what the integration suite does, must not share a process cache, and the entry
 * disappears with the context instead of pinning it. It is also what lets a test read the
 * very counters the route path incremented.
 */
const caches = new WeakMap<ServiceContext, TerrainCache>();

export function terrainCacheOf(services: ServiceContext): TerrainCache {
  const existing = caches.get(services);
  if (existing !== undefined) {
    return existing;
  }
  const created = createTerrainCache({
    redis: services.redis.commands,
    keys: services.keys,
    logger: services.logger,
  });
  caches.set(services, created);
  return created;
}
