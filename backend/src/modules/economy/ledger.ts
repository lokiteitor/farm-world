// The ledger query: the history of entries, paged, filterable by kind and by interval.
//
// Owner: workflow W5-C. Module `economy`.
//
// The ledger is the only account of where the money went, and plan section 5.3 makes it
// auditable rather than merely informative: `seq` is monotonic per player and gives a total
// order that breaks ties between two entries with the same game instant, and `balanceAfter`
// is stored so the history can be drawn without window functions and so an executable test
// can assert that the sum of the entries equals the balance.
//
// Paging, and why it is by sequence and not by offset. An offset re-reads the rows it skips
// and, worse, shifts under the reader: a player who is being settled while paging would see
// an entry twice or miss one. The sequence is unique per player, monotonic and indexed with
// it, so `seq < cursor` is a stable window that a concurrent settlement cannot disturb. The
// cursor is opaque in the contract, which is what lets it stay the sequence today and become
// something else later without a client change.
//
// The order is descending, newest first. It is the order a history panel reads in, and it is
// what makes `balance` in the reply meaningful: the reply carries the settled balance, which
// is exactly the `balanceAfter` of the newest entry, so a client can check the page it just
// received against it without asking for anything else.
//
// The filters. `queryLedger` takes a set of kinds and a half open game interval, because
// both are questions the return summary and the balance panel ask ("what did the wages cost
// me last week", "show me only the sales"). The contract of `shared/api/schemas/economy.ts`
// does not carry them yet: `ledgerQuerySchema` is a strict object with `limit` and `cursor`
// only, so a request naming a kind is rejected at the boundary before this code runs. The
// filters are implemented here anyway and exercised by the suite, so that widening the
// contract is one line in the route and no work in the domain
// (`docs/handoff/NOTES-w5c.md`, item 3.1).

import { toLedgerEntry, toMoney } from '../../lib/dbMap.js';
import { type Db } from '../../lib/tx.js';
import {
  Money,
  validationFailed,
  type GameMs,
  type LedgerEntry,
  type LedgerType,
  type PlayerId,
} from '../../shared/index.js';

/** A cursor is the decimal sequence of the last entry of the previous page. */
const CURSOR_PATTERN = /^[0-9]{1,10}$/;

export interface LedgerQueryInput {
  readonly limit: number;
  readonly cursor: string | null;
  /** Kinds to keep. Null or empty means every kind. */
  readonly types: readonly LedgerType[] | null;
  /** Start of the interval, inclusive. Null means from the beginning. */
  readonly fromGameMs: GameMs | null;
  /** End of the interval, exclusive. Null means up to now. */
  readonly toGameMs: GameMs | null;
}

export interface LedgerPage {
  /** Newest first, so the first entry of the first page is the last thing that happened. */
  readonly entries: readonly LedgerEntry[];
  readonly nextCursor: string | null;
  /** The settled balance, which is the `balanceAfter` of the newest entry of the player. */
  readonly balance: Money;
  /** Entries matching the filter, ignoring the cursor, so the panel can size its list. */
  readonly entryCount: number;
}

/** The empty filter, which is what a request that names none produces. */
export const NO_LEDGER_FILTER: Omit<LedgerQueryInput, 'limit' | 'cursor'> = {
  types: null,
  fromGameMs: null,
  toGameMs: null,
};

/** Parses the opaque cursor, refusing anything that is not one. */
export function parseLedgerCursor(cursor: string | null): number | null {
  if (cursor === null) {
    return null;
  }
  if (!CURSOR_PATTERN.test(cursor)) {
    throw validationFailed('query.cursor', { field: 'query.cursor' });
  }
  return Number(cursor);
}

/**
 * The `where` of a query, written as a local shape rather than as the generated Prisma
 * input type: the ESLint zones keep a domain module away from `src/generated`, and rightly,
 * so the filter is described structurally and Prisma checks it at the call site.
 */
interface LedgerFilter {
  readonly playerId: string;
  readonly type?: { readonly in: LedgerType[] };
  readonly atGameMs?: { readonly gte?: bigint; readonly lt?: bigint };
}

/** The `where` of a query, shared by the page and by the count so the two cannot diverge. */
function filterOf(
  playerId: PlayerId,
  input: Pick<LedgerQueryInput, 'types' | 'fromGameMs' | 'toGameMs'>,
): LedgerFilter {
  const types = input.types === null || input.types.length === 0 ? null : [...input.types];
  const bounded = input.fromGameMs !== null || input.toGameMs !== null;
  return {
    playerId,
    ...(types === null ? {} : { type: { in: types } }),
    ...(bounded
      ? {
          atGameMs: {
            ...(input.fromGameMs === null ? {} : { gte: input.fromGameMs as bigint }),
            ...(input.toGameMs === null ? {} : { lt: input.toGameMs as bigint }),
          },
        }
      : {}),
  };
}

/**
 * One page of the ledger of a player.
 *
 * `limit + 1` rows are read and the extra one is dropped, which is what tells the caller
 * whether there is another page without a second count. The count that is issued is of the
 * whole filter and not of the page, because it is what sizes the scrollbar.
 */
export async function queryLedger(
  db: Db,
  playerId: PlayerId,
  input: LedgerQueryInput,
): Promise<LedgerPage> {
  const cursorSeq = parseLedgerCursor(input.cursor);
  const filter = filterOf(playerId, input);

  const [rows, entryCount, player] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { ...filter, ...(cursorSeq === null ? {} : { seq: { lt: cursorSeq } }) },
      orderBy: { seq: 'desc' },
      take: input.limit + 1,
    }),
    db.ledgerEntry.count({ where: filter }),
    db.player.findUniqueOrThrow({ where: { id: playerId }, select: { balance: true } }),
  ]);

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > input.limit && last !== undefined ? String(last.seq) : null;

  return {
    entries: page.map(toLedgerEntry),
    nextCursor,
    balance: toMoney(player.balance),
    entryCount,
  };
}

/**
 * The sum of the entries of a set of kinds over an interval, which is what the aggregated
 * blocks of the return summary of GDD section 124 are made of.
 *
 * It sums in the database and not in the application: a long lived player accumulates one
 * entry per settlement, and pulling a year of them across the wire to add them up would be
 * paid on every login.
 */
export async function sumLedger(
  db: Db,
  playerId: PlayerId,
  input: Pick<LedgerQueryInput, 'types' | 'fromGameMs' | 'toGameMs'>,
): Promise<Money> {
  const aggregate = await db.ledgerEntry.aggregate({
    where: filterOf(playerId, input),
    _sum: { amount: true },
  });
  const total = aggregate._sum.amount;
  return total === null || total === undefined ? Money.ZERO : toMoney(total);
}
