// The per player event log and the replay ring.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Plan section 7, one rule: the client is a cache and never an authority. What makes
// that decidable rather than hopeful is the sequence:
//
//     seq = last applied + 1   apply
//     seq <= last applied      discard as a duplicate
//     seq >  last applied + 1  there is a gap: replay, and fall back to a snapshot
//
// So the sequence is a contract, and this module is the only place that assigns it. It
// is incremented on the player row, inside the domain transaction and under the player
// lock, which is what makes it gapless: the rows of `game_events` are written in the
// same transaction as the state they describe, so a committed change always has its
// frame and a rolled back change never does.
//
// Two storage layers, with different jobs:
//
//   - `game_events` in PostgreSQL is authoritative and append-only, enforced by a
//     trigger. It is what `GET /api/events?since` reads when the ring no longer covers
//     the gap, and what makes losing Redis survivable.
//   - a bounded list in Redis is the fast path of the same replay. It is written after
//     the commit, like every other side effect, and its loss costs a database read.
//
// `CLOCK` never reaches either: it is periodic, carries no domain change and consumes no
// sequence number, and a CHECK in the database rejects it as well.

import { type Redis } from 'ioredis';
import { type RedisKeys } from '../plugins/redis.js';
import {
  MAX_EVENT_REPLAY,
  toWireGameMs,
  type GameMs,
  type JsonObject,
  type PlayerId,
  type WsServerEvent,
  type WsServerFrame,
} from '../shared/index.js';
import { fromJsonValue } from './dbMap.js';
import { type PlayerLock, type Tx } from './tx.js';

/**
 * A frame a domain path may emit: everything except the two transport tags. The type is
 * derived from the union of the contract, so a tag added to `GameEventType` is emittable
 * without touching this file, and a payload that does not match its tag does not compile.
 */
export type DomainEventDraft = Exclude<WsServerEvent, { readonly type: 'HELLO' | 'CLOCK' }>;

/** Builds the envelope of a frame from its draft. */
function frameOf(seq: number, atGameMs: GameMs, draft: DomainEventDraft): WsServerFrame {
  // The spread of a discriminated union loses the correlation between the tag and the
  // payload at the type level, and reconstructing it would need one branch per tag. The
  // correlation is guaranteed by the type of `draft`, which is why the assertion is
  // sound and stays inside this one function.
  return {
    seq,
    atGameMs: toWireGameMs(atGameMs),
    type: draft.type,
    payload: draft.payload,
  } as WsServerFrame;
}

/**
 * Appends frames to the log of a player and returns them with their sequence.
 *
 * The sequence is taken by incrementing the player row by the number of frames in one
 * update, so the block of sequences is reserved atomically and two concurrent writers
 * cannot interleave inside it. The rows are then inserted with `createMany`, which is a
 * single statement.
 *
 * Emitting no frames is legal and cheap: a mutation that changed nothing the client can
 * see still returns a sequence, which is the one it already had.
 */
export async function appendEvents(
  tx: Tx,
  lock: PlayerLock,
  atGameMs: GameMs,
  drafts: readonly DomainEventDraft[],
): Promise<{ readonly frames: readonly WsServerFrame[]; readonly seq: number }> {
  if (drafts.length === 0) {
    const player = await tx.player.findUniqueOrThrow({
      where: { id: lock.playerId },
      select: { eventSeq: true },
    });
    return { frames: [], seq: player.eventSeq };
  }

  // `CLOCK` cannot appear here: `DomainEventDraft` excludes it, so a caller that tried
  // would not compile, and a CHECK on `game_events` rejects it as well. Two independent
  // guards and no run time branch, which is what makes the transport only tag a property
  // of the type instead of a rule to remember.
  const player = await tx.player.update({
    where: { id: lock.playerId },
    data: { eventSeq: { increment: drafts.length } },
    select: { eventSeq: true },
  });
  const lastSeq = player.eventSeq;
  const firstSeq = lastSeq - drafts.length + 1;

  await tx.gameEvent.createMany({
    data: drafts.map((draft, index) => ({
      playerId: lock.playerId,
      seq: firstSeq + index,
      type: draft.type,
      atGameMs,
      payload: fromJsonValue(draft.payload as unknown as JsonObject),
    })),
  });

  return {
    frames: drafts.map((draft, index) => frameOf(firstSeq + index, atGameMs, draft)),
    seq: lastSeq,
  };
}

// ---------------------------------------------------------------------------
// The replay ring in Redis
// ---------------------------------------------------------------------------

/** Entries the ring keeps per player. The same ceiling as one replay page. */
export const RING_CAPACITY = MAX_EVENT_REPLAY;

/**
 * Time to live of the ring of a disconnected player. Long enough that a reload or a
 * tunnel outage replays instead of downloading a snapshot, short enough that an
 * abandoned account costs nothing. A player whose ring expired takes the snapshot path,
 * which is correct and only slower.
 */
export const RING_TTL_REAL_MS = 6 * 60 * 60 * 1000;

/**
 * Pushes frames onto the ring. Called after the commit, never inside the transaction:
 * Redis is not authoritative, and a ring that is ahead of the committed state would let
 * a replay hand the client something that was rolled back.
 */
export async function pushRing(
  redis: Redis,
  keys: RedisKeys,
  playerId: PlayerId,
  frames: readonly WsServerFrame[],
): Promise<void> {
  if (frames.length === 0) {
    return;
  }
  const key = keys.eventRing(playerId);
  // The newest frame is at index 0, so `LTRIM 0 capacity-1` drops the oldest, and one
  // pipeline keeps the three commands to a single round trip.
  await redis
    .multi()
    .lpush(key, ...frames.map((frame) => JSON.stringify(frame)).reverse())
    .ltrim(key, 0, RING_CAPACITY - 1)
    .pexpire(key, RING_TTL_REAL_MS)
    .exec();
}

/** What the ring can offer for a `since`. */
export interface RingRead {
  readonly frames: readonly WsServerFrame[];
  /** Oldest sequence the ring still holds, or `currentSeq + 1` when it holds nothing. */
  readonly oldestReplaySeq: number;
  /** True when the ring cannot cover the requested `since`. */
  readonly truncated: boolean;
}

/**
 * Reads the ring from a sequence. Only the envelope is parsed: the frames were validated
 * against the contract when they were built, and re-validating five hundred of them on a
 * reconnection would cost more than it protects.
 */
export async function readRing(
  redis: Redis,
  keys: RedisKeys,
  playerId: PlayerId,
  since: number,
  currentSeq: number,
  limit: number = RING_CAPACITY,
): Promise<RingRead> {
  const raw = await redis.lrange(keys.eventRing(playerId), 0, RING_CAPACITY - 1);
  if (raw.length === 0) {
    return {
      frames: [],
      oldestReplaySeq: currentSeq + 1,
      truncated: since < currentSeq,
    };
  }

  const frames: WsServerFrame[] = [];
  let oldest = Number.POSITIVE_INFINITY;
  // The list is newest first, so it is walked backwards to produce ascending sequences.
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const text = raw[index];
    if (text === undefined) {
      continue;
    }
    let frame: WsServerFrame;
    try {
      frame = JSON.parse(text) as WsServerFrame;
    } catch {
      continue;
    }
    oldest = Math.min(oldest, frame.seq);
    if (frame.seq > since && frames.length < limit) {
      frames.push(frame);
    }
  }

  const oldestReplaySeq = Number.isFinite(oldest) ? oldest : currentSeq + 1;
  return {
    frames,
    oldestReplaySeq,
    // The ring covers the request when it holds the frame right after `since`.
    truncated: since + 1 < oldestReplaySeq && since < currentSeq,
  };
}

/**
 * Reads the log from PostgreSQL, which is the fallback when the ring is truncated and
 * the source of truth for the replay of `GET /api/events?since`.
 */
export async function readLog(
  tx: Tx,
  playerId: PlayerId,
  since: number,
  limit: number,
): Promise<readonly WsServerFrame[]> {
  const rows = await tx.gameEvent.findMany({
    where: { playerId, seq: { gt: since } },
    orderBy: { seq: 'asc' },
    take: limit,
  });
  return rows.map((row) =>
    frameOf(
      row.seq,
      row.atGameMs as unknown as GameMs,
      {
        type: row.type,
        payload: row.payload,
      } as DomainEventDraft,
    ),
  );
}
