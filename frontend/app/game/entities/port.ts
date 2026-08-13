// The port through which the entity layer reads state.
//
// Owner: workflow W5-D (canvas entities). Same shape and same reason as
// `game/world/source.ts`: the zone rule of `eslint.config.js` forbids
// `frontend/app/game` from importing `frontend/app/stores`, which is the mechanical
// half of the pillar of plan section 9. The layer declares what it needs as an
// interface and somebody outside the canvas binds it.
//
// What travels is a read model and not the wire model. Three differences, and each one
// is deliberate:
//
//   - Instants are `bigint` game milliseconds, already parsed. The contract serialises
//     them as decimal strings (`shared/api/schemas/common.ts`), and parsing a string on
//     every frame for every moving machine would be the most expensive thing this layer
//     did.
//   - A task carries its target cells. The layer does not know how a field, a forest
//     plot or a loose selection resolves into cells; the binder does, because that is
//     where the stores are.
//   - Nothing carries money, condition or wages. The entity layer draws position and
//     silhouette; every number the player reads about a machine belongs to a panel.

import { type EntityKind } from './config';
import {
  type BuildingType,
  type MachineStatus,
  type MachineType,
  type TaskOperation,
  type TaskStatus,
  type TreeGrowthStage,
  type WorkerStatus,
} from '~/shared/domain/enums';

/** A cell of the world, in absolute coordinates. */
export interface EntityCell {
  readonly cellX: number;
  readonly cellY: number;
}

/**
 * A building, as the layer draws it: a footprint and a type.
 *
 * The sprite of a building is exactly its footprint (`game/textures/shapes.ts`), so
 * there is no scale factor to agree on anywhere and the four numbers below are the
 * whole of the geometry.
 */
export interface EntityBuilding {
  readonly id: string;
  readonly farmId: string;
  readonly type: BuildingType;
  readonly originCellX: number;
  readonly originCellY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

/**
 * A machine. `garageId` is where it is parked when idle, which the server assigns so
 * that capacity is checked per building (plan section 5.2); `currentTaskId` is the only
 * authoritative link to the worker that operates it (ADR of the task as the single
 * link).
 */
export interface EntityMachine {
  readonly id: string;
  readonly farmId: string;
  readonly garageId: string | null;
  readonly type: MachineType;
  readonly status: MachineStatus;
  readonly currentTaskId: string | null;
}

/** A worker. `homeId` is a hard restriction of the domain (GDD section 108). */
export interface EntityWorker {
  readonly id: string;
  readonly name: string;
  readonly farmId: string;
  readonly homeId: string;
  readonly status: WorkerStatus;
  readonly currentTaskId: string | null;
}

/**
 * A standing tree. The stage is derived from the planting instant and never stored
 * (plan section 6.5), so the binder derives it with the shared rule and this layer only
 * picks a sprite.
 */
export interface EntityTree {
  readonly id: string;
  readonly cellX: number;
  readonly cellY: number;
  readonly stage: TreeGrowthStage;
  /** Rotation variant of the sprite. Any integer; the layer takes it modulo the count. */
  readonly variant: number;
}

/**
 * A task in flight, with the cells it works on.
 *
 * The layer synthesises the cosmetic route from `id` and `cells` and reads the position
 * off the clock; nothing about the movement is ever requested from the server (GDD
 * section 92, plan section 9.5).
 */
export interface EntityTask {
  readonly id: string;
  readonly operation: TaskOperation;
  readonly status: TaskStatus;
  readonly workerId: string;
  /** The powered machine first, then its implement, as the contract orders them. */
  readonly machineIds: readonly string[];
  readonly startGameMs: bigint;
  readonly scheduledEndGameMs: bigint;
  readonly endedGameMs: bigint | null;
  /** Cells of the target: a field, a forest plot or a loose selection. */
  readonly cells: readonly EntityCell[];
}

/** Everything the entity layer reads. Nothing here writes domain state. */
export interface EntitySource {
  /** Bumped whenever anything below changed. The layer watches one number. */
  revision(): number;
  /** The game instant to draw at, from the locally extrapolated clock (plan section 7). */
  nowGameMs(): bigint;
  buildings(): readonly EntityBuilding[];
  machines(): readonly EntityMachine[];
  workers(): readonly EntityWorker[];
  /** Standing trees. Felled ones are filtered out by the binder, not here. */
  trees(): readonly EntityTree[];
  /** Tasks in progress. A finished task is not drawn. */
  activeTasks(): readonly EntityTask[];
}

/** A source that reports nothing. The layer runs against it with no branches. */
export const EMPTY_ENTITY_SOURCE: EntitySource = {
  revision: () => 0,
  nowGameMs: () => 0n,
  buildings: () => [],
  machines: () => [],
  workers: () => [],
  trees: () => [],
  activeTasks: () => [],
};

/** What `entityAt` answers: the entity the pointer is over, or nothing. */
export interface EntityHit {
  readonly kind: EntityKind;
  readonly id: string;
}
