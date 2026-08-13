// The writing side of the task engine: assignment, completion and cancellation.
//
// Owner: workflow W6-A. Module `tasks`.
//
// This is the piece that turns everything the earlier workflows built into a game: without
// it no transition of a field can be executed (GDD section 87). Three write paths and one
// core:
//
//   `createTask`   the sequence of GDD section 104, the reservations and the scheduled end.
//   `completeTask` the handler of `TASK_COMPLETE` (GDD section 105).
//   `cancelTask`   the all or nothing interruption of GDD section 106.
//
// WHAT THE THREE SHARE, and why it is a shared core rather than three similar functions.
// Completion and cancellation both close a task, and closing a task means exactly five
// things: claim the row with a conditional transition, release the target, release the
// storage the task committed, apply the wear of the hours actually worked, and give the
// worker and the machines back. The two differ in three points and in no others: the
// instant they close at, whether the transition of the field is applied, and whether the
// worker's skill goes up. Writing them apart would be writing the release of a machine
// twice, and the day the two copies disagree is the day a cancelled task leaves a tractor
// marked as working for ever.
//
// IDEMPOTENCE IS THE CONDITIONAL TRANSITION AND NOTHING ELSE (plan section 6.3, defence 3).
// `UPDATE tasks SET status = ... WHERE id = ? AND status = 'IN_PROGRESS'` is the gate: the
// row count is the decision and every effect below lives inside the branch that won it.
// BullMQ delivers at least once, so a second delivery of the same completion claims nothing
// and applies nothing. The pieces below the gate are individually idempotent as well —
// `applyMachineWear` refuses to move a condition mark backwards, the releases are
// conditional on the identifier of this task, and the ledger entry of the waste carries
// `harvest:<taskId>` — but that is defence in depth and not the mechanism.
//
// WHAT THIS MODULE DOES NOT DO. It does not compute the crop cycle: `applyFieldOperation`
// of `modules/fields` owns the transition, the weed reset, the fertility drain and the
// yield. It does not compute the wear: `applyMachineWear` of `modules/machinery` owns it.
// It does not compute the skill: `applyTaskCompletion` of `modules/workers` owns it. It
// does not decide what fits in a silo: `depositStorage` of `modules/farms` owns it. What
// this module owns is the ORDER in which those happen and the row that ties them together
// (ADR-0040).
//
// THE ONE PLACE WHERE IT WRITES A TABLE OF ANOTHER MODULE is the reservation pair
// `Machine.status` and `Machine.currentTaskId`. ADR-0040 lists writing another module's
// tables among the alternatives it discards, and `modules/machinery` publishes
// `requireAssignableMachines` and `applyMachineWear` but no reserve and no release. The
// reservation therefore lives here, in one function per direction, both conditional updates
// whose row count is the decision (plan section 5.4). The discrepancy is recorded in
// `docs/handoff/NOTES-w6a.md`, item 3.2.

import { type MutationContext } from '../../lib/advancePlayer.js';
import { type ServiceContext } from '../../lib/context.js';
import { type DomainEventDraft } from '../../lib/events.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { harvestKey, scheduledEventDedupeKey } from '../../lib/ids.js';
import { recordNonMonetary } from '../../lib/ledger.js';
import { releaseCancelledTask } from '../../lib/moduleSeams.js';
import { type Outbox } from '../../lib/outbox.js';
import { cancelScheduledEventsFor, scheduleEvent } from '../../lib/scheduler.js';
import { ascendingIds, type PlayerLock, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  GameEventType,
  LedgerType,
  MachineStatus,
  NoticeKind,
  OPERATION_REQUIREMENTS,
  ScheduledEventKind,
  StorageResource,
  TaskStatus,
  ValidationCode,
  isApiError,
  toWireGameMs,
  type CropId,
  type GameMs,
  type MachineId,
  type PlayerId,
  type StorageResource as StorageResourceType,
} from '../../shared/index.js';
import { buildInventoryFarms } from '../economy/readModel.js';
import { buildFarmDto } from '../farms/readModel.js';
import {
  depositStorage,
  releaseStorageReservation,
  reserveStorage,
  storageCapacityError,
} from '../farms/service.js';
import {
  applyFieldOperation,
  fieldUpsertedFrame,
  findLiveField,
  type FieldRecord,
} from '../fields/service.js';
import { machineUpsertedFrame } from '../machinery/readModel.js';
import { findLiveMachine, type MachineRecord } from '../machinery/record.js';
import { applyMachineWear } from '../machinery/service.js';
import {
  applyTaskCompletion,
  findLiveWorker,
  releaseWorkerFromTask,
  reserveWorkerForTask,
  workerUpsertedFrame,
} from '../workers/service.js';
import {
  evaluateAssignment,
  firstBlocker,
  isFeasible,
  roleOfMachine,
  type AssignmentEvaluation,
  type AssignmentRequest,
} from './assignment.js';
import {
  TASK_REF_TYPE,
  findTask,
  loadRunningTasks,
  requireTask,
  taskUpsertedFrame,
  toTaskRecord,
  workedGameHours,
  TASK_SELECT,
  type TaskRecord,
} from './record.js';

// ---------------------------------------------------------------------------
// What a write path of this module needs
// ---------------------------------------------------------------------------

/**
 * The intersection of `MutationContext` and `ScheduledEventContext`.
 *
 * Both a request and a due event close a task, and they differ only in what else they
 * carry. Declaring the intersection is what lets one implementation serve the route and the
 * job without either of them being converted into the other.
 */
export interface TaskContext {
  readonly tx: Tx;
  readonly outbox: Outbox;
  readonly lock: PlayerLock;
  readonly reading: ClockReading;
  readonly services: ServiceContext;
  emit(...drafts: readonly DomainEventDraft[]): void;
}

// ---------------------------------------------------------------------------
// Assignment (GDD sections 91 and 104)
// ---------------------------------------------------------------------------

export interface CreateTaskOutcome {
  readonly task: TaskRecord;
  readonly evaluation: AssignmentEvaluation;
  readonly field: FieldRecord | null;
}

/**
 * Creates a task, or refuses the whole of it (GDD section 104).
 *
 * The six checks run first, as one evaluation, and the first refusal is thrown before any
 * row is written; nothing below can be reached with a combination the table of GDD section
 * 90 rejects. What comes after is only reservations, and every one of them is a conditional
 * update whose row count is the decision, so the race that the checks cannot see — two
 * requests naming the same tractor in the same millisecond — is refused by the database
 * with the same code the check would have produced (plan section 5.4, ADR-0018).
 *
 * A refusal at any point aborts the transaction, which is what "sin ejecucion parcial"
 * means: there is no compensating write anywhere in this function because there is nothing
 * to compensate.
 */
export async function createTask(
  ctx: MutationContext,
  request: AssignmentRequest,
): Promise<CreateTaskOutcome> {
  const { tx, reading, lock } = ctx;
  const playerId = lock.playerId;

  const evaluation = await evaluateAssignment(tx, playerId, reading, request);
  if (!isFeasible(evaluation)) {
    const blocker = firstBlocker(evaluation);
    throw blocker ?? new ApiError(ValidationCode.VALIDATION_FAILED, { field: 'body' });
  }

  const worker = evaluation.worker;
  if (worker === null) {
    // Unreachable: a feasible evaluation resolved its worker. Stated so the types do not
    // have to be widened for a case the checks above already excluded.
    throw new ApiError(ValidationCode.WORKER_NOT_IDLE, { entityId: request.workerId });
  }

  const created = await tx.task.create({
    data: {
      playerId,
      workerId: worker.id,
      operation: request.operation,
      status: TaskStatus.IN_PROGRESS,
      targetFieldId: evaluation.field?.id ?? null,
      targetForestPlotId: evaluation.plot?.id ?? null,
      destinationFarmId: evaluation.destinationFarm?.id ?? null,
      cropId: request.cropId ?? null,
      // Audit, and the divisor of the duration: GDD section 89 warns that the unit of
      // `workSpeed` will be recalculated, so a historical row stays reinterpretable only if
      // it keeps the figures the duration was fixed with (plan section 5.2).
      unitsAtStart: evaluation.units,
      effectiveWorkSpeedMilli: evaluation.duration.effectiveWorkSpeedMilli,
      reservedStorageUnits: evaluation.reservedStorageUnits,
      startGameMs: evaluation.startGameMs,
      scheduledEndGameMs: evaluation.scheduledEndGameMs,
      cancelable: true,
      // `Task.jobId` stays null on purpose. The identifier of the queue job is assigned
      // after the commit, by the dispatcher, and it already lives on the outbox row, which
      // is the authoritative one; a second copy here could not be written in this
      // transaction and would go stale at the next retiming, which reassigns every job
      // identifier with the new epoch (plan section 6.4). The cancellation retires the work
      // through `cancelScheduledEventsFor`, which reads it from the row that has it.
      machines: {
        create: evaluation.machines.map((machine) => ({
          machineId: machine.id,
          role: roleOfMachine(machine),
        })),
      },
    },
    select: TASK_SELECT,
  });
  const task = toTaskRecord(created);

  await reserveResources(tx, task, evaluation);

  await scheduleEvent(tx, ctx.outbox, reading, {
    playerId,
    kind: ScheduledEventKind.TASK_COMPLETE,
    dueGameMs: task.scheduledEndGameMs,
    refType: TASK_REF_TYPE,
    refId: task.id,
    dedupeKey: scheduledEventDedupeKey(ScheduledEventKind.TASK_COMPLETE, task.id),
  });

  const field =
    task.targetFieldId === null ? null : await findLiveField(tx, playerId, task.targetFieldId);

  ctx.emit(taskUpsertedFrame(task, reading.gameNow));
  if (field !== null) {
    ctx.emit(fieldUpsertedFrame(field, reading.gameNow, null));
  }
  for (const machine of await reloadMachines(tx, playerId, task.machineIds)) {
    ctx.emit(machineUpsertedFrame(machine));
  }
  const reservedWorker = await findLiveWorker(tx, playerId, task.workerId);
  if (reservedWorker !== null) {
    ctx.emit(workerUpsertedFrame(reservedWorker));
  }
  // The farm travels when, and only when, the assignment committed capacity in its store.
  // The occupancy the client draws is stored plus reserved (`modules/farms/service.ts`), so
  // a harvest that reserved twenty thousand litres and did not say so would leave the silo
  // gauge reporting room that is already spoken for. The contract does not list
  // `FARM_UPSERTED` among the events of this route, which is a gap of the declaration and
  // not of the behaviour (`docs/handoff/NOTES-w6a.md`, item 2.2).
  if (task.destinationFarmId !== null && (task.reservedStorageUnits ?? 0) > 0) {
    ctx.emit({
      type: GameEventType.FARM_UPSERTED,
      payload: { farm: await buildFarmDto(tx, task.destinationFarmId) },
    });
  }

  return { task, evaluation, field };
}

/**
 * Commits the worker, the machines, the target and the storage to the task.
 *
 * The order is the canonical lock order of `lib/tx.ts` applied to what this transaction
 * writes: the player row is already held by `withPlayerAdvanced`, and the domain rows are
 * taken by ascending identifier so two assignments naming the same two machines the other
 * way round cannot deadlock.
 */
async function reserveResources(
  tx: Tx,
  task: TaskRecord,
  evaluation: AssignmentEvaluation,
): Promise<void> {
  if (!(await reserveWorkerForTask(tx, task.workerId, task.id))) {
    throw new ApiError(ValidationCode.WORKER_NOT_IDLE, { entityId: task.workerId });
  }

  const byId = new Map(evaluation.machines.map((machine) => [machine.id, machine]));
  for (const machineId of ascendingIds([...byId.keys()])) {
    const reserved = await tx.machine.updateMany({
      where: {
        id: machineId,
        playerId: task.playerId,
        status: MachineStatus.IDLE,
        currentTaskId: null,
        disposedGameMs: null,
      },
      data: { status: MachineStatus.WORKING, currentTaskId: task.id },
    });
    if (reserved.count !== 1) {
      throw new ApiError(ValidationCode.MACHINE_NOT_IDLE, {
        entityId: machineId,
        entityKind: byId.get(machineId)?.type ?? 'MACHINE',
      });
    }
  }

  if (task.targetFieldId !== null) {
    const claimed = await tx.field.updateMany({
      where: { id: task.targetFieldId, currentTaskId: null, disposedGameMs: null },
      data: { currentTaskId: task.id },
    });
    if (claimed.count !== 1) {
      throw new ApiError(ValidationCode.FIELD_HAS_ACTIVE_TASK, {
        entityKind: 'field',
        entityId: task.targetFieldId,
      });
    }
  }

  if (task.targetForestPlotId !== null) {
    const claimed = await tx.forestPlot.updateMany({
      where: { id: task.targetForestPlotId, currentTaskId: null, disposedGameMs: null },
      data: { currentTaskId: task.id },
    });
    if (claimed.count !== 1) {
      throw new ApiError(ValidationCode.FIELD_HAS_ACTIVE_TASK, {
        entityKind: 'forestPlot',
        entityId: task.targetForestPlotId,
      });
    }
  }

  const resource = evaluation.storageResource;
  const units = task.reservedStorageUnits;
  if (resource !== null && task.destinationFarmId !== null && units !== null && units > 0) {
    const outcome = await reserveStorage(tx, task.destinationFarmId, resource, units);
    if (!outcome.ok) {
      throw storageCapacityError(resource, outcome.usage, units);
    }
  }
}

// ---------------------------------------------------------------------------
// The shared core of closing a task
// ---------------------------------------------------------------------------

/** What closing a task did, whichever way it was closed. */
export interface TaskClosure {
  readonly task: TaskRecord;
  readonly machines: readonly MachineRecord[];
  readonly endedGameMs: GameMs;
  readonly workedGameHours: number;
}

/**
 * Claims the task with the conditional transition and returns the reloaded row, or null
 * when there was nothing to claim.
 *
 * Null is the normal answer to a second delivery of the same completion and to a
 * cancellation that raced with the due instant, and it is not an error in either case.
 */
async function claimTask(
  tx: Tx,
  task: TaskRecord,
  status: typeof TaskStatus.COMPLETED | typeof TaskStatus.CANCELED,
  endedGameMs: GameMs,
): Promise<TaskRecord | null> {
  const claimed = await tx.task.updateMany({
    where: { id: task.id, status: TaskStatus.IN_PROGRESS },
    data: { status, endedGameMs },
  });
  if (claimed.count === 0) {
    return null;
  }
  const row = await tx.task.findUnique({ where: { id: task.id }, select: TASK_SELECT });
  return row === null ? null : toTaskRecord(row);
}

/** Gives the target back, so the panel offers its operations again (GDD sections 105 and 106). */
async function releaseTarget(tx: Tx, task: TaskRecord): Promise<void> {
  if (task.targetFieldId !== null) {
    await tx.field.updateMany({
      where: { id: task.targetFieldId, currentTaskId: task.id },
      data: { currentTaskId: null },
    });
  }
  if (task.targetForestPlotId !== null) {
    await tx.forestPlot.updateMany({
      where: { id: task.targetForestPlotId, currentTaskId: task.id },
      data: { currentTaskId: null },
    });
  }
}

/**
 * Wears the machines over the hours actually worked and gives them back (GDD section 93).
 *
 * The hours are `[startGameMs, endedGameMs)`, which is exactly the interval `lib/accrual.ts`
 * integrates the operating cost over, so the hours that wear a machine and the hours it is
 * billed for are the same hours by construction and not by coincidence (ADR-0040). A
 * cancellation therefore prorates the wear without any code of its own: it closes at a
 * different instant and the same call does the rest.
 */
async function wearAndRelease(
  tx: Tx,
  task: TaskRecord,
  endedGameMs: GameMs,
): Promise<readonly MachineRecord[]> {
  const hours = workedGameHours(task, endedGameMs);
  await applyMachineWear(tx, [...task.machineIds], hours, endedGameMs);
  const released: MachineRecord[] = [];
  for (const machineId of ascendingIds([...task.machineIds])) {
    await tx.machine.updateMany({
      where: { id: machineId, currentTaskId: task.id },
      data: { status: MachineStatus.IDLE, currentTaskId: null },
    });
    const reloaded = await findLiveMachine(tx, task.playerId, machineId);
    if (reloaded !== null) {
      released.push(reloaded);
    }
  }
  return released;
}

/** The machines of a task as they stand, for the frames of the assignment path. */
async function reloadMachines(
  tx: Tx,
  playerId: PlayerId,
  machineIds: readonly MachineId[],
): Promise<readonly MachineRecord[]> {
  const machines: MachineRecord[] = [];
  for (const machineId of machineIds) {
    const machine = await findLiveMachine(tx, playerId, machineId);
    if (machine !== null) {
      machines.push(machine);
    }
  }
  return machines;
}

// ---------------------------------------------------------------------------
// Completion (GDD section 105)
// ---------------------------------------------------------------------------

export interface CompleteTaskOutcome extends TaskClosure {
  readonly field: FieldRecord | null;
  readonly producedUnits: number | null;
  readonly storedUnits: number;
  readonly wastedUnits: number;
  readonly skillBefore: number | null;
  readonly skillAfter: number | null;
}

/**
 * Completes a task (GDD section 105): the target advances, the produce is stored, the wear
 * is applied, the skill goes up and the worker and the machines go back to idle.
 *
 * The worker is NOT reassigned. GDD section 105 says so outright, and it is what feeds the
 * return summary of GDD section 68: "Field #12 finished plowing. Worker #7 is idle".
 *
 * `atGameMs` is the due instant of the event and never the current one, so a job that ran
 * late places the change where it happened rather than where it was noticed (plan section
 * 6.4). That is also what makes the reconciliation path of a worker that was down produce
 * exactly the same rows as a punctual run.
 */
export async function completeTask(
  ctx: TaskContext,
  task: TaskRecord,
  atGameMs: GameMs,
): Promise<CompleteTaskOutcome | null> {
  const { tx, lock } = ctx;
  const playerId = lock.playerId;

  const closed = await claimTask(tx, task, TaskStatus.COMPLETED, atGameMs);
  if (closed === null) {
    return null;
  }

  // The target is freed before the transition is applied, so the field the frame carries
  // already offers its next operations and the panel needs no second request.
  await releaseTarget(tx, closed);

  const applied = await applyTargetTransition(ctx, closed, atGameMs);
  const deposit = await depositProduce(ctx, closed, applied.producedUnits);

  const machines = await wearAndRelease(tx, closed, atGameMs);

  const worker = await findLiveWorker(tx, playerId, closed.workerId);
  const skillBefore = worker?.skillBp ?? null;
  // Skill, counter and release in one call, so a completion cannot apply one without the
  // others (GDD sections 103, 105 and 110).
  const advancedWorker = worker === null ? null : await applyTaskCompletion(tx, worker, closed.id);

  ctx.emit(taskUpsertedFrame(closed, atGameMs));
  if (applied.field !== null) {
    ctx.emit(fieldUpsertedFrame(applied.field, atGameMs, null));
  }
  for (const machine of machines) {
    ctx.emit(machineUpsertedFrame(machine));
  }
  if (advancedWorker !== null) {
    ctx.emit(workerUpsertedFrame(advancedWorker));
  }
  await emitStorageFrames(ctx, closed, deposit.wastedUnits, atGameMs);

  return {
    task: closed,
    machines,
    endedGameMs: atGameMs,
    workedGameHours: workedGameHours(closed, atGameMs),
    field: applied.field,
    producedUnits: applied.producedUnits,
    storedUnits: deposit.storedUnits,
    wastedUnits: deposit.wastedUnits,
    skillBefore,
    skillAfter: advancedWorker?.skillBp ?? null,
  };
}

/**
 * Applies the transition of the target and returns what it produced.
 *
 * The whole of the crop cycle is `applyFieldOperation` of `modules/fields`: the state
 * machine of GDD section 76, the weed reset of GDD section 78, the fertility drain of GDD
 * section 77 and the yield of GDD section 83. This module supplies the instant and the
 * operation and takes the litres.
 *
 * A refusal from the state machine is caught and logged rather than thrown. The reason is
 * the shape of the queue and not indifference: the event was claimed by the point of
 * advance before the handler ran, so a throw would roll the claim back and turn the
 * vencimiento into an endless BullMQ retry (ADR-0016). It should be unreachable — the field
 * is reserved for the whole task and the only automatic transitions are the timed ones,
 * which never leave a state that admitted the operation — and if it ever happens the task
 * still closes, the resources still come back, and the notice says the transition did not
 * apply.
 */
async function applyTargetTransition(
  ctx: TaskContext,
  task: TaskRecord,
  atGameMs: GameMs,
): Promise<{ readonly field: FieldRecord | null; readonly producedUnits: number | null }> {
  if (task.targetFieldId === null) {
    return { field: null, producedUnits: null };
  }
  const field = await findLiveField(ctx.tx, task.playerId, task.targetFieldId);
  if (field === null) {
    return { field: null, producedUnits: null };
  }
  try {
    const outcome = await applyFieldOperation(
      ctx.tx,
      ctx.outbox,
      ctx.reading,
      field,
      { operation: task.operation, cropId: task.cropId as CropId | null },
      atGameMs,
    );
    return { field: outcome.field, producedUnits: outcome.harvestedLiters };
  } catch (error) {
    if (!isApiError(error)) {
      throw error;
    }
    ctx.services.logger.warn(
      {
        taskId: task.id,
        fieldId: task.targetFieldId,
        operation: task.operation,
        code: error.code,
        playerId: task.playerId,
      },
      'the state of the field no longer admitted the operation when the task completed',
    );
    ctx.emit({
      type: GameEventType.NOTICE,
      payload: {
        notice: {
          kind: NoticeKind.GENERIC,
          severity: 'WARNING',
          code: error.code,
          message:
            'La tarea termino pero el estado del campo ya no admitia la operacion, ' +
            'de modo que la transicion no se aplico.',
          details: { taskId: task.id, operation: task.operation },
          atGameMs: toWireGameMs(atGameMs),
          subjectType: 'FIELD',
          subjectId: task.targetFieldId,
        },
      },
    });
    return { field, producedUnits: null };
  }
}

/**
 * Puts the produce in the store, filling to capacity and wasting the rest (GDD sections 83
 * and 97, plan section 2.2).
 *
 * `depositStorage` is a single bounded statement that computes what fits against the row it
 * is updating, so it cannot violate the capacity `CHECK` whatever it is asked for. That
 * property is what makes it safe here: this runs inside a completion job, and a constraint
 * violation there would be retried for ever (plan section 5.4).
 *
 * The reservation the task made is released in the same statement, so the room the harvest
 * kept for itself is exactly the room it may now occupy.
 */
async function depositProduce(
  ctx: TaskContext,
  task: TaskRecord,
  producedUnits: number | null,
): Promise<{ readonly storedUnits: number; readonly wastedUnits: number }> {
  const resource = storageResourceOf(task);
  const farmId = task.destinationFarmId;
  const reserved = task.reservedStorageUnits ?? 0;

  if (resource === null || farmId === null) {
    return { storedUnits: 0, wastedUnits: 0 };
  }
  if (producedUnits === null || producedUnits <= 0) {
    if (reserved > 0) {
      await releaseStorageReservation(ctx.tx, farmId, resource, reserved);
    }
    return { storedUnits: 0, wastedUnits: 0 };
  }

  const deposit = await depositStorage(ctx.tx, farmId, resource, producedUnits, {
    releaseReservedUnits: reserved,
  });
  if (deposit.wastedUnits > 0) {
    // A non monetary entry: no money moves, and the return summary needs to be able to say
    // that grain was lost and how much (plan section 2.2, resolution of GDD sections 83 and
    // 97). The key is `harvest:<taskId>`, which is unique by construction.
    await recordNonMonetary(ctx.tx, ctx.lock, {
      type: LedgerType.HARVEST_WASTE,
      atGameMs: task.endedGameMs ?? task.scheduledEndGameMs,
      atRealMs: ctx.reading.atRealMs,
      idempotencyKey: harvestKey(task.id),
      refType: TASK_REF_TYPE,
      refId: task.id,
      meta: {
        resource,
        producedUnits,
        acceptedUnits: deposit.acceptedUnits,
        wastedUnits: deposit.wastedUnits,
        farmId,
        gddSection: 83,
      },
    });
    ctx.services.metrics.ledgerEntries.inc({ type: LedgerType.HARVEST_WASTE });
  }
  return { storedUnits: deposit.acceptedUnits, wastedUnits: deposit.wastedUnits };
}

/** The stock and the farm frames a completion produces, plus the notice of an overflow. */
async function emitStorageFrames(
  ctx: TaskContext,
  task: TaskRecord,
  wastedUnits: number,
  atGameMs: GameMs,
): Promise<void> {
  const farmId = task.destinationFarmId;
  if (farmId === null) {
    return;
  }
  const inventory = await buildInventoryFarms(ctx.tx, task.playerId);
  if (inventory.length > 0) {
    ctx.emit({ type: GameEventType.INVENTORY_UPSERTED, payload: { farms: [...inventory] } });
  }
  ctx.emit({
    type: GameEventType.FARM_UPSERTED,
    payload: { farm: await buildFarmDto(ctx.tx, farmId) },
  });
  if (wastedUnits <= 0) {
    return;
  }
  const resource = storageResourceOf(task);
  ctx.emit({
    type: GameEventType.NOTICE,
    payload: {
      notice: {
        kind:
          resource === StorageResource.WOOD_M3
            ? NoticeKind.WOOD_OVERFLOW
            : NoticeKind.HARVEST_OVERFLOW,
        severity: 'WARNING',
        code: null,
        message: `El almacen se lleno y se perdieron ${wastedUnits} unidades de la produccion.`,
        details: { wastedUnits, farmId, taskId: task.id },
        atGameMs: toWireGameMs(atGameMs),
        subjectType: 'FARM',
        subjectId: farmId,
      },
    },
  });
}

/**
 * The store a task feeds, read from the requirement table of GDD section 90 and never
 * restated, so a change of the catalogue moves the reservation, the deposit and the release
 * together.
 */
function storageResourceOf(task: TaskRecord): StorageResourceType | null {
  return OPERATION_REQUIREMENTS[task.operation].requiresStorage;
}

// ---------------------------------------------------------------------------
// Cancellation (GDD section 106)
// ---------------------------------------------------------------------------

export interface CancelTaskOutcome extends TaskClosure {
  readonly releasedStorageUnits: number | null;
}

/**
 * Cancels a running task: all or nothing (GDD section 106).
 *
 * What GDD section 106 states, and what plan section 2.2 resolves of what it leaves open:
 *
 *   - The field stays in the state it was in before, and the partial progress is lost.
 *     There is literally nothing to do for that: the transition is applied at completion
 *     and only at completion, so a cancelled task never touched the field.
 *   - The worker and the machines go back to idle, without the skill increment: the task
 *     was not completed.
 *   - Nothing is refunded. The operating cost already accrued stays accrued, and closing
 *     the task at this instant is what stops it: `lib/accrual.ts` integrates over
 *     `[start, coalesce(endedGameMs, scheduledEndGameMs))`, and the accruals of this player
 *     were settled up to now by the advance that wraps this call, so the charge is exact.
 *   - The wear is prorated over the hours actually worked, by the same call the completion
 *     uses with a different instant.
 *   - The scheduled work is retired by its identifier, so no orphan alarm clock survives.
 */
export async function cancelTask(
  ctx: TaskContext,
  task: TaskRecord,
  atGameMs: GameMs,
): Promise<CancelTaskOutcome | null> {
  const { tx, lock } = ctx;
  const playerId = lock.playerId;

  // `tasks_interval_check` demands an end at or after the start, and a task assigned in
  // this very millisecond is legitimately cancellable.
  const endedGameMs = atGameMs < task.startGameMs ? task.startGameMs : atGameMs;

  const closed = await claimTask(tx, task, TaskStatus.CANCELED, endedGameMs);
  if (closed === null) {
    return null;
  }

  await releaseTarget(tx, closed);

  const resource = storageResourceOf(closed);
  const reserved = closed.reservedStorageUnits;
  let released: number | null = null;
  if (resource !== null && closed.destinationFarmId !== null && reserved !== null && reserved > 0) {
    await releaseStorageReservation(tx, closed.destinationFarmId, resource, reserved);
    released = reserved;
  }

  const machines = await wearAndRelease(tx, closed, endedGameMs);
  await releaseWorkerFromTask(tx, closed.workerId, closed.id);

  // The alarm clock and its outbox row. Cancelling the row is what makes the completion
  // unreachable even if the job survives in Redis: the handler would find nothing pending.
  await cancelScheduledEventsFor(tx, ctx.outbox, playerId, TASK_REF_TYPE, closed.id);

  // What a cancellation leaves behind inside a module this one may not import. Today the only
  // strategy is the forestry one, which gives the trees of a cancelled felling back as
  // standing: `MARKED_FOR_HARVEST` is how the batch remembers its area (ADR-0050), and rule 4
  // of plan section 11 keeps the two modules apart because they are siblings of the same
  // phase. The registry lives in `lib/moduleSeams.ts` and `src/handlers.ts` fills it, so it is
  // installed in the server and in the queue process alike
  // (docs/handoff/NOTES-w6c.md 2.2). With no strategy registered this is a no-op.
  const releaseFrames = await releaseCancelledTask(tx, ctx.outbox, closed, endedGameMs);

  const field =
    closed.targetFieldId === null ? null : await findLiveField(tx, playerId, closed.targetFieldId);
  const worker = await findLiveWorker(tx, playerId, closed.workerId);

  ctx.emit(taskUpsertedFrame(closed, endedGameMs));
  if (field !== null) {
    ctx.emit(fieldUpsertedFrame(field, endedGameMs, null));
  }
  for (const machine of machines) {
    ctx.emit(machineUpsertedFrame(machine));
  }
  if (worker !== null) {
    ctx.emit(workerUpsertedFrame(worker));
  }
  if (released !== null && closed.destinationFarmId !== null) {
    ctx.emit({
      type: GameEventType.FARM_UPSERTED,
      payload: { farm: await buildFarmDto(tx, closed.destinationFarmId) },
    });
  }
  ctx.emit(...releaseFrames);

  return {
    task: closed,
    machines,
    endedGameMs,
    workedGameHours: workedGameHours(closed, endedGameMs),
    releasedStorageUnits: released,
  };
}

/** The route form: loads the task, applies the two refusals of the contract, cancels it. */
export async function cancelTaskById(
  ctx: MutationContext,
  taskId: string,
): Promise<CancelTaskOutcome> {
  const task = await requireTask(ctx.tx, ctx.lock.playerId, taskId);
  if (task.status !== TaskStatus.IN_PROGRESS) {
    throw new ApiError(ValidationCode.TASK_ALREADY_FINISHED, {
      entityId: task.id,
      actual: task.status,
    });
  }
  if (!task.cancelable) {
    throw new ApiError(ValidationCode.TASK_NOT_CANCELABLE, { entityId: task.id });
  }
  const outcome = await cancelTask(ctx, task, ctx.reading.gameNow);
  if (outcome === null) {
    // The completion event fell due between the advance and this write. The task is
    // finished, and saying so is better than reporting a cancellation that did not happen.
    throw new ApiError(ValidationCode.TASK_ALREADY_FINISHED, { entityId: task.id });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// The `CANCEL_TASKS` step of the forced liquidation (plan section 6.6)
// ---------------------------------------------------------------------------

/**
 * Cancels every running task of a player, which is the third step of the published
 * liquidation order of `shared/config/economy.ts`.
 *
 * The step that `modules/economy` declares and leaves without a strategy, because its
 * semantics are the prorated wear, the release of the storage reservation and the retirement
 * of the queued work, and all three belong here (ADR-0039, `docs/handoff/NOTES-w5c.md` item
 * 2.4). It frees no money by itself: what it does is stop the operating cost of GDD section
 * 94 and hand the machinery back, which is what lets the steps after it act on assets that
 * were reserved a moment earlier.
 *
 * It is not bounded by the debt, for the same reason the `WORKERS` step is not: cancelling
 * one task recovers nothing, so a stopping rule based on the balance would cancel the whole
 * board one row at a time anyway.
 *
 * `modules/economy` cannot call this until its `STEP_PLAN` names it, which is a two line
 * change in a file this workflow does not own; the patch is in `docs/handoff/NOTES-w6a.md`,
 * item 2.1.
 */
export async function cancelTasksForLiquidation(
  ctx: TaskContext,
  atGameMs: GameMs,
): Promise<readonly CancelTaskOutcome[]> {
  const running = await loadRunningTasks(ctx.tx, ctx.lock.playerId);
  const cancelled: CancelTaskOutcome[] = [];
  for (const task of running) {
    const outcome = await cancelTask(ctx, task, atGameMs);
    if (outcome !== null) {
      cancelled.push(outcome);
    }
  }
  return cancelled;
}

// ---------------------------------------------------------------------------
// Reading helpers the routes and the job share
// ---------------------------------------------------------------------------

/** The task a due event points at, or null when it no longer exists (ADR-0016). */
export async function taskOfEvent(
  tx: Tx,
  playerId: PlayerId,
  refId: string | null,
): Promise<TaskRecord | null> {
  if (refId === null) {
    return null;
  }
  return findTask(tx, playerId, refId);
}
