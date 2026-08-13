// The four routes of the `workers` area.
//
// Owner: workflow W5-B. Module `workers`.
//
// Two reads and two transitions. The reads carry `advancesPlayer` and no sequence, so the
// guard of `plugins/routes.ts` catches the player up before the handler runs and a payroll is
// never shown behind the clock. The two writes are `sequenced`, so each runs inside
// `withPlayerAdvanced`, which advances the player in the same transaction as its own writes
// and is the only thing that returns the `seq` the reply has to carry (ADR-0017).
//
// Neither write moves money and neither carries an idempotency key, which is what the
// contract declares and what GDD sections 102 and 109 justify: there is no hiring fee and no
// severance, so nothing is charged. What protects a hire from a double submission is that the
// candidate leaves the pool, so the second attempt is refused with `CANDIDATE_NOT_AVAILABLE`;
// what protects a dismissal is that the second one no longer finds a live worker.
//
// One departure from "a GET does not write" is deliberate and is confined to
// `GET /api/workers/pool`: a player who has never had a pool gets one listed there. The
// player is created by `modules/auth`, which belongs to a frozen workflow and knows nothing
// about hiring, so the alternative would be reopening a frozen module. The write is
// idempotent, costs one indexed read on every later call, and emits no frame, because the
// contract declares no `emits` for that route and the reply already carries the pool.

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { lockPlayer } from '../../lib/tx.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import { toWireGameMs, toWireMoney, type PlayerId, type RouteReply } from '../../shared/index.js';
import {
  buildPoolReply,
  buildWorkersReply,
  dismissWorker,
  ensurePool,
  hireCandidate,
  homeSlots,
  homeUpsertedFrames,
  loadPlayerWorkers,
  payrollPerGameHour,
  poolUpsertedFrame,
  toWorkerDto,
  workerRemovedFrame,
  workerUpsertedFrame,
} from './service.js';

/** Registers the routes of the area. Invoked once by `src/app.ts`. */
export function registerWorkersRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/workers
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/workers', async (request) => {
    const auth = requirePlayer(request);
    const body: RouteReply<'GET /api/workers'> = await buildWorkersReply(
      request.server.services.prisma,
      auth.playerId,
    );
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/workers/pool
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/workers/pool', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    // The fast path, which is every call after the first: the pool exists and the refresh is
    // already scheduled, so nothing is written and no transaction is opened.
    const listed = await buildPoolReply(services.prisma, playerId);
    if (listed.nextRefreshAtGameMs !== null) {
      return listed;
    }

    const reading = await readClock(request);
    const seeded = await services.transaction(async (tx, outbox) => {
      // The player row, so two first requests of the same session cannot both list a pool
      // and leave the player with six candidates. It is the lock of every write path
      // (`lib/tx.ts`), taken here for the same reason and in the same order.
      if ((await lockPlayer(tx, playerId)) === null) {
        return listed;
      }
      await ensurePool(tx, outbox, reading, playerId);
      return buildPoolReply(tx, playerId);
    });
    const body: RouteReply<'GET /api/workers/pool'> = seeded;
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/workers/hire
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/workers/hire', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;
    const payload = request.body;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const hired = await hireCandidate(context, playerId, {
        candidateId: payload.candidateId,
        farmId: payload.farmId,
        homeId: payload.homeId,
      });
      const slots = await homeSlots(context.tx, playerId);

      context.emit(
        workerUpsertedFrame(hired.worker),
        poolUpsertedFrame(hired.pool),
        ...(await homeUpsertedFrames(context.tx, hired.worker.farmId, hired.homeId)),
      );

      return {
        worker: toWorkerDto(hired.worker),
        pool: hired.pool,
        homeSlotsUsed: slots.used,
        homeSlotsTotal: slots.total,
      };
    });

    const body: RouteReply<'POST /api/workers/hire'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/workers/:workerId/fire
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/workers/:workerId/fire', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;
    const targetWorkerId = request.params.workerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const dismissed = await dismissWorker(context, playerId, targetWorkerId);
      const slots = await homeSlots(context.tx, playerId);
      const remaining = await loadPlayerWorkers(context.tx, playerId);

      context.emit(
        workerRemovedFrame(dismissed),
        ...(await homeUpsertedFrames(context.tx, dismissed.farmId, dismissed.homeId)),
      );

      return {
        workerId: dismissed.id,
        homeSlotsUsed: slots.used,
        homeSlotsTotal: slots.total,
        totalSalaryPerGameHour: toWireMoney(payrollPerGameHour(remaining)),
      };
    });

    const body: RouteReply<'POST /api/workers/:workerId/fire'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });
}
