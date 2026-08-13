// The event replay: the ring when it reaches, the log when Redis lost it, the snapshot when
// neither can.
//
// Owner: workflow W6-B. Module `session`.
//
// The three rungs of the ladder of ADR-0019 are exercised in one suite because what has to be
// proved is the boundary between them, and a boundary is only observable from both sides. The
// frames are produced with real mutations — `POST /api/farms` is sequenced and emits one frame
// each — so the sequences are the ones `lib/events.ts` assigned inside the domain transaction
// and not a fixture's idea of them.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  eventReplayReplySchema,
  snapshotReplySchema,
  type EventReplayReply,
  type World,
} from '../../shared/index.js';
import { createHarness, type Harness } from '../harness.js';
import {
  clearDomain,
  createSessionPlayer,
  getJson,
  postJson,
  type SessionPlayer,
} from './fixtures.js';

let harness: Harness;
let world: World;

/** Mutations the suite performs, and therefore frames the player has behind it. */
const FRAME_COUNT = 4;

beforeAll(async () => {
  harness = await createHarness();
  world = (await harness.services.clock.read()).world;
});

afterAll(async () => {
  await clearDomain(harness, world);
  await harness.teardown();
});

/** A player with `FRAME_COUNT` sequenced mutations behind it. */
async function playerWithFrames(label: string): Promise<SessionPlayer> {
  const player = await createSessionPlayer(harness, label);
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const created = await postJson(harness, player.accessToken, '/api/farms', {
      name: `Granja ${index + 1}`,
    });
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
  }
  return player;
}

/** The replay, parsed against the schema of the contract. */
async function replay(
  player: SessionPlayer,
  query: string,
): Promise<{ readonly statusCode: number; readonly reply: EventReplayReply }> {
  const { statusCode, body } = await getJson(harness, player.accessToken, `/api/events?${query}`);
  expect(statusCode, JSON.stringify(body)).toBe(200);
  return { statusCode, reply: eventReplayReplySchema.parse(body) };
}

describe('GET /api/events', () => {
  it('reproduce el hueco desde el anillo cuando alcanza', async () => {
    const player = await playerWithFrames('replay-anillo');

    const { reply } = await replay(player, 'since=0');
    expect(reply.truncated).toBe(false);
    expect(reply.currentSeq).toBe(FRAME_COUNT);
    expect(reply.through).toBe(FRAME_COUNT);
    expect(reply.frames.map((frame) => frame.seq)).toEqual([1, 2, 3, 4]);
    expect(reply.frames.every((frame) => frame.type === 'FARM_UPSERTED')).toBe(true);
    // The ring holds everything this player ever produced, so it reaches back to the first.
    expect(reply.oldestReplaySeq).toBe(1);

    // A partial gap is answered from the same place, starting at the first frame that is
    // missing and not at the oldest the ring holds.
    const partial = await replay(player, 'since=2');
    expect(partial.reply.frames.map((frame) => frame.seq)).toEqual([3, 4]);
    expect(partial.reply.truncated).toBe(false);
  });

  it('no reproduce nada cuando el cliente ya esta al dia', async () => {
    const player = await playerWithFrames('replay-al-dia');

    const { reply } = await replay(player, `since=${FRAME_COUNT}`);
    expect(reply.frames).toEqual([]);
    expect(reply.through).toBe(FRAME_COUNT);
    expect(reply.truncated).toBe(false);
  });

  it('cae al registro autoritativo cuando se ha perdido el anillo de Redis', async () => {
    const player = await playerWithFrames('replay-sin-redis');

    // Losing Redis is a degradation and never a corruption (plan section 5): the ring is
    // dropped and the same frames come back, from `game_events`.
    const removed = await harness.redis.commands.del(
      harness.services.keys.eventRing(player.playerId),
    );
    expect(removed).toBe(1);

    const { reply } = await replay(player, 'since=0');
    expect(reply.truncated).toBe(false);
    expect(reply.frames.map((frame) => frame.seq)).toEqual([1, 2, 3, 4]);
    expect(reply.frames.every((frame) => frame.type === 'FARM_UPSERTED')).toBe(true);
  });

  it('se declara truncado cuando el hueco no cabe en una pagina, y la instantania lo resuelve', async () => {
    const player = await playerWithFrames('replay-truncado');

    // A gap of four frames asked for with a page of two. The reply carries nothing rather than
    // half of it: half a gap applied would leave the client believing it had moved forward.
    const { reply } = await replay(player, 'since=0&limit=2');
    expect(reply.truncated).toBe(true);
    expect(reply.frames).toEqual([]);
    expect(reply.through).toBe(0);
    expect(reply.currentSeq).toBe(FRAME_COUNT);

    // The rung the client takes next, and it closes the gap for good.
    const snapshotReply = await getJson(harness, player.accessToken, '/api/state/snapshot');
    expect(snapshotReply.statusCode).toBe(200);
    const snapshot = snapshotReplySchema.parse(snapshotReply.body);
    expect(snapshot.seq).toBe(FRAME_COUNT);
    expect(snapshot.farms).toHaveLength(FRAME_COUNT + 1);

    // With a page that fits, the very same gap is replayable, which is what makes the ceiling a
    // property of the request and not a property of the player.
    const fitting = await replay(player, `since=0&limit=${FRAME_COUNT}`);
    expect(fitting.reply.truncated).toBe(false);
    expect(fitting.reply.frames).toHaveLength(FRAME_COUNT);
  });
});
