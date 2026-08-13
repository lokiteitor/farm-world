// The short lived cache of the return summary.
//
// Owner: workflow W6-B. Module `session`.
//
// Plan section 6.7 asks for the result to be cached a few minutes per player, and the reason
// is not the cost of building it: it is that the summary must not move while it is being read.
// The interval of a summary ends at "now", so two requests a second apart produce two different
// intervals and two slightly different figures. A player who reloads the page mid-read would
// see the numbers shift under them, and a player who acknowledged what they saw would be
// acknowledging something else.
//
// So the cache is keyed by player, holds the reply verbatim, and is bound to the interval it
// was built for: an entry whose `fromGameMs` is not the current summary mark is stale by
// definition and is rebuilt. The acknowledgement drops the entry, which is what makes the
// summary disappear on acknowledgement and only then.
//
// Redis is not authoritative here either (plan section 5). A miss, a parse failure and an
// unreachable Redis are all answered by building the summary again, which is correct and only
// slower; nothing is ever read from the cache without validating it against the very schema the
// route answers with, because a redeploy may have changed that schema under a live entry.

import { type ServiceContext } from '../../lib/context.js';
import {
  welcomeBackReplySchema,
  type PlayerId,
  type WelcomeBackReply,
} from '../../shared/index.js';

/**
 * How long a cached summary lives, in real milliseconds.
 *
 * Five minutes is long enough that a reload, a second tab and a slow read all see the same
 * figures, and short enough that a player who leaves the modal open and comes back to it gets
 * an interval that has not gone stale by hours.
 */
export const WELCOME_BACK_CACHE_TTL_REAL_MS = 5 * 60 * 1000;

/**
 * Reads the cached summary of a player, or null.
 *
 * `expectedFromGameMs` is the current summary mark: an entry built for a different interval is
 * discarded rather than returned, which is the one invariant that keeps an acknowledged summary
 * from reappearing.
 */
export async function readCachedWelcomeBack(
  services: ServiceContext,
  playerId: PlayerId,
  expectedFromGameMs: string,
): Promise<WelcomeBackReply | null> {
  let raw: string | null;
  try {
    raw = await services.redis.commands.get(services.keys.welcomeBack(playerId));
  } catch (error) {
    services.logger.warn({ err: error, playerId }, 'no se pudo leer el resumen cacheado');
    return null;
  }
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = welcomeBackReplySchema.safeParse(parsed);
  if (!result.success || result.data.fromGameMs !== expectedFromGameMs) {
    return null;
  }
  return result.data;
}

/** Stores a summary for `WELCOME_BACK_CACHE_TTL_REAL_MS`. A failure is logged and ignored. */
export async function writeCachedWelcomeBack(
  services: ServiceContext,
  playerId: PlayerId,
  reply: WelcomeBackReply,
): Promise<void> {
  try {
    await services.redis.commands.set(
      services.keys.welcomeBack(playerId),
      JSON.stringify(reply),
      'PX',
      WELCOME_BACK_CACHE_TTL_REAL_MS,
    );
  } catch (error) {
    services.logger.warn({ err: error, playerId }, 'no se pudo cachear el resumen de regreso');
  }
}

/** Drops the cached summary of a player. Called by the acknowledgement, after the commit. */
export async function clearCachedWelcomeBack(
  services: ServiceContext,
  playerId: PlayerId,
): Promise<void> {
  try {
    await services.redis.commands.del(services.keys.welcomeBack(playerId));
  } catch (error) {
    services.logger.warn({ err: error, playerId }, 'no se pudo invalidar el resumen cacheado');
  }
}
