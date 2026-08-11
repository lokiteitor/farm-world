// Redis: two connections, because one of them cannot answer commands.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// A connection in subscribe mode accepts only subscription commands, which is a
// property of the Redis protocol and not of ioredis. So the process opens two:
//
//   - `commands`, for everything else: the WebSocket tickets, the replay ring, the
//     chunk cache of workflow W3-B and the publishing side of the pub/sub.
//   - `subscriber`, which spends its life in subscribe mode delivering the frames of
//     every connected player.
//
// BullMQ opens its own connections and is not one of these two, for the same reason:
// its blocking commands would monopolise a shared connection. `lib/queue.ts` builds
// them from the same URL.
//
// What Redis is authoritative for: nothing. It caches chunks, transports the queue,
// publishes events, holds the replay ring and holds the tickets (plan section 5). A
// balance is never read from it and a capacity is never validated against it, which
// is what makes losing the whole instance a degradation and not a corruption.

import { Redis } from 'ioredis';
import { type AppConfig } from './config.js';

/** A minimal logger, so this module does not depend on the shape of Fastify's. */
export interface RedisLogger {
  warn(object: Record<string, unknown>, message: string): void;
  info(object: Record<string, unknown>, message: string): void;
}

/** The two connections of a process. */
export interface RedisConnections {
  /** Commands, publishing and the key space. */
  readonly commands: Redis;
  /** Subscriptions only: a connection in subscribe mode refuses other commands. */
  readonly subscriber: Redis;
}

/** Reconnection: exponential backoff with a ceiling, so a long outage does not spin. */
export const RECONNECT_BASE_DELAY_MS = 200;
export const RECONNECT_MAX_DELAY_MS = 5_000;

/** Options shared by every connection this process opens, including BullMQ's. */
export function redisOptions(role: string, logger: RedisLogger): Record<string, unknown> {
  return {
    // A command issued while the connection is down waits for the reconnection
    // instead of failing, except during shutdown, where the queue is drained.
    enableOfflineQueue: true,
    // BullMQ requires this to be null on its own connections and it is harmless
    // here: a command that has already been sent is not retried blindly, which is
    // what a non null value would do.
    maxRetriesPerRequest: null,
    lazyConnect: false,
    connectionName: `farm-world:${role}`,
    retryStrategy: (attempt: number): number =>
      Math.min(RECONNECT_BASE_DELAY_MS * attempt, RECONNECT_MAX_DELAY_MS),
    reconnectOnError: (error: Error): boolean => {
      logger.warn({ err: error, role }, 'redis reconnecting after error');
      return true;
    },
  };
}

/** Opens the two connections and attaches their diagnostics. */
export function createRedisConnections(config: AppConfig, logger: RedisLogger): RedisConnections {
  const commands = new Redis(config.redisUrl, redisOptions('commands', logger));
  const subscriber = new Redis(config.redisUrl, redisOptions('subscriber', logger));

  for (const [role, connection] of [
    ['commands', commands],
    ['subscriber', subscriber],
  ] as const) {
    // Without a listener, an `error` event on an ioredis connection is an unhandled
    // event and takes the process down, which is the wrong response to a Redis that
    // is restarting.
    connection.on('error', (error: Error) => {
      logger.warn({ err: error, role }, 'redis connection error');
    });
    connection.on('end', () => {
      logger.info({ role }, 'redis connection closed');
    });
  }

  return { commands, subscriber };
}

/** Whether Redis answers. `/health` reports `degraded` and not `down` when it does not. */
export async function pingRedis(connections: RedisConnections): Promise<boolean> {
  try {
    return (await connections.commands.ping()) === 'PONG';
  } catch {
    return false;
  }
}

/** Closes both connections, waiting for in flight commands. */
export async function closeRedisConnections(connections: RedisConnections): Promise<void> {
  await Promise.allSettled([connections.commands.quit(), connections.subscriber.quit()]);
}

// ---------------------------------------------------------------------------
// Key space
// ---------------------------------------------------------------------------
//
// Every key this project writes is prefixed, so that a Redis shared with another
// project stays legible and `KEYS farm-world:*` is a complete inventory. The prefix
// is a parameter of the key builders and not a global, because the integration tests
// isolate themselves with their own prefix.

/** Prefix of the key space in production and in development. */
export const DEFAULT_KEY_PREFIX = 'farm-world';

/** The keys of the pieces this workflow owns. */
export function keyBuilders(prefix: string = DEFAULT_KEY_PREFIX): {
  readonly wsTicket: (ticket: string) => string;
  readonly playerChannel: (playerId: string) => string;
  readonly eventRing: (playerId: string) => string;
  readonly welcomeBack: (playerId: string) => string;
  readonly channelPattern: string;
} {
  return {
    wsTicket: (ticket) => `${prefix}:ws:ticket:${ticket}`,
    playerChannel: (playerId) => `${prefix}:events:${playerId}`,
    eventRing: (playerId) => `${prefix}:ring:${playerId}`,
    welcomeBack: (playerId) => `${prefix}:welcome-back:${playerId}`,
    channelPattern: `${prefix}:events:*`,
  };
}

export type RedisKeys = ReturnType<typeof keyBuilders>;
