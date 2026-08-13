// The five routes of the `machinery` area.
//
// Owner: workflow W5-A. Module `machinery`.
//
//   GET  /api/machines                     the holding, with condition, resale and repair.
//   GET  /api/machines/catalog             the catalogue and the table of GDD section 90.
//   POST /api/machines                     buys one, demanding a free garage slot (GDD 96).
//   POST /api/machines/:machineId/sell     sells an idle one at the resale factor.
//   POST /api/machines/:machineId/repair   schedules a repair in the workshop (GDD 93).
//
// The three mutating routes are `sequenced` in the contract, so all three run inside
// `withPlayerAdvanced`. That is not a style choice: the wrapper is what advances the player
// in the same transaction as the writes, what makes every affordability check compare
// against a settled balance, and the only thing that returns the `seq` a sequenced reply has
// to carry (ADR-0017).
//
// The handlers are deliberately thin. Everything that decides anything lives in `service.ts`
// and the conversion between the wire types and the domain types is explicit in both
// directions, because the branded types of `shared/domain` do not cross the cable
// (ADR-0006).
//
// `GET /api/machines/catalog` is the one route of the area with `requiresAuth: false`: it
// carries balance data and no state of any player, and the client imports the same constants
// anyway (shared/api/schemas/machinery.ts).

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { requestKey } from '../../lib/ids.js';
import { requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  clampBp,
  fromWireMoney,
  idempotencyKeyRequired,
  toWireGameMs,
  toWireMoney,
  type RouteReply,
} from '../../shared/index.js';
import { buildCatalogReply, toMachineDto } from './readModel.js';
import { loadMachines } from './record.js';
import { buyMachine, repairMachine, sellMachine } from './service.js';

/** Verbs of the idempotency keys of this area, so an entry is greppable in the ledger. */
const PURCHASE_KEY_VERB = 'machine-purchase';
const SALE_KEY_VERB = 'machine-sale';
const REPAIR_KEY_VERB = 'machine-repair';

/** Registra las rutas del area `machinery`. Invocada una vez por `src/app.ts`. */
export function registerMachineryRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/machines
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/machines', async (request) => {
    const auth = requirePlayer(request);
    const machines = await loadMachines(request.server.services.prisma, auth.playerId);
    const body: RouteReply<'GET /api/machines'> = { machines: machines.map(toMachineDto) };
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/machines/catalog
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/machines/catalog', async () => {
    const body: RouteReply<'GET /api/machines/catalog'> = buildCatalogReply();
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/machines
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/machines', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;

    // The guard of `plugins/routes.ts` installs the record for every route the map marks
    // with `requiresIdempotencyKey`, so this is never null in practice. Refusing rather than
    // inventing a key keeps the ledger key derived from the client key and only from it,
    // which is what makes a retry land on the same entry.
    const record = request.idempotency;
    if (record === null) {
      throw idempotencyKeyRequired();
    }

    const body = request.body;
    const outcome = await withPlayerAdvanced(services, auth.playerId, (ctx) =>
      buyMachine(ctx, {
        farmId: body.farmId,
        type: body.type,
        garageId: body.garageId ?? null,
        expectedTotal: body.expectedTotal === undefined ? null : fromWireMoney(body.expectedTotal),
        idempotencyKey: requestKey(auth.playerId, PURCHASE_KEY_VERB, record.key),
      }),
    );

    const reply: RouteReply<'POST /api/machines'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: {
        machine: toMachineDto(outcome.result.machine),
        totalPaid: toWireMoney(outcome.result.totalPaid),
        balanceAfter: toWireMoney(outcome.result.balanceAfter),
        garageSlotsUsed: outcome.result.garageSlots.used,
        garageSlotsTotal: outcome.result.garageSlots.total,
      },
    };
    return reply;
  });

  // -------------------------------------------------------------------------
  // POST /api/machines/:machineId/sell
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/machines/:machineId/sell', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const record = request.idempotency;
    if (record === null) {
      throw idempotencyKeyRequired();
    }

    const outcome = await withPlayerAdvanced(services, auth.playerId, (ctx) =>
      sellMachine(ctx, {
        machineId: request.params.machineId,
        idempotencyKey: requestKey(auth.playerId, SALE_KEY_VERB, record.key),
      }),
    );

    const reply: RouteReply<'POST /api/machines/:machineId/sell'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: {
        machineId: outcome.result.machine.id,
        refund: toWireMoney(outcome.result.refund),
        balanceAfter: toWireMoney(outcome.result.balanceAfter),
        garageSlotsUsed: outcome.result.garageSlots.used,
        garageSlotsTotal: outcome.result.garageSlots.total,
      },
    };
    return reply;
  });

  // -------------------------------------------------------------------------
  // POST /api/machines/:machineId/repair
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/machines/:machineId/repair', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const record = request.idempotency;
    if (record === null) {
      throw idempotencyKeyRequired();
    }

    const body = request.body;
    const outcome = await withPlayerAdvanced(services, auth.playerId, (ctx) =>
      repairMachine(ctx, {
        machineId: request.params.machineId,
        toConditionBp: body.toConditionBp === undefined ? null : clampBp(body.toConditionBp),
        expectedTotal: body.expectedTotal === undefined ? null : fromWireMoney(body.expectedTotal),
        idempotencyKey: requestKey(auth.playerId, REPAIR_KEY_VERB, record.key),
      }),
    );

    const reply: RouteReply<'POST /api/machines/:machineId/repair'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: {
        machine: toMachineDto(outcome.result.machine),
        pointsRestored: outcome.result.pointsRestored,
        totalPaid: toWireMoney(outcome.result.totalPaid),
        balanceAfter: toWireMoney(outcome.result.balanceAfter),
        repairEndsAtGameMs: toWireGameMs(outcome.result.repairEndsAtGameMs),
      },
    };
    return reply;
  });
}
