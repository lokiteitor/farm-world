// Pure domain entities.
//
// Owner: workflow W2 (vocabulary).
//
// These interfaces are the shape of the domain as the rules, the API responses and
// the client stores see it. They are not Prisma types and never import from
// Prisma: the generated client is a backend detail, and the frontend must be able
// to consume the same vocabulary without it. The Prisma schema of workflow W2
// mirrors these interfaces, and the mapping is explicit in each module.
//
// The seven divergences that workflow W2 left between these interfaces and the
// schema were aligned by the W2.5 patching window, following the schema in every
// case (docs/handoff/NOTES-w2d.md, item 5), so the mapping from a Prisma row to a
// domain entity is now field by field with no renaming: `ScheduledEvent.refType`,
// `refId`, `status` and `dedupeKey`; the four capacities and two counters of
// `Building` plus its `purchasePrice`; the two capacities of `Farm`; the origin of
// `Player`; and `Tree.worldId`.
//
// Four conventions apply throughout, all of them from plan section 5:
//
//   - Every instant with simulation or economic meaning is a `GameMs`. Real
//     instants appear only where the value is a trace or a scheduling detail, and
//     they are named `...RealMs` so the difference is visible at the call site.
//   - Every domain percentage is a `Bp`, an integer in basis points.
//   - Everything that participates in a cost carries a validity interval and is
//     deleted logically, never physically: an immutable ledger must keep pointing
//     at something.
//   - What the catalogues of shared/config already state is not stored again.
//     Prices per hour, work speeds, capacities per building type and wood volumes
//     are constants versioned with the code, not columns.

import type {
  BuildingType,
  CropCycleState,
  CropId,
  GameEventType,
  LandUse,
  LedgerType,
  MachineStatus,
  MachineType,
  PlayerStatus,
  ScheduledEventKind,
  ScheduledEventStatus,
  SoilCondition,
  StorageResource,
  TaskOperation,
  TaskStatus,
  TerrainType,
  TreeSpecies,
  TreeStatus,
  WorkerStatus,
} from './enums.js';
import type {
  BuildingId,
  FarmId,
  FieldId,
  ForestPlotId,
  GameEventId,
  LedgerEntryId,
  MachineId,
  PlayerId,
  ScheduledEventId,
  TaskId,
  TreeId,
  WorkerCandidateId,
  WorkerId,
  WorldId,
} from './ids.js';
import type { Money } from './money.js';
import type { Bp, GameMs, RealMs } from './units.js';

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

// ---------------------------------------------------------------------------
// World and clock
// ---------------------------------------------------------------------------

/**
 * Anchor of the game clock with a rational multiplier, so that the conversion
 * between real and game time is invertible without floating point error (plan
 * section 6.1).
 *
 * `rateNum = 0` is a paused world, which is the only admissible mitigation for a
 * prolonged outage: the clock never rewinds.
 */
export interface WorldClockAnchor {
  readonly anchorGameMs: GameMs;
  readonly anchorRealMs: RealMs;
  /** Game milliseconds that elapse per real millisecond, as a rational. */
  readonly rateNum: number;
  readonly rateDen: number;
  /**
   * Incremented on every re-anchoring. A scheduled event carries the epoch it was
   * written under, so a stale job can be discarded instead of firing early.
   */
  readonly scheduleEpoch: number;
}

export interface World extends WorldClockAnchor {
  readonly id: WorldId;
  readonly seed: number;
  /**
   * Persisted so that startup can abort if the constants of shared/config no
   * longer match what the stored coordinates were generated with (plan section
   * 5.1).
   */
  readonly generatorVersion: number;
  readonly chunkSize: number;
  readonly createdAtRealMs: RealMs;
}

/**
 * Closed interval of world time under a single multiplier. Written by
 * `retimeWorld`, which freezes the past before re-anchoring (plan section 6.1).
 */
export interface WorldTimeSegment {
  readonly worldId: WorldId;
  readonly seq: number;
  readonly fromGameMs: GameMs;
  readonly toGameMs: GameMs;
  readonly fromRealMs: RealMs;
  readonly toRealMs: RealMs;
  readonly rateNum: number;
  readonly rateDen: number;
}

/** Chunk coordinate. A chunk is `CHUNK_SIZE` cells on a side (GDD section 6). */
export interface ChunkCoord {
  readonly chunkX: number;
  readonly chunkY: number;
}

/** Absolute cell coordinate in the world grid (GDD section 7). */
export interface CellCoord {
  readonly cellX: number;
  readonly cellY: number;
}

/**
 * Chunk header. Only the version and the coordinates are persisted; the terrain is
 * regenerated from the seed (GDD sections 7 and 58).
 *
 * The version is what allows answering `unchanged` to an up to date client and,
 * above all, what allows caching the overlay of modifications in Redis with the
 * version inside the key: modifying a cell changes the key, so nothing has to be
 * invalidated (plan section 5.1).
 */
export interface Chunk extends ChunkCoord {
  readonly worldId: WorldId;
  readonly version: number;
  readonly updatedAtRealMs: RealMs;
}

/**
 * A modified cell. Only modified cells exist as rows (GDD section 58); everything
 * else is regenerated.
 *
 * `generatedTerrain` is kept as a witness of what the generator produced when the
 * row was written, so that a change of noise parameters cannot silently turn a
 * cell that is already part of a field into water. `terrainOverride` is the
 * cleared forest of GDD section 10.
 */
export interface Cell extends CellCoord {
  readonly worldId: WorldId;
  readonly chunkX: number;
  readonly chunkY: number;
  /** Index of the cell inside its chunk, row major: `y * CHUNK_SIZE + x`. */
  readonly idx: number;
  readonly generatedTerrain: TerrainType;
  readonly terrainOverride: TerrainType | null;
  readonly ownerPlayerId: PlayerId | null;
  readonly landUse: LandUse;
  readonly fieldId: FieldId | null;
  readonly forestPlotId: ForestPlotId | null;
  readonly buildingId: BuildingId | null;
  /**
   * Set once the natural trees of the cell have been generated, so that deleting
   * and recreating a forest plot cannot farm free trees (plan section 5.1).
   */
  readonly naturalTreeConsumed: boolean;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface Player {
  readonly id: PlayerId;
  readonly worldId: WorldId;
  readonly email: string;
  readonly displayName: string;
  /** `IN_DEBT` is derived from a negative settled balance (plan section 6.6). */
  readonly status: PlayerStatus;
  /** Settled balance. Reads project it forward; writes settle first. */
  readonly balance: Money;
  /** Start of the player's own day counter (GDD section 61, plan section 2.2). */
  readonly startedAtGameMs: GameMs;
  /** Upper bound of the interval whose continuous costs are already settled. */
  readonly lastAccrualGameMs: GameMs;
  readonly lastLoginGameMs: GameMs;
  /**
   * Separate from the login mark on purpose: reloading the page must not erase
   * the pending return summary (plan section 6.7).
   */
  readonly lastSummaryGameMs: GameMs;
  /** Monotonic per player ledger sequence, incremented under the same lock. */
  readonly ledgerSeq: number;
  /** Monotonic per player event sequence, the one the client checks for gaps. */
  readonly eventSeq: number;
  /**
   * Origin assigned by the deterministic spawn allocator, null until it is
   * assigned. Stored and not derived from the owned cells, because the allocator
   * has to honour the minimum separation between players and a land sale would
   * falsify a derived origin (plan section 2.2, `SPAWN_MIN_DISTANCE_CHUNKS`).
   */
  readonly spawnCellX: number | null;
  readonly spawnCellY: number | null;
  readonly createdAtRealMs: RealMs;
}

// ---------------------------------------------------------------------------
// Farm and buildings
// ---------------------------------------------------------------------------

/**
 * A farm holds the fungible stock, because grain and wood have no individual
 * identity and aggregating them avoids inventing a micro decision the GDD never
 * asks for (plan section 5.4). Capacity, in contrast, is the sum of the
 * capacities of its storage buildings.
 *
 * `reserved...` is capacity committed by tasks in flight: a harvest reserves room
 * in the silo when it is assigned, so that an overflow is an actionable rejection
 * instead of a silent loss (plan section 5.4).
 *
 * Units are integers, and wood is therefore counted in cubic decimetres and not in
 * cubic metres: the published volumes of GDD section 131 are multiples of 0.05 m³,
 * and adding thousands of them as floating point numbers would make a lazy sum
 * depend on its order. Same reason percentages are stored in basis points. The
 * interface divides by `DM3_PER_M3`.
 */
export interface Farm {
  readonly id: FarmId;
  readonly playerId: PlayerId;
  readonly name: string;
  readonly storedWheatLiters: number;
  readonly reservedWheatLiters: number;
  readonly storedWoodDm3: number;
  readonly reservedWoodDm3: number;
  /**
   * Sum of the capacities of the storage buildings of the farm, maintained by
   * trigger. Denormalised on purpose: it is what turns "stock against capacity"
   * into an intra-row `CHECK` instead of a query over the buildings (plan
   * section 5.4).
   */
  readonly capacityWheatLiters: number;
  readonly capacityWoodDm3: number;
  readonly createdAtGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

export interface Building {
  readonly id: BuildingId;
  readonly farmId: FarmId;
  readonly playerId: PlayerId;
  readonly type: BuildingType;
  /** North west corner of the footprint, in absolute cell coordinates. */
  readonly originCellX: number;
  readonly originCellY: number;
  readonly widthCells: number;
  readonly heightCells: number;
  /**
   * Price actually paid, excluding land: the cells of GDD section 116 are a separate
   * `LAND_PURCHASE` entry when they were not already owned (plan section 2.2). Kept
   * for the same reason as `Machine.purchasePrice`, so the resale value stays
   * auditable if the catalogue is retuned.
   */
  readonly purchasePrice: Money;
  /**
   * Snapshot of the catalogue capacity at the time of construction, by kind.
   * Redundant with shared/config on purpose: the hard capacity restrictions of plan
   * section 5.4 are a `CHECK` against a counter in this same row, and a `CHECK`
   * cannot read a constant that lives in the application.
   *
   * The three counters are separate and not one, because a single counter cannot
   * tell the `CHECK` what it is counting, and the trigger that adds storage capacity
   * into the farm cannot tell which resource it belongs to. A garage uses machines
   * (GDD section 96), a worker home uses workers (GDD section 108), a silo and a wood
   * store use storage units of `storageResource` (GDD sections 27 and 136), and a
   * workshop uses none: what it provides is repair access (GDD sections 29 and 93).
   */
  readonly capacityMachines: number;
  readonly capacityWorkers: number;
  readonly capacityStorageUnits: number;
  readonly storageResource: StorageResource | null;
  /**
   * Live occupancy, incremented by a trigger inside the same transaction. Only
   * machines that are not disposed of and workers that are not terminated count.
   * Storage buildings keep both at zero, because their contents are fungible and
   * aggregated on the farm.
   */
  readonly machineCount: number;
  readonly workerCount: number;
  readonly builtAtGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * A field (GDD section 85). Its geometry is not an array of cells: the cell
 * carries the foreign key (plan section 5.2), and `cellCount` is the denormalised
 * area that the duration and yield formulas need.
 *
 * Each lazily accrued attribute carries its own timestamp, and not one shared by
 * the row, so that settling one does not discard the elapsed time of the other
 * (plan section 6.5).
 */
export interface Field {
  readonly id: FieldId;
  readonly playerId: PlayerId;
  /**
   * Farm that serves the field, which is also the destination of its harvest.
   * Resolves the ambiguity of GDD section 31 against GDD section 83. It is null
   * while the player has no farm yet.
   */
  readonly farmId: FarmId | null;
  readonly name: string;
  readonly cellCount: number;
  readonly cropId: CropId | null;
  readonly cropCycleState: CropCycleState;
  readonly soilCondition: SoilCondition;
  readonly fertilityBp: Bp;
  readonly fertilityUpdatedAtGameMs: GameMs;
  readonly weedLevelBp: Bp;
  readonly weedLevelUpdatedAtGameMs: GameMs;
  /** Modelled and settled, multiplier fixed at 1.0 in the MVP (GDD section 79). */
  readonly fertilizationBp: Bp;
  readonly fertilizationUpdatedAtGameMs: GameMs;
  /** Instant the current `cropCycleState` was entered. */
  readonly stateEnteredAtGameMs: GameMs;
  /**
   * Start of the growth timeline. The crop phase and the growth progress are
   * projected from it, from the species and from the clock; the scheduled job only
   * materialises and notifies the same result (plan section 6.5).
   */
  readonly seededAtGameMs: GameMs | null;
  readonly currentTaskId: TaskId | null;
  readonly createdAtGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

/**
 * A machine (GDD section 98). Prices per hour, work speed, work width and
 * capacity are not stored: they come from the catalogue of shared/config, indexed
 * by `type`.
 *
 * `assignedWorkerId` of GDD section 98 does not exist either: the authoritative
 * link between worker and machine is the task (plan section 5.2). What does stay
 * is `currentTaskId`, which is the reservation column that the conditional update
 * of plan section 5.4 writes to rule out a double booking.
 */
export interface Machine {
  readonly id: MachineId;
  readonly playerId: PlayerId;
  /** Ownership. Mandatory, unlike the ambiguous `location` of GDD section 98. */
  readonly farmId: FarmId;
  /** Physical location, assigned by the server so capacity can be checked. */
  readonly garageId: BuildingId | null;
  readonly type: MachineType;
  readonly conditionBp: Bp;
  /** Wear is applied per event, prorated over hours worked (GDD section 93). */
  readonly conditionUpdatedAtGameMs: GameMs;
  readonly status: MachineStatus;
  readonly currentTaskId: TaskId | null;
  /** Instant the scheduled repair completes, for the countdown of the interface. */
  readonly repairEndsAtGameMs: GameMs | null;
  /** Price actually paid, kept so that resale value stays auditable. */
  readonly purchasePrice: Money;
  readonly acquiredGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

/**
 * A worker (GDD section 101), without the `assignedMachineId` cross pointer.
 *
 * Skill is a scalar and not a map, against the suggestion of GDD section 139:
 * adding a column in PostgreSQL is instantaneous, whereas a JSON field costs type
 * safety permanently on the hot path of the duration calculation (plan section
 * 5.2).
 */
export interface Worker {
  readonly id: WorkerId;
  readonly playerId: PlayerId;
  readonly farmId: FarmId;
  /** Worker home where the worker lives. A hard restriction (GDD section 108). */
  readonly homeId: BuildingId;
  readonly name: string;
  readonly skillBp: Bp;
  readonly salaryPerGameHour: Money;
  readonly status: WorkerStatus;
  readonly currentTaskId: TaskId | null;
  /** Number of completed tasks, which is what drives skill progression (GDD 103). */
  readonly completedTaskCount: number;
  readonly hiredGameMs: GameMs;
  readonly terminatedGameMs: GameMs | null;
}

/**
 * Candidate in the hiring pool (GDD section 102). The pool is per player, with
 * `region` reserved: a global pool would introduce contention between players that
 * the MVP avoids explicitly (plan section 5.2).
 */
export interface WorkerCandidate {
  readonly id: WorkerCandidateId;
  readonly playerId: PlayerId;
  readonly region: string | null;
  readonly name: string;
  readonly skillBp: Bp;
  readonly askingSalaryPerGameHour: Money;
  readonly listedAtGameMs: GameMs;
  /** Set when the candidate is hired or replaced by a pool refresh. */
  readonly removedGameMs: GameMs | null;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * A task (GDD section 111). It is the only authoritative link between a worker and
 * the machines being used, and the only place a duration is fixed.
 *
 * `scheduledEndGameMs` and `endedGameMs` are distinct because cancellation is not
 * a completion: nothing is refunded, wear is applied prorated, and the operating
 * cost integral must stop at the real end (plan section 2.2, resolution of GDD
 * sections 106 and 111).
 */
export interface Task {
  readonly id: TaskId;
  readonly playerId: PlayerId;
  readonly workerId: WorkerId;
  /** Machines reserved by the task. One row per machine in `TaskMachine`. */
  readonly machineIds: readonly MachineId[];
  readonly operation: TaskOperation;
  readonly status: TaskStatus;
  readonly targetFieldId: FieldId | null;
  readonly targetForestPlotId: ForestPlotId | null;
  /** Destination of the produce: the farm whose storage receives it. */
  readonly destinationFarmId: FarmId | null;
  readonly cropId: CropId | null;
  /** Cells or trees at the start of the task. Audit, and the divisor of duration. */
  readonly unitsAtStart: number;
  /**
   * Effective work speed used to fix the duration, in thousandths of a unit per
   * game hour. Stored as an integer for the same reason as every other percentage,
   * and kept as audit because GDD section 89 warns that the unit of `workSpeed`
   * will be recalculated, so historical rows stay reinterpretable.
   */
  readonly effectiveWorkSpeedMilli: number;
  /**
   * Storage reserved on assignment, in the stored unit of the resource: litres for a
   * harvest, cubic decimetres for a fell.
   */
  readonly reservedStorageUnits: number | null;
  readonly startGameMs: GameMs;
  readonly scheduledEndGameMs: GameMs;
  readonly endedGameMs: GameMs | null;
  readonly cancelable: boolean;
  /** Identifier of the queue job, so it can be removed on cancellation (GDD 106). */
  readonly jobId: string | null;
}

// ---------------------------------------------------------------------------
// Forestry
// ---------------------------------------------------------------------------

/** A forest plot (GDD sections 129 and 140). Geometry as in `Field`. */
export interface ForestPlot {
  readonly id: ForestPlotId;
  readonly playerId: PlayerId;
  /** Farm that serves the plot, and destination of the felled wood. */
  readonly farmId: FarmId | null;
  readonly name: string;
  readonly cellCount: number;
  readonly currentTaskId: TaskId | null;
  readonly createdAtGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

/**
 * A tree (GDD sections 130 and 140). Age, growth stage and wood volume are never
 * stored: they are derived from `plantedAtGameMs`, the species and the clock (plan
 * section 2.2, resolution of GDD sections 130 and 140). Tens of thousands of trees
 * make a job per tree unviable, and GDD section 131 confirms that nothing is
 * triggered when a tree matures.
 */
export interface Tree {
  readonly id: TreeId;
  readonly forestPlotId: ForestPlotId;
  readonly playerId: PlayerId;
  /**
   * The uniqueness of one tree per cell (GDD section 130) has to be scoped to the
   * world, and the cell is addressed by absolute coordinates rather than by a
   * foreign key: a tree exists on a generated forest cell that may have no row yet,
   * and forcing one would persist cells that were never modified.
   */
  readonly worldId: WorldId;
  readonly cellX: number;
  readonly cellY: number;
  readonly species: TreeSpecies;
  /** May be in the past when the tree was generated already grown (GDD 130). */
  readonly plantedAtGameMs: GameMs;
  readonly status: TreeStatus;
  readonly felledAtGameMs: GameMs | null;
  /** True for the trees the world generated, false for replanted ones. */
  readonly naturallyGenerated: boolean;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/**
 * An immutable ledger entry (plan section 5.3). Single entry with a signed amount:
 * negative is an outflow for the player.
 *
 * `balanceAfter` is redundant on purpose: it makes the ledger self auditable with
 * an executable test, lets the history be drawn without window functions and,
 * above all, forces every write path through the player row, which is precisely
 * the serialisation the design is looking for.
 *
 * The reference to the origin is polymorphic and has no foreign key: an immutable
 * accounting record must not point with a foreign key at entities that are
 * dismissed, sold or merged, because that would force a choice between destroying
 * the trail and forbidding deletion.
 */
export interface LedgerEntry {
  readonly id: LedgerEntryId;
  readonly playerId: PlayerId;
  /** Monotonic per player. Gives a total order and breaks timestamp ties. */
  readonly seq: number;
  readonly type: LedgerType;
  readonly amount: Money;
  readonly balanceAfter: Money;
  readonly atGameMs: GameMs;
  readonly refType: string | null;
  readonly refId: string | null;
  readonly meta: JsonObject | null;
  /**
   * Deterministic and unique per player. The detail that is easiest to forget and
   * most expensive to omit: the queue delivers at least once, and a retry of
   * "charge the wages of this interval" without a key duplicates the charge.
   */
  readonly idempotencyKey: string;
  readonly createdAtRealMs: RealMs;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * A row of the outbox (plan section 6.4). The payload is minimal by rule:
 * identifiers, due instant and epoch, never amounts, quantities or durations,
 * which would have been computed in the past.
 */
export interface ScheduledEvent {
  readonly id: ScheduledEventId;
  readonly playerId: PlayerId;
  readonly kind: ScheduledEventKind;
  readonly dueGameMs: GameMs;
  readonly epoch: number;
  /**
   * Polymorphic reference to the subject, with no foreign key, for the same reason
   * as in the ledger: the subject may be logically deleted before the event is
   * processed and the handler has to be able to notice. Named as in the ledger,
   * because it is the same mechanism.
   */
  readonly refType: string | null;
  readonly refId: string | null;
  readonly status: ScheduledEventStatus;
  /**
   * Deterministic key that makes scheduling the same fact twice a no-op. Unique
   * among the pending rows only, which is a partial unique index: once processed,
   * the same key may legitimately be scheduled again, as happens with every pool
   * refresh.
   */
  readonly dedupeKey: string | null;
  /** Null while the event is outside the scheduling horizon and has no alarm yet. */
  readonly enqueuedAtRealMs: RealMs | null;
  readonly processedAtGameMs: GameMs | null;
  readonly jobId: string | null;
}

/** A row of the per player event log that backs the resynchronisation ring. */
export interface GameEvent {
  readonly id: GameEventId;
  readonly playerId: PlayerId;
  readonly seq: number;
  readonly type: GameEventType;
  readonly atGameMs: GameMs;
  readonly payload: JsonObject;
}
