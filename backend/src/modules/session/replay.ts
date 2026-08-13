// `GET /api/events?since`: the second rung of the resynchronisation ladder.
//
// Owner: workflow W6-B. Module `session`.
//
// The rule the client applies is decided in `shared/ws` and implemented in `lib/events.ts`
// (ADR-0019): a frame whose sequence is the last applied plus one is applied, one at or below
// is a duplicate, and anything above is a gap. This route answers the gap, and the only
// question it really has to settle is when it must refuse to.
//
// The replay is one page and never a sequence of them. `truncated` therefore means "this reply
// does not carry the frame you are missing, so replaying is impossible and the remaining route
// is a full snapshot", which is what `shared/ws/envelope.ts` declares and what the client acts
// on. Paging a gap would be the wrong trade: a client more than one page behind is cheaper to
// rebuild from a snapshot than to walk forward through several hundred frames, and half a gap
// applied is a state the reducer would have to reason about.
//
// Two storage layers answer it, with the papers ADR-0019 gave them:
//
//   1. The bounded list in Redis is the fast path, and its capacity is the same as the page
//      ceiling, so "the ring reaches" and "the gap fits in one page" are the same statement
//      whenever the ring is intact.
//   2. `game_events` in PostgreSQL is authoritative and append only, and it answers when the
//      ring does not — which, given the ceiling above, only happens when the ring was lost or
//      its time to live expired. That is what makes losing Redis cost a database read and
//      nothing else.
//
// So the horizon is a property of the transport and not of the store: past `limit` frames the
// answer is the snapshot whichever layer could have served it, and inside `limit` frames the
// answer is the same frames whichever layer does serve it.

import { type ServiceContext } from '../../lib/context.js';
import { readLog, readRing } from '../../lib/events.js';
import { type Db } from '../../lib/tx.js';
import {
  MAX_EVENT_REPLAY,
  toWireGameMs,
  type EventReplayReply,
  type GameMs,
  type PlayerId,
  type WsServerFrame,
} from '../../shared/index.js';

/** What the route needs in order to answer, so the decision is testable without HTTP. */
export interface ReplayInput {
  readonly since: number;
  readonly limit: number;
  readonly atGameMs: GameMs;
}

/**
 * Builds the replay reply of a player.
 *
 * `currentSeq` is read from the player row and not from the ring: the ring is not
 * authoritative and a ring that lost its last entries would make the client believe it had
 * caught up. The row is the same counter `lib/events.ts` increments inside the domain
 * transaction, so it is exactly the sequence of the last committed change.
 */
export async function buildReplay(
  services: ServiceContext,
  db: Db,
  playerId: PlayerId,
  input: ReplayInput,
): Promise<EventReplayReply> {
  const player = await db.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { eventSeq: true },
  });
  const currentSeq = player.eventSeq;
  const limit = Math.min(Math.max(1, input.limit), MAX_EVENT_REPLAY);
  const since = Math.max(0, Math.min(input.since, currentSeq));

  const ring = await readRing(
    services.redis.commands,
    services.keys,
    playerId,
    since,
    currentSeq,
    limit,
  );

  // The oldest sequence this endpoint could serve: the older of what the ring still holds and
  // what one page of the log reaches back to. It is reported so the decision is explainable in
  // a client log, and the client acts on `truncated`, which is the same question answered.
  const logOldest = currentSeq <= limit ? 1 : currentSeq - limit + 1;
  const oldestReplaySeq = Math.min(ring.oldestReplaySeq, Math.max(1, logOldest));

  const gap = currentSeq - since;
  if (gap <= 0) {
    return {
      since,
      through: since,
      currentSeq,
      oldestReplaySeq,
      truncated: false,
      frames: [],
      atGameMs: toWireGameMs(input.atGameMs),
    };
  }

  if (gap > limit) {
    // Beyond the horizon of one page. Sending what fits would leave the client half applied
    // and force the snapshot anyway, so nothing is sent and the escalation is explicit.
    return {
      since,
      through: since,
      currentSeq,
      oldestReplaySeq,
      truncated: true,
      frames: [],
      atGameMs: toWireGameMs(input.atGameMs),
    };
  }

  let frames: readonly WsServerFrame[] = ring.frames;
  if (ring.truncated || frames.length === 0) {
    // The ring cannot cover a gap that fits in a page, which means the ring was lost. The
    // authoritative log answers, at the cost of one indexed read.
    frames = await readLog(db, playerId, since, limit);
  }

  const last = frames[frames.length - 1];
  return {
    since,
    through: last === undefined ? since : last.seq,
    currentSeq,
    oldestReplaySeq,
    // The gap fits in a page and one of the two layers holds it, so the client can close it.
    truncated: false,
    frames: [...frames],
    atGameMs: toWireGameMs(input.atGameMs),
  };
}
