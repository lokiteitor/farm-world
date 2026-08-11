// The ledger: the only path through which money is written.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Plan section 5.3. Single entry with a signed amount, because the market, the labour
// pool and the land vendor are "the world" and modelling fictitious counterparties
// would add nothing. What is kept from accounting rigour is immutability and
// verifiability, and both are properties of this module rather than good intentions:
//
//   - `seq` is monotonic per player and incremented under the player lock, which gives
//     a total order and breaks ties between two entries with the same game instant.
//   - `balanceAfter` is stored. It is redundant on purpose: it makes the ledger self
//     auditable with an executable test, it lets the history be drawn without window
//     functions and, above all, it forces every write path through the player row,
//     which is precisely the serialisation the design is looking for.
//   - `idempotencyKey` is unique per player. This is the detail that is easiest to
//     forget and most expensive to omit: the queue delivers at least once, and a retry
//     of "charge the wages of this interval" without a key duplicates the charge.
//
// Three ways to write, and the difference between them is the whole of the debt policy
// of plan section 6.6:
//
//   `charge`  discretionary spending. Decrements only if the settled balance covers
//             the amount, as a conditional update with a row count. It cannot be a
//             CHECK on the column, because offline accrual legitimately overdraws the
//             account (GDD sections 118 and 119) and a CHECK would then reject the
//             accrual itself.
//   `credit`  income. Never refused: selling is the only way out of debt, so it is
//             admissible with a negative balance.
//   `accrue`  the passage of time. A debit that does not check funds, which is what
//             makes the balance able to go negative at all. Only the four kinds of
//             `ACCRUAL_LEDGER_TYPES` may use it.
//
// Every one of the three takes a `PlayerLock`, so the compiler refuses a write that did
// not serialise the player first.

import {
  ACCRUAL_LEDGER_TYPES,
  LedgerType,
  Money,
  NON_MONETARY_LEDGER_TYPES,
  type AccrualBreakdown,
  type GameMs,
  type JsonObject,
  type LedgerEntry,
  type PlayerId,
  type RealMs,
} from '../shared/index.js';
import { fromJsonObject, fromMoney, toLedgerEntry, toMoney } from './dbMap.js';
import { type PlayerLock, type Tx } from './tx.js';

/** What every write needs. `amount` is always a positive magnitude; the sign is applied
 *  by the function that writes, so no call site can get the convention backwards. */
export interface LedgerWrite {
  readonly type: LedgerType;
  readonly amount: Money;
  readonly atGameMs: GameMs;
  /** Deterministic and unique per player. See `lib/ids.ts` for the shapes in use. */
  readonly idempotencyKey: string;
  readonly atRealMs: RealMs;
  readonly refType?: string | null;
  readonly refId?: string | null;
  readonly meta?: JsonObject | null;
}

/** A written entry, with the balance it left behind. */
export interface LedgerResult {
  readonly entry: LedgerEntry;
  readonly balanceAfter: Money;
  /**
   * True when the key already existed and nothing was written. The caller must treat
   * it as success: it means the same fact was already recorded, which is what
   * idempotency is for.
   */
  readonly replayed: boolean;
}

/** The outcome of a discretionary charge. */
export type ChargeResult =
  | ({ readonly ok: true } & LedgerResult)
  | {
      readonly ok: false;
      readonly reason: 'INSUFFICIENT_FUNDS';
      readonly required: Money;
      readonly available: Money;
    };

/** A write that is not admissible at all: a programming error, not a domain outcome. */
export class LedgerUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerUsageError';
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The settled balance projected forward to the instant of a reading, which is what
 * every read path and the WebSocket show (plan section 6.2).
 *
 * Pure, and it writes nothing. That separation is not stylistic: a check against the
 * projection would create money out of nothing under concurrency, because two
 * concurrent requests would both project the same unsettled costs away. Every
 * affordability check uses the settled balance inside its own transaction, which is
 * what `charge` does.
 */
export function projectBalance(settledBalance: Money, pending: AccrualBreakdown): Money {
  return Money.sub(settledBalance, pending.total);
}

/** The entry of an idempotency key, or null. The fast path of every write. */
export async function findEntryByKey(
  tx: Tx,
  playerId: PlayerId,
  idempotencyKey: string,
): Promise<LedgerEntry | null> {
  const row = await tx.ledgerEntry.findUnique({
    where: { playerId_idempotencyKey: { playerId, idempotencyKey } },
  });
  return row === null ? null : toLedgerEntry(row);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Inserts the entry and returns it. Assumes the balance and the sequence of the player
 * have already been moved, and that the values passed are the ones that resulted.
 */
async function insertEntry(
  tx: Tx,
  playerId: PlayerId,
  write: LedgerWrite,
  signedAmount: Money,
  seq: number,
  balanceAfter: Money,
): Promise<LedgerEntry> {
  const row = await tx.ledgerEntry.create({
    data: {
      playerId,
      seq,
      type: write.type,
      amount: fromMoney(signedAmount),
      balanceAfter: fromMoney(balanceAfter),
      atGameMs: write.atGameMs,
      refType: write.refType ?? null,
      refId: write.refId ?? null,
      meta: fromJsonObject(write.meta ?? null),
      idempotencyKey: write.idempotencyKey,
      createdAtRealMs: write.atRealMs,
    },
  });
  return toLedgerEntry(row);
}

/** Moves the balance by a signed amount and takes the next sequence, under the lock. */
async function moveBalance(
  tx: Tx,
  playerId: PlayerId,
  signedAmount: Money,
): Promise<{ readonly seq: number; readonly balanceAfter: Money }> {
  const row = await tx.player.update({
    where: { id: playerId },
    data: {
      balance: { increment: fromMoney(signedAmount) },
      ledgerSeq: { increment: 1 },
    },
    select: { balance: true, ledgerSeq: true },
  });
  return { seq: row.ledgerSeq, balanceAfter: toMoney(row.balance) };
}

function assertPositive(amount: Money, what: string): void {
  if (Money.isNegative(amount)) {
    throw new LedgerUsageError(`${what} requires a positive magnitude, received ${amount}`);
  }
}

/**
 * Discretionary spending. Decrements the balance only if it covers the amount, as one
 * conditional update whose row count is the decision (plan section 5.4).
 *
 * The row count and not a read-then-write: under READ COMMITTED two concurrent
 * purchases both read the same balance, and only the conditional update forces them to
 * write the same row and re-evaluate the condition against the committed value. The
 * player lock already serialises them here, and the conditional update is the second,
 * independent defence that also holds for a caller that forgot to take it.
 */
export async function charge(tx: Tx, lock: PlayerLock, write: LedgerWrite): Promise<ChargeResult> {
  assertPositive(write.amount, 'charge');
  const existing = await findEntryByKey(tx, lock.playerId, write.idempotencyKey);
  if (existing !== null) {
    return { ok: true, entry: existing, balanceAfter: existing.balanceAfter, replayed: true };
  }

  const moved = await tx.player.updateMany({
    where: { id: lock.playerId, balance: { gte: fromMoney(write.amount) } },
    data: { balance: { decrement: fromMoney(write.amount) }, ledgerSeq: { increment: 1 } },
  });
  if (moved.count === 0) {
    const player = await tx.player.findUniqueOrThrow({
      where: { id: lock.playerId },
      select: { balance: true },
    });
    return {
      ok: false,
      reason: 'INSUFFICIENT_FUNDS',
      required: write.amount,
      available: toMoney(player.balance),
    };
  }

  const player = await tx.player.findUniqueOrThrow({
    where: { id: lock.playerId },
    select: { balance: true, ledgerSeq: true },
  });
  const balanceAfter = toMoney(player.balance);
  const entry = await insertEntry(
    tx,
    lock.playerId,
    write,
    Money.negate(write.amount),
    player.ledgerSeq,
    balanceAfter,
  );
  return { ok: true, entry, balanceAfter, replayed: false };
}

/** Income. Never refused, because selling is the only way out of debt. */
export async function credit(tx: Tx, lock: PlayerLock, write: LedgerWrite): Promise<LedgerResult> {
  assertPositive(write.amount, 'credit');
  const existing = await findEntryByKey(tx, lock.playerId, write.idempotencyKey);
  if (existing !== null) {
    return { entry: existing, balanceAfter: existing.balanceAfter, replayed: true };
  }
  const moved = await moveBalance(tx, lock.playerId, write.amount);
  const entry = await insertEntry(
    tx,
    lock.playerId,
    write,
    write.amount,
    moved.seq,
    moved.balanceAfter,
  );
  return { entry, balanceAfter: moved.balanceAfter, replayed: false };
}

/**
 * The passage of time: a debit that does not check funds.
 *
 * Restricted to the four kinds of `ACCRUAL_LEDGER_TYPES`, which are the only ones whose
 * amount is an integral over an interval. Any other kind that needed to overdraw the
 * account would be a design mistake, so the restriction is enforced rather than
 * documented.
 */
export async function accrue(tx: Tx, lock: PlayerLock, write: LedgerWrite): Promise<LedgerResult> {
  if (!ACCRUAL_LEDGER_TYPES.includes(write.type)) {
    throw new LedgerUsageError(
      `accrue only writes the continuous accruals, not ${write.type}. Use charge or credit.`,
    );
  }
  assertPositive(write.amount, 'accrue');
  const existing = await findEntryByKey(tx, lock.playerId, write.idempotencyKey);
  if (existing !== null) {
    return { entry: existing, balanceAfter: existing.balanceAfter, replayed: true };
  }
  const signed = Money.negate(write.amount);
  const moved = await moveBalance(tx, lock.playerId, signed);
  const entry = await insertEntry(tx, lock.playerId, write, signed, moved.seq, moved.balanceAfter);
  return { entry, balanceAfter: moved.balanceAfter, replayed: false };
}

/**
 * A signed compensation entry.
 *
 * `COMPENSATION` is the kind reserved for exactly this: an incident is compensated with an
 * entry and never by rewinding the clock (plan section 6.1). It is the only kind that may
 * carry either sign from a single call site, because the sign is the whole point, and it is
 * restricted to that kind so that no ordinary path can bypass the funds check of `charge` by
 * passing a negative amount.
 */
export async function compensate(
  tx: Tx,
  lock: PlayerLock,
  write: LedgerWrite,
): Promise<LedgerResult> {
  if (write.type !== LedgerType.COMPENSATION) {
    throw new LedgerUsageError(`compensate only writes COMPENSATION, not ${write.type}.`);
  }
  const existing = await findEntryByKey(tx, lock.playerId, write.idempotencyKey);
  if (existing !== null) {
    return { entry: existing, balanceAfter: existing.balanceAfter, replayed: true };
  }
  const moved = await moveBalance(tx, lock.playerId, write.amount);
  const entry = await insertEntry(
    tx,
    lock.playerId,
    write,
    write.amount,
    moved.seq,
    moved.balanceAfter,
  );
  return { entry, balanceAfter: moved.balanceAfter, replayed: false };
}

/**
 * An entry that carries no money and exists only so that the return summary can explain
 * a physical loss: the grain that did not fit in the silo (GDD sections 83 and 97). The
 * wasted volume travels in `meta`.
 */
export async function recordNonMonetary(
  tx: Tx,
  lock: PlayerLock,
  write: Omit<LedgerWrite, 'amount'>,
): Promise<LedgerResult> {
  if (!NON_MONETARY_LEDGER_TYPES.includes(write.type)) {
    throw new LedgerUsageError(
      `recordNonMonetary only writes ${NON_MONETARY_LEDGER_TYPES.join(', ')}, not ${write.type}.`,
    );
  }
  return credit(tx, lock, { ...write, amount: Money.ZERO });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Sums the ledger of a player and compares it against the stored balance.
 *
 * This is the executable form of "the ledger is auditable because the sum of its entries
 * equals the balance", which is what the opening entry of GDD section 117 exists for and
 * what the smoke test of plan section 10 asserts. It reads in pages, because a long
 * lived player accumulates one entry per settlement.
 */
export async function auditBalance(
  tx: Tx,
  playerId: PlayerId,
  pageSize = 1000,
): Promise<{
  readonly ok: boolean;
  readonly storedBalance: Money;
  readonly summedBalance: Money;
  readonly entryCount: number;
}> {
  const player = await tx.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { balance: true },
  });
  let total = 0n;
  let entryCount = 0;
  let cursor = 0;
  for (;;) {
    const rows = await tx.ledgerEntry.findMany({
      where: { playerId, seq: { gt: cursor } },
      orderBy: { seq: 'asc' },
      take: pageSize,
      select: { seq: true, amount: true },
    });
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      total += Money.toScaled(toMoney(row.amount));
      entryCount += 1;
      cursor = row.seq;
    }
  }
  const stored = toMoney(player.balance);
  const summed = Money.fromScaled(total);
  return {
    ok: Money.compare(stored, summed) === 0,
    storedBalance: stored,
    summedBalance: summed,
    entryCount,
  };
}
