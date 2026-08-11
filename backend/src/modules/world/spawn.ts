// Assignment of the origin of a new player.
//
// Owner: workflow W3-B. Module `world`.
//
// The GDD never says where a new player starts, which plan section 2.2 lists as its largest
// gap and resolves with the deterministic allocator of `shared/world/spawn.ts`: given the
// seed and the index of the player it returns a cell inside a surface of at least
// `MIN_SPAWN_GRASS_CELLS` contiguous grass cells, reading no other player's row (ADR-0014).
//
// What this file adds to the pure allocator is the two things a pure function cannot do.
//
//   1. The player index, which is the count of players of the world. It is only stable while
//      the world row is locked, because two concurrent registrations that both read the same
//      count would be handed the same reserved block. The lock is step 1 of the canonical
//      lock order of `lib/tx.ts`, and the signature demands the token rather than trusting
//      the caller to remember.
//   2. The check against what is already persisted. The lattice of the pure allocator makes
//      the separation structural, so the first index always clears it; the check is here
//      because "structural" is a property of an argument and not of the database, and a row
//      written by a fixture, by a migration or by hand would break it silently. When it does
//      fail, the index is advanced rather than the origin nudged, so the result stays a value
//      the pure allocator can reproduce from the seed and an integer.
//
// The function is total. An origin below the minimum surface is reported through
// `meetsMinimum` and never refused: a registration that fails is worse for the player than an
// origin smaller than intended, and the caller logs the difference.

import { type Tx, type WorldLock } from '../../lib/tx.js';
import {
  MIN_SPAWN_GRASS_CELLS,
  SPAWN_MIN_DISTANCE_CHUNKS,
  assignSpawn,
  chunkOf,
  type CellCoord,
  type PlayerId,
  type SpawnAssignment,
  type World,
} from '../../shared/index.js';

/**
 * Player indices tried before the allocation settles for the last one.
 *
 * Sixty four is a ceiling and not a budget: with the lattice of the pure allocator the first
 * index clears the separation, so any attempt beyond the first means a persisted origin that
 * the lattice did not place. Settling rather than throwing keeps the function total.
 */
export const SPAWN_MAX_INDEX_ATTEMPTS = 64;

/** An origin, with everything the caller needs in order to log or to refuse. */
export interface SpawnAllocation {
  /** What the pure allocator answered, unchanged. */
  readonly assignment: SpawnAssignment;
  /** Index the allocator was finally called with. */
  readonly playerIndex: number;
  /** Indices tried. One in every case the lattice covers. */
  readonly attempts: number;
  /** True when the origin is far enough from every origin already persisted. */
  readonly respectsMinimumDistance: boolean;
  /** Chunks to the nearest persisted origin, or null when the world has no other player. */
  readonly nearestOriginDistanceChunks: number | null;
}

/**
 * Separation between two origins, in chunks, as a Chebyshev distance.
 *
 * Chebyshev and not Euclidean because the quantity the configuration names is a number of
 * chunks on a side (`SPAWN_MIN_DISTANCE_CHUNKS`), and the reserved blocks of the pure
 * allocator are squares: a diagonal neighbour of a square block is as far away as an
 * orthogonal one, and measuring it with a circle would refuse origins the lattice allows.
 */
export function originDistanceChunks(left: CellCoord, right: CellCoord, chunkSize: number): number {
  const leftChunk = chunkOf(left.cellX, left.cellY, chunkSize);
  const rightChunk = chunkOf(right.cellX, right.cellY, chunkSize);
  return Math.max(
    Math.abs(leftChunk.chunkX - rightChunk.chunkX),
    Math.abs(leftChunk.chunkY - rightChunk.chunkY),
  );
}

/** Origins already persisted in the world. Read under the world lock, so the set is stable. */
export async function persistedOrigins(tx: Tx, world: World): Promise<readonly CellCoord[]> {
  const rows = await tx.player.findMany({
    where: { worldId: world.id, spawnCellX: { not: null }, spawnCellY: { not: null } },
    select: { spawnCellX: true, spawnCellY: true },
  });
  const origins: CellCoord[] = [];
  for (const row of rows) {
    if (row.spawnCellX !== null && row.spawnCellY !== null) {
      origins.push({ cellX: row.spawnCellX, cellY: row.spawnCellY });
    }
  }
  return origins;
}

/** Chunks to the nearest of a set of origins, or null when the set is empty. */
export function nearestOriginDistance(
  candidate: CellCoord,
  origins: readonly CellCoord[],
  chunkSize: number,
): number | null {
  let nearest: number | null = null;
  for (const origin of origins) {
    const distance = originDistanceChunks(candidate, origin, chunkSize);
    if (nearest === null || distance < nearest) {
      nearest = distance;
    }
  }
  return nearest;
}

export interface AllocateSpawnOptions {
  /** Minimum separation, in chunks. Injected so a test can tighten or relax it. */
  readonly minDistanceChunks?: number;
  /** Contiguous grass cells an origin must offer. Injected for the same reason. */
  readonly minGrassCells?: number;
  readonly maxIndexAttempts?: number;
}

/**
 * Allocates the origin of the next player of a world.
 *
 * Requires the world lock: without it the count of players is not stable and two
 * registrations would derive the same index. Taking the lock is the caller's job, and the
 * token proves it was done.
 */
export async function allocateSpawn(
  tx: Tx,
  world: World,
  _lock: WorldLock,
  options: AllocateSpawnOptions = {},
): Promise<SpawnAllocation> {
  const minDistance = options.minDistanceChunks ?? SPAWN_MIN_DISTANCE_CHUNKS;
  const maxAttempts = options.maxIndexAttempts ?? SPAWN_MAX_INDEX_ATTEMPTS;
  const spawnOptions = {
    chunkSize: world.chunkSize,
    generatorVersion: world.generatorVersion,
    ...(options.minGrassCells === undefined
      ? {}
      : {
          spawn: {
            minGrassCells: options.minGrassCells,
            latticeSpacingChunks: 2 * minDistance,
            blockChunks: minDistance,
            maxChunksInspected: 4096,
          },
        }),
  };

  const baseIndex = await tx.player.count({ where: { worldId: world.id } });
  const origins = await persistedOrigins(tx, world);

  let last: SpawnAllocation | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const playerIndex = baseIndex + attempt;
    const assignment = assignSpawn(world.seed, playerIndex, spawnOptions);
    const nearest = nearestOriginDistance(assignment.originCell, origins, world.chunkSize);
    const respects = nearest === null || nearest >= minDistance;
    last = {
      assignment,
      playerIndex,
      attempts: attempt + 1,
      respectsMinimumDistance: respects,
      nearestOriginDistanceChunks: nearest,
    };
    if (respects) {
      return last;
    }
  }
  if (last === null) {
    // Only reachable with `maxIndexAttempts` at zero, which is a misconfiguration and not a
    // state of the world. Falling back to the first index keeps the function total.
    const assignment = assignSpawn(world.seed, baseIndex, spawnOptions);
    return {
      assignment,
      playerIndex: baseIndex,
      attempts: 0,
      respectsMinimumDistance: origins.length === 0,
      nearestOriginDistanceChunks: nearestOriginDistance(
        assignment.originCell,
        origins,
        world.chunkSize,
      ),
    };
  }
  return last;
}

/** Writes the origin on the player row. Called inside the transaction that created it. */
export async function persistSpawn(
  tx: Tx,
  playerId: PlayerId,
  originCell: CellCoord,
): Promise<void> {
  await tx.player.update({
    where: { id: playerId },
    data: { spawnCellX: originCell.cellX, spawnCellY: originCell.cellY },
  });
}

/**
 * The whole operation: allocate and persist.
 *
 * This is what the registration path of `modules/auth` is meant to call. It does not call it
 * today, and cannot: the ESLint zones forbid an import between sibling backend modules, so
 * workflow W3-A inlined `assignSpawn` in `modules/auth/service.ts` instead. The two agree on
 * the origin they produce, because both take the same pure allocator with the same index;
 * what only this path adds is the check against the persisted origins. The discrepancy and
 * its resolution are recorded in `docs/handoff/NOTES-w3b.md`.
 */
export async function assignAndPersistSpawn(
  tx: Tx,
  world: World,
  lock: WorldLock,
  playerId: PlayerId,
  options: AllocateSpawnOptions = {},
): Promise<SpawnAllocation> {
  const allocation = await allocateSpawn(tx, world, lock, options);
  await persistSpawn(tx, playerId, allocation.assignment.originCell);
  return allocation;
}

/** The minimum surface an origin must offer, restated for the callers that report it. */
export const SPAWN_MIN_GRASS_CELLS = MIN_SPAWN_GRASS_CELLS;
