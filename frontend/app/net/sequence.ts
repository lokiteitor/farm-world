// The sequence rule of the client, and the resynchronisation ladder.
//
// Owner: W3-C. Pure functions, so that the one rule the whole synchronisation design
// rests on is decidable and testable rather than spread over the socket handler.
//
// The rule, from plan section 7 and shared/ws/envelope.ts:
//
//   seq === last + 1   apply
//   seq <= last        discard, it is a duplicate or an echo already applied
//   seq >  last + 1    there is a gap
//
// A gap is not an error and not a reason to reload: it is the normal outcome of a
// dropped connection. It leads into a ladder with exactly two rungs, in this order:
// replay the bounded ring with `GET /api/events?since`, and if the ring no longer
// reaches back that far, rebuild everything with `GET /api/state/snapshot` and
// invalidate the loaded chunks. Reconnection enters the same ladder, because `HELLO`
// reports the current sequence and the client compares it against its own mark; that
// shared path is why a reconnection needs no code of its own.
//
// Two tags consume no sequence number, `CLOCK` and `HELLO`. They are applied for their
// payload and leave the mark where it was, so a clock frame during a gap neither closes
// it nor makes it worse.

import { WS_TRANSPORT_ONLY_EVENT_TYPES, type WsServerEventType } from '~/shared/index';

/** What to do with one incoming frame. */
export const FrameVerdict = {
  /** Next in sequence: apply it and advance the mark. */
  APPLY: 'APPLY',
  /** Carries no sequence: apply the payload and leave the mark alone. */
  APPLY_TRANSPORT: 'APPLY_TRANSPORT',
  /** Already applied: discard it. */
  DISCARD: 'DISCARD',
  /** Something is missing between the mark and this frame. */
  GAP: 'GAP',
} as const;
export type FrameVerdict = (typeof FrameVerdict)[keyof typeof FrameVerdict];

export interface SequencedFrame {
  readonly seq: number;
  readonly type: WsServerEventType;
}

/** Whether a tag consumes a sequence number. */
export function consumesSequence(type: WsServerEventType): boolean {
  return !WS_TRANSPORT_ONLY_EVENT_TYPES.includes(type);
}

/**
 * The verdict for one frame against the mark.
 *
 * `lastAppliedSeq` is the sequence of the last domain frame that was applied, and zero
 * means nothing has been applied yet, which is the value the server's own sequence
 * starts from.
 */
export function decideFrame(lastAppliedSeq: number, frame: SequencedFrame): FrameVerdict {
  if (!consumesSequence(frame.type)) {
    return FrameVerdict.APPLY_TRANSPORT;
  }
  if (frame.seq <= lastAppliedSeq) {
    return FrameVerdict.DISCARD;
  }
  return frame.seq === lastAppliedSeq + 1 ? FrameVerdict.APPLY : FrameVerdict.GAP;
}

/**
 * The verdict for the reply of a mutating route, which travels through the same
 * reducer as a frame (shared/api/README.md, section 4).
 *
 * The rule is `>` and not `=== last + 1`: the reply carries the sequence of the last
 * event the mutation produced, and a mutation may produce several, so a hole between
 * the mark and it is expected rather than a gap. Every entity in `result` is a full
 * replacement, so applying it is safe and the frames it skipped over will be discarded
 * as duplicates when they arrive.
 */
export function decideMutationReply(lastAppliedSeq: number, seq: number): FrameVerdict {
  return seq > lastAppliedSeq ? FrameVerdict.APPLY : FrameVerdict.DISCARD;
}

// ---------------------------------------------------------------------------
// The resynchronisation ladder
// ---------------------------------------------------------------------------

export const ResyncAction = {
  /** Nothing is missing. */
  NONE: 'NONE',
  /** Replay from `since` with `GET /api/events?since`. */
  REPLAY: 'REPLAY',
  /** The ring no longer covers it: rebuild with `GET /api/state/snapshot`. */
  SNAPSHOT: 'SNAPSHOT',
} as const;
export type ResyncAction = (typeof ResyncAction)[keyof typeof ResyncAction];

export interface ResyncInput {
  /** Mark of the client. */
  readonly lastAppliedSeq: number;
  /** Sequence the server reports, from `HELLO`, from a frame or from a replay. */
  readonly currentSeq: number;
  /** Oldest sequence the replay ring still holds, from `HELLO` or from a replay. */
  readonly oldestReplaySeq: number;
  /** Whether the last replay reported that it could not reach `since`. */
  readonly truncated?: boolean;
}

export interface ResyncStep {
  readonly action: ResyncAction;
  /** `since` of the replay request. Zero for the other two actions. */
  readonly sinceSeq: number;
  /** Why this rung was chosen. Meant for a log line, never for the interface. */
  readonly reason: string;
}

/**
 * The next rung of the ladder.
 *
 * The comparison that decides between replaying and a full snapshot is
 * `oldestReplaySeq <= lastAppliedSeq + 1`: the ring has to contain the very first frame
 * the client is missing, not merely overlap the range. Getting that boundary wrong
 * produces the worst possible failure of this design, a client that believes it caught
 * up while a frame is missing for good.
 */
export function nextResyncStep(input: ResyncInput): ResyncStep {
  if (input.truncated === true) {
    return {
      action: ResyncAction.SNAPSHOT,
      sinceSeq: 0,
      reason: 'el anillo de reproduccion ya no cubre la secuencia pedida',
    };
  }
  if (input.currentSeq <= input.lastAppliedSeq) {
    return { action: ResyncAction.NONE, sinceSeq: 0, reason: 'sin hueco' };
  }
  const firstMissing = input.lastAppliedSeq + 1;
  if (input.oldestReplaySeq <= firstMissing) {
    return {
      action: ResyncAction.REPLAY,
      sinceSeq: input.lastAppliedSeq,
      reason: 'hueco cubierto por el anillo',
    };
  }
  return {
    action: ResyncAction.SNAPSHOT,
    sinceSeq: 0,
    reason: 'el hueco empieza por debajo del anillo',
  };
}
