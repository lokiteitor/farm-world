// Transactions and the canonical lock order.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// THE CANONICAL LOCK ORDER (plan section 6.3). Every path that takes more than one
// explicit lock takes them in this order and never in another:
//
//     1. world           the row of `worlds`, only for a retiming and for a
//                        registration, which needs a serialisation point to assign
//                        the player index of the spawn allocator.
//     2. player          the row of `players`. This is the lock of the write path:
//                        `advancePlayer` holds it, the ledger sequence is incremented
//                        under it and `balanceAfter` is written under it.
//     3. domain rows     fields, machines, workers, tasks, forest plots and chunks,
//                        in ascending order of identifier.
//
// Why an order at all. Two transactions that take the same two rows in opposite orders
// deadlock, and PostgreSQL resolves it by killing one of them; under load that shows
// up as an intermittent 500 on the busiest endpoint. The order above is total, so a
// cycle cannot form. `ascendingIds` exists so that step 3 is mechanical.
//
// Isolation is READ COMMITTED, which `infra/postgres/init.sql` sets as the database
// default and this module states explicitly. It is enough because the hard constraints
// of plan section 5.4 never rely on a repeatable read: they force the two transactions
// to write the same row, and PostgreSQL then serialises the writers and re-evaluates
// the CHECK against the committed value.
//
// The explicit lock is reserved for where it is really needed. Most restrictions are a
// conditional update with a row count, which needs no lock at all; the player row needs
// one because the settlement path reads the set of workers, machines and tasks before
// it writes.

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { type PlayerId, type WorldId } from '../shared/index.js';
import { createOutbox, discardOutbox, type Outbox, type OutboxFlush } from './outbox.js';

/**
 * Either the client or a transaction client. Every function that may run inside a
 * transaction takes this, which is what lets a read path be reused by a write path.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

/** A transaction client. Required where a lock or an outbox effect is involved. */
export type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

declare const LOCK_BRAND: unique symbol;

/**
 * Evidence that the row of a player is locked for the current transaction.
 *
 * It is a branded token and not a boolean because it is a precondition of every
 * function of `lib/ledger.ts`: the ledger sequence and `balanceAfter` are only correct
 * if the writers of that player are serialised. Requiring the token in the signature
 * turns "remember to lock first" into a compile error, which is the only form of that
 * reminder that survives five more workflows.
 */
export interface PlayerLock {
  readonly playerId: PlayerId;
  readonly [LOCK_BRAND]: 'player';
}

/** Evidence that the row of the world is locked for the current transaction. */
export interface WorldLock {
  readonly worldId: WorldId;
  readonly [LOCK_BRAND]: 'world';
}

/**
 * Takes the lock of a player row, returning null when the player does not exist.
 *
 * Only the identifier is selected. The values are read afterwards through the typed
 * client, which is the same row inside the same transaction: a raw select would return
 * a `numeric` as a string and an `int8` as a bigint with no schema to check it against,
 * and the mapping of `lib/dbMap.ts` exists precisely so that no path decodes a row by
 * hand.
 */
export async function lockPlayer(tx: Tx, playerId: PlayerId): Promise<PlayerLock | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "players" WHERE "id" = ${playerId}::uuid FOR UPDATE
  `;
  return rows.length === 0 ? null : ({ playerId } as PlayerLock);
}

/**
 * Takes the lock of the world row. Used by a retiming, which rewrites the anchor, and
 * by a registration, which needs the count of players to be stable while it derives
 * the origin of the new one.
 */
export async function lockWorld(tx: Tx, worldId: WorldId): Promise<WorldLock | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "worlds" WHERE "id" = ${worldId}::uuid FOR UPDATE
  `;
  return rows.length === 0 ? null : ({ worldId } as WorldLock);
}

/**
 * Step 3 of the lock order: identifiers sorted ascending, deduplicated.
 *
 * The comparison is the plain string order of the textual UUID, which is total and
 * stable; what matters is that every transaction uses the same one, not which one.
 */
export function ascendingIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/** How long a transaction may run before Prisma rolls it back. */
export const TRANSACTION_TIMEOUT_MS = 20_000;

/** How long a caller waits for a connection and for the transaction to start. */
export const TRANSACTION_MAX_WAIT_MS = 10_000;

export interface TransactionOptions {
  readonly timeoutMs?: number;
  readonly maxWaitMs?: number;
}

/**
 * Runs a body inside one interactive transaction and flushes the outbox after the
 * commit.
 *
 * The order of the three steps is the whole point and is not negotiable: the body runs,
 * the commit returns, and only then does anything leave the process. If the commit
 * fails, the body's recorded effects are discarded with it, so no alarm clock and no
 * frame can refer to state that was rolled back.
 *
 * A failure of the flush is not a failure of the transaction: the domain state is
 * committed and correct, and what was lost is punctuality, which the reconciliation
 * sweep of plan section 6.4 restores. The flush therefore reports through the logger
 * and does not rethrow, which is why it is injected as a whole rather than assembled
 * here.
 */
export async function withTransaction<T>(
  prisma: PrismaClient,
  flush: OutboxFlush,
  body: (tx: Tx, outbox: Outbox) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const collector = createOutbox();
  const result = await prisma.$transaction(async (tx) => body(tx, collector), {
    isolationLevel: 'ReadCommitted',
    timeout: options.timeoutMs ?? TRANSACTION_TIMEOUT_MS,
    maxWait: options.maxWaitMs ?? TRANSACTION_MAX_WAIT_MS,
  });
  if (!collector.isEmpty) {
    await flush(collector);
  }
  return result;
}

/**
 * The same, with no side effects outside the database. For a caller that has neither a
 * queue nor Redis, which is what an audit test is.
 */
export async function withPlainTransaction<T>(
  prisma: PrismaClient,
  body: (tx: Tx, outbox: Outbox) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return withTransaction(prisma, discardOutbox, body, options);
}

// ---------------------------------------------------------------------------
// Refusals of the database
// ---------------------------------------------------------------------------
//
// The two outcomes that are domain results and not failures. They live here, and not at the call
// sites, for a reason the ESLint zones make structural: a module may import `lib` and `plugins` and
// nothing else of `src`, so it cannot reach the generated Prisma client, and therefore cannot know
// an error code. Which is the right restriction: a unique index that fires means "this fact was
// already recorded", and translating that into a domain answer is the job of one place.

/**
 * Whether a write was refused by a unique index. That covers the partial unique index of the outbox
 * and the one of the email, neither of which Prisma reports with a field name.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Whether an operation failed because a row it required was not found. */
export function isMissingRecord(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
