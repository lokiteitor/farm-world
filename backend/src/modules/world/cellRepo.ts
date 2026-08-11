// The repository of chunks and of modified cells.
//
// Owner: workflow W3-B. Module `world`.
//
// Only modified cells exist as rows (GDD section 58, ADR-0010). Everything else is
// regenerated from the seed by `generator.ts`, so this file is about the overlay and
// nothing else: who owns a cell, what it is used for, and the cleared forest of GDD
// section 10.
//
// Four things live here, and they are the four the module contract of workflow W3-B asks
// for.
//
//   1. Batch reading. A request for fifty chunks costs one statement for the versions and
//      one statement for the overlay of every chunk that is not already cached, never one
//      per chunk. The overlay statement is raw SQL for a reason that is not performance
//      theatre: `hasStandingTree` is a property of the `trees` table and folding it into
//      the same statement as an `EXISTS` is what keeps the count at one.
//   2. Claiming cells, by conditional update with a row count. Two transactions that buy
//      the same cell both write the same row, so PostgreSQL serialises them and the second
//      one updates zero rows and is told so (plan section 5.4). No lock is taken.
//   3. Incrementing the chunk version, with the chunks taken in ascending order of
//      identifier, which is step 3 of the canonical lock order of `lib/tx.ts`.
//   4. The overlay cache in Redis, with the version of the chunk INSIDE THE KEY. Modifying
//      a cell increments the version, which changes the key, so nothing is ever
//      invalidated: the whole class of invalidation bugs, and the race between invalidating
//      and repopulating, does not exist (plan section 5.1, ADR-0010).
//
// One invariant the read path leans on, and it is enforced by the database rather than by
// convention: `world_cells` has a foreign key to `chunks`, so a chunk with no row can have
// no modified cell. A chunk the version query did not return is therefore answered with
// version 0 and an empty overlay, without touching Redis and without a second statement.
//
// Why raw SQL rather than the typed client on the write paths. The three writes need
// `ON CONFLICT DO NOTHING` and `RETURNING`, which the typed client does not express: it has
// `createMany({ skipDuplicates })`, which does not return what it actually inserted, and
// that is precisely the value a purchase needs in order to charge for what it acquired and
// not for what it asked for. Every value is a bound parameter; only the placeholder list is
// built, and it is built from a count.

import { type Redis } from 'ioredis';
import { type ServiceContext } from '../../lib/context.js';
import { newUuid } from '../../lib/ids.js';
import { ascendingIds, type Db, type Tx } from '../../lib/tx.js';
import { type RedisKeys } from '../../plugins/redis.js';
import {
  LandUse,
  MAX_SELECTION_CELLS,
  cellIndex,
  cellKey,
  chunkOf,
  type CellCoord,
  type ChunkCellPatch,
  type ChunkCoord,
  type PlayerId,
  type RealMs,
  type TerrainType,
  type World,
  type WorldId,
} from '../../shared/index.js';
import { chunkKey, dedupeChunks, worldKeyPrefix } from './generator.js';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A chunk as the client asked for it: the coordinate and the version it already holds. */
export interface ChunkStateRequest extends ChunkCoord {
  /** Version the client holds. Absent means it holds no copy. */
  readonly rev?: number | undefined;
}

/** The overlay of one chunk, before the reply decides between `unchanged` and the cells. */
export interface ChunkOverlay extends ChunkCoord {
  readonly version: number;
  readonly cells: readonly ChunkCellPatch[];
}

/** What the batch read answers for one requested chunk. */
export interface ChunkStateResult extends ChunkOverlay {
  /** True when the version the client sent is the current one. */
  readonly unchanged: boolean;
}

/** The row of a modified cell, as the module reads it. */
export interface CellRow extends CellCoord {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly idx: number;
  readonly generatedTerrain: TerrainType;
  readonly terrainOverride: TerrainType | null;
  readonly ownerPlayerId: string | null;
  readonly landUse: LandUse;
  readonly fieldId: string | null;
  readonly forestPlotId: string | null;
  readonly buildingId: string | null;
  readonly naturalTreeConsumed: boolean;
}

/** Counters of the batch read. Read by the tests, which measure hits and misses. */
export interface CellRepoStats {
  /** Statements that read `chunks`. One per batch. */
  readonly versionQueries: number;
  /** Statements that read `world_cells`. One per batch, and zero when everything is cached. */
  readonly cellQueries: number;
  /** Chunks answered from the Redis overlay cache. */
  readonly overlayHits: number;
  /** Chunks whose overlay had to be read from PostgreSQL. */
  readonly overlayMisses: number;
  /** Chunks answered as empty without any read, because they have no `chunks` row. */
  readonly emptyChunks: number;
  /** Chunks answered as `unchanged`, which cost neither Redis nor a cell statement. */
  readonly unchangedChunks: number;
  readonly redisReads: number;
  readonly redisWrites: number;
  /** Redis commands that failed. The answer was still correct; only the cache was lost. */
  readonly redisFailures: number;
}

interface MutableStats {
  versionQueries: number;
  cellQueries: number;
  overlayHits: number;
  overlayMisses: number;
  emptyChunks: number;
  unchangedChunks: number;
  redisReads: number;
  redisWrites: number;
  redisFailures: number;
}

function emptyStats(): MutableStats {
  return {
    versionQueries: 0,
    cellQueries: 0,
    overlayHits: 0,
    overlayMisses: 0,
    emptyChunks: 0,
    unchangedChunks: 0,
    redisReads: 0,
    redisWrites: 0,
    redisFailures: 0,
  };
}

/** A logger with the level this module uses. Kept minimal so the repository is testable alone. */
interface RepoLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Expiry of a cached overlay, in real milliseconds.
 *
 * Six hours, and it is eviction rather than invalidation. The version is in the key, so an
 * entry can never be wrong; what it can be is unreachable, because the chunk moved on to a
 * later version. Without an expiry every version a chunk ever had would stay in Redis
 * forever, which is the one way this cache could grow without a ceiling.
 */
export const OVERLAY_CACHE_TTL_REAL_MS = 6 * 60 * 60 * 1000;

/**
 * Cells a single write may touch. The same ceiling the client applies while dragging
 * (`MAX_SELECTION_CELLS`, ADR-0012), restated here because it also bounds the number of
 * bound parameters of the statements below: three per cell, so 6 000 at the ceiling, well
 * inside the 65 535 PostgreSQL accepts.
 */
export const MAX_CELLS_PER_WRITE = MAX_SELECTION_CELLS;

// ---------------------------------------------------------------------------
// Placeholder builders
// ---------------------------------------------------------------------------

/**
 * `($2::int, $3::int), ($4::int, $5::int), ...` for a list of chunk coordinates.
 *
 * The text is built from a count and the values are always bound, which is what makes
 * `$queryRawUnsafe` safe here: nothing that comes from a request ever reaches the SQL text.
 */
function chunkTuples(count: number, firstPlaceholder: number): string {
  const tuples: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const first = firstPlaceholder + index * 2;
    tuples.push(`($${first}::int, $${first + 1}::int)`);
  }
  return tuples.join(', ');
}

/** `($2::int, $3::int, $4::int), ...` for a list of cells, addressed by chunk and index. */
function cellTuples(count: number, firstPlaceholder: number): string {
  const tuples: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const first = firstPlaceholder + index * 3;
    tuples.push(`($${first}::int, $${first + 1}::int, $${first + 2}::int)`);
  }
  return tuples.join(', ');
}

/** Chunk coordinate and index inside it, which is how a cell is addressed in a statement. */
interface CellAddress extends CellCoord {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly idx: number;
}

/** Addresses of a set of cells, deduplicated, in the order they were first given. */
export function addressCells(
  cells: Iterable<CellCoord>,
  chunkSize: number,
): readonly CellAddress[] {
  const seen = new Set<number>();
  const addresses: CellAddress[] = [];
  for (const cell of cells) {
    const key = cellKey(cell.cellX, cell.cellY);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const chunk = chunkOf(cell.cellX, cell.cellY, chunkSize);
    addresses.push({
      cellX: cell.cellX,
      cellY: cell.cellY,
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      idx: cellIndex(cell.cellX, cell.cellY, chunkSize),
    });
  }
  return addresses;
}

/** A refusal of a write because it exceeded the shared selection ceiling. */
export class TooManyCellsError extends RangeError {
  constructor(count: number) {
    super(
      `Una escritura de celdas no puede tocar ${count} celdas: el tope es ${MAX_CELLS_PER_WRITE}.`,
    );
    this.name = 'TooManyCellsError';
  }
}

function assertWritableSize(count: number): void {
  if (count > MAX_CELLS_PER_WRITE) {
    throw new TooManyCellsError(count);
  }
}

/** Which identifier column a use requires, mirroring `world_cells_use_exclusivity_check`. */
const IDENTIFIER_OF_USE: Readonly<
  Record<LandUse, 'fieldId' | 'forestPlotId' | 'buildingId' | null>
> = {
  NONE: null,
  OWNED: null,
  ROAD: null,
  FIELD: 'fieldId',
  FOREST_PLOT: 'forestPlotId',
  BUILDING: 'buildingId',
};

/**
 * Refuses an assignment whose identifiers do not match its use, before the statement runs.
 *
 * The intra-row CHECK of the initial migration already forbids it, and that is exactly why
 * this exists: a constraint violation raised inside a queue job produces endless retries, so
 * the application never delegates a predictable case to the safety net (plan section 5.4). A
 * plain `Error` and not an `ApiError`, because this is a bug of the calling module and not
 * something a player can provoke.
 */
function assertUseIdentifier(input: AssignCellUseInput): void {
  const required = IDENTIFIER_OF_USE[input.landUse];
  const given = {
    fieldId: input.fieldId ?? null,
    forestPlotId: input.forestPlotId ?? null,
    buildingId: input.buildingId ?? null,
  };
  for (const [column, value] of Object.entries(given)) {
    if (column === required) {
      if (value === null) {
        throw new Error(
          `El uso ${input.landUse} exige ${column}: lo impone world_cells_use_exclusivity_check.`,
        );
      }
      continue;
    }
    if (value !== null) {
      throw new Error(
        `El uso ${input.landUse} no admite ${column}: lo impone world_cells_use_exclusivity_check.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

/** Rows of the overlay statement, before they become `ChunkCellPatch`. */
interface OverlayRow {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly idx: number;
  readonly terrainOverride: TerrainType | null;
  readonly ownerPlayerId: string | null;
  readonly landUse: LandUse;
  readonly fieldId: string | null;
  readonly forestPlotId: string | null;
  readonly buildingId: string | null;
  readonly hasStandingTree: boolean;
}

export interface CellRepositoryDeps {
  readonly redis: Redis;
  readonly keys: RedisKeys;
  readonly logger: RepoLogger;
  readonly ttlRealMs?: number;
}

export interface CellRepository {
  /** Prefix of every key this repository writes, so a test can inspect the key space. */
  readonly keyPrefix: string;
  /** The Redis key of the overlay of one chunk at one version. */
  overlayKey(worldId: WorldId, chunk: ChunkCoord, version: number): string;
  /** Current version of each requested chunk. Absent from the map means no row, version 0. */
  chunkVersions(
    db: Db,
    worldId: WorldId,
    chunks: readonly ChunkCoord[],
  ): Promise<Map<string, number>>;
  /** The overlay of a batch of chunks, with `unchanged` resolved against the sent version. */
  chunkStates(
    db: Db,
    world: World,
    requests: readonly ChunkStateRequest[],
  ): Promise<readonly ChunkStateResult[]>;
  /** The rows of a set of cells, keyed by `cellKey`. One statement. */
  cellRows(db: Db, world: World, cells: readonly CellCoord[]): Promise<Map<number, CellRow>>;
  /** Creates the `chunks` rows a write needs, and returns the identifier of each. */
  ensureChunks(
    tx: Tx,
    worldId: WorldId,
    chunks: readonly ChunkCoord[],
    atRealMs: RealMs,
  ): Promise<Map<string, string>>;
  /** Claims unowned cells for a player. Returns exactly the cells actually acquired. */
  claimCells(tx: Tx, input: ClaimCellsInput): Promise<ClaimCellsOutcome>;
  /** Assigns the use of cells the player already owns, by conditional update. */
  assignCellUse(tx: Tx, input: AssignCellUseInput): Promise<AssignCellUseOutcome>;
  /** Increments the version of each chunk, taking them in ascending order of identifier. */
  bumpChunkVersions(
    tx: Tx,
    worldId: WorldId,
    chunks: readonly ChunkCoord[],
    atRealMs: RealMs,
  ): Promise<Map<string, number>>;
  stats(): CellRepoStats;
  resetStats(): void;
}

export interface ClaimCellsInput {
  readonly world: World;
  readonly playerId: PlayerId;
  readonly cells: readonly CellCoord[];
  /** Generated terrain of each cell, keyed by `cellKey`. Written as the witness of ADR-0010. */
  readonly generatedTerrain: ReadonlyMap<number, TerrainType>;
  readonly atRealMs: RealMs;
}

export interface ClaimCellsOutcome {
  /** Cells that went from unowned to owned by this player, in row major order. */
  readonly acquired: readonly CellCoord[];
  /** Cells that were asked for and were already owned, by this player or by another. */
  readonly refused: readonly CellCoord[];
  /** Chunks whose version was incremented. Empty when nothing was acquired. */
  readonly touchedChunks: readonly ChunkCoord[];
}

export interface AssignCellUseInput {
  readonly world: World;
  readonly playerId: PlayerId;
  readonly cells: readonly CellCoord[];
  readonly landUse: LandUse;
  readonly fieldId?: string | null;
  readonly forestPlotId?: string | null;
  readonly buildingId?: string | null;
  /**
   * Uses a cell may currently have for the assignment to apply. Defaults to `OWNED`, which
   * is the exclusivity rule of GDD section 15: a cell already taken by another use is not
   * available. `CLEAR_LAND` is the one caller that also accepts `FOREST_PLOT`.
   */
  readonly fromLandUse?: readonly LandUse[];
  readonly atRealMs: RealMs;
}

export interface AssignCellUseOutcome {
  /** Rows the conditional update actually affected. */
  readonly affected: number;
  /** True when every requested cell was assigned. The caller aborts the transaction if not. */
  readonly complete: boolean;
  readonly touchedChunks: readonly ChunkCoord[];
}

/** Builds a repository. One per service context; `cellRepositoryOf` hands out the shared one. */
export function createCellRepository(deps: CellRepositoryDeps): CellRepository {
  const prefix = worldKeyPrefix(deps.keys);
  const ttlRealMs = deps.ttlRealMs ?? OVERLAY_CACHE_TTL_REAL_MS;
  const stats = emptyStats();

  const overlayKey = (worldId: WorldId, chunk: ChunkCoord, version: number): string =>
    `${prefix}:world:overlay:${worldId}:${chunk.chunkX}:${chunk.chunkY}:${version}`;

  const chunkVersions = async (
    db: Db,
    worldId: WorldId,
    chunks: readonly ChunkCoord[],
  ): Promise<Map<string, number>> => {
    const versions = new Map<string, number>();
    if (chunks.length === 0) {
      return versions;
    }
    stats.versionQueries += 1;
    // The typed client is enough here: one `OR` per chunk is a single statement, and the
    // unique index on (worldId, chunkX, chunkY) serves every branch of it.
    const rows = await db.chunk.findMany({
      where: {
        worldId,
        OR: chunks.map((chunk) => ({ chunkX: chunk.chunkX, chunkY: chunk.chunkY })),
      },
      select: { chunkX: true, chunkY: true, version: true },
    });
    for (const row of rows) {
      versions.set(chunkKey(row), row.version);
    }
    return versions;
  };

  const readOverlaysFromRedis = async (
    keys: readonly string[],
  ): Promise<readonly (string | null)[] | null> => {
    if (keys.length === 0) {
      return [];
    }
    try {
      stats.redisReads += 1;
      return await deps.redis.mget(...keys);
    } catch (error) {
      stats.redisFailures += 1;
      deps.logger.warn(
        { err: error, keys: keys.length },
        'the chunk overlay cache could not be read',
      );
      return null;
    }
  };

  const writeOverlaysToRedis = async (
    entries: readonly (readonly [string, string])[],
  ): Promise<void> => {
    if (entries.length === 0) {
      return;
    }
    try {
      stats.redisWrites += 1;
      const pipeline = deps.redis.pipeline();
      for (const [key, payload] of entries) {
        pipeline.set(key, payload, 'PX', ttlRealMs);
      }
      await pipeline.exec();
    } catch (error) {
      stats.redisFailures += 1;
      deps.logger.warn(
        { err: error, entries: entries.length },
        'the chunk overlay cache could not be written',
      );
    }
  };

  /**
   * The overlay of a set of chunks, in one statement.
   *
   * `hasStandingTree` is an `EXISTS` over `trees` rather than a second statement, which is
   * what keeps the batch at one query. A standing tree always sits on a cell that has a row,
   * because creating a forest plot writes `forestPlotId` on every cell of it, so the join
   * from `world_cells` loses nothing; the asymmetry is documented in
   * `docs/handoff/NOTES-w3b.md`.
   */
  const loadOverlays = async (
    db: Db,
    worldId: WorldId,
    chunks: readonly ChunkCoord[],
  ): Promise<Map<string, ChunkCellPatch[]>> => {
    const overlays = new Map<string, ChunkCellPatch[]>();
    for (const chunk of chunks) {
      overlays.set(chunkKey(chunk), []);
    }
    if (chunks.length === 0) {
      return overlays;
    }
    const sql =
      'SELECT wc."chunkX", wc."chunkY", wc."idx", wc."terrainOverride", wc."ownerPlayerId", ' +
      'wc."landUse", wc."fieldId", wc."forestPlotId", wc."buildingId", ' +
      'EXISTS (SELECT 1 FROM "trees" t WHERE t."worldId" = wc."worldId" ' +
      'AND t."cellX" = wc."cellX" AND t."cellY" = wc."cellY" ' +
      `AND t."status" = 'STANDING') AS "hasStandingTree" ` +
      'FROM "world_cells" wc ' +
      `WHERE wc."worldId" = $1::uuid AND (wc."chunkX", wc."chunkY") IN (${chunkTuples(chunks.length, 2)}) ` +
      'ORDER BY wc."chunkX", wc."chunkY", wc."idx"';
    const values: unknown[] = [worldId];
    for (const chunk of chunks) {
      values.push(chunk.chunkX, chunk.chunkY);
    }
    stats.cellQueries += 1;
    const rows = await db.$queryRawUnsafe<OverlayRow[]>(sql, ...values);
    for (const row of rows) {
      const cells = overlays.get(chunkKey(row));
      if (cells === undefined) {
        continue;
      }
      cells.push({
        idx: row.idx,
        terrainOverride: row.terrainOverride,
        ownerPlayerId: row.ownerPlayerId,
        landUse: row.landUse,
        fieldId: row.fieldId,
        forestPlotId: row.forestPlotId,
        buildingId: row.buildingId,
        hasStandingTree: row.hasStandingTree,
      });
    }
    return overlays;
  };

  const chunkStates = async (
    db: Db,
    world: World,
    requests: readonly ChunkStateRequest[],
  ): Promise<readonly ChunkStateResult[]> => {
    // A repeated coordinate is answered once. The client has no use for two copies, and
    // deduplicating is something the server has to be able to do anyway for a request that
    // arrives twice.
    const unique = new Map<string, ChunkStateRequest>();
    for (const request of requests) {
      const key = chunkKey(request);
      if (!unique.has(key)) {
        unique.set(key, request);
      }
    }
    const ordered = [...unique.values()];
    if (ordered.length === 0) {
      return [];
    }

    const versions = await chunkVersions(db, world.id, ordered);

    const results = new Map<string, ChunkStateResult>();
    const needOverlay: ChunkStateRequest[] = [];
    for (const request of ordered) {
      const key = chunkKey(request);
      const version = versions.get(key);
      if (version === undefined) {
        // No `chunks` row, and `world_cells` has a foreign key to it, so there is provably
        // no modified cell. Answered without touching Redis or PostgreSQL again.
        stats.emptyChunks += 1;
        results.set(key, {
          chunkX: request.chunkX,
          chunkY: request.chunkY,
          version: 0,
          unchanged: request.rev === 0,
          cells: [],
        });
        continue;
      }
      if (request.rev === version) {
        stats.unchangedChunks += 1;
        results.set(key, {
          chunkX: request.chunkX,
          chunkY: request.chunkY,
          version,
          unchanged: true,
          cells: [],
        });
        continue;
      }
      needOverlay.push(request);
    }

    if (needOverlay.length > 0) {
      const cacheKeys = needOverlay.map((request) =>
        overlayKey(world.id, request, versions.get(chunkKey(request)) ?? 0),
      );
      const cached = await readOverlaysFromRedis(cacheKeys);
      const misses: ChunkStateRequest[] = [];
      for (let index = 0; index < needOverlay.length; index += 1) {
        const request = needOverlay[index];
        if (request === undefined) {
          continue;
        }
        const payload = cached === null ? null : (cached[index] ?? null);
        const decoded = payload === null ? null : decodeOverlay(payload);
        if (decoded === null) {
          misses.push(request);
          continue;
        }
        stats.overlayHits += 1;
        results.set(chunkKey(request), {
          chunkX: request.chunkX,
          chunkY: request.chunkY,
          version: versions.get(chunkKey(request)) ?? 0,
          unchanged: false,
          cells: decoded,
        });
      }

      if (misses.length > 0) {
        const overlays = await loadOverlays(db, world.id, misses);
        const toWrite: (readonly [string, string])[] = [];
        for (const request of misses) {
          const key = chunkKey(request);
          const version = versions.get(key) ?? 0;
          const cells = overlays.get(key) ?? [];
          stats.overlayMisses += 1;
          results.set(key, {
            chunkX: request.chunkX,
            chunkY: request.chunkY,
            version,
            unchanged: false,
            cells,
          });
          toWrite.push([overlayKey(world.id, request, version), JSON.stringify(cells)]);
        }
        await writeOverlaysToRedis(toWrite);
      }
    }

    return ordered.map((request) => {
      const result = results.get(chunkKey(request));
      if (result === undefined) {
        // Unreachable: every requested chunk falls into exactly one of the four branches.
        // Stated as an error rather than with a non null assertion, which the lint rules forbid.
        throw new Error(`El repositorio no resolvio el chunk ${chunkKey(request)}`);
      }
      return result;
    });
  };

  const cellRows = async (
    db: Db,
    world: World,
    cells: readonly CellCoord[],
  ): Promise<Map<number, CellRow>> => {
    const rows = new Map<number, CellRow>();
    const addresses = addressCells(cells, world.chunkSize);
    if (addresses.length === 0) {
      return rows;
    }
    assertWritableSize(addresses.length);
    const sql =
      'SELECT "cellX", "cellY", "chunkX", "chunkY", "idx", "generatedTerrain", "terrainOverride", ' +
      '"ownerPlayerId", "landUse", "fieldId", "forestPlotId", "buildingId", "naturalTreeConsumed" ' +
      'FROM "world_cells" ' +
      `WHERE "worldId" = $1::uuid AND ("chunkX", "chunkY", "idx") IN (${cellTuples(addresses.length, 2)})`;
    const values: unknown[] = [world.id];
    for (const address of addresses) {
      values.push(address.chunkX, address.chunkY, address.idx);
    }
    stats.cellQueries += 1;
    const found = await db.$queryRawUnsafe<CellRow[]>(sql, ...values);
    for (const row of found) {
      rows.set(cellKey(row.cellX, row.cellY), row);
    }
    return rows;
  };

  const ensureChunks = async (
    tx: Tx,
    worldId: WorldId,
    chunks: readonly ChunkCoord[],
    atRealMs: RealMs,
  ): Promise<Map<string, string>> => {
    const ids = new Map<string, string>();
    const unique = dedupeChunks(chunks);
    if (unique.length === 0) {
      return ids;
    }
    // Prisma 7 generates `@default(uuid(7))` on the client, so the column has no DEFAULT and
    // raw SQL has to supply the identifier (backend/prisma/README.md, section 2).
    const placeholders: string[] = [];
    const values: unknown[] = [worldId, atRealMs.toString()];
    for (const chunk of unique) {
      const first = values.length + 1;
      values.push(newUuid(), chunk.chunkX, chunk.chunkY);
      placeholders.push(
        `($${first}::uuid, $1::uuid, $${first + 1}::int, $${first + 2}::int, 0, $2::bigint)`,
      );
    }
    await tx.$executeRawUnsafe(
      'INSERT INTO "chunks" ("id", "worldId", "chunkX", "chunkY", "version", "updatedAtRealMs") ' +
        `VALUES ${placeholders.join(', ')} ` +
        'ON CONFLICT ("worldId", "chunkX", "chunkY") DO NOTHING',
      ...values,
    );
    const rows = await tx.chunk.findMany({
      where: {
        worldId,
        OR: unique.map((chunk) => ({ chunkX: chunk.chunkX, chunkY: chunk.chunkY })),
      },
      select: { id: true, chunkX: true, chunkY: true },
    });
    for (const row of rows) {
      ids.set(chunkKey(row), row.id);
    }
    return ids;
  };

  const bumpChunkVersions = async (
    tx: Tx,
    worldId: WorldId,
    chunks: readonly ChunkCoord[],
    atRealMs: RealMs,
  ): Promise<Map<string, number>> => {
    const versions = new Map<string, number>();
    const unique = dedupeChunks(chunks);
    if (unique.length === 0) {
      return versions;
    }
    const ids = await ensureChunks(tx, worldId, unique, atRealMs);
    const byId = new Map<string, ChunkCoord>();
    for (const chunk of unique) {
      const id = ids.get(chunkKey(chunk));
      if (id !== undefined) {
        byId.set(id, chunk);
      }
    }
    // Step 3 of the canonical lock order of `lib/tx.ts`: the domain rows of a multi row write
    // are taken in ascending order of identifier, so two transactions editing the same two
    // chunks in opposite request order cannot deadlock.
    for (const id of ascendingIds([...byId.keys()])) {
      const chunk = byId.get(id);
      if (chunk === undefined) {
        continue;
      }
      const updated = await tx.chunk.update({
        where: { id },
        data: { version: { increment: 1 }, updatedAtRealMs: atRealMs },
        select: { version: true },
      });
      versions.set(chunkKey(chunk), updated.version);
    }
    return versions;
  };

  const claimCells = async (tx: Tx, input: ClaimCellsInput): Promise<ClaimCellsOutcome> => {
    const addresses = addressCells(input.cells, input.world.chunkSize);
    if (addresses.length === 0) {
      return { acquired: [], refused: [], touchedChunks: [] };
    }
    assertWritableSize(addresses.length);
    const chunks = dedupeChunks(
      addresses.map((address) => ({ chunkX: address.chunkX, chunkY: address.chunkY })),
    );
    await ensureChunks(tx, input.world.id, chunks, input.atRealMs);

    // 1. The cells that have no row yet. `ON CONFLICT DO NOTHING ... RETURNING` returns
    //    exactly the rows this statement inserted, so a concurrent buyer of the same cell
    //    gets nothing back and is charged for nothing (plan section 5.4).
    const insertPlaceholders: string[] = [];
    const insertValues: unknown[] = [input.world.id, input.playerId, input.atRealMs.toString()];
    for (const address of addresses) {
      const terrain = input.generatedTerrain.get(cellKey(address.cellX, address.cellY));
      if (terrain === undefined) {
        throw new Error(
          `Falta el terreno generado de la celda (${address.cellX}, ${address.cellY}): ` +
            'la propiedad `generatedTerrain` es el testigo obligatorio de ADR-0010.',
        );
      }
      const first = insertValues.length + 1;
      insertValues.push(
        newUuid(),
        address.chunkX,
        address.chunkY,
        address.idx,
        address.cellX,
        address.cellY,
        terrain,
      );
      insertPlaceholders.push(
        `($${first}::uuid, $1::uuid, $${first + 1}::int, $${first + 2}::int, $${first + 3}::int, ` +
          `$${first + 4}::int, $${first + 5}::int, $${first + 6}::"TerrainType", $2::uuid, ` +
          `'OWNED'::"LandUse", $3::bigint)`,
      );
    }
    const inserted = await tx.$queryRawUnsafe<{ cellX: number; cellY: number }[]>(
      'INSERT INTO "world_cells" ("id", "worldId", "chunkX", "chunkY", "idx", "cellX", "cellY", ' +
        '"generatedTerrain", "ownerPlayerId", "landUse", "updatedAtRealMs") ' +
        `VALUES ${insertPlaceholders.join(', ')} ` +
        'ON CONFLICT ("worldId", "chunkX", "chunkY", "idx") DO NOTHING ' +
        'RETURNING "cellX", "cellY"',
      ...insertValues,
    );

    // 2. The cells that already had a row. A conditional update with a row count: only a row
    //    that is still unowned and unused changes hands, and the count is what the caller
    //    charges for. No lock is taken; the two writers of one row serialise on the row.
    const updated = await tx.$queryRawUnsafe<{ cellX: number; cellY: number }[]>(
      'UPDATE "world_cells" SET "ownerPlayerId" = $2::uuid, "landUse" = \'OWNED\'::"LandUse", ' +
        '"updatedAtRealMs" = $3::bigint ' +
        `WHERE "worldId" = $1::uuid AND ("chunkX", "chunkY", "idx") IN (${cellTuples(addresses.length, 4)}) ` +
        'AND "ownerPlayerId" IS NULL AND "landUse" = \'NONE\'::"LandUse" ' +
        'RETURNING "cellX", "cellY"',
      ...[
        input.world.id,
        input.playerId,
        input.atRealMs.toString(),
        ...addresses.flatMap((address) => [address.chunkX, address.chunkY, address.idx]),
      ],
    );

    const acquiredKeys = new Set<number>();
    for (const row of [...inserted, ...updated]) {
      acquiredKeys.add(cellKey(row.cellX, row.cellY));
    }
    const acquired: CellCoord[] = [];
    const refused: CellCoord[] = [];
    for (const address of addresses) {
      const target = acquiredKeys.has(cellKey(address.cellX, address.cellY)) ? acquired : refused;
      target.push({ cellX: address.cellX, cellY: address.cellY });
    }

    if (acquired.length === 0) {
      return { acquired, refused, touchedChunks: [] };
    }
    const touchedChunks = dedupeChunks(
      acquired.map((cell) => chunkOf(cell.cellX, cell.cellY, input.world.chunkSize)),
    );
    await bumpChunkVersions(tx, input.world.id, touchedChunks, input.atRealMs);
    return { acquired, refused, touchedChunks };
  };

  const assignCellUse = async (
    tx: Tx,
    input: AssignCellUseInput,
  ): Promise<AssignCellUseOutcome> => {
    const addresses = addressCells(input.cells, input.world.chunkSize);
    if (addresses.length === 0) {
      return { affected: 0, complete: true, touchedChunks: [] };
    }
    assertWritableSize(addresses.length);
    assertUseIdentifier(input);
    const from = input.fromLandUse ?? [LandUse.OWNED];
    const values: unknown[] = [
      input.world.id,
      input.playerId,
      input.atRealMs.toString(),
      input.landUse,
      input.fieldId ?? null,
      input.forestPlotId ?? null,
      input.buildingId ?? null,
    ];
    const fromPlaceholders = from.map((use) => {
      values.push(use);
      return `$${values.length}::"LandUse"`;
    });
    const first = values.length + 1;
    for (const address of addresses) {
      values.push(address.chunkX, address.chunkY, address.idx);
    }
    const affected = await tx.$executeRawUnsafe(
      'UPDATE "world_cells" SET "landUse" = $4::"LandUse", "fieldId" = $5::uuid, ' +
        '"forestPlotId" = $6::uuid, "buildingId" = $7::uuid, "updatedAtRealMs" = $3::bigint ' +
        `WHERE "worldId" = $1::uuid AND ("chunkX", "chunkY", "idx") IN (${cellTuples(addresses.length, first)}) ` +
        `AND "ownerPlayerId" = $2::uuid AND "landUse" IN (${fromPlaceholders.join(', ')})`,
      ...values,
    );

    const complete = affected === addresses.length;
    if (affected === 0) {
      return { affected, complete, touchedChunks: [] };
    }
    const touchedChunks = dedupeChunks(
      addresses.map((address) => ({ chunkX: address.chunkX, chunkY: address.chunkY })),
    );
    await bumpChunkVersions(tx, input.world.id, touchedChunks, input.atRealMs);
    return { affected, complete, touchedChunks };
  };

  return {
    keyPrefix: prefix,
    overlayKey,
    chunkVersions,
    chunkStates,
    cellRows,
    ensureChunks,
    claimCells,
    assignCellUse,
    bumpChunkVersions,
    stats() {
      return { ...stats };
    },
    resetStats() {
      Object.assign(stats, emptyStats());
    },
  };
}

/**
 * Decodes a cached overlay, answering null for anything that is not the array it should be.
 *
 * A corrupt entry is treated as a miss and overwritten, which is the only safe reading: the
 * value is reproducible from PostgreSQL, so there is never a reason to trust a payload that
 * does not parse.
 */
function decodeOverlay(payload: string): ChunkCellPatch[] | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return Array.isArray(parsed) ? (parsed as ChunkCellPatch[]) : null;
  } catch {
    return null;
  }
}

/**
 * The repository of a service context.
 *
 * A weak map and not a module level singleton, for the same reason as the terrain cache of
 * `generator.ts`: two applications built in the same process, which is what the integration
 * suite does, must not share counters, and the entry disappears with the context instead of
 * pinning it.
 */
const repositories = new WeakMap<ServiceContext, CellRepository>();

export function cellRepositoryOf(services: ServiceContext): CellRepository {
  const existing = repositories.get(services);
  if (existing !== undefined) {
    return existing;
  }
  const created = createCellRepository({
    redis: services.redis.commands,
    keys: services.keys,
    logger: services.logger,
  });
  repositories.set(services, created);
  return created;
}
