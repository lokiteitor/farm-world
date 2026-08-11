// Explicit mapping between Prisma rows and domain entities.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Why the mapping is written by hand. `shared/domain/entities.ts` is the vocabulary
// the rules, the API replies and the client stores share, and it deliberately does
// not import Prisma: the generated client is a detail of the backend and the frontend
// must be able to use the same vocabulary without it. The two shapes were aligned
// field by field by the W2.5 patching window (docs/handoff/NOTES-w2d.md, item 5), so
// the mapping is mechanical, but it is not free:
//
//   - `Decimal` becomes `Money`, through the canonical four decimal string. The
//     conversion goes through `toFixed(4)` and never through `toString()`, which
//     drops trailing zeroes and, for a large magnitude, would emit exponential
//     notation that `Money` refuses.
//   - `BigInt` becomes `GameMs` or `RealMs`, through the constructors that reject a
//     negative instant.
//   - `number` becomes `Bp` through `bp`, which rejects anything outside 0..10 000.
//     The database has the same CHECK, so a failure here means the row was written
//     around Prisma.
//
// Scope. This file maps only what workflow W3 owns: the world, the player, the ledger,
// the outbox and the event log. Later workflows map their own rows inside their own
// module, because this file is frozen and a module that needed a field added here
// would have to reopen it (plan section 11, rule 2).

import {
  Prisma,
  type GameEvent as GameEventRow,
  type LedgerEntry as LedgerEntryRow,
  type Player as PlayerRow,
  type ScheduledEvent as ScheduledEventRow,
  type World as WorldRow,
} from '../generated/prisma/client.js';
import {
  bp,
  gameMs,
  playerId as toPlayerId,
  realMs,
  worldId as toWorldId,
  Money,
  type Bp,
  type GameEvent,
  type GameMs,
  type JsonObject,
  type JsonValue,
  type LedgerEntry,
  type Player,
  type RealMs,
  type ScheduledEvent,
  type World,
  type WorldClockAnchor,
} from '../shared/index.js';

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** Anything Prisma can hand back for a `Decimal(20,4)` column. */
export interface DecimalLike {
  toFixed(decimalPlaces: number): string;
}

/** A `Decimal` column as a canonical `Money`. */
export function toMoney(value: DecimalLike): Money {
  return Money.fromString(value.toFixed(4));
}

/**
 * A `Money` as the value written to a `Decimal` column. Prisma accepts the decimal
 * string, which is exactly the canonical form, so nothing is parsed on the way in.
 */
export function fromMoney(value: Money): string {
  return Money.toString(value);
}

/** A `BigInt` column as a game instant. */
export function toGameMs(value: bigint): GameMs {
  return gameMs(value);
}

/** A `BigInt` column as a wall clock instant. */
export function toRealMs(value: bigint): RealMs {
  return realMs(value);
}

/** A nullable `BigInt` column as a nullable game instant. */
export function toGameMsOrNull(value: bigint | null): GameMs | null {
  return value === null ? null : gameMs(value);
}

/** A nullable `BigInt` column as a nullable wall clock instant. */
export function toRealMsOrNull(value: bigint | null): RealMs | null {
  return value === null ? null : realMs(value);
}

/** An integer column as basis points, rejecting anything outside 0..10 000. */
export function toBp(value: number): Bp {
  return bp(value);
}

/**
 * A `Json` column as a domain JSON object, or null.
 *
 * A scalar or an array in a column the domain declares as an object is a row written
 * around this layer, so it is reported rather than coerced.
 */
export function toJsonObject(value: Prisma.JsonValue | null): JsonObject | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Expected a JSON object in the column, found ${typeof value}`);
  }
  return value as JsonObject;
}

/**
 * A domain JSON object as the value written to a nullable `Json` column.
 *
 * `Prisma.DbNull` and not `undefined` or `Prisma.JsonNull`: `undefined` means "leave the
 * column alone", which on an insert is not the same as writing null, and `JsonNull` writes
 * the JSON value `null` inside the column, which is a third state nothing in the domain
 * distinguishes. `DbNull` is SQL NULL, which is what "no metadata" means.
 */
export function fromJsonObject(
  value: JsonObject | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** A JSON value as the value written to a `Json` column that cannot be null. */
export function fromJsonValue(value: JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** The clock anchor of a world row, which is all the clock arithmetic needs. */
export function toClockAnchor(row: WorldRow): WorldClockAnchor {
  return {
    anchorGameMs: toGameMs(row.anchorGameMs),
    anchorRealMs: toRealMs(row.anchorRealMs),
    rateNum: row.rateNum,
    rateDen: row.rateDen,
    scheduleEpoch: row.scheduleEpoch,
  };
}

export function toWorld(row: WorldRow): World {
  return {
    id: toWorldId(row.id),
    seed: row.seed,
    generatorVersion: row.generatorVersion,
    chunkSize: row.chunkSize,
    createdAtRealMs: toRealMs(row.createdAtRealMs),
    ...toClockAnchor(row),
  };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * A player row as the domain entity. `passwordHash` is deliberately dropped: the
 * domain entity is what reaches the read models and the events, and a hash has no
 * business travelling through them.
 */
export function toPlayer(row: PlayerRow): Player {
  return {
    id: toPlayerId(row.id),
    worldId: toWorldId(row.worldId),
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    balance: toMoney(row.balance),
    startedAtGameMs: toGameMs(row.startedAtGameMs),
    lastAccrualGameMs: toGameMs(row.lastAccrualGameMs),
    lastLoginGameMs: toGameMs(row.lastLoginGameMs),
    lastSummaryGameMs: toGameMs(row.lastSummaryGameMs),
    ledgerSeq: row.ledgerSeq,
    eventSeq: row.eventSeq,
    spawnCellX: row.spawnCellX,
    spawnCellY: row.spawnCellY,
    createdAtRealMs: toRealMs(row.createdAtRealMs),
  };
}

// ---------------------------------------------------------------------------
// Ledger, outbox and event log
// ---------------------------------------------------------------------------

export function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id as LedgerEntry['id'],
    playerId: toPlayerId(row.playerId),
    seq: row.seq,
    type: row.type,
    amount: toMoney(row.amount),
    balanceAfter: toMoney(row.balanceAfter),
    atGameMs: toGameMs(row.atGameMs),
    refType: row.refType,
    refId: row.refId,
    meta: toJsonObject(row.meta),
    idempotencyKey: row.idempotencyKey,
    createdAtRealMs: toRealMs(row.createdAtRealMs),
  };
}

export function toScheduledEvent(row: ScheduledEventRow): ScheduledEvent {
  return {
    id: row.id as ScheduledEvent['id'],
    playerId: toPlayerId(row.playerId),
    kind: row.kind,
    dueGameMs: toGameMs(row.dueGameMs),
    epoch: row.epoch,
    refType: row.refType,
    refId: row.refId,
    status: row.status,
    dedupeKey: row.dedupeKey,
    enqueuedAtRealMs: toRealMsOrNull(row.enqueuedAtRealMs),
    processedAtGameMs: toGameMsOrNull(row.processedAtGameMs),
    jobId: row.jobId,
  };
}

export function toGameEvent(row: GameEventRow): GameEvent {
  const payload = toJsonObject(row.payload);
  return {
    id: row.id as GameEvent['id'],
    playerId: toPlayerId(row.playerId),
    seq: row.seq,
    type: row.type,
    atGameMs: toGameMs(row.atGameMs),
    payload: payload ?? {},
  };
}
