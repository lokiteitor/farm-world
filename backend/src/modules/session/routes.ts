// The four routes of the `state` area.
//
// Owner: workflow W6-B. Module `session`.
//
// Three readings and one mutation, and the shape of each follows from the flags the contract
// sets rather than from a choice made here:
//
//   `GET /api/state/snapshot`            advances the player, so by the time the body runs the
//                                        due events have been applied and the accruals settled,
//                                        and the state it reports is the state at `atGameMs`.
//   `GET /api/events`                    does not advance, and must not: it replays what was
//                                        already written, and advancing would append frames the
//                                        client is about to be told it has caught up past.
//   `GET /api/session/welcome-back`      advances, because the interval it reports ends now and
//                                        the last stretch of wages has to be inside it.
//   `POST /api/session/welcome-back/ack` is `sequenced`, therefore runs inside
//                                        `withPlayerAdvanced`, which is the only thing that
//                                        returns the `seq` the reply has to carry.
//
// The snapshot runs inside a transaction of its own even though it writes nothing. That is the
// one non obvious decision of this file and it is the reason the snapshot is usable at all: the
// sequence it reports and the entities it carries have to come from one consistent read, and
// two dozen statements issued outside a transaction would let a mutation land between the
// sequence and the entities. See `snapshot.ts` for the direction the inconsistency is allowed
// to take.

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { buildPlayerDto } from '../../lib/playerView.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  GameEventType,
  MAX_EVENT_REPLAY,
  gameMs as toGameMsValue,
  toWireGameMs,
  type GameMs,
  type RouteReply,
} from '../../shared/index.js';
import { clearCachedWelcomeBack, readCachedWelcomeBack, writeCachedWelcomeBack } from './cache.js';
import { buildReplay } from './replay.js';
import { buildSnapshot } from './snapshot.js';
import { buildWelcomeBack } from './welcomeBack.js';

/** Registers the routes of the area. Invoked once by `src/app.ts`. */
export function registerSessionRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/state/snapshot
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/state/snapshot', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const reading = await readClock(request);

    const body: RouteReply<'GET /api/state/snapshot'> = await services.transaction(async (tx) =>
      buildSnapshot(tx, auth.playerId, reading),
    );
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/events
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/events', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const reading = await readClock(request);

    const body: RouteReply<'GET /api/events'> = await buildReplay(
      services,
      services.prisma,
      auth.playerId,
      {
        since: request.query.since,
        limit: request.query.limit ?? MAX_EVENT_REPLAY,
        atGameMs: reading.gameNow,
      },
    );
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/session/welcome-back
  // -------------------------------------------------------------------------
  //
  // The advance has already run in the `preHandler`, so the summary is built against a player
  // that is settled up to `atGameMs`. The cache is consulted after it, never instead of it: the
  // advance is what keeps the world moving, and skipping it to save an aggregation would make
  // a returning player's simulation depend on whether a Redis key happened to be warm.
  defineRoute(app, 'GET /api/session/welcome-back', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const reading = await readClock(request);

    const player = await services.prisma.player.findUniqueOrThrow({
      where: { id: auth.playerId },
      select: { lastSummaryGameMs: true },
    });
    const fromGameMs = toWireGameMs(toGameMsValue(player.lastSummaryGameMs));

    const cached = await readCachedWelcomeBack(services, auth.playerId, fromGameMs);
    if (cached !== null) {
      const hit: RouteReply<'GET /api/session/welcome-back'> = cached;
      return hit;
    }

    const built = await buildWelcomeBack(services.prisma, auth.playerId, reading.gameNow);
    await writeCachedWelcomeBack(services, auth.playerId, built);
    const body: RouteReply<'GET /api/session/welcome-back'> = built;
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/session/welcome-back/ack
  // -------------------------------------------------------------------------
  //
  // The instant travels in the body rather than being taken as "now", which is what
  // `shared/api/schemas/state.ts` asks for: a summary read and acknowledged minutes later must
  // not silently discard what happened in between. Two clamps make that safe in both
  // directions. The mark never moves backwards, so acknowledging an old summary twice is
  // harmless; and it never moves past the current instant, so a client cannot acknowledge a
  // future it has not been shown and lose the interval in between.
  defineRoute(app, 'POST /api/session/welcome-back/ack', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const requested = BigInt(request.body.throughGameMs);

    const outcome = await withPlayerAdvanced(services, auth.playerId, async (context) => {
      const current = await context.tx.player.findUniqueOrThrow({
        where: { id: auth.playerId },
        select: { lastSummaryGameMs: true },
      });
      const capped =
        requested > (context.reading.gameNow as bigint)
          ? (context.reading.gameNow as bigint)
          : requested;
      const target: GameMs = toGameMsValue(
        capped > current.lastSummaryGameMs ? capped : current.lastSummaryGameMs,
      );

      // Monotonic and conditional, like every other mark of the player (plan section 6.3): a
      // concurrent acknowledgement that already moved it further wins and this one becomes a
      // no-op instead of pulling it back.
      await context.tx.player.updateMany({
        where: { id: auth.playerId, lastSummaryGameMs: { lt: target as bigint } },
        data: { lastSummaryGameMs: target as bigint },
      });

      context.emit({
        type: GameEventType.PLAYER_UPSERTED,
        payload: { player: await buildPlayerDto(context.tx, auth.playerId, context.reading) },
      });
      return { lastSummaryGameMs: toWireGameMs(target) };
    });

    // After the commit, so a rolled back acknowledgement cannot drop a summary that is still
    // pending. A failure here costs a stale cache entry, which the interval check of
    // `cache.ts` discards on the next read.
    await clearCachedWelcomeBack(services, auth.playerId);

    const body: RouteReply<'POST /api/session/welcome-back/ack'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });
}
