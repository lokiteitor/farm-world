// Publishing frames to the live channel, after the commit.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// One channel per player, `farm-world:events:<playerId>`. The WebSocket plugin
// subscribes to the channel of every connected player, so a frame published by the
// worker process reaches a socket held by the server process: that is the whole reason
// Redis is in this path at all, and it stays true with several instances of either.
//
// The storm guard. A job that runs very late, or a reconciliation sweep after an outage,
// can apply dozens of due events for one player in a few seconds. Publishing every frame
// then floods a socket with state the client is about to replace anyway. The guard uses
// the synchronisation rule of plan section 7 instead of fighting it: dropping a frame
// from the live channel is safe, because the client sees a gap and replays through
// `GET /api/events?since`, which is one request instead of hundreds of frames. So beyond
// a threshold only the last frame of the batch is published, the one that carries the
// highest sequence, and the client resynchronises once.
//
// What is never done: suppressing the frame before it is written. The row in
// `game_events` is authoritative and is always written inside the transaction; the guard
// only decides what travels live.

import { type Redis } from 'ioredis';
import { type RedisKeys } from '../plugins/redis.js';
import { type PlayerId, type WsServerFrame } from '../shared/index.js';

/**
 * Frames published live for one player in one flush before the guard collapses the
 * batch. Ten is above every legitimate mutation of the surface: the widest one,
 * building on bought land, emits five.
 */
export const MAX_LIVE_FRAMES_PER_FLUSH = 10;

/** What a publish did, for the metrics and for the log. */
export interface PublishOutcome {
  readonly published: number;
  readonly suppressed: number;
  /** True when the batch was collapsed and the client will have to replay. */
  readonly collapsed: boolean;
}

/**
 * Decides which frames travel live. Pure, so the rule is testable without Redis.
 *
 * The last frame is kept and not the first: it carries the highest sequence, so a client
 * that applies it lands exactly on the current state of the server and asks for the
 * interval it missed.
 */
export function selectLiveFrames(
  frames: readonly WsServerFrame[],
  limit: number = MAX_LIVE_FRAMES_PER_FLUSH,
): readonly WsServerFrame[] {
  if (frames.length <= limit) {
    return frames;
  }
  const last = frames[frames.length - 1];
  return last === undefined ? [] : [last];
}

/**
 * Publishes the frames of one player. One `PUBLISH` per frame, because a subscriber
 * receives a message and not a batch, and the frames of one flush are few by
 * construction once the guard has applied.
 */
export async function publishFrames(
  redis: Redis,
  keys: RedisKeys,
  playerId: PlayerId,
  frames: readonly WsServerFrame[],
  limit: number = MAX_LIVE_FRAMES_PER_FLUSH,
): Promise<PublishOutcome> {
  const live = selectLiveFrames(frames, limit);
  if (live.length === 0) {
    return { published: 0, suppressed: frames.length, collapsed: frames.length > 0 };
  }
  const channel = keys.playerChannel(playerId);
  const pipeline = redis.multi();
  for (const frame of live) {
    pipeline.publish(channel, JSON.stringify(frame));
  }
  await pipeline.exec();
  return {
    published: live.length,
    suppressed: frames.length - live.length,
    collapsed: live.length < frames.length,
  };
}

/**
 * Publishes a transport only frame: the periodic clock reading and the greeting are sent
 * straight to a socket, but a retiming has to reach every connected player of every
 * process, and that goes through the channel like everything else.
 */
export async function publishTransportFrame(
  redis: Redis,
  keys: RedisKeys,
  playerId: PlayerId,
  frame: WsServerFrame,
): Promise<void> {
  await redis.publish(keys.playerChannel(playerId), JSON.stringify(frame));
}

/** Parses a message read from a channel. Returns null for anything unreadable. */
export function parseChannelMessage(message: string): WsServerFrame | null {
  try {
    const parsed = JSON.parse(message) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { seq?: unknown }).seq === 'number' &&
      typeof (parsed as { type?: unknown }).type === 'string'
    ) {
      return parsed as WsServerFrame;
    }
    return null;
  } catch {
    return null;
  }
}

/** The player a channel name belongs to, or null when the name is not one of ours. */
export function playerOfChannel(keys: RedisKeys, channel: string): PlayerId | null {
  const prefix = keys.playerChannel('');
  return channel.startsWith(prefix) ? (channel.slice(prefix.length) as PlayerId) : null;
}
