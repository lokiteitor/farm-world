// The simulated server: state, sequence and the event ring.
//
// Owner: W3-C.
//
// It is the thing that lets the panel agents of W4, W5 and W6 work with no backend at all
// (plan section 10), and the property that makes it worth writing rather than stubbing each
// panel is that it speaks the contract: one sequence per player, one ring of frames, frames
// emitted by a mutation before its reply is built, and the same schemas validating both
// directions. A panel developed against it exercises the real reducer, the real gap rule and
// the real resynchronisation ladder.
//
// The ring is bounded, and that is not an economy: the whole escalation from a replay to a
// full snapshot only ever happens when the ring cannot reach back far enough, so a ring that
// never truncated would leave the most delicate path of the client untested. Sixty four
// frames is small enough that a test can overflow it on purpose.

import { createMockWorld, type MockWorld } from '~/mock/world';
import {
  GameEventType,
  toWireGameMs,
  type WsServerEventType,
  type WsServerFrame,
} from '~/shared/index';

/** Frames the ring holds. Small on purpose, so truncation is reachable in a test. */
export const MOCK_RING_CAPACITY = 64;

export interface MockServerOptions {
  readonly seed?: number;
  readonly ringCapacity?: number;
  /** Whether a session is already open. False makes the login page appear. */
  readonly sessionOpen?: boolean;
}

export type MockFrameListener = (frame: WsServerFrame) => void;

export interface MockServer {
  readonly world: MockWorld;
  /** Frames still in the ring, oldest first. */
  readonly ring: readonly WsServerFrame[];
  sessionOpen: boolean;
  /** Next sequence and the frame it belongs to. Transport tags consume none. */
  emit: (type: WsServerEventType, payload: unknown) => WsServerFrame;
  /** A transport frame: it carries the current sequence and consumes none. */
  emitTransport: (type: WsServerEventType, payload: unknown) => WsServerFrame;
  currentSeq: () => number;
  oldestReplaySeq: () => number;
  /** Frames after a sequence, and whether the ring could reach it. */
  replay: (
    sinceSeq: number,
    limit: number,
  ) => { frames: readonly WsServerFrame[]; truncated: boolean };
  subscribe: (listener: MockFrameListener) => () => void;
  /** Chunks a connection is subscribed to, so a patch is only sent to those looking. */
  readonly subscribedChunks: Set<string>;
  reset: () => void;
}

export function createMockServer(options: MockServerOptions = {}): MockServer {
  const capacity = options.ringCapacity ?? MOCK_RING_CAPACITY;
  let world = createMockWorld(options.seed);
  let ring: WsServerFrame[] = [];
  const listeners = new Set<MockFrameListener>();
  const subscribedChunks = new Set<string>();
  let sessionOpen = options.sessionOpen ?? false;
  /** Oldest sequence the ring still holds. One when nothing has been dropped. */
  let dropped = 0;

  function push(frame: WsServerFrame): void {
    ring.push(frame);
    if (ring.length > capacity) {
      ring = ring.slice(1);
      dropped += 1;
    }
    for (const listener of [...listeners]) {
      listener(frame);
    }
  }

  const server: MockServer = {
    get world() {
      return world;
    },
    get ring() {
      return ring;
    },
    get sessionOpen() {
      return sessionOpen;
    },
    set sessionOpen(value: boolean) {
      sessionOpen = value;
    },
    subscribedChunks,

    emit(type, payload) {
      world.eventSeq += 1;
      world.player = { ...world.player, eventSeq: world.eventSeq };
      const frame = {
        seq: world.eventSeq,
        atGameMs: toWireGameMs(world.nowGameMs),
        type,
        payload,
      } as WsServerFrame;
      push(frame);
      return frame;
    },

    emitTransport(type, payload) {
      const frame = {
        seq: world.eventSeq,
        atGameMs: toWireGameMs(world.nowGameMs),
        type,
        payload,
      } as WsServerFrame;
      // A transport frame is not part of the ring: it consumes no sequence and replaying it
      // would put a duplicate clock reading in the middle of a recovery.
      for (const listener of [...listeners]) {
        listener(frame);
      }
      return frame;
    },

    currentSeq: () => world.eventSeq,

    oldestReplaySeq: () => dropped + 1,

    replay(sinceSeq, limit) {
      const firstMissing = sinceSeq + 1;
      const truncated = ring.length > 0 && firstMissing < dropped + 1;
      const frames = ring.filter((frame) => frame.seq > sinceSeq).slice(0, limit);
      return { frames, truncated };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    reset() {
      world = createMockWorld(options.seed);
      ring = [];
      dropped = 0;
      subscribedChunks.clear();
      sessionOpen = options.sessionOpen ?? false;
    },
  };

  return server;
}

/** The clock frame, which the socket sends periodically (plan section 7). */
export function clockFrameType(): WsServerEventType {
  return GameEventType.CLOCK;
}
