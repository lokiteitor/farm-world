// The internal API of the workers module: the payroll, the hiring pool and the two
// transitions that move a worker in and out of it.
//
// Owner: workflow W5-B. Module `workers`.
//
// Four rules of GDD sections 100 to 112 are implemented here and nowhere else, so that the
// task engine of workflow W6-A consumes them instead of restating them:
//
//   1. Housing is a hard restriction (GDD section 108). The free slot is asked of
//      `modules/farms/service.ts`, which is the module that owns the counters and their
//      `CHECK`; this module never counts occupants itself. Two readings of "is there room"
//      is how two callers end up disagreeing (ADR-0018).
//   2. Only an idle worker can be dismissed (GDD section 109). The row is not deleted: it
//      survives with `terminatedGameMs`, which closes the validity interval the wage accrual
//      of plan section 6.2 integrates over and keeps every past ledger entry pointing at
//      something (ADR-0009).
//   3. A worker belongs to a farm through the home he lives in (GDD sections 101 and 108), so
//      he cannot operate machinery of another farm. `requireWorkerOfFarm` is that check, and
//      the trigger `task_machines_farm_guard` of the initial migration is its safety net.
//   4. Skill progresses by one point per completed task up to a ceiling (GDD sections 103,
//      105 and 110). `applyTaskCompletion` is the whole of it, written for the completion
//      handler of workflow W6-A.
//
// What this module deliberately does not do. It moves no money: neither GDD section 102 nor
// GDD section 109 defines a hiring fee or a severance payment, so hiring and dismissal write
// no ledger entry and carry no idempotency key, which is exactly what the contract declares.
// The only economic effect of a hire is that a new source of continuous cost starts, and the
// accrual of `lib/accrual.ts` picks it up from the validity interval without being told.
//
// The one money check that does exist is the one GDD section 102 asks for, "validar dinero",
// read as the debt policy of plan section 6.6: committing to a salary is discretionary
// spending, and a negative settled balance blocks it. That is a rule of the return path out
// of debt, not an invented hiring fee: selling and assigning tasks stay available because
// they are the only way out.

import { type MutationContext } from '../../lib/advancePlayer.js';
import { toBp, toGameMs, toGameMsOrNull, toMoney, type DecimalLike } from '../../lib/dbMap.js';
import { type DomainEventDraft } from '../../lib/events.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { scheduledEventDedupeKey } from '../../lib/ids.js';
import { type Outbox } from '../../lib/outbox.js';
import { scheduleEvent } from '../../lib/scheduler.js';
import { type Db, type Tx } from '../../lib/tx.js';
import {
  ApiError,
  BuildingType,
  Money,
  POOL_REFRESH_INTERVAL_GAME_HOURS,
  POOL_SIZE,
  ScheduledEventKind,
  ScheduledEventStatus,
  ValidationCode,
  WorkerStatus,
  addGameMs,
  capacityExceeded,
  gameHoursToGameMs,
  holdingRatePerGameHour,
  notFound,
  notOwned,
  overlapGameMs,
  skillAfterTask,
  skillFactor,
  spendingBlockedInDebt,
  toWireGameMs,
  toWireMoney,
  type Bp,
  type BuildingId,
  type FarmId,
  type GameInterval,
  type GameMs,
  type PlayerId,
  type TaskId,
  type WorkerCandidateDto,
  type WorkerCandidateId,
  type WorkerDto,
  type WorkerId,
  type WorkerPoolReply,
  type WorkersReply,
} from '../../shared/index.js';
import { withConstraintTranslation } from '../farms/constraints.js';
import { toBuildingDto } from '../farms/readModel.js';
import { buildingsWithFreeSlot, loadBuildings, requireFarm } from '../farms/service.js';
import { generatePool } from './pool.js';

// ---------------------------------------------------------------------------
// Vocabulary of this module
// ---------------------------------------------------------------------------

/** Reference type of a scheduled event that belongs to the hiring pool of a player. */
export const POOL_REF_TYPE = 'WORKER_POOL';

/**
 * The refresh interval of GDD section 102 as a duration in game milliseconds, which is the
 * unit every stored instant of the project uses.
 */
export const POOL_REFRESH_INTERVAL_GAME_MS: bigint = gameHoursToGameMs(
  POOL_REFRESH_INTERVAL_GAME_HOURS,
);

/**
 * The two statuses the MVP produces (GDD sections 35 and 112).
 *
 * `TRAVELING`, `UNAVAILABLE`, `RESTING` and `INJURED` exist in the enum and are never
 * written. They are reserved on purpose and not omitted: migrating an enum in Prisma is far
 * more awkward than reserving a value, and GDD sections 35, 101 and 112 name all four as
 * future states (plan section 5.2).
 */
export const ACTIVE_WORKER_STATUSES: readonly WorkerStatus[] = [
  WorkerStatus.IDLE,
  WorkerStatus.WORKING,
];

/** The four statuses the MVP reserves without producing them. */
export const RESERVED_WORKER_STATUSES: readonly WorkerStatus[] = [
  WorkerStatus.TRAVELING,
  WorkerStatus.UNAVAILABLE,
  WorkerStatus.RESTING,
  WorkerStatus.INJURED,
];

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

const WORKER_SELECT = {
  id: true,
  playerId: true,
  farmId: true,
  homeId: true,
  name: true,
  skillBp: true,
  salaryPerGameHour: true,
  status: true,
  currentTaskId: true,
  completedTaskCount: true,
  hiredGameMs: true,
  terminatedGameMs: true,
} as const;

const CANDIDATE_SELECT = {
  id: true,
  playerId: true,
  region: true,
  name: true,
  skillBp: true,
  askingSalaryPerGameHour: true,
  listedAtGameMs: true,
  removedGameMs: true,
} as const;

/** A worker row in the units of the domain rather than of the driver. */
export interface WorkerRecord {
  readonly id: WorkerId;
  readonly playerId: PlayerId;
  readonly farmId: FarmId;
  readonly homeId: BuildingId;
  readonly name: string;
  readonly skillBp: Bp;
  readonly salaryPerGameHour: Money;
  readonly status: WorkerStatus;
  readonly currentTaskId: TaskId | null;
  readonly completedTaskCount: number;
  readonly hiredGameMs: GameMs;
  readonly terminatedGameMs: GameMs | null;
}

/** A candidate row in the units of the domain. */
export interface CandidateRecord {
  readonly id: WorkerCandidateId;
  readonly playerId: PlayerId;
  readonly region: string | null;
  readonly name: string;
  readonly skillBp: Bp;
  readonly askingSalaryPerGameHour: Money;
  readonly listedAtGameMs: GameMs;
  readonly removedGameMs: GameMs | null;
}

/**
 * The shapes the two `select` above produce, written structurally.
 *
 * Structural and not imported from the generated client, because the ESLint zones stop a
 * domain module from reaching `src/generated`, which is the same restriction that made
 * `lib/dbMap.ts` publish `DecimalLike` in the first place.
 */
interface WorkerRow {
  readonly id: string;
  readonly playerId: string;
  readonly farmId: string;
  readonly homeId: string;
  readonly name: string;
  readonly skillBp: number;
  readonly salaryPerGameHour: DecimalLike;
  readonly status: WorkerStatus;
  readonly currentTaskId: string | null;
  readonly completedTaskCount: number;
  readonly hiredGameMs: bigint;
  readonly terminatedGameMs: bigint | null;
}

interface CandidateRow {
  readonly id: string;
  readonly playerId: string;
  readonly region: string | null;
  readonly name: string;
  readonly skillBp: number;
  readonly askingSalaryPerGameHour: DecimalLike;
  readonly listedAtGameMs: bigint;
  readonly removedGameMs: bigint | null;
}

export function toWorkerRecord(row: WorkerRow): WorkerRecord {
  return {
    id: row.id as WorkerId,
    playerId: row.playerId as PlayerId,
    farmId: row.farmId as FarmId,
    homeId: row.homeId as BuildingId,
    name: row.name,
    skillBp: toBp(row.skillBp),
    salaryPerGameHour: toMoney(row.salaryPerGameHour),
    status: row.status,
    currentTaskId: row.currentTaskId === null ? null : (row.currentTaskId as TaskId),
    completedTaskCount: row.completedTaskCount,
    hiredGameMs: toGameMs(row.hiredGameMs),
    terminatedGameMs: toGameMsOrNull(row.terminatedGameMs),
  };
}

export function toCandidateRecord(row: CandidateRow): CandidateRecord {
  return {
    id: row.id as WorkerCandidateId,
    playerId: row.playerId as PlayerId,
    region: row.region,
    name: row.name,
    skillBp: toBp(row.skillBp),
    askingSalaryPerGameHour: toMoney(row.askingSalaryPerGameHour),
    listedAtGameMs: toGameMs(row.listedAtGameMs),
    removedGameMs: toGameMsOrNull(row.removedGameMs),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The live payroll of a player, oldest hire first. */
export async function loadPlayerWorkers(
  db: Db,
  playerId: PlayerId,
): Promise<readonly WorkerRecord[]> {
  const rows = await db.worker.findMany({
    where: { playerId, terminatedGameMs: null },
    orderBy: [{ hiredGameMs: 'asc' }, { id: 'asc' }],
    select: WORKER_SELECT,
  });
  return rows.map(toWorkerRecord);
}

/** The live workers of one farm, which is the set a task assignment may choose from. */
export async function loadFarmWorkers(db: Db, farmId: string): Promise<readonly WorkerRecord[]> {
  const rows = await db.worker.findMany({
    where: { farmId, terminatedGameMs: null },
    orderBy: [{ hiredGameMs: 'asc' }, { id: 'asc' }],
    select: WORKER_SELECT,
  });
  return rows.map(toWorkerRecord);
}

/** A live worker of a player, or null. Never throws, for the paths that tolerate absence. */
export async function findLiveWorker(
  db: Db,
  playerId: PlayerId,
  workerId: string,
): Promise<WorkerRecord | null> {
  const row = await db.worker.findUnique({ where: { id: workerId }, select: WORKER_SELECT });
  if (row === null || row.terminatedGameMs !== null || row.playerId !== playerId) {
    return null;
  }
  return toWorkerRecord(row);
}

/**
 * A live worker of the player, or the contract error that says why not.
 *
 * A worker of another player is a 403 and not a 404, for the same reason as in
 * `modules/farms`: the identifier is not a secret, and hiding the difference would make an
 * interface bug indistinguishable from a permission problem.
 */
export async function requireWorker(
  db: Db,
  playerId: PlayerId,
  workerId: string,
): Promise<WorkerRecord> {
  const row = await db.worker.findUnique({ where: { id: workerId }, select: WORKER_SELECT });
  if (row === null || row.terminatedGameMs !== null) {
    throw notFound('Worker', workerId);
  }
  if (row.playerId !== playerId) {
    throw notOwned('Worker', workerId);
  }
  return toWorkerRecord(row);
}

/** The candidates a player may hire right now (GDD section 102). */
export async function loadListedCandidates(
  db: Db,
  playerId: PlayerId,
): Promise<readonly CandidateRecord[]> {
  const rows = await db.workerCandidate.findMany({
    where: { playerId, removedGameMs: null },
    orderBy: [{ listedAtGameMs: 'asc' }, { id: 'asc' }],
    select: CANDIDATE_SELECT,
  });
  return rows.map(toCandidateRecord);
}

/** The instant the pool of a player is refreshed next, or null when none is scheduled. */
export async function nextPoolRefreshAt(db: Db, playerId: PlayerId): Promise<GameMs | null> {
  const row = await db.scheduledEvent.findFirst({
    where: {
      playerId,
      kind: ScheduledEventKind.WORKER_POOL_REFRESH,
      status: ScheduledEventStatus.PENDING,
    },
    orderBy: { dueGameMs: 'asc' },
    select: { dueGameMs: true },
  });
  return row === null ? null : toGameMs(row.dueGameMs);
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/** A worker as the contract carries it, with `skillFactor` derived (GDD section 103). */
export function toWorkerDto(worker: WorkerRecord): WorkerDto {
  return {
    id: worker.id,
    farmId: worker.farmId,
    homeId: worker.homeId,
    name: worker.name,
    skillBp: worker.skillBp,
    salaryPerGameHour: toWireMoney(worker.salaryPerGameHour),
    status: worker.status,
    currentTaskId: worker.currentTaskId,
    completedTaskCount: worker.completedTaskCount,
    hiredGameMs: toWireGameMs(worker.hiredGameMs),
    // Derived and never stored: the formula is the shared rule of GDD section 103, with its
    // floor of 0.5, so the client renders the same factor the duration calculation applies.
    skillFactor: skillFactor(worker.skillBp),
  };
}

/** A candidate as the contract carries it. `region` stays out: it is reserved, always null. */
export function toCandidateDto(candidate: CandidateRecord): WorkerCandidateDto {
  return {
    id: candidate.id,
    name: candidate.name,
    skillBp: candidate.skillBp,
    askingSalaryPerGameHour: toWireMoney(candidate.askingSalaryPerGameHour),
    listedAtGameMs: toWireGameMs(candidate.listedAtGameMs),
    skillFactor: skillFactor(candidate.skillBp),
  };
}

/**
 * The wage term of the hourly cost of GDD section 107.
 *
 * Computed with the shared rule and not with a local sum, so that the figure the payroll
 * panel shows and the figure the accrual charges come from one formula. The machine list is
 * empty because maintenance and operation belong to `modules/machinery`, which is a sibling
 * of this phase and is not imported (plan section 11, rule 4).
 */
export function payrollPerGameHour(workers: readonly WorkerRecord[]): Money {
  return holdingRatePerGameHour({
    workers: workers.map((worker) => ({ salaryPerGameHour: worker.salaryPerGameHour })),
    machines: [],
  }).wagesPerGameHour;
}

/**
 * Home slots of the whole holding, which is what `homeSlotsUsed` and `homeSlotsTotal` mean
 * in the three replies of this area.
 *
 * Player wide and not per farm, in all three, because the field carries the same name in all
 * of them and a field that meant the farm in one reply and the holding in another is the
 * kind of ambiguity a client resolves wrongly exactly once. The per farm reading is already
 * available from `GET /api/farms`, and the `BUILDING_UPSERTED` frame that a hire and a
 * dismissal emit carries the occupancy of the home that actually changed.
 */
export async function homeSlots(
  db: Db,
  playerId: PlayerId,
): Promise<{ readonly used: number; readonly total: number }> {
  const totals = await db.building.aggregate({
    where: { playerId, disposedGameMs: null, type: BuildingType.WORKER_HOME },
    _sum: { workerCount: true, capacityWorkers: true },
  });
  return {
    used: totals._sum.workerCount ?? 0,
    total: totals._sum.capacityWorkers ?? 0,
  };
}

/** The whole `GET /api/workers` reply. */
export async function buildWorkersReply(db: Db, playerId: PlayerId): Promise<WorkersReply> {
  const workers = await loadPlayerWorkers(db, playerId);
  const slots = await homeSlots(db, playerId);
  return {
    workers: workers.map(toWorkerDto),
    totalSalaryPerGameHour: toWireMoney(payrollPerGameHour(workers)),
    homeSlotsUsed: slots.used,
    homeSlotsTotal: slots.total,
  };
}

/** The whole `GET /api/workers/pool` reply. */
export async function buildPoolReply(db: Db, playerId: PlayerId): Promise<WorkerPoolReply> {
  const candidates = await loadListedCandidates(db, playerId);
  const next = await nextPoolRefreshAt(db, playerId);
  return {
    candidates: candidates.map(toCandidateDto),
    nextRefreshAtGameMs: next === null ? null : toWireGameMs(next),
  };
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export function workerUpsertedFrame(worker: WorkerRecord): DomainEventDraft {
  return { type: 'WORKER_UPSERTED', payload: { worker: toWorkerDto(worker) } };
}

export function workerRemovedFrame(worker: WorkerRecord): DomainEventDraft {
  return { type: 'WORKER_REMOVED', payload: { workerId: worker.id, farmId: worker.farmId } };
}

export function poolUpsertedFrame(reply: WorkerPoolReply): DomainEventDraft {
  return {
    type: 'WORKER_POOL_UPSERTED',
    payload: { candidates: reply.candidates, nextRefreshAtGameMs: reply.nextRefreshAtGameMs },
  };
}

/**
 * The frame of the home whose occupancy changed, so the client redraws the capacity.
 *
 * The row is reloaded through `modules/farms`, which is the module that owns the shape of a
 * building and the derivation of its occupancy: the counter was written by the trigger, not
 * by this module, and reading it back is the only way to report what it actually holds.
 * Returns nothing when the home has just been demolished, which is a possible interleaving
 * and not an error.
 */
export async function homeUpsertedFrames(
  db: Db,
  farmId: string,
  homeId: string,
): Promise<readonly DomainEventDraft[]> {
  const buildings = await loadBuildings(db, [farmId]);
  const home = buildings.find((building) => building.id === homeId);
  return home === undefined
    ? []
    : [{ type: 'BUILDING_UPSERTED', payload: { building: toBuildingDto(home) } }];
}

// ---------------------------------------------------------------------------
// The rules a later phase consumes
// ---------------------------------------------------------------------------

/**
 * Refuses a worker that is not idle (GDD sections 104 and 109).
 *
 * Both the reservation column and the status are checked, because they answer different
 * questions: `status` is what the interface renders and `currentTaskId` is what the database
 * enforces. A row where they disagree is a bug, and refusing on either is what keeps that bug
 * from becoming a second task on one worker.
 */
export function requireIdleWorker(worker: WorkerRecord): void {
  if (worker.status !== WorkerStatus.IDLE || worker.currentTaskId !== null) {
    throw new ApiError(ValidationCode.WORKER_NOT_IDLE, {
      entityId: worker.id,
      status: worker.status,
    });
  }
}

/**
 * Refuses a worker of another farm (GDD section 108).
 *
 * "Un trabajador de Farm #1 no puede operar maquinaria de Farm #2 sin reasignarse", and the
 * move between farms is outside the MVP, so the farm of the worker is fixed by the home he
 * lives in. This is the application half of the rule; the trigger `task_machines_farm_guard`
 * of the initial migration is the other half, and it is the one that holds even if a future
 * caller forgets this one, because the task is the single authoritative link between a worker
 * and a machine (plan section 5.2).
 */
export function requireWorkerOfFarm(worker: WorkerRecord, farmId: string): void {
  if (worker.farmId !== farmId) {
    throw new ApiError(ValidationCode.WORKER_WRONG_FARM, {
      entityId: worker.id,
      expected: farmId,
      actual: worker.farmId,
    });
  }
}

/** Whether a worker may operate machinery of a farm. The predicate form of the rule above. */
export function canOperateFarmMachinery(worker: WorkerRecord, farmId: string): boolean {
  return worker.terminatedGameMs === null && worker.farmId === farmId;
}

/**
 * Reserves a worker for a task (GDD section 104), as a conditional update whose row count is
 * the decision.
 *
 * Written for the task engine of workflow W6-A. It is the pattern of plan section 5.4 for the
 * double reservation: the two competing transactions have to write the same row, so the
 * second one updates nothing and finds out. Returning a boolean rather than throwing keeps
 * the caller free to order its own refusals, which matters because GDD section 104 fixes the
 * order of its six checks.
 */
export async function reserveWorkerForTask(
  tx: Tx,
  workerId: string,
  taskId: string,
): Promise<boolean> {
  const updated = await tx.worker.updateMany({
    where: {
      id: workerId,
      status: WorkerStatus.IDLE,
      currentTaskId: null,
      terminatedGameMs: null,
    },
    data: { status: WorkerStatus.WORKING, currentTaskId: taskId },
  });
  return updated.count === 1;
}

/**
 * Releases a worker at the end of a task, completed or cancelled (GDD sections 105 and 106).
 *
 * The worker is left `IDLE` and is never reassigned automatically, which GDD section 105
 * states explicitly and which is what feeds the return summary of GDD section 68.
 */
export async function releaseWorkerFromTask(
  tx: Tx,
  workerId: string,
  taskId: string,
): Promise<boolean> {
  const updated = await tx.worker.updateMany({
    where: { id: workerId, currentTaskId: taskId },
    data: { status: WorkerStatus.IDLE, currentTaskId: null },
  });
  return updated.count === 1;
}

/**
 * Skill progression on completing a task (GDD sections 103, 105 and 110).
 *
 * One point per completed task with a ceiling, which is `skillAfterTask` of
 * `shared/rules/skill.ts` and not an arithmetic written here: the balance calculator projects
 * the same progression over several cycles, and two implementations of a curve is how a
 * report stops matching the game.
 *
 * The counter and the skill move together in one statement, and the worker is released in the
 * same call, so a completion handler of workflow W6-A cannot apply one without the other.
 */
export async function applyTaskCompletion(
  tx: Tx,
  worker: WorkerRecord,
  taskId: string,
): Promise<WorkerRecord> {
  const releasing = worker.currentTaskId !== null && worker.currentTaskId === taskId;
  const row = await tx.worker.update({
    where: { id: worker.id },
    data: {
      skillBp: skillAfterTask(worker.skillBp),
      completedTaskCount: { increment: 1 },
      ...(releasing ? { status: WorkerStatus.IDLE, currentTaskId: null } : {}),
    },
    select: WORKER_SELECT,
  });
  return toWorkerRecord(row);
}

/**
 * Wages a worker accrues over a window: the integral of the overlap between the window and
 * his validity interval (plan section 6.2).
 *
 * The same integral `lib/accrual.ts` charges, exposed so that a panel, the balance report and
 * a test can recompute a figure instead of trusting the ledger to explain itself. Exact:
 * `overlapGameMs` is `bigint` arithmetic and `Money.mulGameMs` rounds once at the end.
 */
export function accruedWages(worker: WorkerRecord, window: GameInterval): Money {
  const validity: GameInterval = {
    fromGameMs: worker.hiredGameMs,
    toGameMs: worker.terminatedGameMs ?? window.toGameMs,
  };
  return Money.mulGameMs(worker.salaryPerGameHour, overlapGameMs(window, validity));
}

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

/** What one write of the pool produced. */
export interface PoolWriteOutcome {
  readonly candidates: readonly CandidateRecord[];
  readonly nextRefreshAtGameMs: GameMs;
}

/**
 * Schedules the next refresh of the pool of a player (GDD section 102).
 *
 * The dedupe key carries only the player, so at most one refresh is ever pending: the partial
 * unique index of `scheduled_events` is on the pending rows alone, which is what lets the same
 * key be used again once the previous one has been processed (`lib/ids.ts`).
 */
export async function schedulePoolRefresh(
  tx: Tx,
  outbox: Outbox,
  reading: ClockReading,
  playerId: PlayerId,
  dueGameMs: GameMs,
): Promise<void> {
  await scheduleEvent(tx, outbox, reading, {
    playerId,
    kind: ScheduledEventKind.WORKER_POOL_REFRESH,
    dueGameMs,
    refType: POOL_REF_TYPE,
    refId: playerId,
    dedupeKey: scheduledEventDedupeKey(ScheduledEventKind.WORKER_POOL_REFRESH, playerId),
  });
}

/**
 * Replaces the pool of a player with a freshly generated one and schedules the next refresh.
 *
 * Whole replacement and not a top up. GDD section 102 says that a hired candidate is
 * withdrawn and a new one appears after `poolRefreshInterval`, which a top up satisfies, but
 * it also calls the interval a refresh of the pool; replacing the whole pool satisfies both
 * readings and is the only one that keeps the interval a decision: if the candidates that
 * were not hired stayed listed for ever, a player could hold the ideal candidate indefinitely
 * and hire him whenever it suited, and the interval would apply to nothing.
 *
 * A retired candidate keeps its row with `removedGameMs` set instead of being deleted, so the
 * refresh is auditable and the same candidate can never be hired twice
 * (`backend/prisma/schema.prisma`).
 */
export async function replacePool(
  tx: Tx,
  outbox: Outbox,
  reading: ClockReading,
  playerId: PlayerId,
  listedAtGameMs: GameMs,
  nextRefreshAtGameMs: GameMs,
): Promise<PoolWriteOutcome> {
  await tx.workerCandidate.updateMany({
    where: { playerId, removedGameMs: null },
    data: { removedGameMs: listedAtGameMs },
  });

  const generated = generatePool(
    { worldSeed: reading.world.seed, playerId, listedAtGameMs },
    POOL_SIZE,
  );
  await tx.workerCandidate.createMany({
    data: generated.map((candidate) => ({
      playerId,
      // Reserved by the schema and never written: a global or regional pool would introduce
      // contention between players that the MVP avoids explicitly (plan section 5.2).
      region: null,
      name: candidate.name,
      skillBp: candidate.skillBp,
      askingSalaryPerGameHour: Money.toString(candidate.askingSalaryPerGameHour),
      listedAtGameMs,
    })),
  });

  await schedulePoolRefresh(tx, outbox, reading, playerId, nextRefreshAtGameMs);
  return {
    candidates: await loadListedCandidates(tx, playerId),
    nextRefreshAtGameMs,
  };
}

/**
 * Lists the first pool of a player, if he has never had one.
 *
 * The player is created by `modules/auth`, which belongs to a frozen earlier workflow and
 * knows nothing about hiring, so the pool cannot be listed at registration without reopening
 * that module. It is listed lazily instead, on the first read of the pool and on the first
 * hire, which is the same shape the crop cycle uses for its projected phases: the state is
 * derived from the clock and materialised when somebody looks (plan section 6.5).
 *
 * The condition is the pending refresh event and not the candidate rows. Once the pool has
 * been listed once there is always exactly one refresh pending, because the handler schedules
 * the next one on its way out, so a missing event means "never listed" and nothing else, and
 * the check is self healing if an event is ever lost.
 *
 * Returns null when there was nothing to do, which is the normal case and costs one indexed
 * count.
 */
export async function ensurePool(
  tx: Tx,
  outbox: Outbox,
  reading: ClockReading,
  playerId: PlayerId,
): Promise<PoolWriteOutcome | null> {
  const pending = await nextPoolRefreshAt(tx, playerId);
  if (pending !== null) {
    return null;
  }
  return replacePool(
    tx,
    outbox,
    reading,
    playerId,
    reading.gameNow,
    addGameMs(reading.gameNow, POOL_REFRESH_INTERVAL_GAME_MS),
  );
}

/**
 * The instant the current pool belongs to and the instant the next refresh falls due, for an
 * event that fell due while the player was away.
 *
 * Whole intervals are skipped rather than replayed one by one. The pool carries no history:
 * only the pool that is listed now can be hired from, and the ones a disconnected player
 * never saw change nothing, neither in the ledger nor in any other row. Replaying them would
 * cost one pass of the queue each — the batch of `advancePlayer` is read before the handler
 * runs, so a handler that scheduled the next boundary in the past would be processed on the
 * following pass and not on this one — which for a player who has been away a year is
 * hundreds of round trips to reach a state one statement produces.
 */
export function poolCatchUp(
  dueGameMs: GameMs,
  gameNow: GameMs,
): { readonly listedAtGameMs: GameMs; readonly nextRefreshAtGameMs: GameMs } {
  const interval = POOL_REFRESH_INTERVAL_GAME_MS;
  const elapsed = gameNow - dueGameMs;
  const skipped = elapsed > 0n ? elapsed / interval : 0n;
  const listedAtGameMs = addGameMs(dueGameMs, skipped * interval);
  return { listedAtGameMs, nextRefreshAtGameMs: addGameMs(listedAtGameMs, interval) };
}

// ---------------------------------------------------------------------------
// Hiring
// ---------------------------------------------------------------------------

export interface HireInput {
  readonly candidateId: string;
  readonly farmId: string;
  readonly homeId?: string | undefined;
}

export interface HireOutcome {
  readonly worker: WorkerRecord;
  readonly homeId: BuildingId;
  readonly pool: WorkerPoolReply;
}

/**
 * Hires a candidate (GDD section 102): validates money and a free home slot, creates the
 * worker `IDLE` and withdraws the candidate from the pool.
 *
 * The order of the five steps is the order of the refusals, and it is deliberate: the cheap
 * ownership checks first, then the two hard restrictions GDD section 102 names, then the
 * writes. So a refusal never leaves a partial state, and no refusal needs a compensating
 * write.
 *
 * The money check is the debt policy and not a fee. GDD section 102 asks to "validar dinero"
 * and the catalogue defines no hiring cost, so what the check can mean is that the player can
 * sustain the salary; a negative settled balance blocks discretionary commitments (plan
 * section 6.6), and the balance is read inside this transaction, under the player lock
 * `withPlayerAdvanced` already holds, so it is settled up to now.
 */
export async function hireCandidate(
  context: MutationContext,
  playerId: PlayerId,
  input: HireInput,
): Promise<HireOutcome> {
  const { tx, outbox, reading } = context;

  // 1. The farm has to be the player's, and it is the farm the home belongs to.
  const farm = await requireFarm(tx, playerId, input.farmId);

  // 2. The pool of a player who has never read it is listed now, so that a client that hires
  //    straight from a cached pool of another session cannot be told the candidate is gone
  //    because the pool never existed.
  await ensurePool(tx, outbox, reading, playerId);

  // 3. The candidate. Gone from the pool is `CANDIDATE_NOT_AVAILABLE` and not `NOT_FOUND`:
  //    the row exists, it is simply no longer offered, and the panel refreshes the pool
  //    rather than reporting a broken link.
  const candidateRow = await tx.workerCandidate.findUnique({
    where: { id: input.candidateId },
    select: CANDIDATE_SELECT,
  });
  if (candidateRow === null || candidateRow.playerId !== playerId) {
    throw notFound('WorkerCandidate', input.candidateId);
  }
  const candidate = toCandidateRecord(candidateRow);
  if (candidate.removedGameMs !== null) {
    throw new ApiError(ValidationCode.CANDIDATE_NOT_AVAILABLE, { entityId: candidate.id });
  }

  // 4. Money (GDD section 102, read as plan section 6.6).
  const balance = toMoney(
    (
      await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { balance: true },
      })
    ).balance,
  );
  if (Money.isNegative(balance)) {
    throw spendingBlockedInDebt(toWireMoney(balance));
  }

  // 5. Housing, which is a hard restriction (GDD section 108). The free slot comes from
  //    `modules/farms`, which owns the counters; this module never counts occupants.
  const home = await resolveHome(tx, farm.id, input.homeId);

  // 6. The writes. The `CHECK` on the home row stays the safety net for the genuine race
  //    between two hires competing for the last slot, and its translation is the one
  //    `modules/farms` already publishes, so the code the client sees is the same one the
  //    check above would have produced.
  const created = await withConstraintTranslation(
    () =>
      tx.worker.create({
        data: {
          playerId,
          farmId: farm.id,
          homeId: home,
          name: candidate.name,
          skillBp: candidate.skillBp,
          // The one cost rate that lives in a row and not in the catalogue, because it is
          // the outcome of the procedural pool (GDD section 102). There is no negotiation:
          // the asking salary is the salary.
          salaryPerGameHour: Money.toString(candidate.askingSalaryPerGameHour),
          status: WorkerStatus.IDLE,
          // Opens the validity interval the wage accrual integrates over (plan section 6.2).
          hiredGameMs: reading.gameNow,
        },
        select: WORKER_SELECT,
      }),
    { buildingType: BuildingType.WORKER_HOME, entityId: home },
  );

  // The candidate leaves the pool and does not come back: the row survives with
  // `removedGameMs`, which is what makes hiring safe against a double submission without an
  // idempotency key, because the second one is refused with `CANDIDATE_NOT_AVAILABLE`.
  await tx.workerCandidate.updateMany({
    where: { id: candidate.id, removedGameMs: null },
    data: { removedGameMs: reading.gameNow },
  });

  return {
    worker: toWorkerRecord(created),
    homeId: home as BuildingId,
    pool: await buildPoolReply(tx, playerId),
  };
}

/**
 * The home a new worker moves into: the one the request named, or the first of the farm with
 * room (GDD section 108).
 *
 * A named home is checked to belong to the farm and to have a slot, so a client that offers
 * the choice gets a refusal that names the building; an omitted one falls back to the
 * lowest identifier with room, which is what `modules/farms` already does for a garage, so
 * two hires fill one home before starting the next and the choice is reproducible in a test.
 */
async function resolveHome(tx: Tx, farmId: string, homeId: string | undefined): Promise<string> {
  const free = await buildingsWithFreeSlot(tx, farmId, BuildingType.WORKER_HOME);
  if (homeId === undefined) {
    const slot = free[0];
    if (slot === undefined) {
      const occupancy = await homesOccupancy(tx, farmId);
      throw capacityExceeded(
        ValidationCode.HOME_CAPACITY_EXCEEDED,
        occupancy.used,
        occupancy.total,
      );
    }
    return slot.buildingId;
  }

  const chosen = free.find((slot) => slot.buildingId === homeId);
  if (chosen !== undefined) {
    return chosen.buildingId;
  }
  const homes = await loadBuildings(tx, [farmId]);
  const named = homes.find(
    (building) => building.id === homeId && building.type === BuildingType.WORKER_HOME,
  );
  if (named === undefined) {
    throw notFound('Building', homeId);
  }
  throw capacityExceeded(
    ValidationCode.HOME_CAPACITY_EXCEEDED,
    named.workerCount,
    named.capacityWorkers,
    homeId,
  );
}

/** Aggregate home occupancy of one farm, for the figures a refusal carries. */
async function homesOccupancy(
  db: Db,
  farmId: string,
): Promise<{ readonly used: number; readonly total: number }> {
  const homes = (await loadBuildings(db, [farmId])).filter(
    (building) => building.type === BuildingType.WORKER_HOME,
  );
  return {
    used: homes.reduce((total, home) => total + home.workerCount, 0),
    total: homes.reduce((total, home) => total + home.capacityWorkers, 0),
  };
}

// ---------------------------------------------------------------------------
// Dismissal
// ---------------------------------------------------------------------------

/**
 * Dismisses an idle worker (GDD section 109): frees the home slot and closes the validity
 * interval.
 *
 * The row is not deleted. `terminatedGameMs` closes the interval the wage accrual integrates
 * over, so the wages of every past window stay recomputable, and the ledger entries that
 * charged them keep pointing at a row that exists (plan section 5.3, ADR-0009). Freeing the
 * slot is not a write of this module either: the trigger `workers_home_occupancy` decrements
 * the counter of the home in the same transaction, precisely because a terminated worker no
 * longer occupies it.
 *
 * "No se puede despedir a mitad de tarea" is enforced three times over: here, by the `CHECK`
 * on the row, and by the trigger `workers_termination_guard`, which reads the tasks rather
 * than the reservation column so the rule does not depend on another column being right.
 */
export async function dismissWorker(
  context: MutationContext,
  playerId: PlayerId,
  workerId: string,
): Promise<WorkerRecord> {
  const { tx, reading } = context;
  const worker = await requireWorker(tx, playerId, workerId);
  requireIdleWorker(worker);

  const updated = await tx.worker.updateMany({
    where: { id: worker.id, terminatedGameMs: null, currentTaskId: null },
    data: { status: WorkerStatus.IDLE, terminatedGameMs: reading.gameNow },
  });
  if (updated.count === 0) {
    // A task was assigned between the check and the write. The row count is the decision and
    // the refusal is the same one the check above would have produced (ADR-0018).
    throw new ApiError(ValidationCode.WORKER_NOT_IDLE, { entityId: worker.id });
  }

  return { ...worker, status: WorkerStatus.IDLE, terminatedGameMs: reading.gameNow };
}
