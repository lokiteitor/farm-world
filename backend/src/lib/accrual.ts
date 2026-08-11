// Continuous costs: settlement by the integral of overlaps. No tick anywhere.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Invariant 2 of plan section 6.2. Every source of cost carries its validity interval
// and the cost of any window is the integral of the overlaps, which
// `shared/rules/holding.ts` computes exactly in `bigint`. This module is the part that
// cannot be pure: it loads the sources from PostgreSQL, writes one ledger entry per
// category and advances the settlement mark.
//
// Three properties follow from doing it this way, and all three are load bearing:
//
//   1. Additivity. `settle(a, c)` and `settle(a, b)` followed by `settle(b, c)` charge
//      the same amount, because both are the same integral over the same interval. That
//      is what makes the order of settlement irrelevant, which in turn is what makes a
//      worker that was down for a day harmless. The exact form is additive to the last
//      unit; the money form rounds once per category, so a split window can differ from
//      the whole by at most one ten-thousandth per category, which is documented in the
//      header of the shared rule and asserted with a tolerance in the tests.
//   2. Tolerance of out of order processing. Nothing here reads "now": the window is
//      given, and a window that was already settled produces no entry because
//      `lastAccrualGameMs` only moves forward.
//   3. Recomputability. The same function over the same interval reproduces the history
//      from scratch, which is what makes the audit of `lib/ledger.ts` meaningful.
//
// What this module never does: read a rate from a row. Salaries live on the worker,
// because they are negotiated per candidate (GDD section 102), and every other rate
// comes from the catalogue of `shared/config` indexed by machine type.

import {
  ACCRUAL_LEDGER_TYPES,
  LedgerType,
  Money,
  accrueContinuousCosts,
  gameMs as toGameMsValue,
  type AccrualBreakdown,
  type AccrualSources,
  type GameInterval,
  type GameMs,
  type LedgerEntry,
  type MachineCostSource,
  type PlayerId,
  type RealMs,
  type TaskCostSource,
  type WorkerCostSource,
} from '../shared/index.js';
import { toMoney } from './dbMap.js';
import { accrualKey } from './ids.js';
import { accrue } from './ledger.js';
import { type Db, type PlayerLock, type Tx } from './tx.js';

/** The result of one settlement. */
export interface SettlementResult {
  readonly window: GameInterval;
  readonly breakdown: AccrualBreakdown;
  readonly entries: readonly LedgerEntry[];
  /** Balance after the settlement, which may legitimately be negative. */
  readonly balanceAfter: Money;
  /** False when the window was empty and nothing was read or written. */
  readonly settled: boolean;
}

/**
 * Loads the sources of cost that overlap a window.
 *
 * The filters are the overlap condition of plan section 6.2 expressed as SQL, so a
 * worker hired after the window or a machine sold before it never reaches the
 * integral. They are a performance measure and not a correctness one: an inverted or
 * empty overlap contributes zero anyway, which is what makes the shared rule total.
 */
export async function loadAccrualSources(
  db: Db,
  playerId: PlayerId,
  window: GameInterval,
  openingBalance: Money,
): Promise<AccrualSources> {
  const { fromGameMs, toGameMs } = window;

  const workerRows = await db.worker.findMany({
    where: {
      playerId,
      hiredGameMs: { lt: toGameMs },
      OR: [{ terminatedGameMs: null }, { terminatedGameMs: { gt: fromGameMs } }],
    },
    select: { salaryPerGameHour: true, hiredGameMs: true, terminatedGameMs: true },
  });

  const machineRows = await db.machine.findMany({
    where: {
      playerId,
      acquiredGameMs: { lt: toGameMs },
      OR: [{ disposedGameMs: null }, { disposedGameMs: { gt: fromGameMs } }],
    },
    select: { type: true, acquiredGameMs: true, disposedGameMs: true },
  });

  const taskRows = await db.task.findMany({
    where: {
      playerId,
      startGameMs: { lt: toGameMs },
      OR: [
        { endedGameMs: null, scheduledEndGameMs: { gt: fromGameMs } },
        { endedGameMs: { gt: fromGameMs } },
      ],
    },
    select: {
      startGameMs: true,
      scheduledEndGameMs: true,
      endedGameMs: true,
      machines: { select: { machine: { select: { type: true } } } },
    },
  });

  const workers: WorkerCostSource[] = workerRows.map((row) => ({
    salaryPerGameHour: toMoney(row.salaryPerGameHour),
    hiredGameMs: toGameMsValue(row.hiredGameMs),
    terminatedGameMs: row.terminatedGameMs === null ? null : toGameMsValue(row.terminatedGameMs),
  }));

  const machines: MachineCostSource[] = machineRows.map((row) => ({
    type: row.type,
    acquiredGameMs: toGameMsValue(row.acquiredGameMs),
    disposedGameMs: row.disposedGameMs === null ? null : toGameMsValue(row.disposedGameMs),
  }));

  const tasks: TaskCostSource[] = taskRows.map((row) => ({
    machineTypes: row.machines.map((link) => link.machine.type),
    startGameMs: toGameMsValue(row.startGameMs),
    scheduledEndGameMs: toGameMsValue(row.scheduledEndGameMs),
    endedGameMs: row.endedGameMs === null ? null : toGameMsValue(row.endedGameMs),
  }));

  return { workers, machines, tasks, openingBalance };
}

/**
 * The cost of a window without writing anything, which is what every read path and the
 * WebSocket use (plan section 6.2). Pure with respect to the database.
 */
export async function computeAccrual(
  db: Db,
  playerId: PlayerId,
  window: GameInterval,
  openingBalance: Money,
): Promise<AccrualBreakdown> {
  if (window.toGameMs <= window.fromGameMs) {
    return accrueContinuousCosts({ workers: [], machines: [], tasks: [], openingBalance }, window);
  }
  const sources = await loadAccrualSources(db, playerId, window, openingBalance);
  return accrueContinuousCosts(sources, window);
}

/** The amount of a category of the breakdown. */
function amountOf(breakdown: AccrualBreakdown, type: LedgerType): Money {
  switch (type) {
    case LedgerType.WORKER_WAGES:
      return breakdown.wages;
    case LedgerType.MACHINE_MAINTENANCE:
      return breakdown.maintenance;
    case LedgerType.MACHINE_OPERATING:
      return breakdown.operating;
    case LedgerType.OVERDRAFT_INTEREST:
      return breakdown.interest;
    default:
      return Money.ZERO;
  }
}

/**
 * Settles the continuous costs of a player up to an instant.
 *
 * The window is `[lastAccrualGameMs, toGameMs)`, always closed-open, so consecutive
 * settlements partition the timeline with no overlap and no hole. An instant that is not
 * ahead of the mark settles nothing and is not an error: it is what a second call inside
 * the same request looks like, and what a queue retry looks like.
 *
 * One entry per category with a non zero amount, in the order of `ACCRUAL_LEDGER_TYPES`,
 * each with the key `accrual:<player>:<kind>:<from>`. A category worth zero writes no
 * entry, which keeps the ledger of an idle player empty instead of filling it with rows
 * of 0.0000.
 *
 * The mark is advanced with a conditional monotonic update, which is the first of the
 * three independent defences against double charging of plan section 6.3; the second is
 * the unique idempotency key, and the third is the transition gate of each handler.
 */
export async function settleAccruals(
  tx: Tx,
  lock: PlayerLock,
  toGameMs: GameMs,
  atRealMs: RealMs,
): Promise<SettlementResult> {
  const player = await tx.player.findUniqueOrThrow({
    where: { id: lock.playerId },
    select: { balance: true, lastAccrualGameMs: true },
  });
  const fromGameMs = toGameMsValue(player.lastAccrualGameMs);
  const openingBalance = toMoney(player.balance);
  const window: GameInterval = { fromGameMs, toGameMs };

  if (toGameMs <= fromGameMs) {
    return {
      window,
      breakdown: accrueContinuousCosts(
        { workers: [], machines: [], tasks: [], openingBalance },
        { fromGameMs, toGameMs: fromGameMs },
      ),
      entries: [],
      balanceAfter: openingBalance,
      settled: false,
    };
  }

  const sources = await loadAccrualSources(tx, lock.playerId, window, openingBalance);
  const breakdown = accrueContinuousCosts(sources, window);

  const entries: LedgerEntry[] = [];
  let balanceAfter = openingBalance;
  for (const type of ACCRUAL_LEDGER_TYPES) {
    const amount = amountOf(breakdown, type);
    if (Money.isZero(amount)) {
      continue;
    }
    const written = await accrue(tx, lock, {
      type,
      amount,
      atGameMs: toGameMs,
      atRealMs,
      idempotencyKey: accrualKey(lock.playerId, type, fromGameMs),
      refType: 'ACCRUAL_WINDOW',
      refId: null,
      meta: {
        fromGameMs: fromGameMs.toString(),
        toGameMs: toGameMs.toString(),
        gameHours: breakdown.windowGameHours,
      },
    });
    entries.push(written.entry);
    balanceAfter = written.balanceAfter;
  }

  // Monotonic and conditional: a concurrent settlement that already moved the mark
  // further wins, and this one becomes a no-op instead of pulling the mark back.
  await tx.player.updateMany({
    where: { id: lock.playerId, lastAccrualGameMs: { lt: toGameMs } },
    data: { lastAccrualGameMs: toGameMs },
  });

  return { window, breakdown, entries, balanceAfter, settled: true };
}
