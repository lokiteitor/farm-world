// Identifiers, opaque tokens and the deterministic keys of the write paths.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Three families live here, and they are different things that are easy to
// conflate:
//
//   1. Row identifiers. PostgreSQL columns are `uuid`, and Prisma 7 generates the
//      value on the client for `@default(uuid(7))`, so the application has to be
//      able to produce one for a raw insert as well. `randomUUID` of node:crypto is
//      a version 4 UUID, which is a valid value of the column; the ordering benefit
//      of version 7 belongs to the rows Prisma writes and is not worth a dependency
//      here (backend/prisma/README.md, section 2).
//   2. Opaque tokens: the refresh token and the single use WebSocket ticket. Both
//      are 32 bytes of `randomBytes` in base64url, and only their hash is stored.
//   3. Deterministic keys. The idempotency key of a ledger entry, the dedupe key of
//      a scheduled event and the identifier of a queue job are all derived from the
//      fact they describe, never random: the queue delivers at least once, and a
//      retry of "charge the wages of this interval" without a key duplicates the
//      charge (plan section 6.3).
//
// The shape of every deterministic key is `<verb>:<subject>[:<qualifier>]`, with the
// separator `:` and no spaces, so a key is greppable in the ledger and in a log.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  type GameMs,
  type LedgerType,
  type PlayerId,
  type ScheduledEventKind,
  type TaskId,
} from '../shared/index.js';

// ---------------------------------------------------------------------------
// Row identifiers and tokens
// ---------------------------------------------------------------------------

/** A fresh UUID for a row the application inserts without going through Prisma. */
export function newUuid(): string {
  return randomUUID();
}

/** Bytes of entropy of an opaque token. 32 bytes is 256 bits. */
const TOKEN_BYTES = 32;

/** An opaque token: 32 bytes of entropy, base64url, safe in a URL and in a cookie. */
export function newOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash of an opaque token, as lowercase hexadecimal.
 *
 * SHA-256 and not a password hash: a token is 256 bits of entropy, so it is not
 * guessable and there is nothing to slow down, while a refresh path that verified
 * argon2 would pay tens of milliseconds on every rotation. What the hash buys is
 * that a dump of `refresh_tokens` hands over no live session.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Stable hash of the body of a request, used to tell a retry of the same request
 * from a different request that reuses an idempotency key (plan section 6.3).
 */
export function hashRequestBody(method: string, path: string, body: unknown): string {
  const serialised = body === undefined ? '' : JSON.stringify(body);
  return createHash('sha256').update(`${method} ${path}\n${serialised}`, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Idempotency keys of the ledger
// ---------------------------------------------------------------------------

/**
 * Key of a continuous accrual entry (plan section 6.3, `accrual:<player>:<kind>:<from>`).
 *
 * The interval start is part of the key and the end is not: the settlement of a
 * window always starts at `lastAccrualGameMs`, which advances monotonically, so two
 * settlements of the same player can only share a start if one of them is a retry
 * of the other.
 */
export function accrualKey(
  forPlayerId: PlayerId,
  type: LedgerType,
  fromGameMs: GameMs | bigint,
): string {
  return `accrual:${forPlayerId}:${type}:${fromGameMs.toString()}`;
}

/** Key of the opening entry of a player (GDD section 117). */
export function startingCapitalKey(forPlayerId: PlayerId): string {
  return `starting-capital:${forPlayerId}`;
}

/** Key of the entry a completed harvest writes. One per task, by construction. */
export function harvestKey(forTaskId: TaskId): string {
  return `harvest:${forTaskId}`;
}

/**
 * Key of an entry caused by a client request that carried an `Idempotency-Key`
 * header. The client key is namespaced by player, because the ledger uniqueness is
 * per player and two players may legitimately send the same key.
 */
export function requestKey(forPlayerId: PlayerId, verb: string, clientKey: string): string {
  return `${verb}:${forPlayerId}:${clientKey}`;
}

// ---------------------------------------------------------------------------
// Keys of the outbox and of the queue
// ---------------------------------------------------------------------------

/**
 * Dedupe key of a scheduled event: the fact it describes, never the instant it was
 * written at. Unique among the pending rows only, which is what lets the same key be
 * scheduled again once it has been processed, as every pool refresh does
 * (backend/prisma/schema.prisma, `scheduled_events_pending_dedupe_key`).
 */
export function scheduledEventDedupeKey(
  kind: ScheduledEventKind,
  subjectId: string,
  qualifier?: string,
): string {
  return qualifier === undefined ? `${kind}:${subjectId}` : `${kind}:${subjectId}:${qualifier}`;
}

/**
 * Identifier of the queue job of a scheduled event, deterministic and carrying the
 * schedule epoch.
 *
 * The epoch is in the identifier and not only in the payload for two reasons: adding
 * the same job identifier twice is a no-op in BullMQ, so a reconciliation sweep that
 * runs while the alarm clock already exists cannot duplicate it; and a re-anchoring
 * increments the epoch, so the jobs of the previous epoch have different identifiers
 * and can be removed without touching the new ones (plan sections 6.1 and 6.4).
 */
export function scheduledJobId(scheduledEventId: string, epoch: number): string {
  return `evt:${scheduledEventId}:${epoch}`;
}

/** Identifier of a periodic job, which carries the window it belongs to. */
export function periodicJobId(name: string, windowIndex: number): string {
  return `cron:${name}:${windowIndex}`;
}
