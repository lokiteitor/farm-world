// Exhaustiveness of the event union and validation of the envelope.
//
// Owner: workflow W2 (API contract).
//
// The central test here is the one that walks `GAME_EVENT_TYPES` and builds a real frame
// for each tag. It proves three things at once that are easy to lose separately: that no
// tag of the domain is missing from the union, that no tag of the union is absent from
// the domain, and that the payload of every tag is a shape the read models of shared/api
// can actually produce, because every fixture is typed against those read models.

import { describe, expect, it } from 'vitest';
import {
  AT_GAME_MS,
  buildingFixture,
  chunkCellPatchFixture,
  clockFixture,
  farmFixture,
  fieldFixture,
  forestPlotFixture,
  inventoryFarmFixture,
  ledgerEntryFixture,
  machineFixture,
  noticeFixture,
  playerFixture,
  taskFixture,
  treeFixture,
  workerCandidateFixture,
  workerFixture,
} from '../../api/__tests__/fixtures.js';
import { MAX_CHUNK_SUBSCRIPTIONS, MAX_EVENT_REPLAY } from '../../api/schemas/common.js';
import { GAME_EVENT_TYPES, GameEventType } from '../../domain/enums.js';
import {
  eventReplayReplySchema,
  WS_CLIENT_MESSAGE_TYPES,
  WS_CLOSE_CODES,
  WS_PATH,
  wsClientMessageSchema,
  wsEnvelopeSchema,
  wsHandshakeQuerySchema,
  wsServerFrameSchema,
} from '../envelope.js';
import {
  WS_EVENT_PAYLOAD_SCHEMAS,
  WS_SERVER_EVENT_TYPES,
  WS_TRANSPORT_ONLY_EVENT_TYPES,
  wsServerEventSchema,
  type WsServerEventType,
  WsTransportEventType,
} from '../events.js';

/**
 * One valid payload per tag, built from the read model fixtures. Declared as a plain
 * record keyed by the union, so a tag added to `GameEventType` without a payload here does
 * not compile.
 */
const PAYLOADS: Readonly<Record<WsServerEventType, unknown>> = {
  HELLO: {
    playerId: playerFixture.id,
    seq: playerFixture.eventSeq,
    oldestReplaySeq: 1,
    clock: clockFixture,
    contractVersion: '0.1.0',
    heartbeatIntervalRealMs: 20_000,
  },
  CLOCK: { clock: clockFixture },
  PLAYER_UPSERTED: { player: playerFixture },
  LEDGER_APPENDED: { entries: [ledgerEntryFixture], balance: playerFixture.balance },
  INVENTORY_UPSERTED: { farms: [inventoryFarmFixture] },
  CHUNK_PATCHED: { chunkX: 37, chunkY: -11, version: 4, cells: [chunkCellPatchFixture] },
  FARM_UPSERTED: { farm: farmFixture },
  BUILDING_UPSERTED: { building: buildingFixture },
  BUILDING_REMOVED: {
    buildingId: buildingFixture.id,
    farmId: farmFixture.id,
    releasedCells: [{ cellX: 1200, cellY: -340 }],
  },
  FIELD_UPSERTED: { field: fieldFixture, cells: null },
  FIELD_REMOVED: { fieldId: fieldFixture.id },
  MACHINE_UPSERTED: { machine: machineFixture },
  MACHINE_REMOVED: { machineId: machineFixture.id, farmId: farmFixture.id },
  WORKER_UPSERTED: { worker: workerFixture },
  WORKER_REMOVED: { workerId: workerFixture.id, farmId: farmFixture.id },
  WORKER_POOL_UPSERTED: {
    candidates: [workerCandidateFixture],
    nextRefreshAtGameMs: '172800000',
  },
  TASK_UPSERTED: { task: taskFixture },
  FOREST_PLOT_UPSERTED: { plot: forestPlotFixture, cells: null },
  FOREST_PLOT_REMOVED: { forestPlotId: forestPlotFixture.id },
  TREES_UPSERTED: {
    forestPlotId: forestPlotFixture.id,
    trees: [treeFixture],
    removedTreeIds: [],
    plot: forestPlotFixture,
  },
  NOTICE: { notice: noticeFixture },
};

function frameOf(type: WsServerEventType, seq = 13): unknown {
  return { seq, atGameMs: AT_GAME_MS, type, payload: PAYLOADS[type] };
}

describe('exhaustiveness against GameEventType', () => {
  it('carries every tag of the domain and adds only the greeting', () => {
    for (const tag of GAME_EVENT_TYPES) {
      expect(WS_SERVER_EVENT_TYPES, `${tag} is missing from the union`).toContain(tag);
    }
    expect(WS_SERVER_EVENT_TYPES.length).toBe(GAME_EVENT_TYPES.length + 1);
    expect(WS_SERVER_EVENT_TYPES).toContain(WsTransportEventType.HELLO);
    expect(GAME_EVENT_TYPES).not.toContain(WsTransportEventType.HELLO as never);
  });

  it('declares a payload schema for every tag and no others', () => {
    expect(Object.keys(WS_EVENT_PAYLOAD_SCHEMAS).sort()).toEqual([...WS_SERVER_EVENT_TYPES].sort());
  });

  it('parses one real frame for every tag of the domain', () => {
    for (const tag of GAME_EVENT_TYPES) {
      const result = wsServerFrameSchema.safeParse(frameOf(tag));
      expect(result.success ? null : { tag, issues: result.error.issues }).toBe(null);
    }
  });

  it('parses the greeting as a frame too', () => {
    const result = wsServerFrameSchema.safeParse(frameOf(WsTransportEventType.HELLO));
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('parses the same payloads without the envelope', () => {
    for (const tag of WS_SERVER_EVENT_TYPES) {
      const result = wsServerEventSchema.safeParse({ type: tag, payload: PAYLOADS[tag] });
      expect(result.success ? null : { tag, issues: result.error.issues }).toBe(null);
    }
  });

  it('lists the clock and the greeting as the only tags that consume no sequence', () => {
    expect([...WS_TRANSPORT_ONLY_EVENT_TYPES].sort()).toEqual(
      [GameEventType.CLOCK, WsTransportEventType.HELLO].sort(),
    );
  });

  it('keeps every payload schema of the table equal to the one the union uses', () => {
    for (const tag of WS_SERVER_EVENT_TYPES) {
      const fromTable = WS_EVENT_PAYLOAD_SCHEMAS[tag];
      expect(fromTable.safeParse(PAYLOADS[tag]).success, tag).toBe(true);
    }
  });
});

describe('the envelope', () => {
  it('requires the four fields', () => {
    const frame = frameOf(GameEventType.PLAYER_UPSERTED) as Record<string, unknown>;
    for (const missing of ['seq', 'atGameMs', 'type', 'payload']) {
      const partial = { ...frame };
      delete partial[missing];
      expect(wsServerFrameSchema.safeParse(partial).success, `accepted without ${missing}`).toBe(
        false,
      );
    }
  });

  it('rejects a sequence that is not a non negative integer', () => {
    expect(wsServerFrameSchema.safeParse(frameOf(GameEventType.CLOCK, -1)).success).toBe(false);
    expect(wsServerFrameSchema.safeParse(frameOf(GameEventType.CLOCK, 1.5)).success).toBe(false);
    expect(wsServerFrameSchema.safeParse(frameOf(GameEventType.CLOCK, 0)).success).toBe(true);
  });

  it('rejects a game instant sent as a number', () => {
    const frame = {
      ...(frameOf(GameEventType.CLOCK) as Record<string, unknown>),
      atGameMs: 3_600_000,
    };
    expect(wsServerFrameSchema.safeParse(frame).success).toBe(false);
  });

  it('rejects an unknown tag and a payload that belongs to another tag', () => {
    expect(
      wsServerFrameSchema.safeParse({
        seq: 1,
        atGameMs: AT_GAME_MS,
        type: 'MONEY_CHANGED',
        payload: { player: playerFixture },
      }).success,
    ).toBe(false);
    expect(
      wsServerFrameSchema.safeParse({
        seq: 1,
        atGameMs: AT_GAME_MS,
        type: GameEventType.PLAYER_UPSERTED,
        payload: { field: fieldFixture, cells: null },
      }).success,
    ).toBe(false);
  });

  it('rejects an extra field in the envelope and in a payload', () => {
    expect(
      wsServerFrameSchema.safeParse({
        ...(frameOf(GameEventType.CLOCK) as Record<string, unknown>),
        sentAtRealMs: '1700000000000',
      }).success,
    ).toBe(false);
    expect(
      wsServerFrameSchema.safeParse({
        seq: 1,
        atGameMs: AT_GAME_MS,
        type: GameEventType.FIELD_REMOVED,
        payload: { fieldId: fieldFixture.id, reason: 'merged' },
      }).success,
    ).toBe(false);
  });

  it('reads the four fields of any frame through the loose envelope', () => {
    const parsed = wsEnvelopeSchema.parse(frameOf(GameEventType.TASK_UPSERTED));
    expect(parsed.seq).toBe(13);
    expect(parsed.type).toBe(GameEventType.TASK_UPSERTED);
    expect(parsed.atGameMs).toBe(AT_GAME_MS);
  });
});

describe('the event replay reply', () => {
  it('accepts a page of frames and reports where the ring starts', () => {
    const reply = {
      since: 12,
      through: 13,
      currentSeq: 13,
      oldestReplaySeq: 4,
      truncated: false,
      frames: [frameOf(GameEventType.TASK_UPSERTED)],
      atGameMs: AT_GAME_MS,
    };
    const result = eventReplayReplySchema.safeParse(reply);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('accepts a truncated reply with no frames, which forces a full snapshot', () => {
    expect(
      eventReplayReplySchema.safeParse({
        since: 1,
        through: 1,
        currentSeq: 900,
        oldestReplaySeq: 400,
        truncated: true,
        frames: [],
        atGameMs: AT_GAME_MS,
      }).success,
    ).toBe(true);
  });

  it('rejects a page above the transport limit', () => {
    const frames = Array.from({ length: MAX_EVENT_REPLAY + 1 }, (_value, index) =>
      frameOf(GameEventType.CLOCK, index),
    );
    expect(
      eventReplayReplySchema.safeParse({
        since: 0,
        through: MAX_EVENT_REPLAY,
        currentSeq: MAX_EVENT_REPLAY,
        oldestReplaySeq: 0,
        truncated: false,
        frames,
        atGameMs: AT_GAME_MS,
      }).success,
    ).toBe(false);
  });
});

describe('client to server messages', () => {
  it('accepts the three messages it declares', () => {
    expect(
      wsClientMessageSchema.safeParse({ type: 'ping', atRealMs: '1700000000000' }).success,
    ).toBe(true);
    expect(
      wsClientMessageSchema.safeParse({
        type: 'subscribeChunks',
        chunks: [{ chunkX: 0, chunkY: 0 }],
      }).success,
    ).toBe(true);
    expect(
      wsClientMessageSchema.safeParse({
        type: 'unsubscribeChunks',
        chunks: [{ chunkX: 0, chunkY: 0 }],
      }).success,
    ).toBe(true);
    expect([...WS_CLIENT_MESSAGE_TYPES].sort()).toEqual(
      ['ping', 'subscribeChunks', 'unsubscribeChunks'].sort(),
    );
  });

  it('rejects anything that would mutate the domain over the socket', () => {
    // Every action goes through REST, because an action needs an idempotency key, a status
    // code and a body that can be retried (plan section 7).
    expect(wsClientMessageSchema.safeParse({ type: 'assignTask', workerId: 'wrk_1' }).success).toBe(
      false,
    );
  });

  it('rejects an empty or oversized subscription', () => {
    expect(wsClientMessageSchema.safeParse({ type: 'subscribeChunks', chunks: [] }).success).toBe(
      false,
    );
    const many = Array.from({ length: MAX_CHUNK_SUBSCRIPTIONS + 1 }, (_value, index) => ({
      chunkX: index,
      chunkY: 0,
    }));
    expect(wsClientMessageSchema.safeParse({ type: 'subscribeChunks', chunks: many }).success).toBe(
      false,
    );
  });

  it('rejects a heartbeat whose instant is a number', () => {
    expect(wsClientMessageSchema.safeParse({ type: 'ping', atRealMs: 1_700_000 }).success).toBe(
      false,
    );
  });
});

describe('the handshake', () => {
  it('accepts a ticket of a plausible length and rejects a short one', () => {
    expect(wsHandshakeQuerySchema.safeParse({ ticket: 'a'.repeat(32) }).success).toBe(true);
    expect(wsHandshakeQuerySchema.safeParse({ ticket: 'corto' }).success).toBe(false);
  });

  it('rejects an access token presented instead of a ticket', () => {
    expect(
      wsHandshakeQuerySchema.safeParse({ ticket: 'a'.repeat(32), token: 'b'.repeat(32) }).success,
    ).toBe(false);
  });

  it('keeps the path and the close codes inside the application range', () => {
    expect(WS_PATH).toBe('/ws');
    for (const code of Object.values(WS_CLOSE_CODES)) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
    expect(new Set(Object.values(WS_CLOSE_CODES)).size).toBe(Object.values(WS_CLOSE_CODES).length);
  });
});
