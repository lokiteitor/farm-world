// The WebSocket: one channel per player, a single use ticket, and the sequence contract.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Why a ticket. A browser cannot set a header on a WebSocket handshake, and an access token
// in the query string ends up in the logs of every proxy on the way. So the client asks for
// a ticket over REST, the ticket lives thirty seconds in Redis, and redeeming it deletes it
// in the same round trip with `GETDEL`: a ticket that is replayed finds nothing (plan
// section 7).
//
// Why the frames come from Redis and not from the process that produced them. The mutation
// that produces a frame may run in the worker, and the socket is held by the server; with
// several instances of either, the socket may be on a third process. Publishing to
// `farm-world:events:<playerId>` and subscribing per connected player is what makes that
// work without any of them knowing about the others.
//
// The sequence contract, which is what the client depends on (plan section 7):
//
//   - `HELLO` is the first frame of every connection and carries the current sequence, the
//     oldest sequence the replay ring still holds, the clock and the contract version. So
//     reconnection and a sequence gap end up on the same code path: the client compares its
//     own mark and decides between applying, replaying and a full snapshot.
//   - Domain frames carry their own sequence, assigned when the row was written inside the
//     transaction (`lib/events.ts`). This plugin never assigns one.
//   - `CLOCK` and `HELLO` consume no sequence and carry the last one assigned, so the client
//     applies their payload and leaves its mark where it was.
//   - A frame that is not delivered is never lost: the row is in `game_events` and the ring
//     usually still has it, so the client replays. That is what lets the storm guard of
//     `lib/pubsub.ts` drop frames on purpose.
//
// One connection per player. A second one supersedes the first, which is closed with 4410.
// Two sockets for one player would both be correct, but the client would then apply every
// frame twice in two tabs and, more to the point, the heartbeat bookkeeping would have to
// become per socket for no benefit the interface asks for.

import { randomUUID } from 'node:crypto';
import websocketPlugin from '@fastify/websocket';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { type ServiceContext } from '../lib/context.js';
import { readRing } from '../lib/events.js';
import { toClockDto } from '../lib/playerView.js';
import { parseChannelMessage, playerOfChannel } from '../lib/pubsub.js';
import {
  CLOCK_EVENT_INTERVAL_REAL_MS,
  CONTRACT_VERSION_HEADER,
  GameEventType,
  MAX_CHUNK_SUBSCRIPTIONS,
  SHARED_CONTRACT_VERSION,
  WS_CLOSE_CODES,
  WS_HEARTBEAT_INTERVAL_REAL_MS,
  WS_PATH,
  WS_TICKET_TTL_REAL_MS,
  WsTransportEventType,
  toWireGameMs,
  wsClientMessageSchema,
  type PlayerId,
  type WsServerFrame,
  type WsTicketReply,
} from '../shared/index.js';

/**
 * The part of the socket API this plugin uses.
 *
 * Declared here rather than imported from `ws`, whose types are not installed:
 * `@fastify/websocket` references them, `skipLibCheck` swallows the unresolved import and
 * the parameter would silently become `any`. A narrow structural type is both honest about
 * what is used and assignable to what the plugin passes in.
 */
export interface WsSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close' | 'error', listener: () => void): void;
}

/** `readyState` of an open socket, as the WebSocket specification defines it. */
const SOCKET_OPEN = 1;

/** How long the heartbeat may be silent before the connection is closed. */
export const HEARTBEAT_TIMEOUT_REAL_MS = WS_HEARTBEAT_INTERVAL_REAL_MS * 3;

/** State of one connection. */
interface Connection {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly socket: WsSocket;
  lastSeenRealMs: bigint;
  /** Chunks the client asked for live updates on. Recorded for the renderer of W4-D. */
  readonly chunks: Set<string>;
}

/** What the rest of the backend can do with the hub. */
export interface WsHub {
  /** Live connections, which is also what the gauge reports. */
  readonly size: number;
  /** Issues a single use ticket for a player (`POST /api/auth/ws-ticket`). */
  issueTicket(playerId: PlayerId): Promise<WsTicketReply>;
  /** Closes every connection, for an orderly shutdown. */
  closeAll(code: number, reason: string): void;
  /** The chunk subscriptions of a player, for the renderer of workflow W4-D. */
  subscribedChunks(playerId: PlayerId): readonly string[];
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The hub, so that `POST /api/auth/ws-ticket` can issue a ticket. */
    wsHub: WsHub;
  }
}

/** Key of a chunk subscription. Coordinates only, in a form that is cheap to compare. */
function chunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`;
}

/**
 * Registers the WebSocket route and returns the hub.
 *
 * The single Redis subscriber is shared: one `message` listener resolves the player from the
 * channel name and forwards to that player's socket. Subscribing per connected player, and
 * not with a pattern over everything, keeps a process from receiving the traffic of players
 * it does not serve.
 */
export async function registerWebSocket(
  app: FastifyInstance,
  services: ServiceContext,
): Promise<WsHub> {
  await app.register(websocketPlugin, {
    options: {
      // A client message is a heartbeat or a list of chunk coordinates. Nothing legitimate
      // is large, and an unbounded payload is a way to make the process allocate.
      maxPayload: 64 * 1024,
    },
  });

  const connections = new Map<PlayerId, Connection>();
  const subscriber = services.redis.subscriber;

  const send = (connection: Connection, frame: WsServerFrame): void => {
    if (connection.socket.readyState !== SOCKET_OPEN) {
      return;
    }
    try {
      connection.socket.send(JSON.stringify(frame));
    } catch (error) {
      services.logger.warn(
        { err: error, playerId: connection.playerId },
        'could not write to the socket',
      );
    }
  };

  subscriber.on('message', (channel: string, message: string) => {
    const playerId = playerOfChannel(services.keys, channel);
    if (playerId === null) {
      return;
    }
    const connection = connections.get(playerId);
    if (connection === undefined) {
      return;
    }
    const frame = parseChannelMessage(message);
    if (frame === null) {
      services.logger.warn({ channel }, 'unreadable message on a player channel');
      return;
    }
    send(connection, frame);
  });

  const attach = async (connection: Connection): Promise<void> => {
    const previous = connections.get(connection.playerId);
    if (previous !== undefined) {
      previous.socket.close(WS_CLOSE_CODES.SUPERSEDED, 'superseded');
      connections.delete(connection.playerId);
    } else {
      await subscriber.subscribe(services.keys.playerChannel(connection.playerId));
    }
    connections.set(connection.playerId, connection);
    services.metrics.wsConnections.set(connections.size);
  };

  const detach = async (connection: Connection): Promise<void> => {
    const current = connections.get(connection.playerId);
    if (current?.id !== connection.id) {
      // Already superseded by a newer connection, which owns the subscription now.
      return;
    }
    connections.delete(connection.playerId);
    services.metrics.wsConnections.set(connections.size);
    await subscriber
      .unsubscribe(services.keys.playerChannel(connection.playerId))
      .catch(() => undefined);
  };

  app.get(WS_PATH, { websocket: true }, (socket: WsSocket, request: FastifyRequest) => {
    void openConnection({ services, socket, request, attach, detach, send });
  });

  // One timer for every connection, and not one per connection: it reads the clock once and
  // sends the same `CLOCK` frame to everybody, which is what a periodic reading is for.
  const clockTimer = setInterval(() => {
    void (async () => {
      if (connections.size === 0) {
        return;
      }
      try {
        const reading = await services.clock.read();
        const now = reading.atRealMs;
        for (const connection of [...connections.values()]) {
          if (now - connection.lastSeenRealMs > BigInt(HEARTBEAT_TIMEOUT_REAL_MS)) {
            connection.socket.close(WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, 'heartbeat timeout');
            continue;
          }
          const player = await services.prisma.player.findUnique({
            where: { id: connection.playerId },
            select: { eventSeq: true },
          });
          send(connection, {
            seq: player?.eventSeq ?? 0,
            atGameMs: toWireGameMs(reading.gameNow),
            type: GameEventType.CLOCK,
            payload: { clock: toClockDto(reading) },
          });
        }
      } catch (error) {
        services.logger.warn({ err: error }, 'could not send the periodic clock frame');
      }
    })();
  }, CLOCK_EVENT_INTERVAL_REAL_MS);
  clockTimer.unref();

  app.addHook('onClose', async () => {
    clearInterval(clockTimer);
  });

  return {
    get size() {
      return connections.size;
    },
    async issueTicket(playerId: PlayerId): Promise<WsTicketReply> {
      const ticket = randomUUID();
      await services.redis.commands.set(
        services.keys.wsTicket(ticket),
        playerId,
        'PX',
        WS_TICKET_TTL_REAL_MS,
      );
      const expiresAtRealMs = services.clock.nowRealMs() + BigInt(WS_TICKET_TTL_REAL_MS);
      return {
        ticket,
        expiresAtRealMs: expiresAtRealMs.toString(),
        expiresInRealMs: WS_TICKET_TTL_REAL_MS,
        path: WS_PATH,
      };
    },
    closeAll(code: number, reason: string): void {
      for (const connection of [...connections.values()]) {
        connection.socket.close(code, reason);
      }
      connections.clear();
      services.metrics.wsConnections.set(0);
    },
    subscribedChunks(playerId: PlayerId): readonly string[] {
      return [...(connections.get(playerId)?.chunks ?? [])];
    },
  };
}

/** Everything the connection handler needs, gathered so the handler stays readable. */
interface OpenOptions {
  readonly services: ServiceContext;
  readonly socket: WsSocket;
  readonly request: FastifyRequest;
  attach(connection: Connection): Promise<void>;
  detach(connection: Connection): Promise<void>;
  send(connection: Connection, frame: WsServerFrame): void;
}

/**
 * Redeems the ticket, greets the client and installs the message handlers.
 *
 * The order matters: nothing is sent before the ticket is redeemed, so an unauthenticated
 * socket learns nothing at all, not even the shape of the greeting.
 */
async function openConnection(options: OpenOptions): Promise<void> {
  const { services, socket, request } = options;

  const clientVersion = request.headers[CONTRACT_VERSION_HEADER];
  if (typeof clientVersion === 'string' && clientVersion !== SHARED_CONTRACT_VERSION) {
    socket.close(WS_CLOSE_CODES.CONTRACT_MISMATCH, 'contract version mismatch');
    return;
  }

  const query = request.query as Record<string, unknown> | undefined;
  const ticket = typeof query?.['ticket'] === 'string' ? query['ticket'] : null;
  if (ticket === null || ticket.length < 16) {
    socket.close(WS_CLOSE_CODES.TICKET_INVALID, 'ticket missing');
    return;
  }

  // Single use: the read and the delete are one command, so two clients cannot both redeem.
  const playerIdText = await services.redis.commands.getdel(services.keys.wsTicket(ticket));
  if (playerIdText === null) {
    socket.close(WS_CLOSE_CODES.TICKET_INVALID, 'ticket invalid or already used');
    return;
  }
  const playerId = playerIdText as PlayerId;

  const player = await services.prisma.player.findUnique({
    where: { id: playerId },
    select: { eventSeq: true },
  });
  if (player === null) {
    socket.close(WS_CLOSE_CODES.TICKET_INVALID, 'unknown player');
    return;
  }

  const reading = await services.clock.read();
  const connection: Connection = {
    id: randomUUID(),
    playerId,
    socket,
    lastSeenRealMs: reading.atRealMs,
    chunks: new Set<string>(),
  };
  await options.attach(connection);

  const ring = await readRing(
    services.redis.commands,
    services.keys,
    playerId,
    player.eventSeq,
    player.eventSeq,
  );

  options.send(connection, {
    seq: player.eventSeq,
    atGameMs: toWireGameMs(reading.gameNow),
    type: WsTransportEventType.HELLO,
    payload: {
      playerId,
      seq: player.eventSeq,
      oldestReplaySeq: ring.oldestReplaySeq,
      clock: toClockDto(reading),
      contractVersion: SHARED_CONTRACT_VERSION,
      heartbeatIntervalRealMs: WS_HEARTBEAT_INTERVAL_REAL_MS,
    },
  });

  services.logger.info({ playerId, connectionId: connection.id }, 'websocket connected');

  socket.on('message', (data: unknown) => {
    const parsed = wsClientMessageSchema.safeParse(safeJson(data));
    if (!parsed.success) {
      // An unreadable message is ignored and not fatal: the client has no way to send
      // anything that mutates, so the worst case is a dropped heartbeat.
      services.logger.debug({ playerId }, 'unreadable client message');
      return;
    }
    const message = parsed.data;
    connection.lastSeenRealMs = services.clock.nowRealMs();
    switch (message.type) {
      case 'ping':
        // Nothing is sent back: the contract declares no pong frame, and liveness is what
        // the timestamp above records. The periodic `CLOCK` frame is the traffic in the
        // other direction.
        break;
      case 'subscribeChunks':
        for (const chunk of message.chunks) {
          if (connection.chunks.size >= MAX_CHUNK_SUBSCRIPTIONS) {
            break;
          }
          connection.chunks.add(chunkKey(chunk.chunkX, chunk.chunkY));
        }
        break;
      case 'unsubscribeChunks':
        for (const chunk of message.chunks) {
          connection.chunks.delete(chunkKey(chunk.chunkX, chunk.chunkY));
        }
        break;
      default: {
        const unreachable: never = message;
        throw new Error(`Unhandled client message: ${JSON.stringify(unreachable)}`);
      }
    }
  });

  socket.on('close', () => {
    void options.detach(connection).then(() => {
      services.logger.info({ playerId, connectionId: connection.id }, 'websocket closed');
    });
  });

  socket.on('error', () => {
    void options.detach(connection);
  });
}

/** Parses whatever the socket delivered. Returns null for anything unreadable. */
function safeJson(data: unknown): unknown {
  try {
    const text =
      typeof data === 'string'
        ? data
        : data instanceof Uint8Array
          ? Buffer.from(data).toString('utf8')
          : String(data);
    return JSON.parse(text);
  } catch {
    return null;
  }
}
