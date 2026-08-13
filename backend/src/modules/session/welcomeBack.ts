// The return summary of GDD section 68, with the exact analytical economics of GDD section 124.
//
// Owner: workflow W6-B. Module `session`.
//
// The whole summary is derived. No table was added for it and none is needed (plan section
// 6.7): the ledger covers the economic block, and the timestamped domain columns cover the
// block of events. That is the property worth defending, because the alternative — writing a
// summary row as things happen — would need every module of every phase to remember to append
// to it, and the first one that forgot would produce a summary that quietly under-reports.
//
// The interval. `(lastSummaryGameMs, gameNow]`, cut in game time and never in real time. The
// summary mark is distinct from the login mark on purpose (`Player`, schema.prisma): reloading
// the page moves `lastLoginGameMs` and must not erase a summary the player has not read, so
// only the acknowledgement moves this one.
//
// The interval is open on the left and closed on the right, which is the opposite of every
// other window in the system, and the reason is where a settlement writes its entry. A
// settlement covers `[lastAccrualGameMs, toGameMs)` and stamps the entry it writes with
// `toGameMs`, the end (`lib/accrual.ts`), because that is the instant at which the cost became
// payable. A window closed on the left would therefore miss the settlement of its own last
// stretch — the entry stamped exactly at `gameNow` — and report an empty summary to a player
// who had been away for four hundred hours. Closing on the right catches it, and opening on the
// left is what stops the next summary from counting it a second time: consecutive intervals
// still partition the timeline with no overlap and no hole. It also has one welcome
// consequence, which is that the opening capital of GDD section 117, stamped at the instant the
// account was created, is not reported as something that happened while the player was away.
//
// The economics of GDD section 124, term by term, and where each one really comes from:
//
//   totalSalaries    `WORKER_WAGES` entries of the interval
//   totalMaintenance `MACHINE_MAINTENANCE` entries of the interval
//   totalOperating   `MACHINE_OPERATING` entries of the interval
//   totalRevenue     `CROP_SALE` and `WOOD_SALE` entries of the interval
//   totalOther       everything else: acquisitions, repairs, interest, liquidations, capital
//
// GDD section 124 writes the first three as a rate multiplied by `elapsedHours` and then warns,
// about the third, that it "requires reviewing the scheduled events, not a simple
// multiplication". The warning applies to all three and the ledger already answers it: every
// accrual entry was written by `settleAccruals`, which integrates the overlap of each source
// with the window over its own validity interval (plan section 6.2). So the operating cost
// here is the integral over `[startGameMs, coalesce(endedGameMs, scheduledEndGameMs))` of each
// task, which is exactly what the section asks for, and a task cancelled halfway contributes
// the half it worked and not the whole it was scheduled for.
//
// Reading the ledger rather than recomputing the integral is also what makes the summary
// reconcile: `balanceBefore + netChange === balanceAfter` holds because all three come from the
// same append only sequence, and a recomputation could differ from what was actually charged by
// the rounding of a category. The recomputation exists and is tested — `computeAccrual` of
// `lib/accrual.ts` — and it belongs to the audit, not to the summary.
//
// The blocks of events, and the one thing each derivation depends on:
//
//   tasksClosed       `Task.endedGameMs` inside the interval
//   fieldTransitions  the growth timeline of `Field.seededAtGameMs` and the crop catalogue
//   idleWorkers       the workers with no task at the end of the interval
//   repairsCompleted  the processed `MACHINE_REPAIR_COMPLETE` rows of the outbox
//   storage           the stores of every farm, which is state and not history (GDD 68)
//   treeStageChanges  the stage of each standing tree at both ends of the interval
//   wasted            the `HARVEST_WASTE` entries, which carry no money and exist to say this
//   liquidations      the `LIQUIDATION` aggregate entry, which carries the whole event
//   notices           the `NOTICE` frames of the interval
//
// Two limits of the derivation, stated rather than hidden. A field harvested during the absence
// has had its growth timeline cleared by the harvest (`modules/fields/service.ts`), so its
// automatic transitions are no longer derivable; the harvest itself appears in `tasksClosed`,
// which is the line GDD section 68 actually shows. And a tree felled during the absence is not
// reported as a stage change, because it is not one: the felling is the task that closed.

import { toLedgerEntry, toMoney } from '../../lib/dbMap.js';
import { type Db } from '../../lib/tx.js';
import {
  LedgerType,
  Money,
  STORAGE_RESOURCES,
  ScheduledEventKind,
  ScheduledEventStatus,
  TIMED_CROP_PHASE_ORDER,
  TREE_GROWTH_STAGES,
  TREE_SPECIES_CATALOGUE,
  TREE_SPECIES_IDS,
  TaskStatus,
  TreeStatus,
  WorkerStatus,
  addGameMs,
  gameHoursBetween,
  gameHoursToGameMs,
  gameMs as toGameMsValue,
  noticeDtoSchema,
  toWireGameMs,
  toWireMoney,
  treeStageAt,
  type CropCycleState,
  type GameMs,
  type LedgerEntry,
  type NoticeDto,
  type PlayerId,
  type TreeGrowthStage,
  type TreeSpecies,
  type WelcomeBackEconomy,
  type WelcomeBackField,
  type WelcomeBackLedgerLine,
  type WelcomeBackLiquidation,
  type WelcomeBackReply,
  type WelcomeBackStorage,
  type WelcomeBackTask,
  type WelcomeBackTrees,
} from '../../shared/index.js';
import { loadFarms, storageUsageOf } from '../farms/service.js';
import { cropOf, loadPlayerFields, nextTimedState } from '../fields/index.js';
import { MACHINE_REF_TYPE } from '../machinery/index.js';
import { loadPlayerWorkers } from '../workers/index.js';

// ---------------------------------------------------------------------------
// The interval
// ---------------------------------------------------------------------------

/**
 * Game time that has to have elapsed before a summary is offered on its own.
 *
 * It gates `welcomeBackPending`, which is the flag the game page reads once on mount to decide
 * whether to open the modal, and it gates nothing else: `GET /api/session/welcome-back` always
 * answers, so a player who wants to reread the summary can. One game hour is the smallest
 * interval in which a continuous cost of GDD section 107 is worth a line at all, since every
 * rate of the catalogue is per game hour.
 */
export const MIN_PENDING_ELAPSED_GAME_MS = 3_600_000n;

/** The interval a summary covers, open on the left and closed on the right. */
export interface SummaryWindow {
  readonly fromGameMs: GameMs;
  readonly toGameMs: GameMs;
}

/** The window of a player at an instant. */
export function summaryWindow(lastSummaryGameMs: GameMs, atGameMs: GameMs): SummaryWindow {
  return {
    fromGameMs: lastSummaryGameMs > atGameMs ? atGameMs : lastSummaryGameMs,
    toGameMs: atGameMs,
  };
}

/**
 * Whether a summary is worth opening on its own, which is what the snapshot reports.
 *
 * Deliberately cheap: two counts and no aggregation. The full summary is one request away and
 * building it to answer a boolean would make every snapshot pay for a modal the player may
 * never open.
 */
export async function welcomeBackPending(
  db: Db,
  playerId: PlayerId,
  atGameMs: GameMs,
): Promise<boolean> {
  const player = await db.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { lastSummaryGameMs: true },
  });
  const window = summaryWindow(toGameMsValue(player.lastSummaryGameMs), atGameMs);
  if (window.toGameMs - window.fromGameMs < MIN_PENDING_ELAPSED_GAME_MS) {
    return false;
  }
  const [entries, tasks] = await Promise.all([
    db.ledgerEntry.count({
      where: {
        playerId,
        atGameMs: { gt: window.fromGameMs as bigint, lte: window.toGameMs as bigint },
      },
    }),
    db.task.count({
      where: {
        playerId,
        endedGameMs: { gt: window.fromGameMs as bigint, lte: window.toGameMs as bigint },
      },
    }),
  ]);
  return entries > 0 || tasks > 0;
}

// ---------------------------------------------------------------------------
// The economic block (GDD section 124)
// ---------------------------------------------------------------------------

/**
 * Kinds that count as revenue in the sense of GDD section 124.
 *
 * The section defines revenue as what the completed harvests produced, so it is production
 * revenue and not any inflow: selling a machine or a building is a disposal of capital and
 * belongs to `totalOther`, where a player can tell it apart from a harvest. Wood is the
 * forestry half of the same sentence (GDD sections 133 and 138).
 */
export const REVENUE_LEDGER_TYPES: readonly LedgerType[] = [
  LedgerType.CROP_SALE,
  LedgerType.WOOD_SALE,
];

/** The aggregate of one kind over the interval. */
interface TypeTotal {
  readonly type: LedgerType;
  readonly entryCount: number;
  readonly total: Money;
}

/** Aggregates the ledger of the interval by kind, in the database and not in memory. */
async function aggregateByType(
  db: Db,
  playerId: PlayerId,
  window: SummaryWindow,
): Promise<readonly TypeTotal[]> {
  const groups = await db.ledgerEntry.groupBy({
    by: ['type'],
    where: {
      playerId,
      atGameMs: { gt: window.fromGameMs as bigint, lte: window.toGameMs as bigint },
    },
    _sum: { amount: true },
    _count: true,
    orderBy: { type: 'asc' },
  });
  return groups.map((group) => ({
    type: group.type,
    entryCount: group._count,
    total: group._sum.amount === null ? Money.ZERO : toMoney(group._sum.amount),
  }));
}

/** Sum of the kinds of a set, already signed. */
function totalOf(totals: readonly TypeTotal[], types: readonly LedgerType[]): Money {
  return Money.sum(totals.filter((line) => types.includes(line.type)).map((line) => line.total));
}

/**
 * The economic block, with both balances read from the ledger and not from the player row.
 *
 * `balanceBefore` is the `balanceAfter` of the newest entry that precedes the interval, which
 * is the balance the player actually had when the interval opened; `balanceAfter` is the
 * `balanceAfter` of the newest entry inside it. Taking them from the ledger rather than
 * subtracting `netChange` from the current balance is what turns the reconciliation into an
 * assertion instead of a tautology: if the interval were cut wrong, or an entry were missing,
 * `balanceBefore + netChange === balanceAfter` would stop holding.
 */
export async function buildEconomy(
  db: Db,
  playerId: PlayerId,
  window: SummaryWindow,
): Promise<WelcomeBackEconomy> {
  const totals = await aggregateByType(db, playerId, window);

  const [previous, latest] = await Promise.all([
    db.ledgerEntry.findFirst({
      where: { playerId, atGameMs: { lte: window.fromGameMs as bigint } },
      orderBy: { seq: 'desc' },
      select: { balanceAfter: true },
    }),
    db.ledgerEntry.findFirst({
      where: {
        playerId,
        atGameMs: { gt: window.fromGameMs as bigint, lte: window.toGameMs as bigint },
      },
      orderBy: { seq: 'desc' },
      select: { balanceAfter: true },
    }),
  ]);

  const balanceBefore = previous === null ? Money.ZERO : toMoney(previous.balanceAfter);
  const balanceAfter = latest === null ? balanceBefore : toMoney(latest.balanceAfter);

  const totalRevenue = totalOf(totals, REVENUE_LEDGER_TYPES);
  const totalSalaries = totalOf(totals, [LedgerType.WORKER_WAGES]);
  const totalMaintenance = totalOf(totals, [LedgerType.MACHINE_MAINTENANCE]);
  const totalOperating = totalOf(totals, [LedgerType.MACHINE_OPERATING]);
  const named = [
    ...REVENUE_LEDGER_TYPES,
    LedgerType.WORKER_WAGES,
    LedgerType.MACHINE_MAINTENANCE,
    LedgerType.MACHINE_OPERATING,
  ];
  const totalOther = Money.sum(
    totals.filter((line) => !named.includes(line.type)).map((line) => line.total),
  );

  const byType: WelcomeBackLedgerLine[] = totals.map((line) => ({
    type: line.type,
    entryCount: line.entryCount,
    total: toWireMoney(line.total),
  }));

  return {
    balanceBefore: toWireMoney(balanceBefore),
    balanceAfter: toWireMoney(balanceAfter),
    totalRevenue: toWireMoney(totalRevenue),
    totalSalaries: toWireMoney(totalSalaries),
    totalMaintenance: toWireMoney(totalMaintenance),
    totalOperating: toWireMoney(totalOperating),
    totalOther: toWireMoney(totalOther),
    // Every term is already signed, so the net is a plain sum. GDD section 124 subtracts
    // because its terms are unsigned magnitudes; ADR-0009 stores a signed amount, and adding
    // the signed terms is the same arithmetic written once instead of twice.
    netChange: toWireMoney(Money.sum(totals.map((line) => line.total))),
    byType,
  };
}

// ---------------------------------------------------------------------------
// Liquidations and waste
// ---------------------------------------------------------------------------

/** Reads a decimal amount out of the free form `meta` of an entry, or zero. */
function metaMoney(value: unknown): Money {
  if (typeof value !== 'string') {
    return Money.ZERO;
  }
  try {
    return Money.fromString(value);
  } catch {
    return Money.ZERO;
  }
}

/**
 * What a forced liquidation sold, and why, from the entries the economy module leaves.
 *
 * The aggregate `LIQUIDATION` entry is the source and not the per asset sale entries, and the
 * reason is the one step that writes no sale: dismissing a worker frees no money, so the
 * `WORKERS` step of ADR-0039 leaves nothing in the ledger except its line inside the aggregate.
 * Reading the aggregate is therefore the only way the summary can say "and your two idle hands
 * were let go", which is exactly the information the absent player does not have.
 */
export function liquidationsOf(entries: readonly LedgerEntry[]): readonly WelcomeBackLiquidation[] {
  const lines: WelcomeBackLiquidation[] = [];
  for (const entry of entries) {
    const assets = entry.meta?.['assets'];
    if (!Array.isArray(assets)) {
      continue;
    }
    for (const asset of assets) {
      if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) {
        continue;
      }
      const record = asset as Record<string, unknown>;
      const step = record['step'];
      lines.push({
        step: typeof step === 'string' ? step : 'UNKNOWN',
        subjectType: typeof record['kind'] === 'string' ? (record['kind'] as string) : null,
        subjectId: typeof record['id'] === 'string' ? (record['id'] as string) : null,
        // The machine type, the resource or the name of the worker. Truncated to the width of
        // the contract rather than dropped, so an over-long name degrades to a shorter name and
        // not to an identifier (docs/handoff/NOTES-w6t.md 1.1).
        detail:
          typeof record['detail'] === 'string' ? (record['detail'] as string).slice(0, 64) : null,
        amount: toWireMoney(metaMoney(record['proceeds'])),
      });
    }
  }
  return lines;
}

/**
 * Production lost for want of capacity (GDD sections 83 and 97).
 *
 * `HARVEST_WASTE` carries no money: it exists so that the return summary can explain the grain
 * that did not fit in the silo (schema.prisma, `LedgerType`). The figures travel in `meta`,
 * and the three keys this reader expects are `resource`, `units` and `farmId`. The writer is
 * `modules/tasks` of workflow W6-A, which closes a harvest; an entry whose `meta` does not
 * carry the three is skipped rather than guessed at, and the expectation is recorded in
 * `docs/handoff/NOTES-w6b.md`.
 */
export function wastedOf(
  entries: readonly LedgerEntry[],
): readonly { readonly resource: string; readonly units: number; readonly farmId: string }[] {
  const lines: { resource: string; units: number; farmId: string }[] = [];
  for (const entry of entries) {
    const meta = entry.meta;
    if (meta === null) {
      continue;
    }
    const resource = meta['resource'];
    const units = meta['units'];
    const farmId = meta['farmId'];
    if (typeof resource !== 'string' || typeof units !== 'number' || typeof farmId !== 'string') {
      continue;
    }
    lines.push({ resource, units: Math.max(0, Math.trunc(units)), farmId });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The block of events
// ---------------------------------------------------------------------------

/**
 * Tasks that closed inside the interval, completed or cancelled.
 *
 * `producedUnits` reports the storage the task reserved on assignment, which for a harvest and
 * for a felling is the production the assignment committed to (`Task.reservedStorageUnits`,
 * schema.prisma). The exact figure at completion is decided by `modules/tasks` of workflow
 * W6-A, a sibling of this phase that this module may not import (plan section 11, rule 4); the
 * request that it be readable from the row is in `docs/handoff/NOTES-w6b.md`.
 */
async function tasksClosedIn(
  db: Db,
  playerId: PlayerId,
  window: SummaryWindow,
): Promise<readonly WelcomeBackTask[]> {
  const rows = await db.task.findMany({
    where: {
      playerId,
      endedGameMs: { gt: window.fromGameMs as bigint, lte: window.toGameMs as bigint },
    },
    orderBy: [{ endedGameMs: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      operation: true,
      status: true,
      endedGameMs: true,
      reservedStorageUnits: true,
      targetField: { select: { name: true } },
      targetForestPlot: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    taskId: row.id,
    operation: row.operation,
    status: row.status,
    targetName: row.targetField?.name ?? row.targetForestPlot?.name ?? null,
    endedGameMs: toWireGameMs(toGameMsValue(row.endedGameMs ?? 0n)),
    producedUnits: row.status === TaskStatus.COMPLETED ? (row.reservedStorageUnits ?? null) : null,
  }));
}

/**
 * Automatic phase transitions of GDD section 76 that fell inside the interval.
 *
 * Derived from the growth timeline and not from a history: the three phase durations of the
 * crop laid end to end from `seededAtGameMs` are exactly the instants at which the field moved
 * on, which is the same arithmetic `projectCropPhase` walks and the same one the scheduled job
 * materialises (plan section 6.5). So a job that had not run yet does not hide a transition
 * that did happen, which is the whole point of making the projection the authority.
 */
export async function fieldTransitionsIn(
  db: Db,
  playerId: PlayerId,
  window: SummaryWindow,
): Promise<readonly WelcomeBackField[]> {
  const fields = await loadPlayerFields(db, playerId);
  const transitions: WelcomeBackField[] = [];
  for (const field of fields) {
    const seeded = field.seededAtGameMs;
    if (seeded === null) {
      continue;
    }
    const crop = cropOf(field.cropId);
    let boundary: GameMs = seeded;
    for (const phase of TIMED_CROP_PHASE_ORDER) {
      boundary = addGameMs(boundary, gameHoursToGameMs(crop.phaseDurationsGameHours[phase]));
      if (boundary <= window.fromGameMs || boundary > window.toGameMs) {
        continue;
      }
      const to: CropCycleState | null = nextTimedState(phase);
      if (to === null) {
        continue;
      }
      transitions.push({
        fieldId: field.id,
        name: field.name,
        fromState: phase,
        toState: to,
        atGameMs: toWireGameMs(boundary),
      });
    }
  }
  // Chronological, and by field where two boundaries fell at the same instant. The instant is
  // compared as a `bigint` and not as the decimal string it travels as, because a string
  // comparison would order 1000 before 900.
  return transitions.sort((left, right) => {
    const a = BigInt(left.atGameMs);
    const b = BigInt(right.atGameMs);
    if (a !== b) {
      return a < b ? -1 : 1;
    }
    return left.fieldId.localeCompare(right.fieldId);
  });
}

/** Repairs whose scheduled completion was processed inside the interval (GDD section 93). */
async function repairsCompletedIn(
  db: Db,
  playerId: PlayerId,
  window: SummaryWindow,
): Promise<
  readonly { readonly machineId: string; readonly conditionBp: number; readonly atGameMs: string }[]
> {
  const events = await db.scheduledEvent.findMany({
    where: {
      playerId,
      kind: ScheduledEventKind.MACHINE_REPAIR_COMPLETE,
      status: ScheduledEventStatus.PROCESSED,
      refType: MACHINE_REF_TYPE,
      processedAtGameMs: {
        gt: window.fromGameMs as bigint,
        lte: window.toGameMs as bigint,
      },
    },
    orderBy: { processedAtGameMs: 'asc' },
    select: { refId: true, processedAtGameMs: true },
  });
  const ids = events
    .map((event) => event.refId)
    .filter((id): id is string => id !== null && id.length > 0);
  if (ids.length === 0) {
    return [];
  }
  const machines = await db.machine.findMany({
    where: { id: { in: ids }, playerId },
    select: { id: true, conditionBp: true },
  });
  const conditionById = new Map(machines.map((machine) => [machine.id, machine.conditionBp]));

  const lines: { machineId: string; conditionBp: number; atGameMs: string }[] = [];
  for (const event of events) {
    const machineId = event.refId;
    const conditionBp = machineId === null ? undefined : conditionById.get(machineId);
    if (machineId === null || conditionBp === undefined) {
      continue;
    }
    lines.push({
      machineId,
      conditionBp,
      atGameMs: toWireGameMs(toGameMsValue(event.processedAtGameMs ?? 0n)),
    });
  }
  return lines;
}

/**
 * Trees that crossed a growth stage inside the interval (GDD section 131).
 *
 * A tree stores only when it was planted (ADR-0030), so "it changed stage" is a statement about
 * arithmetic and not about a row: a tree of species `s` crosses the boundary of a stage that
 * starts at age `b` at the instant `plantedAtGameMs + b`. The filter is therefore an `OR` of
 * one planting range per species and per boundary, which is three ranges with one species, and
 * it is what keeps the query proportional to the trees that changed instead of to the tens of
 * thousands a holding may own.
 */
export async function treeStageChangesIn(
  db: Db,
  playerId: PlayerId,
  window: SummaryWindow,
): Promise<readonly WelcomeBackTrees[]> {
  const ranges: {
    readonly species: TreeSpecies;
    readonly plantedAtGameMs: { readonly gt: bigint; readonly lte: bigint };
  }[] = [];
  for (const species of TREE_SPECIES_IDS) {
    const definition = TREE_SPECIES_CATALOGUE[species];
    for (const stage of TREE_GROWTH_STAGES) {
      const startHours = definition.stageStartGameHours[stage];
      if (startHours <= 0) {
        // The first stage begins at age zero, which is a planting and not a change.
        continue;
      }
      const offset = gameHoursToGameMs(startHours) as bigint;
      ranges.push({
        species,
        plantedAtGameMs: {
          gt: (window.fromGameMs as bigint) - offset,
          lte: (window.toGameMs as bigint) - offset,
        },
      });
    }
  }
  if (ranges.length === 0) {
    return [];
  }

  const trees = await db.tree.findMany({
    where: { playerId, status: TreeStatus.STANDING, OR: ranges },
    select: { forestPlotId: true, species: true, plantedAtGameMs: true },
  });

  // Counted per plot and per resulting stage. Two nested maps rather than a composite string
  // key: an identifier is opaque and building a key out of two of them needs a separator that
  // cannot appear in either, which is a rule nothing enforces.
  const counts = new Map<string, Map<TreeGrowthStage, number>>();
  for (const tree of trees) {
    const view = {
      species: tree.species,
      plantedAtGameMs: toGameMsValue(tree.plantedAtGameMs),
      status: TreeStatus.STANDING,
    };
    const before = treeStageAt(view, window.fromGameMs);
    const after = treeStageAt(view, window.toGameMs);
    if (before === after) {
      continue;
    }
    const byStage = counts.get(tree.forestPlotId) ?? new Map<TreeGrowthStage, number>();
    byStage.set(after, (byStage.get(after) ?? 0) + 1);
    counts.set(tree.forestPlotId, byStage);
  }

  const lines: WelcomeBackTrees[] = [];
  for (const [forestPlotId, byStage] of counts) {
    for (const stage of TREE_GROWTH_STAGES) {
      const count = byStage.get(stage);
      if (count !== undefined && count > 0) {
        lines.push({ forestPlotId, stage, count });
      }
    }
  }
  return lines.sort((left, right) =>
    left.forestPlotId === right.forestPlotId
      ? left.stage.localeCompare(right.stage)
      : left.forestPlotId.localeCompare(right.forestPlotId),
  );
}

/**
 * Occupancy of every store, which is the "Silo is 72 % full" line of GDD section 68.
 *
 * State and not history: it is what the stores hold at the end of the interval, because that is
 * the number the player has to act on. A farm with no store for a resource produces no line, so
 * the summary never says a farm is at 0 % of a silo it has not built.
 */
export async function storageOf(
  db: Db,
  playerId: PlayerId,
): Promise<readonly WelcomeBackStorage[]> {
  const farms = await loadFarms(db, playerId);
  const lines: WelcomeBackStorage[] = [];
  for (const farm of farms) {
    for (const resource of STORAGE_RESOURCES) {
      const usage = storageUsageOf(farm, resource);
      if (usage.capacityUnits <= 0) {
        continue;
      }
      lines.push({
        farmId: farm.id,
        resource,
        storedUnits: usage.storedUnits,
        capacityUnits: usage.capacityUnits,
        occupancyBp: usage.occupancyBp,
      });
    }
  }
  return lines;
}

/** The `NOTICE` frames of the interval, oldest first. */
async function noticesIn(
  db: Db,
  playerId: PlayerId,
  window: SummaryWindow,
): Promise<readonly NoticeDto[]> {
  const rows = await db.gameEvent.findMany({
    where: {
      playerId,
      type: 'NOTICE',
      atGameMs: { gt: window.fromGameMs as bigint, lte: window.toGameMs as bigint },
    },
    orderBy: { seq: 'asc' },
    select: { payload: true },
  });
  const notices: NoticeDto[] = [];
  for (const row of rows) {
    const payload = row.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      continue;
    }
    const parsed = noticeDtoSchema.safeParse((payload as Record<string, unknown>)['notice']);
    if (parsed.success) {
      notices.push(parsed.data);
    }
  }
  return notices;
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

/** Entries of one kind inside the interval, mapped with the one mapper of `lib/dbMap.ts`. */
async function entriesOfType(
  db: Db,
  playerId: PlayerId,
  window: SummaryWindow,
  type: LedgerType,
): Promise<readonly LedgerEntry[]> {
  const rows = await db.ledgerEntry.findMany({
    where: {
      playerId,
      type,
      atGameMs: { gt: window.fromGameMs as bigint, lte: window.toGameMs as bigint },
    },
    orderBy: { seq: 'asc' },
  });
  return rows.map(toLedgerEntry);
}

/** Builds the whole summary of a player over its current window. */
export async function buildWelcomeBack(
  db: Db,
  playerId: PlayerId,
  atGameMs: GameMs,
): Promise<WelcomeBackReply> {
  const player = await db.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { lastSummaryGameMs: true },
  });
  const window = summaryWindow(toGameMsValue(player.lastSummaryGameMs), atGameMs);

  const [
    economy,
    tasksClosed,
    fieldTransitions,
    workers,
    repairsCompleted,
    storage,
    treeStageChanges,
    liquidationEntries,
    wasteEntries,
    notices,
  ] = await Promise.all([
    buildEconomy(db, playerId, window),
    tasksClosedIn(db, playerId, window),
    fieldTransitionsIn(db, playerId, window),
    loadPlayerWorkers(db, playerId),
    repairsCompletedIn(db, playerId, window),
    storageOf(db, playerId),
    treeStageChangesIn(db, playerId, window),
    entriesOfType(db, playerId, window, LedgerType.LIQUIDATION),
    entriesOfType(db, playerId, window, LedgerType.HARVEST_WASTE),
    noticesIn(db, playerId, window),
  ]);

  const idleWorkers = workers
    .filter((worker) => worker.currentTaskId === null && worker.status === WorkerStatus.IDLE)
    .map((worker) => ({ workerId: worker.id, name: worker.name }));

  const liquidations = liquidationsOf(liquidationEntries);
  const wasted = wastedOf(wasteEntries);

  const hasContent =
    economy.byType.length > 0 ||
    tasksClosed.length > 0 ||
    fieldTransitions.length > 0 ||
    repairsCompleted.length > 0 ||
    treeStageChanges.length > 0 ||
    liquidations.length > 0 ||
    wasted.length > 0 ||
    notices.length > 0;

  const elapsed = gameHoursBetween(window.fromGameMs, window.toGameMs);

  return {
    fromGameMs: toWireGameMs(window.fromGameMs),
    toGameMs: toWireGameMs(window.toGameMs),
    elapsedGameHours: elapsed > 0 ? elapsed : 0,
    hasContent,
    economy,
    tasksClosed: [...tasksClosed],
    fieldTransitions: [...fieldTransitions],
    idleWorkers,
    repairsCompleted: [...repairsCompleted],
    storage: [...storage],
    treeStageChanges: [...treeStageChanges],
    wasted: [...wasted],
    liquidations: [...liquidations],
    notices: [...notices],
  };
}
