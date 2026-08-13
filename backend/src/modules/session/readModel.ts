// The two read models the snapshot needs and no earlier phase publishes: the task and the
// forest plot.
//
// Owner: workflow W6-B. Module `session`.
//
// Why they live here at all. `GET /api/state/snapshot` is a complete replacement of every
// entity of the player, and two of those entities belong to modules written in this same
// phase: `tasks` (W6-A) and `forestry` (W6-C). Rule 4 of plan section 11 forbids importing a
// sibling of the same phase, and the alternative — leaving `tasks` and `forestPlots` empty in
// the snapshot — is worse than duplication: a client that rebuilt its state after a sequence
// gap would silently lose every task in flight and every plot, which is precisely the failure
// the snapshot exists to repair.
//
// So the duplication is deliberate, declared, and bounded to the projection: nothing here
// writes, reserves or decides anything. Every derived figure comes from the shared rules the
// sibling module will also call, so the two readings cannot drift apart on arithmetic:
//
//   `treeStageAt`, `treeWoodVolumeDm3`, `isFellable`  shared/rules/forestry.ts (GDD 131)
//   `woodSaleRevenue`                                 shared/rules/pricing.ts  (GDD 133)
//
// What can still drift is the shape of the row, and that is checked by the compiler: the
// selects below are declared as structural interfaces, so a column renamed in
// `schema.prisma` stops this file compiling.
//
// `progressBp` is the one figure with a rule of its own, stated once here: a task that
// completed reads 10 000 whatever its instants say, because a completion is a completion; a
// task that was cancelled reads the fraction it actually worked, which is what GDD section 106
// requires and what `endedGameMs` records; and a task in flight reads the elapsed fraction of
// its scheduled duration at the clock of the reply.

import { toGameMs } from '../../lib/dbMap.js';
import { type Db } from '../../lib/tx.js';
import {
  Money,
  TREE_GROWTH_STAGES,
  TREE_SPECIES_CATALOGUE,
  TaskStatus,
  TreeStatus,
  isFellable,
  toWireGameMs,
  toWireMoney,
  treeStageAt,
  treeWoodVolumeDm3,
  woodSaleRevenue,
  type CropId,
  type ForestPlotDto,
  type GameMs,
  type MachineRole,
  type PlayerId,
  type TaskDto,
  type TaskOperation,
  type TreeGrowthStage,
  type TreeSpecies,
  type TreeStageHistogram,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** The columns of a task this module reads, and its machine links. */
const TASK_SELECT = {
  id: true,
  workerId: true,
  operation: true,
  status: true,
  targetFieldId: true,
  targetForestPlotId: true,
  destinationFarmId: true,
  cropId: true,
  unitsAtStart: true,
  effectiveWorkSpeedMilli: true,
  reservedStorageUnits: true,
  startGameMs: true,
  scheduledEndGameMs: true,
  endedGameMs: true,
  cancelable: true,
  machines: { select: { machineId: true, role: true } },
} as const;

/** The shape the select above returns. Declared so the mapping is checked at compile time. */
export interface TaskRow {
  readonly id: string;
  readonly workerId: string;
  readonly operation: TaskOperation;
  readonly status: TaskStatus;
  readonly targetFieldId: string | null;
  readonly targetForestPlotId: string | null;
  readonly destinationFarmId: string | null;
  readonly cropId: CropId | null;
  readonly unitsAtStart: number;
  readonly effectiveWorkSpeedMilli: number;
  readonly reservedStorageUnits: number | null;
  readonly startGameMs: bigint;
  readonly scheduledEndGameMs: bigint;
  readonly endedGameMs: bigint | null;
  readonly cancelable: boolean;
  readonly machines: readonly { readonly machineId: string; readonly role: MachineRole }[];
}

/** Basis points of one whole, which is how every domain percentage travels (ADR-0013). */
const FULL_BP = 10_000;

/**
 * Elapsed fraction of the scheduled duration, in basis points.
 *
 * The three cases are separated on purpose rather than folded into one expression, because
 * they answer three different questions: a completed task is done, a cancelled one is as done
 * as the work it paid for, and a running one is where the clock says.
 */
export function taskProgressBp(row: TaskRow, atGameMs: GameMs): number {
  if (row.status === TaskStatus.COMPLETED) {
    return FULL_BP;
  }
  const span = row.scheduledEndGameMs - row.startGameMs;
  if (span <= 0n) {
    return FULL_BP;
  }
  const at = row.endedGameMs ?? (atGameMs as bigint);
  const elapsed = at - row.startGameMs;
  if (elapsed <= 0n) {
    return 0;
  }
  if (elapsed >= span) {
    return FULL_BP;
  }
  return Number((elapsed * BigInt(FULL_BP)) / span);
}

/**
 * A task as the contract carries it.
 *
 * The machines travel powered first and implement second, which is what
 * `shared/api/schemas/tasks.ts` declares. The order is imposed here and not left to the
 * database, because the role is an enumerated value whose alphabetical order is the opposite
 * of the one the contract asks for.
 */
export function toTaskDto(row: TaskRow, atGameMs: GameMs): TaskDto {
  const machineIds = [...row.machines]
    .sort((left, right) => {
      if (left.role !== right.role) {
        return left.role === 'POWERED' ? -1 : 1;
      }
      return left.machineId < right.machineId ? -1 : 1;
    })
    .map((link) => link.machineId);

  return {
    id: row.id,
    workerId: row.workerId,
    machineIds,
    operation: row.operation,
    status: row.status,
    targetFieldId: row.targetFieldId,
    targetForestPlotId: row.targetForestPlotId,
    destinationFarmId: row.destinationFarmId,
    cropId: row.cropId,
    unitsAtStart: row.unitsAtStart,
    effectiveWorkSpeedMilli: row.effectiveWorkSpeedMilli,
    reservedStorageUnits: row.reservedStorageUnits,
    startGameMs: toWireGameMs(toGameMs(row.startGameMs)),
    scheduledEndGameMs: toWireGameMs(toGameMs(row.scheduledEndGameMs)),
    endedGameMs: row.endedGameMs === null ? null : toWireGameMs(toGameMs(row.endedGameMs)),
    cancelable: row.cancelable,
    progressBp: taskProgressBp(row, atGameMs),
  };
}

/**
 * The tasks in flight of a player, which is what the snapshot carries.
 *
 * Only `IN_PROGRESS`: a snapshot is the current state and not a history, and the closed tasks
 * of the interval belong to the return summary, which is where GDD section 68 puts them. The
 * listing of past tasks is `GET /api/tasks`, of `modules/tasks`.
 *
 * A row with no machine link is skipped. The contract requires at least one machine per task
 * and the assignment path always writes one, so the case does not arise; skipping rather than
 * emitting an invalid entity keeps one impossible row from failing the whole snapshot in the
 * response serialiser.
 */
export async function loadActiveTaskDtos(
  db: Db,
  playerId: PlayerId,
  atGameMs: GameMs,
): Promise<readonly TaskDto[]> {
  const rows = await db.task.findMany({
    where: { playerId, status: TaskStatus.IN_PROGRESS },
    orderBy: [{ startGameMs: 'asc' }, { id: 'asc' }],
    select: TASK_SELECT,
  });
  return rows.filter((row) => row.machines.length > 0).map((row) => toTaskDto(row, atGameMs));
}

// ---------------------------------------------------------------------------
// Forest plots
// ---------------------------------------------------------------------------

/** The columns of a plot this module reads. */
const PLOT_SELECT = {
  id: true,
  farmId: true,
  name: true,
  cellCount: true,
  currentTaskId: true,
  createdAtGameMs: true,
} as const;

export interface ForestPlotRow {
  readonly id: string;
  readonly farmId: string | null;
  readonly name: string;
  readonly cellCount: number;
  readonly currentTaskId: string | null;
  readonly createdAtGameMs: bigint;
}

/** The columns of a tree the derivations need, and nothing else. */
export interface StandingTreeRow {
  readonly forestPlotId: string;
  readonly species: TreeSpecies;
  readonly plantedAtGameMs: bigint;
}

/** An empty histogram, so every stage is present with zero where there is none. */
function emptyHistogram(): Record<TreeGrowthStage, number> {
  const histogram = {} as Record<TreeGrowthStage, number>;
  for (const stage of TREE_GROWTH_STAGES) {
    histogram[stage] = 0;
  }
  return histogram;
}

/**
 * A plot as the contract carries it, from its standing trees.
 *
 * Nothing about a tree is stored except when it was planted (ADR-0030), so every counter here
 * is derived at `atGameMs` with the shared rules. The value of the fellable wood is priced per
 * species and not per tree: rounding once per species instead of once per tree keeps a clear
 * cut of a thousand trees from drifting by up to a thousand ten-thousandths against the sale
 * the market module would actually write.
 */
export function toForestPlotDto(
  plot: ForestPlotRow,
  trees: readonly StandingTreeRow[],
  atGameMs: GameMs,
): ForestPlotDto {
  const histogram = emptyHistogram();
  const fellableVolumeBySpecies = new Map<TreeSpecies, number>();
  let standingWoodDm3 = 0;
  let fellableWoodDm3 = 0;
  let fellableTreeCount = 0;

  for (const row of trees) {
    const view = {
      species: row.species,
      plantedAtGameMs: toGameMs(row.plantedAtGameMs),
      status: TreeStatus.STANDING,
    };
    histogram[treeStageAt(view, atGameMs)] += 1;
    const volume = treeWoodVolumeDm3(view, atGameMs);
    standingWoodDm3 += volume;
    if (!isFellable(view, atGameMs)) {
      continue;
    }
    fellableTreeCount += 1;
    fellableWoodDm3 += volume;
    fellableVolumeBySpecies.set(
      row.species,
      (fellableVolumeBySpecies.get(row.species) ?? 0) + volume,
    );
  }

  const fellableWoodValue = Money.sum(
    [...fellableVolumeBySpecies.entries()].map(([species, volume]) =>
      woodSaleRevenue(TREE_SPECIES_CATALOGUE[species], volume),
    ),
  );

  return {
    id: plot.id,
    farmId: plot.farmId,
    name: plot.name,
    cellCount: plot.cellCount,
    // One standing tree per cell is a partial unique index of the initial migration, so the
    // empty cells are exactly the cells that carry none.
    emptyCellCount: Math.max(0, plot.cellCount - trees.length),
    standingTreeCount: trees.length,
    fellableTreeCount,
    standingWoodDm3,
    fellableWoodDm3,
    fellableWoodValue: toWireMoney(fellableWoodValue),
    stageHistogram: histogram as TreeStageHistogram,
    currentTaskId: plot.currentTaskId,
    createdAtGameMs: toWireGameMs(toGameMs(plot.createdAtGameMs)),
    atGameMs: toWireGameMs(atGameMs),
  };
}

/** The live plots of a player with their standing trees, in two statements. */
export async function loadForestPlotDtos(
  db: Db,
  playerId: PlayerId,
  atGameMs: GameMs,
): Promise<readonly ForestPlotDto[]> {
  const plots: readonly ForestPlotRow[] = await db.forestPlot.findMany({
    where: { playerId, disposedGameMs: null },
    orderBy: [{ createdAtGameMs: 'asc' }, { id: 'asc' }],
    select: PLOT_SELECT,
  });
  if (plots.length === 0) {
    return [];
  }
  const trees: readonly StandingTreeRow[] = await db.tree.findMany({
    where: {
      playerId,
      status: TreeStatus.STANDING,
      forestPlotId: { in: plots.map((plot) => plot.id) },
    },
    select: { forestPlotId: true, species: true, plantedAtGameMs: true },
  });

  const byPlot = new Map<string, StandingTreeRow[]>();
  for (const tree of trees) {
    const bucket = byPlot.get(tree.forestPlotId);
    if (bucket === undefined) {
      byPlot.set(tree.forestPlotId, [tree]);
    } else {
      bucket.push(tree);
    }
  }
  return plots.map((plot) => toForestPlotDto(plot, byPlot.get(plot.id) ?? [], atGameMs));
}

/** Cells of a plot, for the outline layer of the snapshot. */
export async function forestPlotCells(
  db: Db,
  forestPlotId: string,
): Promise<readonly { readonly cellX: number; readonly cellY: number }[]> {
  const rows = await db.worldCell.findMany({
    where: { forestPlotId },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: { cellX: true, cellY: true },
  });
  return rows.map((row) => ({ cellX: row.cellX, cellY: row.cellY }));
}
