// Binding the stores to the entity port, and a source with no network.
//
// Owner: workflow W5-D (canvas entities). Same shape and same reason as
// `game/world/source.ts`: `frontend/app/game` may not import `frontend/app/stores`
// (zone rule of `eslint.config.js`), so the shape of every store row is declared here
// structurally and the two are joined outside the canvas. A renamed field stops the
// compilation at the call site, which is where the mismatch belongs.
//
// What the binder does and what it deliberately does not do:
//
//   - It parses. Instants travel as decimal strings (`shared/api/schemas/common.ts`) and
//     the layer wants `bigint`. Converting once per rebuild is a few hundred conversions
//     a second; converting inside the renderer would be one per moving machine per frame.
//   - It derives the growth stage of a tree with the shared rule and never with a rule of
//     its own. The stage is never stored (plan section 6.5), the panels derive it with
//     `treeStageAt`, and the canvas has to agree with them.
//   - It resolves the cells of a target. A field knows its cells and a forest plot knows
//     its trees; neither lookup belongs inside a renderer.
//   - It decides nothing about drawing. Which entity is visible, where it is and what it
//     looks like is `plan.ts`.

import {
  type EntityBuilding,
  type EntityCell,
  type EntityMachine,
  type EntitySource,
  type EntityTask,
  type EntityTree,
  type EntityWorker,
} from './port';
import {
  type BuildingType,
  type MachineStatus,
  type MachineType,
  type TaskOperation,
  type TaskStatus,
  type TreeGrowthStage,
  type TreeSpecies,
  TreeStatus,
  type WorkerStatus,
} from '~/shared/domain/enums';
import { gameMs, type GameMs } from '~/shared/domain/units';
import { treeStageAt } from '~/shared/rules/forestry';

/** A building, as `app/stores/buildings.ts` holds it. */
export interface BuildingRowLike {
  readonly id: string;
  readonly farmId: string;
  readonly type: BuildingType;
  readonly originCellX: number;
  readonly originCellY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

/** A machine, as `app/stores/machines.ts` holds it. */
export interface MachineRowLike {
  readonly id: string;
  readonly farmId: string;
  readonly garageId: string | null;
  readonly type: MachineType;
  readonly status: MachineStatus;
  readonly currentTaskId: string | null;
}

/** A worker, as `app/stores/workers.ts` holds it. */
export interface WorkerRowLike {
  readonly id: string;
  readonly farmId: string;
  readonly homeId: string;
  readonly name: string;
  readonly status: WorkerStatus;
  readonly currentTaskId: string | null;
}

/** A task, as `app/stores/tasks.ts` holds it: instants still in their wire form. */
export interface TaskRowLike {
  readonly id: string;
  readonly operation: TaskOperation;
  readonly status: TaskStatus;
  readonly workerId: string;
  readonly machineIds: readonly string[];
  readonly targetFieldId: string | null;
  readonly targetForestPlotId: string | null;
  readonly startGameMs: string;
  readonly scheduledEndGameMs: string;
  readonly endedGameMs: string | null;
}

/** A tree, as `app/stores/forestry.ts` holds it. */
export interface TreeRowLike {
  readonly id: string;
  readonly forestPlotId: string;
  readonly cellX: number;
  readonly cellY: number;
  readonly species: TreeSpecies;
  readonly plantedAtGameMs: string;
  readonly status: TreeStatus;
}

/**
 * What the binding needs. Every accessor is read on each call and never captured at
 * construction: a Pinia setup store unwraps its computed refs on the proxy, so reading
 * `store.all` again is what gives the current value.
 */
export interface StoreEntitySourceDeps {
  readonly buildings: () => readonly BuildingRowLike[];
  readonly machines: () => readonly MachineRowLike[];
  readonly workers: () => readonly WorkerRowLike[];
  /** Tasks in progress. The store already has the getter (`tasks.active`). */
  readonly tasks: () => readonly TaskRowLike[];
  readonly trees: () => readonly TreeRowLike[];
  /** Cells of a field, from `fields.cellsOf`. */
  readonly fieldCells: (fieldId: string) => readonly EntityCell[];
  /**
   * Cells of a forest plot. Optional: the contract gives a plot a cell count and no
   * geometry, so the fallback is where its standing trees are, which is what a felling
   * actually works on (GDD section 132). A caller that has the geometry passes this and
   * the fallback never runs.
   */
  readonly forestPlotCells?: (forestPlotId: string) => readonly EntityCell[];
  /** Game instant to draw at, from `useGameClock` (plan section 7). */
  readonly nowGameMs: () => GameMs;
  /**
   * One number the layer watches to know that something changed. `sync.lastAppliedSeq`
   * is exactly that number and costs nothing: it is bumped by every applied frame and by
   * every mutating reply, which is the definition of "the domain moved".
   */
  readonly revision: () => number;
}

/** Parses a wire instant. Zero for anything malformed, which draws rather than throws. */
function parseGameMs(text: string): bigint {
  try {
    return BigInt(text);
  } catch {
    return 0n;
  }
}

/**
 * Binds the stores to the port.
 *
 * The variant of a tree sprite is derived from its identifier and never stored: the four
 * variants exist to break the repetition of a plot of hundreds of trees
 * (`game/textures/shapes.ts`), and deriving them from the identifier keeps a tree in the
 * same rotation across sessions and across two open tabs, exactly like the worker tint.
 */
export function createStoreEntitySource(deps: StoreEntitySourceDeps): EntitySource {
  return {
    revision: () => deps.revision(),
    nowGameMs: () => deps.nowGameMs(),

    buildings: (): readonly EntityBuilding[] => deps.buildings(),

    machines: (): readonly EntityMachine[] => deps.machines(),

    workers: (): readonly EntityWorker[] => deps.workers(),

    trees: (): readonly EntityTree[] => {
      const at = deps.nowGameMs();
      const trees: EntityTree[] = [];
      for (const row of deps.trees()) {
        if (row.status !== TreeStatus.STANDING) {
          continue;
        }
        trees.push({
          id: row.id,
          cellX: row.cellX,
          cellY: row.cellY,
          stage: stageOf(row, at),
          variant: variantOf(row.id),
        });
      }
      return trees;
    },

    activeTasks: (): readonly EntityTask[] =>
      deps.tasks().map((row) => ({
        id: row.id,
        operation: row.operation,
        status: row.status,
        workerId: row.workerId,
        machineIds: row.machineIds,
        startGameMs: parseGameMs(row.startGameMs),
        scheduledEndGameMs: parseGameMs(row.scheduledEndGameMs),
        endedGameMs: row.endedGameMs === null ? null : parseGameMs(row.endedGameMs),
        cells: cellsOfTask(deps, row),
      })),
  };
}

/**
 * Cells the machinery of a task drives over.
 *
 * A field knows its own cells. A forest plot does not, for the reason `forestPlotCells`
 * gives; the fallback walks the trees once per rebuild, which is ten times a second over
 * the trees of one plot and not of the world.
 */
function cellsOfTask(deps: StoreEntitySourceDeps, task: TaskRowLike): readonly EntityCell[] {
  if (task.targetFieldId !== null) {
    return deps.fieldCells(task.targetFieldId);
  }
  const plotId = task.targetForestPlotId;
  if (plotId === null) {
    return [];
  }
  const named = deps.forestPlotCells?.(plotId);
  if (named !== undefined && named.length > 0) {
    return named;
  }
  const cells: EntityCell[] = [];
  for (const tree of deps.trees()) {
    if (tree.forestPlotId === plotId) {
      cells.push({ cellX: tree.cellX, cellY: tree.cellY });
    }
  }
  return cells;
}

/** Growth stage of a tree, with the shared rule the panels use (GDD section 131). */
function stageOf(row: TreeRowLike, atGameMs: GameMs): TreeGrowthStage {
  return treeStageAt(
    {
      species: row.species,
      plantedAtGameMs: gameMs(parseGameMs(row.plantedAtGameMs)),
      status: row.status,
    },
    atGameMs,
  );
}

/**
 * Rotation variant of a tree, from its identifier.
 *
 * FNV-1a, the same mixer the worker tint uses, for the same reason: pure, stable across
 * sessions and two operations per character. There is no `Math.random` in the art.
 */
function variantOf(treeId: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < treeId.length; index += 1) {
    hash ^= treeId.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// A source with no network
// ---------------------------------------------------------------------------

/** Everything the offline source accepts. All optional, so a test states one fact. */
export interface StaticEntitySourceOptions {
  readonly buildings?: readonly EntityBuilding[];
  readonly machines?: readonly EntityMachine[];
  readonly workers?: readonly EntityWorker[];
  readonly trees?: readonly EntityTree[];
  readonly tasks?: readonly EntityTask[];
  readonly nowGameMs?: bigint;
}

/**
 * A source that holds a fixed world and never touches the network.
 *
 * Two users, and both matter. The unit tests need entities without a Pinia instance, and
 * the measurement route needs a source whose cost is the cost of the renderer and not of
 * a mock round trip: a budget measured through a fetch measures the fetch.
 *
 * The clock is mutable through `setNowGameMs` because the whole point of the cosmetic
 * movement is that it is a function of the clock, and a bench that could not advance it
 * would be measuring two hundred stationary machines.
 */
export interface StaticEntitySource extends EntitySource {
  setNowGameMs(value: bigint): void;
  replace(options: StaticEntitySourceOptions): void;
}

export function createStaticEntitySource(
  options: StaticEntitySourceOptions = {},
): StaticEntitySource {
  let held = options;
  let now = options.nowGameMs ?? 0n;
  let revision = 1;
  return {
    revision: () => revision,
    nowGameMs: () => now,
    buildings: () => held.buildings ?? [],
    machines: () => held.machines ?? [],
    workers: () => held.workers ?? [],
    trees: () => held.trees ?? [],
    activeTasks: () => held.tasks ?? [],
    setNowGameMs: (value) => {
      // No revision bump: the clock moving is what the frame pass is for, and treating it
      // as a structural change would rebuild the whole plan sixty times a second.
      now = value;
    },
    replace: (next) => {
      held = next;
      now = next.nowGameMs ?? now;
      revision += 1;
    },
  };
}
