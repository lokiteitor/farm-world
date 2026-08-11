// The envelope of a WebSocket frame, and the messages the client may send.
//
// Owner: workflow W2 (API contract).
//
// One envelope, one rule (plan section 7):
//
//     { seq, atGameMs, type, payload }
//
// `seq` is monotonic per player and is backed by the `GameEvent` table, which is what
// makes the rule the client applies decidable rather than heuristic: equal to the last
// applied plus one, apply; less than or equal, discard as a duplicate; above, there is a
// gap, so replay from `GET /api/events?since` and fall back to a full snapshot if the
// ring no longer covers it.
//
// `atGameMs` is the instant of game time the change belongs to, not the instant it was
// sent. The difference matters for a frame produced by a job that ran late: the client
// places the change where it happened and keeps its own clock extrapolating from the
// anchor, instead of inferring time from arrival.
//
// Transport only frames (`CLOCK` and `HELLO`) carry the last sequence the server
// assigned and consume none, so the client applies their payload and leaves its mark
// where it was.

import { z } from 'zod';
import {
  chunkCoordSchema,
  gameMsSchema,
  MAX_CHUNK_SUBSCRIPTIONS,
  MAX_EVENT_REPLAY,
  realMsSchema,
  seqSchema,
} from '../api/schemas/common.js';
import { GameEventType } from '../domain/enums.js';
import {
  buildingRemovedPayloadSchema,
  buildingUpsertedPayloadSchema,
  chunkPatchedPayloadSchema,
  clockPayloadSchema,
  farmUpsertedPayloadSchema,
  fieldRemovedPayloadSchema,
  fieldUpsertedPayloadSchema,
  forestPlotRemovedPayloadSchema,
  forestPlotUpsertedPayloadSchema,
  helloPayloadSchema,
  inventoryUpsertedPayloadSchema,
  ledgerAppendedPayloadSchema,
  machineRemovedPayloadSchema,
  machineUpsertedPayloadSchema,
  noticePayloadSchema,
  playerUpsertedPayloadSchema,
  taskUpsertedPayloadSchema,
  treesUpsertedPayloadSchema,
  workerPoolUpsertedPayloadSchema,
  workerRemovedPayloadSchema,
  workerUpsertedPayloadSchema,
  WsTransportEventType,
  type WsServerEventType,
} from './events.js';

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/**
 * The four fields every frame carries, without the correlation between the tag and the
 * payload. It exists for the documentation and for a caller that only needs to route by
 * tag; parsing a frame goes through `wsServerFrameSchema`, which does correlate them.
 */
export const wsEnvelopeSchema = z.looseObject({
  seq: seqSchema,
  atGameMs: gameMsSchema,
  type: z.string().min(1).max(64),
});
export type WsEnvelope = z.infer<typeof wsEnvelopeSchema>;

/** Builds the frame schema of one tag, with its payload correlated to it. */
function frameSchema<TType extends WsServerEventType, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) {
  return z.strictObject({
    seq: seqSchema,
    atGameMs: gameMsSchema,
    type: z.literal(type),
    payload,
  });
}

/**
 * Every frame the server can send, discriminated by `type`.
 *
 * The members are written out and not generated, for the same reason as in events.ts: a
 * generated union loses the correlation between the tag and the payload at the type
 * level, and that correlation is what lets the reducer of the client switch on `type`
 * and see the right payload in each branch without a cast.
 */
export const wsServerFrameSchema = z.discriminatedUnion('type', [
  frameSchema(WsTransportEventType.HELLO, helloPayloadSchema),
  frameSchema(GameEventType.CLOCK, clockPayloadSchema),
  frameSchema(GameEventType.PLAYER_UPSERTED, playerUpsertedPayloadSchema),
  frameSchema(GameEventType.LEDGER_APPENDED, ledgerAppendedPayloadSchema),
  frameSchema(GameEventType.INVENTORY_UPSERTED, inventoryUpsertedPayloadSchema),
  frameSchema(GameEventType.CHUNK_PATCHED, chunkPatchedPayloadSchema),
  frameSchema(GameEventType.FARM_UPSERTED, farmUpsertedPayloadSchema),
  frameSchema(GameEventType.BUILDING_UPSERTED, buildingUpsertedPayloadSchema),
  frameSchema(GameEventType.BUILDING_REMOVED, buildingRemovedPayloadSchema),
  frameSchema(GameEventType.FIELD_UPSERTED, fieldUpsertedPayloadSchema),
  frameSchema(GameEventType.FIELD_REMOVED, fieldRemovedPayloadSchema),
  frameSchema(GameEventType.MACHINE_UPSERTED, machineUpsertedPayloadSchema),
  frameSchema(GameEventType.MACHINE_REMOVED, machineRemovedPayloadSchema),
  frameSchema(GameEventType.WORKER_UPSERTED, workerUpsertedPayloadSchema),
  frameSchema(GameEventType.WORKER_REMOVED, workerRemovedPayloadSchema),
  frameSchema(GameEventType.WORKER_POOL_UPSERTED, workerPoolUpsertedPayloadSchema),
  frameSchema(GameEventType.TASK_UPSERTED, taskUpsertedPayloadSchema),
  frameSchema(GameEventType.FOREST_PLOT_UPSERTED, forestPlotUpsertedPayloadSchema),
  frameSchema(GameEventType.FOREST_PLOT_REMOVED, forestPlotRemovedPayloadSchema),
  frameSchema(GameEventType.TREES_UPSERTED, treesUpsertedPayloadSchema),
  frameSchema(GameEventType.NOTICE, noticePayloadSchema),
]);
export type WsServerFrame = z.infer<typeof wsServerFrameSchema>;

/** The frame of one tag, for a caller that already knows which tag it holds. */
export type WsFrameOf<TType extends WsServerEventType> = Extract<WsServerFrame, { type: TType }>;

// ---------------------------------------------------------------------------
// GET /api/events?since
// ---------------------------------------------------------------------------

/**
 * Replay of the event ring. It lives here and not in shared/api/schemas/state.ts because
 * what it carries is a list of frames, and duplicating the union would be the one way to
 * let the two paths diverge.
 *
 * `truncated` is the answer to the question the client actually has: it means the ring no
 * longer covers the requested sequence, so replaying is impossible and the only remaining
 * route is a full snapshot with an invalidation of the loaded chunks. `oldestReplaySeq`
 * says where the ring does start, which is what makes the decision explainable in a log.
 */
export const eventReplayReplySchema = z.strictObject({
  /** Sequence the reply starts after: the `since` of the request, echoed. */
  since: seqSchema,
  /** Sequence of the last frame in `frames`, or `since` when there are none. */
  through: seqSchema,
  /** Current sequence of the player, which may be above `through` when the page filled. */
  currentSeq: seqSchema,
  oldestReplaySeq: seqSchema,
  truncated: z.boolean(),
  frames: z.array(wsServerFrameSchema).max(MAX_EVENT_REPLAY),
  atGameMs: gameMsSchema,
});
export type EventReplayReply = z.infer<typeof eventReplayReplySchema>;

// ---------------------------------------------------------------------------
// Client to server
// ---------------------------------------------------------------------------
//
// Three messages, none of which mutates the domain. That is deliberate and not an
// omission: every action goes through REST, because an action needs an idempotency key,
// a status code and a body that can be retried, and a socket gives none of the three
// (plan section 7). What the socket carries upwards is only the heartbeat and which part
// of the world the client is looking at.

/**
 * Heartbeat, every twenty seconds (plan section 7). It carries the real instant of the
 * client so that a latency can be measured without a second round trip; the server never
 * uses that instant for anything with simulation meaning.
 */
export const wsPingMessageSchema = z.strictObject({
  type: z.literal('ping'),
  atRealMs: realMsSchema,
});
export type WsPingMessage = z.infer<typeof wsPingMessageSchema>;

/**
 * Chunks the client wants live updates for. The set replaces nothing: it adds, and
 * `unsubscribeChunks` removes, so the streaming ring of the renderer maps onto it
 * directly as it crosses chunk borders.
 */
export const wsSubscribeChunksMessageSchema = z.strictObject({
  type: z.literal('subscribeChunks'),
  chunks: z.array(chunkCoordSchema).min(1).max(MAX_CHUNK_SUBSCRIPTIONS),
});
export type WsSubscribeChunksMessage = z.infer<typeof wsSubscribeChunksMessageSchema>;

export const wsUnsubscribeChunksMessageSchema = z.strictObject({
  type: z.literal('unsubscribeChunks'),
  chunks: z.array(chunkCoordSchema).min(1).max(MAX_CHUNK_SUBSCRIPTIONS),
});
export type WsUnsubscribeChunksMessage = z.infer<typeof wsUnsubscribeChunksMessageSchema>;

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  wsPingMessageSchema,
  wsSubscribeChunksMessageSchema,
  wsUnsubscribeChunksMessageSchema,
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

export const WS_CLIENT_MESSAGE_TYPES = ['ping', 'subscribeChunks', 'unsubscribeChunks'] as const;
export type WsClientMessageType = (typeof WS_CLIENT_MESSAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/** Path the WebSocket connects to. Proxied verbatim (infra/caddy/Caddyfile). */
export const WS_PATH = '/ws';

/** Name of the query parameter that carries the single use ticket (plan section 7). */
export const WS_TICKET_QUERY_PARAM = 'ticket';

/**
 * Query string of the handshake. The ticket travels here and the access token never
 * does: a browser cannot set a header on a WebSocket handshake, and a token in a URL ends
 * up in the logs of every proxy on the way, whereas a ticket is single use and lives
 * thirty seconds.
 */
export const wsHandshakeQuerySchema = z.strictObject({
  ticket: z.string().min(16).max(256),
});
export type WsHandshakeQuery = z.infer<typeof wsHandshakeQuerySchema>;

/**
 * Close codes the server uses, beyond the standard ones. The range 4000-4999 is reserved
 * by the WebSocket specification for the application.
 */
export const WS_CLOSE_CODES = {
  /** The ticket was missing, unknown, spent or expired. */
  TICKET_INVALID: 4401,
  /** The client was built against another version of the shared contract. */
  CONTRACT_MISMATCH: 4409,
  /** The heartbeat stopped arriving. */
  HEARTBEAT_TIMEOUT: 4408,
  /** Another connection for the same player took over. */
  SUPERSEDED: 4410,
  /** The server is shutting down; the client should reconnect with backoff. */
  SHUTTING_DOWN: 4503,
} as const;
export type WsCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];
