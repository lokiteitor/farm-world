// The system area: health, metrics and the four development routes.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// These routes are registered here and not in a module of `src/modules` because none of them
// belongs to the domain: `/health` and `/metrics` are properties of the process, and the four
// `POST /api/dev/*` routes drive the pieces of `src/lib` directly — the clock, the applier of
// simulation effects, the ledger and the reconciliation sweep. Adding a twelfth module
// directory for them would put infrastructure inside the layer the ESLint zones reserve for
// the domain, and `docs/ownership.md` lists eleven modules on purpose.
//
// `GET /docs` is registered by `@fastify/swagger-ui`, from `plugins/swagger.ts`.
//
// The four development routes exist because two acceptance criteria of plan section 12 are not
// reachable without them: exercising a 325 hour cycle in seconds needs the multiplier to be
// settable, and exercising the debt policy needs a balance to be settable. Both are refused
// unless the development flag is on and `NODE_ENV` is not production (`plugins/devGuard.ts`).

import { type FastifyInstance } from 'fastify';
import { advancePlayerNow, withPlayerAdvanced } from '../lib/advancePlayer.js';
import { buildHealthReply, healthStatusCode } from '../lib/health.js';
import { requestKey } from '../lib/ids.js';
import { compensate } from '../lib/ledger.js';
import { buildPlayerDto, toClockDto, toLedgerEntryDto } from '../lib/playerView.js';
import { reconcile, rescheduleHorizon } from '../lib/scheduler.js';
import {
  LedgerType,
  Money,
  fromWireGameMs,
  fromWireMoney,
  toWireGameMs,
  toWireMoney,
  type PlayerId,
  type RouteReply,
} from '../shared/index.js';
import { requirePlayer } from './auth.js';
import { renderMetrics } from './metrics.js';
import { defineRoute } from './routes.js';

/** Registers every route of the system area except `GET /docs`. */
export function registerSystemRoutes(app: FastifyInstance, startedAtRealMs: bigint): void {
  // -------------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------------
  // The status is set and the body is returned; `send` is not called. Doing both made
  // Fastify log `FST_ERR_REP_ALREADY_SENT` at level `warn` on every single probe, which with
  // a ten second health check is 8.640 lines of noise a day against a route that answered
  // correctly all along (docs/handoff/NOTES-w6b.md 4.4).
  defineRoute(app, 'GET /health', async (request, reply) => {
    const body = await buildHealthReply(request.server.services, startedAtRealMs);
    reply.status(healthStatusCode(body));
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /metrics
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /metrics', async (request, reply) => {
    const rendered = await renderMetrics(request.server.services.metrics);
    reply.header('content-type', rendered.contentType);
    return rendered.body;
  });

  // -------------------------------------------------------------------------
  // POST /api/dev/retime
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/dev/retime', async (request) => {
    const services = request.server.services;
    const result = await services.clock.retimeWorld({
      rateNum: request.body.rateNum,
      rateDen: request.body.rateDen,
    });
    // Re-anchoring changes when every future instant falls due in real time, so the alarm
    // clocks of the horizon are recreated under the new epoch and the old ones removed by
    // identifier (plan section 6.1).
    const rescheduledJobs = await rescheduleHorizon(services.schedulerDeps);
    const reply: RouteReply<'POST /api/dev/retime'> = {
      clock: toClockDto(result.reading),
      rescheduledJobs,
    };
    return reply;
  });

  // -------------------------------------------------------------------------
  // POST /api/dev/advance-player
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/dev/advance-player', async (request) => {
    const auth = requirePlayer(request);
    const playerId = (request.body.playerId ?? auth.playerId) as PlayerId;
    const result = await advancePlayerNow(
      request.server.services,
      playerId,
      fromWireGameMs(request.body.toGameMs),
    );
    const reply: RouteReply<'POST /api/dev/advance-player'> = {
      processedEvents: result.processedEvents,
      lastAccrualGameMs: toWireGameMs(result.lastAccrualGameMs),
      balance: toWireMoney(result.balance),
    };
    return reply;
  });

  // -------------------------------------------------------------------------
  // POST /api/dev/grant
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/dev/grant', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId = (request.body.playerId ?? auth.playerId) as PlayerId;
    const amount = fromWireMoney(request.body.amount);
    const clientKey = request.idempotency?.key ?? request.body.reason;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const written = await compensate(context.tx, context.lock, {
        type: LedgerType.COMPENSATION,
        amount,
        atGameMs: context.reading.gameNow,
        atRealMs: context.reading.atRealMs,
        idempotencyKey: requestKey(playerId, 'dev-grant', clientKey),
        refType: 'DEV',
        refId: null,
        meta: { reason: request.body.reason },
      });
      const player = await buildPlayerDto(context.tx, playerId, context.reading);
      context.emit(
        { type: 'PLAYER_UPSERTED', payload: { player } },
        {
          type: 'LEDGER_APPENDED',
          payload: {
            entries: [toLedgerEntryDto(written.entry)],
            balance: toWireMoney(written.balanceAfter),
          },
        },
      );
      return {
        amount: toWireMoney(Money.fromString(request.body.amount)),
        balanceAfter: toWireMoney(written.balanceAfter),
      };
    });

    const reply: RouteReply<'POST /api/dev/grant'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return reply;
  });

  // -------------------------------------------------------------------------
  // POST /api/dev/reconcile
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/dev/reconcile', async (request) => {
    const result = await reconcile(request.server.services.schedulerDeps, 'manual');
    const reply: RouteReply<'POST /api/dev/reconcile'> = {
      enqueuedEvents: result.enqueuedEvents,
      pendingEvents: result.pendingEvents,
    };
    return reply;
  });
}
