// The internal API of the world module.
//
// Owner: workflow W3-B. Module `world`.
//
// This is the surface the land, farms, fields and forestry modules need in order to touch
// the grid: what a cell really is, whether the player may use it, and how to take it. It
// exists so that four later modules do not each write their own reading of "effective
// terrain" or their own conditional update, which is exactly how two callers end up
// disagreeing about whether a cleared forest is arable.
//
// The three questions it answers, and why each one is here and not in the caller:
//
//   1. Effective terrain. A cell is what the generator produced unless it carries a
//      `terrainOverride`, which is the cleared forest of GDD section 10. The generated part
//      comes from the cache of `generator.ts` and the override from `world_cells`, so the
//      combination needs both halves of this module and neither of them alone.
//   2. Ownership and use. `shared/rules/selection.ts` is the one place the rules live, and it
//      is shared with the client so that the green highlight and the 400 cannot diverge
//      (plan section 8). What the server has to add is the loading: turning a list of
//      coordinates into the `SelectionCell` the rules take.
//   3. Claiming. Delegated to `cellRepo.ts`, which does it with a conditional update and a
//      row count, and re-exported here so that a caller has one import and not two.
//
// KNOWN DEVIATION, recorded in `docs/handoff/NOTES-w3b.md`. The ESLint zones of
// `eslint.config.js` forbid any import between sibling backend modules, not only between
// siblings of the same workflow, so `modules/land` cannot import this file as it stands. The
// brief of this agent asks for exactly that consumption. The file is written where the brief
// puts it and the resolution belongs to the agent that may touch a frozen file: either an
// `except: ['./world']` in `siblingModuleZones`, or moving this file to `lib/`, which is what
// workflow W3-A had to do with `lib/playerView.ts` for the same reason.

import { type ServiceContext } from '../../lib/context.js';
import { type Db, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  CellOwnership,
  LandUse,
  ValidationCode,
  cellKey,
  chunkOf,
  validateSelection,
  type CellCoord,
  type ChunkCoord,
  type ChunkPatchEvent,
  type PlayerId,
  type RealMs,
  type SelectionCell,
  type SelectionConfig,
  type SelectionPurpose,
  type SelectionValidation,
  type TerrainType,
  type World,
} from '../../shared/index.js';
import {
  cellRepositoryOf,
  type AssignCellUseInput,
  type AssignCellUseOutcome,
  type ClaimCellsOutcome,
} from './cellRepo.js';
import { dedupeChunks, terrainCacheOf } from './generator.js';

export {
  MAX_CELLS_PER_WRITE,
  TooManyCellsError,
  type AssignCellUseInput,
  type AssignCellUseOutcome,
  type CellRow,
  type ChunkStateResult,
  type ClaimCellsOutcome,
} from './cellRepo.js';

// ---------------------------------------------------------------------------
// Effective terrain
// ---------------------------------------------------------------------------

/**
 * Terrain of a cell as the rules see it: the override when there is one, the generated
 * terrain otherwise (GDD section 10, ADR-0010).
 *
 * Pure, and the only definition of the word "effective" in the backend. A caller that read
 * `generatedTerrain` directly would treat a cleared forest as forest and refuse to plough it.
 */
export function effectiveTerrain(
  generated: TerrainType,
  override: TerrainType | null,
): TerrainType {
  return override ?? generated;
}

/** Effective terrain of a set of cells, keyed by `cellKey`. */
export async function loadEffectiveTerrain(
  services: ServiceContext,
  db: Db,
  world: World,
  cells: readonly CellCoord[],
): Promise<ReadonlyMap<number, TerrainType>> {
  const [generated, rows] = await Promise.all([
    terrainCacheOf(services).terrainOfCells(world, cells),
    cellRepositoryOf(services).cellRows(db, world, cells),
  ]);
  const terrain = new Map<number, TerrainType>();
  for (const cell of cells) {
    const key = cellKey(cell.cellX, cell.cellY);
    const base = generated.get(key);
    if (base === undefined) {
      continue;
    }
    terrain.set(key, effectiveTerrain(base, rows.get(key)?.terrainOverride ?? null));
  }
  return terrain;
}

// ---------------------------------------------------------------------------
// Ownership and use
// ---------------------------------------------------------------------------

/**
 * The cells of a selection, in the shape `shared/rules/selection.ts` takes.
 *
 * A cell with no row is unowned, unused, generated terrain and carries no tree, which is the
 * whole of the procedural persistence model: absence of a row is a value and not a gap
 * (GDD section 58).
 */
export async function loadSelectionCells(
  services: ServiceContext,
  db: Db,
  world: World,
  playerId: PlayerId,
  cells: readonly CellCoord[],
): Promise<readonly SelectionCell[]> {
  const repository = cellRepositoryOf(services);
  const [generated, rows] = await Promise.all([
    terrainCacheOf(services).terrainOfCells(world, cells),
    repository.cellRows(db, world, cells),
  ]);
  const standing = await standingTreeCells(db, world, cells);

  return cells.map((cell) => {
    const key = cellKey(cell.cellX, cell.cellY);
    const row = rows.get(key);
    const base = generated.get(key);
    if (base === undefined) {
      // Unreachable: `terrainOfCells` returns an entry for every cell it was given.
      throw new Error(`Sin terreno generado para la celda (${cell.cellX}, ${cell.cellY})`);
    }
    return {
      cellX: cell.cellX,
      cellY: cell.cellY,
      terrain: effectiveTerrain(base, row?.terrainOverride ?? null),
      ownership: ownershipOf(row?.ownerPlayerId ?? null, playerId),
      landUse: row?.landUse ?? LandUse.NONE,
      hasStandingTree: standing.has(key),
    };
  });
}

/** Ownership of a cell from the point of view of one player. */
export function ownershipOf(ownerPlayerId: string | null, playerId: PlayerId): CellOwnership {
  if (ownerPlayerId === null) {
    return CellOwnership.UNOWNED;
  }
  return ownerPlayerId === playerId ? CellOwnership.PLAYER : CellOwnership.OTHER;
}

/** Cells of the set that carry a standing tree, keyed by `cellKey`. One statement. */
export async function standingTreeCells(
  db: Db,
  world: World,
  cells: readonly CellCoord[],
): Promise<ReadonlySet<number>> {
  const keys = new Set<number>();
  if (cells.length === 0) {
    return keys;
  }
  const rows = await db.tree.findMany({
    where: {
      worldId: world.id,
      status: 'STANDING',
      OR: cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    },
    select: { cellX: true, cellY: true },
  });
  for (const row of rows) {
    keys.add(cellKey(row.cellX, row.cellY));
  }
  return keys;
}

/**
 * Validates a selection against the shared rules, having loaded the state of every cell.
 *
 * The caller decides what to do with the answer: `POST /api/land/quote` shows it and
 * `POST /api/land/purchase` refuses on it. Both call this, which is what keeps the estimate
 * and the refusal in agreement.
 */
export async function validateCellSelection(
  services: ServiceContext,
  db: Db,
  world: World,
  input: {
    readonly playerId: PlayerId;
    readonly purpose: SelectionPurpose;
    readonly cells: readonly CellCoord[];
    readonly adjacentTo?: readonly CellCoord[] | undefined;
  },
  config?: SelectionConfig,
): Promise<{ readonly cells: readonly SelectionCell[]; readonly validation: SelectionValidation }> {
  const loaded = await loadSelectionCells(services, db, world, input.playerId, input.cells);
  const validation = validateSelection(
    { purpose: input.purpose, cells: loaded, adjacentTo: input.adjacentTo },
    config,
  );
  return { cells: loaded, validation };
}

/**
 * Refuses unless every cell is owned by the player and free of any other use.
 *
 * Thrown as the contract error of `shared/api/errors.ts`, with the first offending cell in
 * the details, because "one of your two thousand cells is already a field" is only actionable
 * if it says which one.
 */
export async function assertCellsAvailable(
  services: ServiceContext,
  db: Db,
  world: World,
  playerId: PlayerId,
  cells: readonly CellCoord[],
  allowedUses: readonly LandUse[] = [LandUse.OWNED],
): Promise<void> {
  const loaded = await loadSelectionCells(services, db, world, playerId, cells);
  for (const cell of loaded) {
    const offending = [{ cellX: cell.cellX, cellY: cell.cellY }];
    if (cell.ownership !== CellOwnership.PLAYER) {
      throw new ApiError(ValidationCode.CELL_NOT_OWNED, { cells: offending });
    }
    if (!allowedUses.includes(cell.landUse)) {
      throw new ApiError(ValidationCode.CELL_IN_USE, { cells: offending });
    }
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Buys a set of cells for a player and returns exactly what was acquired (GDD sections 14
 * and 115).
 *
 * The generated terrain is loaded here and not by the caller, because it is written as the
 * witness of ADR-0010 and no caller should have to remember that. Two concurrent purchases of
 * the same cell both reach the same row, so the second one acquires nothing and its caller
 * charges nothing.
 */
export async function claimCells(
  services: ServiceContext,
  tx: Tx,
  world: World,
  playerId: PlayerId,
  cells: readonly CellCoord[],
  atRealMs: RealMs,
): Promise<ClaimCellsOutcome> {
  const generatedTerrain = await terrainCacheOf(services).terrainOfCells(world, cells);
  return cellRepositoryOf(services).claimCells(tx, {
    world,
    playerId,
    cells,
    generatedTerrain,
    atRealMs,
  });
}

/** Assigns the use of cells the player already owns, by conditional update with a row count. */
export async function assignCellUse(
  services: ServiceContext,
  tx: Tx,
  input: AssignCellUseInput,
): Promise<AssignCellUseOutcome> {
  return cellRepositoryOf(services).assignCellUse(tx, input);
}

/** Increments the version of a set of chunks, in ascending order of identifier. */
export async function bumpChunkVersions(
  services: ServiceContext,
  tx: Tx,
  world: World,
  chunks: readonly ChunkCoord[],
  atRealMs: RealMs,
): Promise<ReadonlyMap<string, number>> {
  return cellRepositoryOf(services).bumpChunkVersions(tx, world.id, chunks, atRealMs);
}

/**
 * The payloads of the `CHUNK_PATCHED` frames a mutation has to emit (plan section 7).
 *
 * Read after the write and inside the same transaction, so the version and the cells travel
 * together and a client that applies the frame reaches exactly the state the database holds.
 *
 * The version in the cache key is what makes this safe to call inside a transaction. The
 * write has just incremented the version, so the key is new and the cache cannot answer with
 * the state from before; and if the transaction then rolls back, the entry it wrote sits
 * under a version the chunk never reaches and is therefore unreachable rather than wrong.
 */
export async function chunkPatchesFor(
  services: ServiceContext,
  db: Db,
  world: World,
  chunks: readonly ChunkCoord[],
): Promise<readonly ChunkPatchEvent[]> {
  const unique = dedupeChunks(chunks);
  if (unique.length === 0) {
    return [];
  }
  const states = await cellRepositoryOf(services).chunkStates(
    db,
    world,
    // No `rev`, so no chunk can answer `unchanged` and every one carries its cells.
    unique.map((chunk) => ({ chunkX: chunk.chunkX, chunkY: chunk.chunkY })),
  );
  return states.map((state) => ({
    chunkX: state.chunkX,
    chunkY: state.chunkY,
    version: state.version,
    cells: [...state.cells],
  }));
}

/** The chunks a set of cells spans, deduplicated. The unit every patch and every lock uses. */
export function chunksOfCells(
  cells: readonly CellCoord[],
  chunkSize: number,
): readonly ChunkCoord[] {
  return dedupeChunks(cells.map((cell) => chunkOf(cell.cellX, cell.cellY, chunkSize)));
}
