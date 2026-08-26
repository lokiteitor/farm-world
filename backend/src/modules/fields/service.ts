// The internal API of the fields module: reads, the state machine applied, and geometry.
//
// Owner: workflow W4-C. Module `fields`.
//
// Everything that writes a field goes through this file, and it is written so that the two
// entry points of the crop cycle cannot diverge. The scheduled `FIELD_ADVANCE_PHASE` job of
// `jobs.ts` and the validation of a player action both call `materializeProjectedPhase`,
// which recomputes the phase with the pure projection of `projection.ts` and applies
// exactly the transitions whose boundary has passed. Running it twice applies nothing the
// second time, because the loop compares the stored state with the projected one and stops
// when they agree, and that is what makes the two paths converge on the same row (plan
// section 6.5, invariant 5).
//
// Three rules the writes here obey, and where each comes from:
//
//   - Every transition settles the three parallel attributes and stamps each of them with
//     its own instant (GDD sections 77, 78 and 79). The timestamps are per attribute and
//     not per row, so settling the weeds does not throw away the elapsed fallow time of the
//     fertility (plan section 6.5).
//   - A transition is applied one phase at a time, at the instant of the boundary it
//     crosses and not at the instant the job noticed it. A field caught up after two
//     hundred hours therefore has the same stored history as one whose jobs ran on time,
//     which is the property the tests compare.
//   - The cells are claimed and released through `modules/world/service.ts`, which is a
//     module of an earlier phase, and never with a statement of this module. That is the
//     one place that knows the exclusivity of use of GDD section 15 and the conditional
//     update that makes it race free (ADR-0018).
//
// The module owns no money: none of the four geometry operations moves any, because the
// land is already owned and a field is a logical entity over it (GDD sections 13 and 19).
// That is why none of the four routes carries an idempotency key.

import { type MutationContext } from '../../lib/advancePlayer.js';
import { type ServiceContext } from '../../lib/context.js';
import { toBp, toGameMs, toGameMsOrNull } from '../../lib/dbMap.js';
import { type DomainEventDraft } from '../../lib/events.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { scheduledEventDedupeKey } from '../../lib/ids.js';
import { type Outbox } from '../../lib/outbox.js';
import { cancelScheduledEventsFor, scheduleEvent } from '../../lib/scheduler.js';
import { ascendingIds, type Db, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  CropCycleState,
  INITIAL_CROP_CYCLE_STATE,
  INITIAL_CROP_ID,
  LandUse,
  MAX_SELECTION_CELLS,
  ScheduledEventKind,
  SelectionPurpose,
  SoilCondition,
  ValidationCode,
  bp,
  cellKey,
  fertilityAfterHarvest,
  isContiguous,
  notFound,
  notOwned,
  toWireGameMs,
  type Bp,
  type CellCoord,
  type ChunkPatchEvent,
  type CropDefinition,
  type CropId,
  type FarmId,
  type FieldDto,
  type FieldId,
  type GameMs,
  type PlayerId,
  type SelectionValidation,
  type TaskOperation,
  type World,
} from '../../shared/index.js';
import {
  assignCellUse,
  chunkPatchesFor,
  chunksOfCells,
  validateCellSelection,
} from '../world/service.js';
import {
  availableOperations,
  cropOf,
  expectedYieldLiters,
  isTimedPhase,
  nextTimedState,
  phaseBoundaryAfter,
  projectFieldPhase,
  settleAttributes,
  type FieldAttributes,
} from './projection.js';
import { requireExtendable, requireOperationAllowed, requireTransition } from './stateMachine.js';

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

/** Reference type of a scheduled event that belongs to a field. */
export const FIELD_REF_TYPE = 'FIELD';

/** Ceiling on the phases one materialisation may cross. Three phases plus the exit. */
const MAX_MATERIALISED_TRANSITIONS = 8;

const FIELD_SELECT = {
  id: true,
  playerId: true,
  farmId: true,
  name: true,
  cellCount: true,
  cropId: true,
  cropCycleState: true,
  soilCondition: true,
  fertilityBp: true,
  fertilityUpdatedAtGameMs: true,
  weedLevelBp: true,
  weedLevelUpdatedAtGameMs: true,
  fertilizationBp: true,
  fertilizationUpdatedAtGameMs: true,
  stateEnteredAtGameMs: true,
  seededAtGameMs: true,
  currentTaskId: true,
  createdAtGameMs: true,
  disposedGameMs: true,
} as const;

/** A field row as this module reads it, with the units of the domain rather than of the driver. */
export interface FieldRecord extends FieldAttributes {
  readonly id: FieldId;
  readonly playerId: PlayerId;
  readonly farmId: FarmId | null;
  readonly name: string;
  readonly createdAtGameMs: GameMs;
  readonly disposedGameMs: GameMs | null;
}

/** The shape the select above returns. Declared so the mapping is checked at compile time. */
interface FieldRow {
  readonly id: string;
  readonly playerId: string;
  readonly farmId: string | null;
  readonly name: string;
  readonly cellCount: number;
  readonly cropId: CropId | null;
  readonly cropCycleState: CropCycleState;
  readonly soilCondition: SoilCondition;
  readonly fertilityBp: number;
  readonly fertilityUpdatedAtGameMs: bigint;
  readonly weedLevelBp: number;
  readonly weedLevelUpdatedAtGameMs: bigint;
  readonly fertilizationBp: number;
  readonly fertilizationUpdatedAtGameMs: bigint;
  readonly stateEnteredAtGameMs: bigint;
  readonly seededAtGameMs: bigint | null;
  readonly currentTaskId: string | null;
  readonly createdAtGameMs: bigint;
  readonly disposedGameMs: bigint | null;
}

export function toFieldRecord(row: FieldRow): FieldRecord {
  return {
    id: row.id as FieldId,
    playerId: row.playerId as PlayerId,
    farmId: row.farmId === null ? null : (row.farmId as FarmId),
    name: row.name,
    cellCount: row.cellCount,
    cropId: row.cropId,
    cropCycleState: row.cropCycleState,
    soilCondition: row.soilCondition,
    fertilityBp: toBp(row.fertilityBp),
    fertilityUpdatedAtGameMs: toGameMs(row.fertilityUpdatedAtGameMs),
    weedLevelBp: toBp(row.weedLevelBp),
    weedLevelUpdatedAtGameMs: toGameMs(row.weedLevelUpdatedAtGameMs),
    fertilizationBp: toBp(row.fertilizationBp),
    fertilizationUpdatedAtGameMs: toGameMs(row.fertilizationUpdatedAtGameMs),
    stateEnteredAtGameMs: toGameMs(row.stateEnteredAtGameMs),
    seededAtGameMs: toGameMsOrNull(row.seededAtGameMs),
    currentTaskId: row.currentTaskId,
    createdAtGameMs: toGameMs(row.createdAtGameMs),
    disposedGameMs: toGameMsOrNull(row.disposedGameMs),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every live field of a player, oldest first, which is the order the listing shows. */
export async function loadPlayerFields(
  db: Db,
  playerId: PlayerId,
): Promise<readonly FieldRecord[]> {
  const rows = await db.field.findMany({
    where: { playerId, disposedGameMs: null },
    orderBy: [{ createdAtGameMs: 'asc' }, { id: 'asc' }],
    select: FIELD_SELECT,
  });
  return rows.map(toFieldRecord);
}

/**
 * One field of a player, or the refusal that says which of the two things went wrong.
 *
 * A field of another player is `NOT_OWNED` and not `NOT_FOUND`: the identifier came from
 * somewhere, and telling the client it does not exist would send it looking for a bug that
 * is not there. A disposed field is `NOT_FOUND`, because it genuinely no longer exists.
 */
export async function requireField(
  db: Db,
  playerId: PlayerId,
  fieldId: string,
): Promise<FieldRecord> {
  const row = await db.field.findUnique({ where: { id: fieldId }, select: FIELD_SELECT });
  if (row === null || row.disposedGameMs !== null) {
    throw notFound('field', fieldId);
  }
  if (row.playerId !== playerId) {
    throw notOwned('field', fieldId);
  }
  return toFieldRecord(row);
}

/**
 * A live field of a player, or null.
 *
 * The absence of a refusal is the point: the job handler cannot treat a missing subject as
 * an error, because an event outliving the field it points at is expected at least once and
 * throwing inside a queue job turns it into an endless retry (ADR-0016).
 */
export async function findLiveField(
  db: Db,
  playerId: PlayerId,
  fieldId: string,
): Promise<FieldRecord | null> {
  const row = await db.field.findUnique({ where: { id: fieldId }, select: FIELD_SELECT });
  if (row === null || row.disposedGameMs !== null || row.playerId !== playerId) {
    return null;
  }
  return toFieldRecord(row);
}

/** The cells of a field, in row major order so two reads produce the same geometry. */
export async function fieldCells(db: Db, fieldId: FieldId): Promise<readonly CellCoord[]> {
  const rows = await db.worldCell.findMany({
    where: { fieldId },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: { cellX: true, cellY: true },
  });
  return rows.map((row) => ({ cellX: row.cellX, cellY: row.cellY }));
}

/** Refuses a field that has a task in flight (GDD section 104). */
export function requireIdleField(field: FieldRecord): void {
  if (field.currentTaskId !== null) {
    throw new ApiError(ValidationCode.FIELD_HAS_ACTIVE_TASK, {
      entityKind: 'field',
      entityId: field.id,
    });
  }
}

/** Refuses a farm that is not a live farm of this player, and accepts the absence of one. */
export async function requireFarmOfPlayer(
  db: Db,
  playerId: PlayerId,
  farmId: string | null,
): Promise<FarmId | null> {
  if (farmId === null) {
    return null;
  }
  const farm = await db.farm.findUnique({
    where: { id: farmId },
    select: { id: true, playerId: true, disposedGameMs: true },
  });
  if (farm === null || farm.disposedGameMs !== null) {
    throw notFound('farm', farmId);
  }
  if (farm.playerId !== playerId) {
    throw notOwned('farm', farmId);
  }
  return farm.id as FarmId;
}

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/** A field as the contract carries it, with its attributes projected to an instant. */
export function buildFieldDto(field: FieldRecord, atGameMs: GameMs): FieldDto {
  const crop = cropOf(field.cropId);
  const phase = projectFieldPhase(field, atGameMs, crop);
  const settled = settleAttributes(field, atGameMs, crop);
  return {
    id: field.id,
    farmId: field.farmId,
    name: field.name,
    cellCount: field.cellCount,
    cropId: field.cropId,
    cropCycleState: field.cropCycleState,
    soilCondition: field.soilCondition,
    fertilityBp: field.fertilityBp,
    fertilityUpdatedAtGameMs: toWireGameMs(field.fertilityUpdatedAtGameMs),
    weedLevelBp: field.weedLevelBp,
    weedLevelUpdatedAtGameMs: toWireGameMs(field.weedLevelUpdatedAtGameMs),
    fertilizationBp: field.fertilizationBp,
    fertilizationUpdatedAtGameMs: toWireGameMs(field.fertilizationUpdatedAtGameMs),
    stateEnteredAtGameMs: toWireGameMs(field.stateEnteredAtGameMs),
    seededAtGameMs: field.seededAtGameMs === null ? null : toWireGameMs(field.seededAtGameMs),
    currentTaskId: field.currentTaskId,
    createdAtGameMs: toWireGameMs(field.createdAtGameMs),
    projection: {
      atGameMs: toWireGameMs(atGameMs),
      cropCycleState: phase.state,
      growthProgressBp: phase.growthProgressBp,
      weedLevelBp: settled.weedLevelBp,
      fertilityBp: settled.fertilityBp,
      fertilizationBp: settled.fertilizationBp,
      readyAtGameMs: phase.readyAtGameMs === null ? null : toWireGameMs(phase.readyAtGameMs),
      expectedYieldLiters: expectedYieldLiters(field, settled, crop),
      availableOperations: [
        ...availableOperations(phase.state, field.cropId, field.currentTaskId !== null),
      ],
    },
  };
}

/**
 * The `FIELD_UPSERTED` frame of a field.
 *
 * `cells` travels only when the geometry changed, which is the rule of
 * `shared/ws/events.ts`: a field of two thousand cells would otherwise resend its whole
 * geometry every time its weed level was settled.
 */
export function fieldUpsertedFrame(
  field: FieldRecord,
  atGameMs: GameMs,
  cells: readonly CellCoord[] | null,
): DomainEventDraft {
  return {
    type: 'FIELD_UPSERTED',
    payload: { field: buildFieldDto(field, atGameMs), cells: cells === null ? null : [...cells] },
  };
}

/** The `CHUNK_PATCHED` frames of the chunks a geometry change touched. */
export async function chunkFrames(
  services: ServiceContext,
  tx: Tx,
  world: World,
  cells: readonly CellCoord[],
): Promise<readonly DomainEventDraft[]> {
  const patches = await chunkPatchesFor(services, tx, world, chunksOfCells(cells, world.chunkSize));
  // The payload demands at least one cell, so a chunk that somehow came back empty is
  // dropped rather than sent as a frame the contract rejects.
  return patches
    .filter((patch: ChunkPatchEvent) => patch.cells.length > 0)
    .map((patch: ChunkPatchEvent): DomainEventDraft => ({ type: 'CHUNK_PATCHED', payload: patch }));
}

// ---------------------------------------------------------------------------
// Writes: one transition
// ---------------------------------------------------------------------------

/** What a write changes on top of settling the three parallel attributes. */
export interface FieldMutation {
  readonly name?: string | undefined;
  readonly farmId?: FarmId | null | undefined;
  readonly cellCount?: number | undefined;
  readonly cropId?: CropId | null | undefined;
  readonly cropCycleState?: CropCycleState | undefined;
  readonly soilCondition?: SoilCondition | undefined;
  readonly seededAtGameMs?: GameMs | null | undefined;
  /** Weeds back to zero, which is the side effect of `CULTIVATE` and of `HARVEST`. */
  readonly resetWeedLevel?: boolean | undefined;
  /** Fertility after the drain of a harvest (GDD section 77). */
  readonly fertilityBp?: Bp | undefined;
}

/**
 * Settles the three parallel attributes at an instant and writes the row.
 *
 * Every column is written, with the current value where the mutation says nothing, so there
 * is no conditional shape to reason about and a column can never be left behind by a branch
 * that forgot it. `stateEnteredAtGameMs` moves only when the state really changes.
 */
export async function writeSettledField(
  tx: Tx,
  field: FieldRecord,
  atGameMs: GameMs,
  mutation: FieldMutation = {},
): Promise<FieldRecord> {
  const crop = cropOf(field.cropId);
  const settled = settleAttributes(field, atGameMs, crop);
  const nextState = mutation.cropCycleState ?? field.cropCycleState;
  const row = await tx.field.update({
    where: { id: field.id },
    data: {
      name: mutation.name ?? field.name,
      farmId: mutation.farmId === undefined ? field.farmId : mutation.farmId,
      cellCount: mutation.cellCount ?? field.cellCount,
      cropId: mutation.cropId === undefined ? field.cropId : mutation.cropId,
      cropCycleState: nextState,
      soilCondition: mutation.soilCondition ?? field.soilCondition,
      seededAtGameMs:
        mutation.seededAtGameMs === undefined ? field.seededAtGameMs : mutation.seededAtGameMs,
      fertilityBp: mutation.fertilityBp ?? settled.fertilityBp,
      fertilityUpdatedAtGameMs: atGameMs,
      weedLevelBp: mutation.resetWeedLevel === true ? bp(0) : settled.weedLevelBp,
      weedLevelUpdatedAtGameMs: atGameMs,
      fertilizationBp: settled.fertilizationBp,
      fertilizationUpdatedAtGameMs: atGameMs,
      stateEnteredAtGameMs:
        nextState === field.cropCycleState ? field.stateEnteredAtGameMs : atGameMs,
    },
    select: FIELD_SELECT,
  });
  return toFieldRecord(row);
}

/**
 * Applies one transition of the table of GDD section 76, refusing anything it does not
 * contain.
 *
 * `reason` names what asked for the transition, so a refusal reads the same whether it came
 * from a player action or from the materialising job.
 */
export async function applyTransition(
  tx: Tx,
  field: FieldRecord,
  toState: CropCycleState,
  atGameMs: GameMs,
  reason: string,
  mutation: FieldMutation = {},
): Promise<FieldRecord> {
  requireTransition(field.cropCycleState, toState, reason);
  return writeSettledField(tx, field, atGameMs, { ...mutation, cropCycleState: toState });
}

/**
 * Applies every automatic timed transition whose boundary has already passed.
 *
 * This is the hybrid of plan section 6.5 made concrete. The projection is the authority, so
 * a field whose job never ran is already `READY_TO_HARVEST` for every purpose; this
 * function is what puts the stored row in agreement with it, one phase at a time and at the
 * instant of each boundary. Idempotent: called twice with the same instant, the second call
 * finds the loop condition already false and writes nothing.
 */
export async function materializeProjectedPhase(
  tx: Tx,
  field: FieldRecord,
  atGameMs: GameMs,
): Promise<FieldRecord> {
  let current = field;
  for (let guard = 0; guard < MAX_MATERIALISED_TRANSITIONS; guard += 1) {
    const seeded = current.seededAtGameMs;
    if (seeded === null || !isTimedPhase(current.cropCycleState)) {
      return current;
    }
    const crop = cropOf(current.cropId);
    const boundary = phaseBoundaryAfter(current.cropCycleState, seeded, crop);
    const next = nextTimedState(current.cropCycleState);
    if (boundary === null || next === null || boundary > atGameMs) {
      return current;
    }
    current = await applyTransition(tx, current, next, boundary, 'ADVANCE_PHASE');
  }
  return current;
}

// ---------------------------------------------------------------------------
// Writes: the scheduled growth event
// ---------------------------------------------------------------------------

/**
 * Leaves exactly one pending `FIELD_ADVANCE_PHASE` for the field: the next boundary of its
 * timeline, or none at all when it is outside the timed part of the cycle.
 *
 * Cancel and reschedule rather than update, because the dedupe key is unique among the
 * pending rows only, so cancelling frees it inside the same transaction
 * (`lib/scheduler.ts`). A row already claimed by the advance is `PROCESSED` and is not
 * touched, which is what lets the job handler call this on its way out.
 */
export async function syncPhaseSchedule(
  tx: Tx,
  outbox: Outbox,
  reading: ClockReading,
  field: FieldRecord,
): Promise<void> {
  await cancelScheduledEventsFor(tx, outbox, field.playerId, FIELD_REF_TYPE, field.id);
  const seeded = field.seededAtGameMs;
  if (seeded === null || !isTimedPhase(field.cropCycleState)) {
    return;
  }
  const boundary = phaseBoundaryAfter(field.cropCycleState, seeded, cropOf(field.cropId));
  if (boundary === null) {
    return;
  }
  await scheduleEvent(tx, outbox, reading, {
    playerId: field.playerId,
    kind: ScheduledEventKind.FIELD_ADVANCE_PHASE,
    dueGameMs: boundary,
    refType: FIELD_REF_TYPE,
    refId: field.id,
    dedupeKey: scheduledEventDedupeKey(ScheduledEventKind.FIELD_ADVANCE_PHASE, field.id),
  });
}

// ---------------------------------------------------------------------------
// Writes: a player operation
// ---------------------------------------------------------------------------

export interface FieldOperationInput {
  readonly operation: TaskOperation;
  /** Crop of a sowing (GDD section 104). Refused where the operation does not take one. */
  readonly cropId?: CropId | null | undefined;
}

export interface FieldOperationOutcome {
  readonly field: FieldRecord;
  /**
   * Litres the harvest produced (GDD section 83), or null for any other operation. The
   * caller deposits them, because the silo belongs to the farm and its capacity rule is not
   * a rule of this module (GDD sections 83 and 97).
   */
  readonly harvestedLiters: number | null;
  /** States the field passed through, in order, including the ones materialised first. */
  readonly states: readonly CropCycleState[];
}

/**
 * Applies the state machine effect of a completed operation (GDD sections 76, 81 and 90).
 *
 * The order is the one plan section 6.5 prescribes and it is not negotiable: the projected
 * phase is materialised first, so an operation is validated against the state the field
 * really is in and not against the state a job has not yet written; then the requirement
 * table of GDD section 90 decides whether the operation may start from it; then the
 * transition is applied with its side effects.
 *
 * Written for `modules/tasks` of workflow W6-A, which is a later phase and may import this
 * module, so the crop cycle has one implementation and the task engine has none of it.
 */
export async function applyFieldOperation(
  tx: Tx,
  outbox: Outbox,
  reading: ClockReading,
  field: FieldRecord,
  input: FieldOperationInput,
  atGameMs: GameMs = reading.gameNow,
): Promise<FieldOperationOutcome> {
  const states: CropCycleState[] = [];
  let current = await materializeProjectedPhase(tx, field, atGameMs);
  if (current.cropCycleState !== field.cropCycleState) {
    states.push(current.cropCycleState);
  }

  const requirement = requireOperationAllowed(input.operation, current.cropCycleState);
  const cropId = input.cropId ?? null;
  if (requirement.requiresCrop && cropId === null) {
    throw new ApiError(ValidationCode.FIELD_CROP_REQUIRED, { operation: input.operation });
  }
  if (!requirement.requiresCrop && cropId !== null) {
    throw new ApiError(ValidationCode.FIELD_CROP_NOT_ALLOWED, { operation: input.operation });
  }

  const crop: CropDefinition | null = cropOf(cropId ?? current.cropId);
  const toState = requirement.toCropState;
  if (toState === null) {
    // Unreachable: `requireOperationAllowed` already refused a requirement without one.
    throw new ApiError(ValidationCode.TARGET_KIND_MISMATCH, { operation: input.operation });
  }

  // The yield is computed before the transition, with the attributes settled to this
  // instant, because the same transition drains the fertility and resets the weeds.
  let harvestedLiters: number | null = null;
  let fertilityAfter: Bp | undefined;
  if (toState === CropCycleState.HARVESTED) {
    if (crop === null) {
      // Unreachable: only `READY_TO_HARVEST` transitions here, and a field cannot reach it
      // without having been sown. Stated rather than assumed, because the yield and the
      // fertility drain below are both meaningless without a crop.
      throw new ApiError(ValidationCode.FIELD_CROP_REQUIRED, { operation: input.operation });
    }
    const settled = settleAttributes(current, atGameMs, crop);
    harvestedLiters = expectedYieldLiters(current, settled, crop);
    fertilityAfter = fertilityAfterHarvest(settled.fertilityBp, crop);
  }

  current = await applyTransition(tx, current, toState, atGameMs, input.operation, {
    ...(requirement.soilConditionAfter === null
      ? {}
      : { soilCondition: requirement.soilConditionAfter }),
    ...(requirement.resetsWeedLevel ? { resetWeedLevel: true } : {}),
    ...(requirement.requiresCrop ? { cropId } : {}),
    ...(toState === CropCycleState.SEEDED ? { seededAtGameMs: atGameMs } : {}),
    ...(fertilityAfter === undefined ? {} : { fertilityBp: fertilityAfter }),
  });
  states.push(current.cropCycleState);

  // `HARVESTED -> VIRGIN/PLOWED` is automatic and triggered by the crop configuration (GDD
  // section 76), so the field never rests in `HARVESTED`: the narrative cycle of GDD
  // section 84 ends on virgin soil in the same breath as the harvest. The growth timeline
  // is cleared with it, which is what makes the field project as unsown again.
  if (current.cropCycleState === CropCycleState.HARVESTED && crop !== null) {
    current = await applyTransition(
      tx,
      current,
      crop.afterHarvestState,
      atGameMs,
      'AFTER_HARVEST',
      { cropId: null, seededAtGameMs: null },
    );
    states.push(current.cropCycleState);
  }

  await syncPhaseSchedule(tx, outbox, reading, current);
  return { field: current, harvestedLiters, states };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Deduplicates a selection, preserving the order the request sent. */
export function dedupeCells(cells: readonly CellCoord[]): readonly CellCoord[] {
  const seen = new Set<number>();
  const unique: CellCoord[] = [];
  for (const cell of cells) {
    const key = cellKey(cell.cellX, cell.cellY);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({ cellX: cell.cellX, cellY: cell.cellY });
  }
  return unique;
}

/**
 * Turns the aggregated answer of `shared/rules/selection.ts` into the refusal of the API.
 *
 * The first issue is the one reported, and the shared rules already put the whole selection
 * rules first, so "the selection is not contiguous" wins over two hundred per cell reasons.
 * The code is the shared `ValidationCode`, which is what makes the green highlight of the
 * client and this 400 the same rule (plan section 8).
 */
export function refuseSelection(validation: SelectionValidation): never {
  const issue = validation.issues[0];
  if (issue === undefined) {
    throw new ApiError(ValidationCode.VALIDATION_FAILED, { field: 'cells' });
  }
  throw new ApiError(issue.code, {
    cellCount: issue.cellCount,
    ...(issue.firstCell === null ? {} : { cells: [issue.firstCell] }),
    ...(issue.code === ValidationCode.SELECTION_TOO_LARGE ? { limit: MAX_SELECTION_CELLS } : {}),
  });
}

/** Refuses a selection that the shared rules did not accept for this purpose. */
export async function requireValidSelection(
  services: ServiceContext,
  tx: Tx,
  world: World,
  playerId: PlayerId,
  purpose: SelectionPurpose,
  cells: readonly CellCoord[],
  adjacentTo?: readonly CellCoord[],
): Promise<void> {
  const { validation } = await validateCellSelection(services, tx, world, {
    playerId,
    purpose,
    cells,
    ...(adjacentTo === undefined ? {} : { adjacentTo }),
  });
  if (!validation.ok) {
    refuseSelection(validation);
  }
}

/**
 * Hands a set of cells to a field, aborting the whole transaction unless every one of them
 * moved.
 *
 * The row count of the conditional update is the decision (ADR-0018): a partial result
 * means somebody else took a cell in between, and committing it would leave a field whose
 * `cellCount` and geometry disagree.
 */
export async function claimCellsForField(
  services: ServiceContext,
  context: MutationContext,
  world: World,
  playerId: PlayerId,
  fieldId: FieldId,
  cells: readonly CellCoord[],
  fromLandUse: readonly LandUse[] = [LandUse.OWNED],
): Promise<void> {
  if (cells.length === 0) {
    return;
  }
  const outcome = await assignCellUse(services, context.tx, {
    world,
    playerId,
    cells,
    landUse: LandUse.FIELD,
    fieldId,
    fromLandUse: [...fromLandUse],
    atRealMs: context.reading.atRealMs,
  });
  if (!outcome.complete) {
    throw new ApiError(ValidationCode.CELL_IN_USE, { cellCount: cells.length - outcome.affected });
  }
}

/** Releases the cells of a field back to plain owned land, which is what a merge does. */
export async function releaseFieldCells(
  services: ServiceContext,
  context: MutationContext,
  world: World,
  playerId: PlayerId,
  cells: readonly CellCoord[],
): Promise<void> {
  if (cells.length === 0) {
    return;
  }
  const outcome = await assignCellUse(services, context.tx, {
    world,
    playerId,
    cells,
    landUse: LandUse.OWNED,
    fromLandUse: [LandUse.FIELD],
    atRealMs: context.reading.atRealMs,
  });
  if (!outcome.complete) {
    throw new ApiError(ValidationCode.CELL_IN_USE, { cellCount: cells.length - outcome.affected });
  }
}

// ---------------------------------------------------------------------------
// Geometry: creation and extension
// ---------------------------------------------------------------------------

export interface CreateFieldInput {
  readonly name: string;
  readonly farmId: string | null;
  readonly cells: readonly CellCoord[];
}

/**
 * Creates a field over cells the player already owns (GDD sections 17 and 19).
 *
 * The six rules of GDD section 17 are checked by `shared/rules/selection.ts` and not here:
 * ownership, arable terrain, no standing tree, no infrastructure and contiguity are the
 * `FIELD` purpose of that module, and the ceiling of two thousand cells is the same one the
 * client applies while dragging (ADR-0012). Multi chunk is not a special case at any point:
 * a field is a logical entity over the grid and its surface is the count of its cells (GDD
 * sections 16 and 18).
 */
export async function createField(
  services: ServiceContext,
  context: MutationContext,
  world: World,
  playerId: PlayerId,
  input: CreateFieldInput,
): Promise<{ readonly field: FieldRecord; readonly cells: readonly CellCoord[] }> {
  const cells = dedupeCells(input.cells);
  const farmId = await requireFarmOfPlayer(context.tx, playerId, input.farmId);
  await requireValidSelection(services, context.tx, world, playerId, SelectionPurpose.FIELD, cells);

  const atGameMs = context.reading.gameNow;
  const row = await context.tx.field.create({
    data: {
      playerId,
      farmId,
      name: input.name,
      cellCount: cells.length,
      cropId: INITIAL_CROP_ID,
      cropCycleState: INITIAL_CROP_CYCLE_STATE,
      soilCondition: SoilCondition.UNTOUCHED,
      fertilityUpdatedAtGameMs: atGameMs,
      weedLevelUpdatedAtGameMs: atGameMs,
      fertilizationUpdatedAtGameMs: atGameMs,
      stateEnteredAtGameMs: atGameMs,
      createdAtGameMs: atGameMs,
    },
    select: FIELD_SELECT,
  });
  const field = toFieldRecord(row);
  await claimCellsForField(services, context, world, playerId, field.id, cells);
  return { field, cells };
}

/**
 * Adds adjacent cells to a field (GDD section 20).
 *
 * Adjacency and the per cell rules are the `FIELD_EXTEND` purpose of the shared rules, with
 * the current geometry as the surface to touch. The state check is the one thing the shared
 * rules cannot express, and its reason is in `stateMachine.ts`.
 */
export async function extendField(
  services: ServiceContext,
  context: MutationContext,
  world: World,
  field: FieldRecord,
  requested: readonly CellCoord[],
): Promise<{ readonly field: FieldRecord; readonly cells: readonly CellCoord[] }> {
  requireIdleField(field);
  const projected = projectFieldPhase(field, context.reading.gameNow);
  requireExtendable(projected.state);

  const current = await fieldCells(context.tx, field.id);
  const added = dedupeCells(requested);
  await requireValidSelection(
    services,
    context.tx,
    world,
    field.playerId,
    SelectionPurpose.FIELD_EXTEND,
    added,
    current,
  );

  await claimCellsForField(services, context, world, field.playerId, field.id, added);
  const updated = await writeSettledField(context.tx, field, context.reading.gameNow, {
    cellCount: current.length + added.length,
  });
  return { field: updated, cells: [...current, ...added] };
}

// ---------------------------------------------------------------------------
// Geometry: split
// ---------------------------------------------------------------------------

export interface SplitFieldOutcome {
  readonly original: FieldRecord;
  readonly created: FieldRecord;
  readonly movedCells: readonly CellCoord[];
  readonly remainingCells: readonly CellCoord[];
}

/**
 * Splits a field in two (GDD section 21).
 *
 * Both halves have to be contiguous and non empty, which is what `FIELD_SPLIT_INCOMPLETE`
 * reports. The parallel attributes travel with each half unchanged, and so do the crop, the
 * soil condition and the growth timeline: GDD section 22 asks that a geometry operation not
 * destroy agricultural progress without an explicit reason, and a split has none. The sum
 * of the two cell counts is the original count, so the yield of GDD section 83 over the two
 * halves is the yield of the field it came from.
 */
export async function splitField(
  services: ServiceContext,
  context: MutationContext,
  world: World,
  field: FieldRecord,
  input: { readonly name: string; readonly cells: readonly CellCoord[] },
): Promise<SplitFieldOutcome> {
  requireIdleField(field);
  const owned = await fieldCells(context.tx, field.id);
  const ownedKeys = new Set(owned.map((cell) => cellKey(cell.cellX, cell.cellY)));
  const moved = dedupeCells(input.cells);

  for (const cell of moved) {
    if (!ownedKeys.has(cellKey(cell.cellX, cell.cellY))) {
      throw new ApiError(ValidationCode.FIELD_SPLIT_INCOMPLETE, {
        entityKind: 'field',
        entityId: field.id,
        cells: [cell],
      });
    }
  }
  const movedKeys = new Set(moved.map((cell) => cellKey(cell.cellX, cell.cellY)));
  const remaining = owned.filter((cell) => !movedKeys.has(cellKey(cell.cellX, cell.cellY)));
  if (moved.length === 0 || remaining.length === 0) {
    throw new ApiError(ValidationCode.FIELD_SPLIT_INCOMPLETE, {
      entityKind: 'field',
      entityId: field.id,
      cellCount: moved.length,
    });
  }
  if (!isContiguous(moved) || !isContiguous(remaining)) {
    throw new ApiError(ValidationCode.FIELD_SPLIT_INCOMPLETE, {
      entityKind: 'field',
      entityId: field.id,
      cellCount: moved.length,
    });
  }

  const atGameMs = context.reading.gameNow;
  const row = await context.tx.field.create({
    data: {
      playerId: field.playerId,
      farmId: field.farmId,
      name: input.name,
      cellCount: moved.length,
      cropId: field.cropId,
      cropCycleState: field.cropCycleState,
      soilCondition: field.soilCondition,
      fertilityBp: field.fertilityBp,
      fertilityUpdatedAtGameMs: field.fertilityUpdatedAtGameMs,
      weedLevelBp: field.weedLevelBp,
      weedLevelUpdatedAtGameMs: field.weedLevelUpdatedAtGameMs,
      fertilizationBp: field.fertilizationBp,
      fertilizationUpdatedAtGameMs: field.fertilizationUpdatedAtGameMs,
      stateEnteredAtGameMs: field.stateEnteredAtGameMs,
      seededAtGameMs: field.seededAtGameMs,
      createdAtGameMs: atGameMs,
    },
    select: FIELD_SELECT,
  });
  const created = toFieldRecord(row);

  await claimCellsForField(services, context, world, field.playerId, created.id, moved, [
    LandUse.FIELD,
  ]);
  const original = await writeSettledField(context.tx, field, atGameMs, {
    cellCount: remaining.length,
  });

  // The new half inherits the timeline, so it needs its own alarm clock; the original keeps
  // the one it already had, and rescheduling it is harmless and keeps the two symmetric.
  await syncPhaseSchedule(context.tx, context.outbox, context.reading, created);
  await syncPhaseSchedule(context.tx, context.outbox, context.reading, original);
  return { original, created, movedCells: moved, remainingCells: remaining };
}

// ---------------------------------------------------------------------------
// Geometry: merge
// ---------------------------------------------------------------------------

export interface MergeFieldsOutcome {
  readonly field: FieldRecord;
  readonly removedFieldIds: readonly FieldId[];
  readonly cells: readonly CellCoord[];
}

/**
 * Attributes of a field of a set for the compatibility check of GDD section 22.
 *
 * THE RESOLUTION RULE, which GDD section 22 asks for without stating and which the brief of
 * this module requires to be defined and documented:
 *
 *   1. Two fields at different points of the cycle are not merged; the request is refused
 *      with `FIELD_MERGE_INCOMPATIBLE`. That is the only reading of "it should not destroy
 *      agricultural progress without an explicit reason" that destroys nothing at all:
 *      merging a `GROWING` field with a `VIRGIN` one would have to either grant the virgin
 *      half a crop it was never sown with, which creates yield out of nothing, or discard
 *      the growing half, which is the destruction the section forbids. Refusing leaves the
 *      player with an action that always has an obvious remedy, namely to harvest or to
 *      work the other half first.
 *   2. The state compared is the projected one, so a field whose growth job has not run is
 *      compared as what it really is. Every field is materialised before the comparison, in
 *      the same transaction.
 *   3. Compatible means the same crop cycle state, the same crop, the same soil condition
 *      and the same serving farm. Soil condition is part of the agricultural state GDD
 *      section 22 asks to validate, and the farm decides where the harvest goes (GDD section
 *      31 as resolved by plan section 2.2), so neither can be picked arbitrarily.
 *   4. The parallel attributes of the result are the mean of the parts weighted by cell
 *      count, truncated. Fertility, weeds and fertilisation are intensive quantities over a
 *      surface, so weighting by surface is the only combination under which merging and then
 *      harvesting yields what harvesting the parts separately would have yielded, up to the
 *      truncation of one basis point.
 *   5. The growth timeline of the result is the latest of the parts. It is not a preference:
 *      it is the only choice under which the projected phase of the merged field is still
 *      the common phase of the parts. Taking the earliest, or the mean, could place the
 *      result past a boundary that neither part had crossed, which is progress granted for
 *      free.
 *   6. The first field of the request survives and the rest are disposed of. Creating a
 *      third identity, which is how GDD section 22 draws it, would orphan every reference
 *      that already points at the parts: the polymorphic reference of the ledger (ADR-0009),
 *      the task history and the reservation column all carry field identifiers. The reply
 *      of the contract, `{ field, removedFieldIds }`, expresses either shape, and the one
 *      that keeps the trail is this one.
 */
function mergeIncompatible(field: FieldRecord, expected: FieldRecord): ApiError {
  return new ApiError(ValidationCode.FIELD_MERGE_INCOMPATIBLE, {
    entityKind: 'field',
    entityId: field.id,
    operation: 'MERGE',
    fromState: field.cropCycleState,
    allowedStates: [expected.cropCycleState],
  });
}

/** Cell count weighted mean of a basis point attribute, truncated. */
export function weightedBp(parts: readonly { readonly value: Bp; readonly weight: number }[]): Bp {
  let total = 0;
  let weight = 0;
  for (const part of parts) {
    total += part.value * part.weight;
    weight += part.weight;
  }
  return weight === 0 ? bp(0) : bp(Math.floor(total / weight));
}

/** The latest of a set of instants, or null when every one of them is null. */
function latestInstant(values: readonly (GameMs | null)[]): GameMs | null {
  let latest: GameMs | null = null;
  for (const value of values) {
    if (value !== null && (latest === null || value > latest)) {
      latest = value;
    }
  }
  return latest;
}

export async function mergeFields(
  services: ServiceContext,
  context: MutationContext,
  world: World,
  playerId: PlayerId,
  input: { readonly name: string; readonly fieldIds: readonly string[] },
): Promise<MergeFieldsOutcome> {
  const requested = [...new Set(input.fieldIds)];
  if (requested.length < 2) {
    throw new ApiError(ValidationCode.VALIDATION_FAILED, { field: 'fieldIds' });
  }

  const atGameMs = context.reading.gameNow;
  const fields: FieldRecord[] = [];
  for (const id of requested) {
    const loaded = await requireField(context.tx, playerId, id);
    requireIdleField(loaded);
    // Rule 2: compare what the field really is, not what the last job wrote.
    fields.push(await materializeProjectedPhase(context.tx, loaded, atGameMs));
  }

  const survivor = fields[0];
  if (survivor === undefined) {
    throw new ApiError(ValidationCode.VALIDATION_FAILED, { field: 'fieldIds' });
  }
  for (const field of fields) {
    if (
      field.cropCycleState !== survivor.cropCycleState ||
      field.cropId !== survivor.cropId ||
      field.soilCondition !== survivor.soilCondition ||
      field.farmId !== survivor.farmId
    ) {
      throw mergeIncompatible(field, survivor);
    }
  }

  const cellsByField = new Map<FieldId, readonly CellCoord[]>();
  for (const field of fields) {
    cellsByField.set(field.id, await fieldCells(context.tx, field.id));
  }
  const union = dedupeCells([...cellsByField.values()].flat());
  if (!isContiguous(union)) {
    throw new ApiError(ValidationCode.SELECTION_NOT_CONTIGUOUS, { cellCount: union.length });
  }

  // Rules 4 and 5: the attributes are settled to now before they are combined, so a part
  // that had been accruing weeds for longer contributes what it really accrued.
  const settledParts = fields.map((field) => ({
    field,
    weight: field.cellCount,
    settled: settleAttributes(field, atGameMs, cropOf(field.cropId)),
  }));
  const fertilityBp = weightedBp(
    settledParts.map((part) => ({ value: part.settled.fertilityBp, weight: part.weight })),
  );
  const weedLevelBp = weightedBp(
    settledParts.map((part) => ({ value: part.settled.weedLevelBp, weight: part.weight })),
  );
  const fertilizationBp = weightedBp(
    settledParts.map((part) => ({ value: part.settled.fertilizationBp, weight: part.weight })),
  );
  const seededAtGameMs = latestInstant(fields.map((field) => field.seededAtGameMs));

  const absorbed = fields.filter((field) => field.id !== survivor.id);
  // Step 3 of the canonical lock order of `lib/tx.ts`. The player row is already locked, so
  // no other transaction of this player can be here, but the order costs nothing and keeps
  // the convention mechanical.
  const absorbedById = new Map<string, FieldRecord>(absorbed.map((field) => [field.id, field]));
  for (const id of ascendingIds([...absorbedById.keys()])) {
    const field = absorbedById.get(id);
    if (field === undefined) {
      continue;
    }
    const cells = cellsByField.get(field.id) ?? [];
    await releaseFieldCells(services, context, world, playerId, cells);
    await cancelScheduledEventsFor(context.tx, context.outbox, playerId, FIELD_REF_TYPE, field.id);
    // Only the disposal instant is written. `cellCount` keeps the surface the field had when
    // it was absorbed, because `fields_geometry_check` of the initial migration demands a
    // positive count and, more to the point, a soft deleted row is a record of what the
    // entity was: the geometry it really owns is zero cells, and that is already stated by
    // `world_cells`, which now point at the survivor.
    await context.tx.field.update({
      where: { id: field.id },
      data: { disposedGameMs: atGameMs },
    });
  }

  const absorbedCells = absorbed.flatMap((field) => [...(cellsByField.get(field.id) ?? [])]);
  await claimCellsForField(services, context, world, playerId, survivor.id, absorbedCells);

  const row = await context.tx.field.update({
    where: { id: survivor.id },
    data: {
      name: input.name,
      cellCount: union.length,
      fertilityBp,
      fertilityUpdatedAtGameMs: atGameMs,
      weedLevelBp,
      weedLevelUpdatedAtGameMs: atGameMs,
      fertilizationBp,
      fertilizationUpdatedAtGameMs: atGameMs,
      seededAtGameMs,
    },
    select: FIELD_SELECT,
  });
  const merged = toFieldRecord(row);
  await syncPhaseSchedule(context.tx, context.outbox, context.reading, merged);

  return {
    field: merged,
    removedFieldIds: absorbed.map((field) => field.id),
    cells: union,
  };
}
