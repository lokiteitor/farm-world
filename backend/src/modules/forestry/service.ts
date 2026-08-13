// The internal API of the forestry module: the plot, its trees, the milestone schedule and
// the clearing of felled ground.
//
// Owner: workflow W6-C. Module `forestry`.
//
// What this file owns, stated once so the boundary is not guessed:
//
//   - The forest plot as an entity separate from the field (GDD sections 129 and 141): its
//     geometry, which lives on the cell exactly as a field's does, and its aggregate, which is
//     recomputed from the standing trees and never stored.
//   - The one shot generation of the wild forest (GDD section 130) and the mark that makes it
//     one shot, `world_cells.naturalTreeConsumed` (plan section 5.1).
//   - The plot level milestone of GDD section 131, which is what makes notifying viable
//     without a scheduled event per tree.
//   - The clearing of GDD section 10, which is a terrain override and not a new cell.
//
// What it deliberately does not own. It does not decide what a stage or a volume is: that is
// `shared/rules/forestry.ts`, which the client runs too. It does not move money: felling
// produces wood and the wood is sold through `modules/economy`, and the cost of every forestry
// operation is the operating cost of its task, integrated by `lib/accrual.ts` over the interval
// the task ran (plan section 6.2). And it does not count storage capacity: the store belongs to
// the farm and `modules/farms/service.ts` is the one place that writes it.
//
// Cells are claimed and released through `modules/world/service.ts`, a module of an earlier
// phase. The two writes that module does not expose — the terrain override of a clearing and
// the consumption mark of the generator — are written here with the same discipline it uses: a
// bounded statement, the row count as the decision, and `bumpChunkVersions` afterwards so the
// renderer learns about it through the ordinary `CHUNK_PATCHED` frame.

import { type MutationContext } from '../../lib/advancePlayer.js';
import { toGameMs } from '../../lib/dbMap.js';
import { type DomainEventDraft } from '../../lib/events.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { scheduledEventDedupeKey } from '../../lib/ids.js';
import { type Outbox } from '../../lib/outbox.js';
import { scheduleEvent } from '../../lib/scheduler.js';
import { type Db, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  FOREST_MILESTONE_STAGES,
  LandUse,
  PINE,
  ScheduledEventKind,
  ScheduledEventStatus,
  SelectionPurpose,
  TerrainType,
  TreeSpecies,
  TreeStatus,
  ValidationCode,
  ceilDiv,
  cellKey,
  gameHours,
  gameHoursToGameMs,
  treeStageAt,
  treeStageBoundaryGameMs,
  type CellCoord,
  type GameMs,
  type PlayerId,
  type RealMs,
  type TreeGrowthStage,
  type World,
  type WorldId,
} from '../../shared/index.js';
import {
  chunkFrames,
  dedupeCells,
  refuseSelection,
  requireFarmOfPlayer,
} from '../fields/service.js';
import { cellRepositoryOf } from '../world/cellRepo.js';
import {
  assignCellUse,
  bumpChunkVersions,
  chunksOfCells,
  validateCellSelection,
} from '../world/service.js';
import { generateNaturalForest, type GeneratedTree } from './generator.js';
import {
  FOREST_PLOT_REF_TYPE,
  TREE_SELECT,
  standingTrees,
  toForestPlotRecord,
  toTreeRecord,
  treeView,
  type ForestPlotRecord,
  type TreeRecord,
} from './record.js';

export { chunkFrames, dedupeCells, refuseSelection };

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Refuses a selection the shared rules did not accept for a forestry purpose. */
export async function requireValidForestSelection(
  services: MutationContext['services'],
  db: Db,
  world: World,
  playerId: PlayerId,
  purpose: SelectionPurpose,
  cells: readonly CellCoord[],
): Promise<void> {
  const { validation } = await validateCellSelection(services, db, world, {
    playerId,
    purpose,
    cells,
  });
  if (!validation.ok) {
    refuseSelection(validation);
  }
}

// ---------------------------------------------------------------------------
// The one shot generation mark
// ---------------------------------------------------------------------------

/**
 * The cells of a selection whose natural trees have not been generated yet.
 *
 * Absence of a row means the cell was never modified, which cannot happen here: a plot is
 * created over land the player already bought, so every cell carries a row. A cell with the
 * mark set is one that a previous plot already generated, and it stays empty (plan section
 * 5.1).
 */
export async function unconsumedCells(
  services: MutationContext['services'],
  db: Db,
  world: World,
  cells: readonly CellCoord[],
): Promise<readonly CellCoord[]> {
  const rows = await cellRepositoryOf(services).cellRows(db, world, cells);
  return cells.filter(
    (cell) => rows.get(cellKey(cell.cellX, cell.cellY))?.naturalTreeConsumed !== true,
  );
}

/**
 * Marks the cells of a plot as having had their natural trees generated.
 *
 * Every cell of the plot is marked, not only the ones that got a tree: the draw of GDD section
 * 130 decides emptiness as much as it decides a stage, and marking only the populated cells
 * would let a player recreate a plot until the empty ones came up populated, which is exactly
 * the exploit `naturalTreeConsumed` exists to close.
 */
export async function markNaturalTreesConsumed(
  tx: Tx,
  worldId: WorldId,
  cells: readonly CellCoord[],
): Promise<number> {
  if (cells.length === 0) {
    return 0;
  }
  return tx.$executeRawUnsafe(
    'UPDATE "world_cells" SET "naturalTreeConsumed" = true ' +
      'WHERE "worldId" = $1::uuid ' +
      'AND ("cellX", "cellY") IN (SELECT * FROM unnest($2::int[], $3::int[]))',
    worldId,
    cells.map((cell) => cell.cellX),
    cells.map((cell) => cell.cellY),
  );
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateForestPlotInput {
  readonly name: string;
  readonly farmId: string | null;
  readonly cells: readonly CellCoord[];
}

export interface CreateForestPlotOutcome {
  readonly plot: ForestPlotRecord;
  readonly cells: readonly CellCoord[];
  readonly trees: readonly TreeRecord[];
  readonly generatedTreeCount: number;
}

/**
 * Creates a plot over forest cells the player owns and populates it once (GDD sections 129,
 * 130 and 141).
 *
 * The order is fixed and each step depends on the one before: the shared rules judge the
 * selection, the row is written so the trees have a parent, the cells are handed to it with the
 * conditional update whose row count decides, the generation runs over the cells that were
 * never generated, the mark is set, and the milestone is scheduled.
 *
 * It moves no money. The land was paid for when it was bought (GDD section 115) and a plot is a
 * logical entity over it, exactly as a field is (GDD section 19).
 */
export async function createForestPlot(
  services: MutationContext['services'],
  context: MutationContext,
  world: World,
  playerId: PlayerId,
  input: CreateForestPlotInput,
): Promise<CreateForestPlotOutcome> {
  const cells = dedupeCells(input.cells);
  const farmId = await requireFarmOfPlayer(context.tx, playerId, input.farmId);
  await requireValidForestSelection(
    services,
    context.tx,
    world,
    playerId,
    SelectionPurpose.FOREST_PLOT,
    cells,
  );

  const atGameMs = context.reading.gameNow;
  const row = await context.tx.forestPlot.create({
    data: {
      playerId,
      farmId,
      name: input.name,
      cellCount: cells.length,
      createdAtGameMs: atGameMs,
    },
    select: {
      id: true,
      playerId: true,
      farmId: true,
      name: true,
      cellCount: true,
      currentTaskId: true,
      createdAtGameMs: true,
      disposedGameMs: true,
    },
  });
  const plot = toForestPlotRecord(row);

  const assigned = await assignCellUse(services, context.tx, {
    world,
    playerId,
    cells,
    landUse: LandUse.FOREST_PLOT,
    forestPlotId: plot.id,
    fromLandUse: [LandUse.OWNED],
    atRealMs: context.reading.atRealMs,
  });
  if (!assigned.complete) {
    throw new ApiError(ValidationCode.CELL_IN_USE, { cellCount: cells.length - assigned.affected });
  }

  const eligible = await unconsumedCells(services, context.tx, world, cells);
  const generated = generateNaturalForest(world.seed, world.generatorVersion, eligible, atGameMs);
  const trees = await insertTrees(context.tx, world, plot, generated, { naturallyGenerated: true });
  await markNaturalTreesConsumed(context.tx, world.id, cells);
  // A tree changes `hasStandingTree` of its cell, which travels in the chunk overlay, so the
  // version has to move even though no column of `world_cells` changed for it.
  if (trees.length > 0) {
    await bumpChunkVersions(
      services,
      context.tx,
      world,
      chunksOfCells(
        trees.map((tree) => ({ cellX: tree.cellX, cellY: tree.cellY })),
        world.chunkSize,
      ),
      context.reading.atRealMs,
    );
  }

  await syncMilestoneSchedule(context.tx, context.outbox, context.reading, plot, atGameMs, trees);
  return { plot, cells, trees, generatedTreeCount: trees.length };
}

/** Inserts a batch of trees and reads them back as records, in the order they were given. */
export async function insertTrees(
  tx: Tx,
  world: World,
  plot: ForestPlotRecord,
  trees: readonly Pick<GeneratedTree, 'cellX' | 'cellY' | 'plantedAtGameMs'>[],
  options: { readonly naturallyGenerated: boolean },
): Promise<readonly TreeRecord[]> {
  if (trees.length === 0) {
    return [];
  }
  await tx.tree.createMany({
    data: trees.map((tree) => ({
      forestPlotId: plot.id,
      playerId: plot.playerId,
      worldId: world.id,
      cellX: tree.cellX,
      cellY: tree.cellY,
      species: TreeSpecies.PINE,
      plantedAtGameMs: tree.plantedAtGameMs,
      status: TreeStatus.STANDING,
      naturallyGenerated: options.naturallyGenerated,
    })),
  });
  const rows = await tx.tree.findMany({
    where: {
      forestPlotId: plot.id,
      status: TreeStatus.STANDING,
      OR: trees.map((tree) => ({ cellX: tree.cellX, cellY: tree.cellY })),
    },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: TREE_SELECT,
  });
  return rows.map(toTreeRecord);
}

// ---------------------------------------------------------------------------
// The milestone of GDD section 131
// ---------------------------------------------------------------------------

/**
 * Length of the window a milestone notification aggregates, in game hours.
 *
 * The reason it exists at all: a plot of 250 trees generated with spread ages reaches maturity
 * at 250 distinct instants, and one event per instant would be a chatty version of the very
 * "one job per tree" the design rejects. Quantising the due instant to a whole number of
 * windows means every boundary falls in exactly one window, so the notification stays exact
 * while the plot never schedules more than one event per window.
 *
 * Twenty four game hours is a day of the player's own counter (GDD section 61), which is the
 * granularity the return summary of GDD section 68 reports at anyway.
 */
export const MILESTONE_WINDOW_GAME_HOURS = 24;

/** The same length in game milliseconds. */
export const MILESTONE_WINDOW_GAME_MS: bigint = gameHoursToGameMs(
  gameHours(MILESTONE_WINDOW_GAME_HOURS),
);

/** The end of the window a boundary belongs to: the first multiple of the window at or after it. */
export function milestoneWindowEnd(boundaryGameMs: GameMs): bigint {
  return ceilDiv(boundaryGameMs, MILESTONE_WINDOW_GAME_MS) * MILESTONE_WINDOW_GAME_MS;
}

/**
 * The instant of the next milestone of a plot, or null when no standing tree will reach one.
 *
 * A milestone is only maturity (`FOREST_MILESTONE_STAGES`): GDD section 131 is explicit that
 * nothing is lost by not felling on time, so this is information and never a deadline. A tree
 * that was already past the stage when the plot was created has its boundary in the past and is
 * therefore never notified, which is right: it arrived mature and the creation frame said so.
 */
export function nextMilestoneGameMs(
  trees: readonly TreeRecord[],
  fromGameMs: GameMs,
  stages: readonly TreeGrowthStage[] = FOREST_MILESTONE_STAGES,
): GameMs | null {
  let earliest: bigint | null = null;
  for (const tree of trees) {
    if (tree.status === TreeStatus.FELLED) {
      continue;
    }
    for (const stage of stages) {
      const boundary = treeStageBoundaryGameMs(tree.plantedAtGameMs, stage, PINE);
      if (boundary <= fromGameMs) {
        continue;
      }
      const due = milestoneWindowEnd(boundary);
      if (earliest === null || due < earliest) {
        earliest = due;
      }
    }
  }
  return earliest === null ? null : (earliest as GameMs);
}

/**
 * The trees a milestone notification at `dueGameMs` reports: those whose boundary fell inside
 * the window that ends there.
 *
 * Stateless on purpose. Nothing records which trees have already been notified, and nothing has
 * to: quantising the boundary maps every tree to exactly one window, and the schedule always
 * points at the earliest window still in the future, so a tree is reported once and only once.
 */
export function treesCrossingMilestone(
  trees: readonly TreeRecord[],
  dueGameMs: GameMs,
  stages: readonly TreeGrowthStage[] = FOREST_MILESTONE_STAGES,
): readonly TreeRecord[] {
  const windowStart = dueGameMs - MILESTONE_WINDOW_GAME_MS;
  return trees.filter((tree) => {
    if (tree.status === TreeStatus.FELLED) {
      return false;
    }
    return stages.some((stage) => {
      const boundary = treeStageBoundaryGameMs(tree.plantedAtGameMs, stage, PINE);
      return boundary > windowStart && boundary <= dueGameMs;
    });
  });
}

/**
 * Leaves exactly one pending `FOREST_NOTIFY_MILESTONE` for a plot: the next window in which a
 * standing tree matures, or none at all.
 *
 * A pending row is kept and never recomputed, which is the opposite of what `syncPhaseSchedule`
 * of `modules/fields` does and is the right choice here for one reason: a window that has not
 * fired yet may already contain a tree that matured, and recomputing from the current instant
 * would drop it silently. A felling that finishes between a tree maturing and its window firing
 * is not a rare interleaving, it is the ordinary one.
 *
 * Keeping it is safe in the other direction too. The pending window can only be earlier than any
 * window a later tree produces, because a replanted sapling matures four hundred and eighty game
 * hours from now and every tree already in the plot was planted no later than now. So a stale row
 * is at worst a window that reports nothing, which the handler answers by rescheduling; it is
 * never a window that arrives after the fact it should have announced.
 */
export async function syncMilestoneSchedule(
  tx: Tx,
  outbox: Outbox,
  reading: ClockReading,
  plot: ForestPlotRecord,
  fromGameMs: GameMs,
  trees?: readonly TreeRecord[],
): Promise<GameMs | null> {
  const pending = await tx.scheduledEvent.findFirst({
    where: {
      playerId: plot.playerId,
      kind: ScheduledEventKind.FOREST_NOTIFY_MILESTONE,
      status: ScheduledEventStatus.PENDING,
      refType: FOREST_PLOT_REF_TYPE,
      refId: plot.id,
    },
    select: { dueGameMs: true },
  });
  if (pending !== null) {
    return toGameMs(pending.dueGameMs);
  }
  const standing = trees ?? (await standingTrees(tx, plot.id));
  const due = nextMilestoneGameMs(standing, fromGameMs);
  if (due === null) {
    return null;
  }
  await scheduleEvent(tx, outbox, reading, {
    playerId: plot.playerId,
    kind: ScheduledEventKind.FOREST_NOTIFY_MILESTONE,
    dueGameMs: due,
    refType: FOREST_PLOT_REF_TYPE,
    refId: plot.id,
    dedupeKey: scheduledEventDedupeKey(ScheduledEventKind.FOREST_NOTIFY_MILESTONE, plot.id),
  });
  return due;
}

/** Whether a tree is at a milestone stage at an instant. Used by the notification log line. */
export function isAtMilestone(
  tree: TreeRecord,
  atGameMs: GameMs,
  stages: readonly TreeGrowthStage[] = FOREST_MILESTONE_STAGES,
): boolean {
  return stages.includes(treeStageAt(treeView(tree), atGameMs));
}

// ---------------------------------------------------------------------------
// Clearing (GDD section 10)
// ---------------------------------------------------------------------------

export interface ClearingOutcome {
  readonly clearedCells: readonly CellCoord[];
  readonly affected: number;
  readonly plotIds: readonly string[];
}

/**
 * Turns felled forest into arable land (GDD section 10), which is the one direction the MVP
 * supports: reforesting a field is outside it (GDD section 137).
 *
 * The conversion is a `terrainOverride` on the cell and never a rewrite of the generated
 * terrain, which is the witness of ADR-0010: the generator stays the authority for what the
 * world produced, and `effectiveTerrain` of `modules/world/service.ts` is the one definition of
 * what the rules see. That is why a cleared cell becomes a legitimate field cell without a
 * single rule about clearing existing in `shared/rules/selection.ts`.
 *
 * The statement excludes a cell that still carries a standing tree, which the shared rules
 * already refused: it is the same defence in depth as every conditional update of ADR-0018,
 * and here it also protects against a tree planted between the validation and the write.
 */
export async function applyClearing(
  services: MutationContext['services'],
  tx: Tx,
  world: World,
  playerId: PlayerId,
  cells: readonly CellCoord[],
  atRealMs: RealMs,
): Promise<ClearingOutcome> {
  if (cells.length === 0) {
    return { clearedCells: [], affected: 0, plotIds: [] };
  }
  const before = await tx.worldCell.findMany({
    where: {
      worldId: world.id,
      ownerPlayerId: playerId,
      forestPlotId: { not: null },
      OR: cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    },
    select: { forestPlotId: true },
  });
  const plotIds = [
    ...new Set(before.map((row) => row.forestPlotId).filter((id): id is string => id !== null)),
  ].sort();

  const affected = await tx.$executeRawUnsafe(
    'UPDATE "world_cells" c SET ' +
      `"terrainOverride" = $4::"TerrainType", "landUse" = 'OWNED'::"LandUse", ` +
      '"forestPlotId" = NULL, "updatedAtRealMs" = $5::bigint ' +
      'WHERE c."worldId" = $1::uuid ' +
      'AND (c."cellX", c."cellY") IN (SELECT * FROM unnest($2::int[], $3::int[])) ' +
      'AND c."ownerPlayerId" = $6::uuid ' +
      `AND c."landUse" IN ('OWNED'::"LandUse", 'FOREST_PLOT'::"LandUse") ` +
      'AND NOT EXISTS (SELECT 1 FROM "trees" t WHERE t."worldId" = c."worldId" ' +
      `AND t."cellX" = c."cellX" AND t."cellY" = c."cellY" AND t."status" = 'STANDING')`,
    world.id,
    cells.map((cell) => cell.cellX),
    cells.map((cell) => cell.cellY),
    TerrainType.GRASS,
    atRealMs.toString(),
    playerId,
  );
  if (affected === 0) {
    return { clearedCells: [], affected: 0, plotIds };
  }
  await bumpChunkVersions(services, tx, world, chunksOfCells(cells, world.chunkSize), atRealMs);
  return { clearedCells: cells, affected, plotIds };
}

/**
 * Recomputes `cellCount` of a plot from its cells, which a clearing is the only thing to change.
 *
 * A count of zero is returned and never written: `forest_plots_geometry_check` demands
 * `cellCount > 0`, so a plot cleared whole is closed by its caller with `disposedGameMs`
 * instead of being kept as a plot of no cells.
 */
export async function refreshPlotCellCount(tx: Tx, forestPlotId: string): Promise<number> {
  const cellCount = await tx.worldCell.count({ where: { forestPlotId } });
  if (cellCount === 0) {
    return 0;
  }
  await tx.forestPlot.update({ where: { id: forestPlotId }, data: { cellCount } });
  return cellCount;
}

// ---------------------------------------------------------------------------
// Frames of a chunk change
// ---------------------------------------------------------------------------

/** The `CHUNK_PATCHED` frames of the chunks a tree or a terrain change touched. */
export async function forestChunkFrames(
  services: MutationContext['services'],
  tx: Tx,
  world: World,
  cells: readonly CellCoord[],
): Promise<readonly DomainEventDraft[]> {
  return chunkFrames(services, tx, world, cells);
}
