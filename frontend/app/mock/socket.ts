// The simulated WebSocket.
//
// Owner: W3-C.
//
// It implements `WsSocketLike` and nothing more, which is the whole reason that seam exists:
// the reconnection logic, the heartbeat and the sequence rule of net/ws.ts run unchanged
// against it, so what a panel of W4 to W6 develops against is the real client and not a
// simplified one.
//
// It answers a `ping` with a `CLOCK` frame. That is not an invention of the mock: the
// contract declares a `ping` from the client and no acknowledgement tag from the server
// (shared/ws/envelope.ts), so what the client can measure is inbound traffic, and `CLOCK` is
// the frame that already exists, carries what the client wants and consumes no sequence. The
// recommendation for the backend of W3-A is recorded in the handoff.

import { type MockServer } from '~/mock/server';
import { mockClock } from '~/mock/world';
import { type WsSocketLike } from '~/net/ws';
import {
  SHARED_CONTRACT_VERSION,
  WS_HEARTBEAT_INTERVAL_REAL_MS,
  toWireGameMs,
  wsClientMessageSchema,
  type WsServerFrame,
} from '~/shared/index';

export interface MockSocketOptions {
  /** Delay before the handshake completes, in real milliseconds. */
  readonly openDelayRealMs?: number;
  /** Period of the unsolicited clock frame. Zero disables it. */
  readonly clockIntervalRealMs?: number;
}

/**
 * A socket bound to the simulated server. One per connection attempt, exactly like the real
 * one: `net/ws.ts` builds a new one for every reconnection.
 */
export function createMockSocket(
  server: MockServer,
  url: string,
  options: MockSocketOptions = {},
): WsSocketLike {
  const openDelay = options.openDelayRealMs ?? 5;
  const clockInterval = options.clockIntervalRealMs ?? 30_000;

  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  const socket: WsSocketLike = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,

    send(data: string): void {
      if (closed) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data) as unknown;
      } catch {
        return;
      }
      const message = wsClientMessageSchema.safeParse(parsed);
      if (!message.success) {
        return;
      }
      switch (message.data.type) {
        case 'ping':
          deliver(clockFrame());
          break;
        case 'subscribeChunks':
          for (const chunk of message.data.chunks) {
            server.subscribedChunks.add(`${chunk.chunkX}:${chunk.chunkY}`);
          }
          break;
        case 'unsubscribeChunks':
          for (const chunk of message.data.chunks) {
            server.subscribedChunks.delete(`${chunk.chunkX}:${chunk.chunkY}`);
          }
          break;
      }
    },

    close(code?: number, reason?: string): void {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
      if (clockTimer !== null) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
      socket.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
    },
  };

  function deliver(frame: WsServerFrame): void {
    if (closed) {
      return;
    }
    socket.onmessage?.({ data: JSON.stringify(frame) });
  }

  function clockFrame(): WsServerFrame {
    return {
      seq: server.currentSeq(),
      atGameMs: toWireGameMs(server.world.nowGameMs),
      type: 'CLOCK',
      payload: { clock: mockClock(server.world) },
    };
  }

  function helloFrame(): WsServerFrame {
    return {
      seq: server.currentSeq(),
      atGameMs: toWireGameMs(server.world.nowGameMs),
      type: 'HELLO',
      payload: {
        playerId: server.world.player.id,
        seq: server.currentSeq(),
        oldestReplaySeq: server.oldestReplaySeq(),
        clock: mockClock(server.world),
        contractVersion: SHARED_CONTRACT_VERSION,
        heartbeatIntervalRealMs: WS_HEARTBEAT_INTERVAL_REAL_MS,
      },
    };
  }

  // The handshake refuses without a ticket, exactly as the real one does: a client that
  // forgot to ask for one has to fail here and not silently work in development.
  const hasTicket = url.includes('ticket=');

  setTimeout(() => {
    if (closed) {
      return;
    }
    if (!hasTicket) {
      closed = true;
      socket.onclose?.({ code: 4401, reason: 'ticket invalid' });
      return;
    }
    socket.onopen?.({});
    deliver(helloFrame());
    unsubscribe = server.subscribe((frame) => {
      deliver(frame);
    });
    if (clockInterval > 0) {
      clockTimer = setInterval(() => {
        deliver(clockFrame());
      }, clockInterval);
    }
  }, openDelay);

  return socket;
}
