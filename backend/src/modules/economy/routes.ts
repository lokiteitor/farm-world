// The four routes of the `economy` area.
//
// Owner: workflow W5-C. Module `economy`.
//
// Three readings and one mutation, and the shape of each follows from the flags the contract
// sets rather than from a choice made here:
//
//   `GET /api/inventory`        advances the player, so the guard of `plugins/routes.ts` has
//                               already settled the accruals by the time the body runs and
//                               the stock it reports is the stock at `atGameMs`.
//   `GET /api/market/prices`    does not advance: the price is a constant of GDD section 123
//                               and has nothing to do with the state of the player. It is the
//                               only route of the area that touches no player row.
//   `GET /api/economy/ledger`   advances, so a page that ends at "now" includes the settlement
//                               of the window that just closed instead of showing a balance
//                               the top bar has already moved past.
//   `POST /api/market/sell`     is `sequenced` and `movesMoney`, therefore carries an
//                               idempotency key, therefore runs inside `withPlayerAdvanced`,
//                               which is the only thing that returns the `seq` the reply has
//                               to carry.
//
// The handlers are deliberately thin: everything that decides anything lives in `market.ts`,
// `ledger.ts` and `readModel.ts`, so this file is the conversion between the wire types and
// the domain types and nothing else. The conversion is explicit in both directions because
// the branded types of `shared/domain` do not cross the cable (ADR-0006).

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { requestKey } from '../../lib/ids.js';
import { buildPlayerDto, toLedgerEntryDto } from '../../lib/playerView.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  GameEventType,
  fromWireGameMs,
  idempotencyKeyRequired,
  toWireGameMs,
  toWireMoney,
  type RouteReply,
} from '../../shared/index.js';
import { buildFarmDto } from '../farms/readModel.js';
import { NO_LEDGER_FILTER, queryLedger } from './ledger.js';
import { marketPrices, sellStock } from './market.js';
import { buildInventoryFarms, buildInventoryReply } from './readModel.js';

/** Verb of the idempotency key of this area, so an entry is greppable in the ledger. */
const SELL_KEY_VERB = 'market-sell';

/** Registers the routes of the area. Invoked once by `src/app.ts`. */
export function registerEconomyRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/inventory
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/inventory', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const reading = await readClock(request);
    const body: RouteReply<'GET /api/inventory'> = await buildInventoryReply(
      services.prisma,
      auth.playerId,
      reading.gameNow,
    );
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/market/prices
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/market/prices', async (request) => {
    const reading = await readClock(request);
    const body: RouteReply<'GET /api/market/prices'> = {
      prices: [...marketPrices()],
      atGameMs: toWireGameMs(reading.gameNow),
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/economy/ledger
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/economy/ledger', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;

    // The two filters of `queryLedger` reach it through HTTP since W7: the contract used to
    // be a strict object with `limit` and `cursor` only, so a request that named a kind was
    // refused at the boundary before this module saw it (docs/handoff/NOTES-w5c.md 2.3).
    // `type` is one value or a list, which is what one or several `?type=` produce, and the
    // interval is half-open, `[fromGameMs, toGameMs)`, the window the whole system uses.
    const requestedTypes = request.query.type;
    const page = await queryLedger(services.prisma, auth.playerId, {
      ...NO_LEDGER_FILTER,
      limit: request.query.limit,
      cursor: request.query.cursor ?? null,
      types:
        requestedTypes === undefined
          ? null
          : Array.isArray(requestedTypes)
            ? requestedTypes
            : [requestedTypes],
      fromGameMs:
        request.query.fromGameMs === undefined ? null : fromWireGameMs(request.query.fromGameMs),
      toGameMs:
        request.query.toGameMs === undefined ? null : fromWireGameMs(request.query.toGameMs),
    });

    const body: RouteReply<'GET /api/economy/ledger'> = {
      entries: page.entries.map(toLedgerEntryDto),
      nextCursor: page.nextCursor,
      balance: toWireMoney(page.balance),
      entryCount: page.entryCount,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/market/sell
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/market/sell', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;

    // The guard of `plugins/routes.ts` installs the record for every route the map marks with
    // `requiresIdempotencyKey`, so this is never null in practice. Refusing rather than
    // inventing a key keeps the ledger key derived from the client key and only from it,
    // which is what makes a retry land on the same entry.
    const record = request.idempotency;
    if (record === null) {
      throw idempotencyKeyRequired();
    }

    const quantityUnits = request.body.quantityUnits;
    const outcome = await withPlayerAdvanced(services, auth.playerId, async (ctx) => {
      const sale = await sellStock(ctx, {
        farmId: request.body.farmId,
        item: request.body.item,
        quantityUnits: quantityUnits === undefined ? null : quantityUnits,
        idempotencyKey: requestKey(auth.playerId, SELL_KEY_VERB, record.key),
      });

      // The frames, in the order the contract declares them for this route. Every entity is a
      // complete replacement and not a delta, so the reply and the frames converge whichever
      // arrives first (ADR-0006).
      const inventory = await buildInventoryFarms(ctx.tx, auth.playerId);
      if (inventory.length > 0) {
        ctx.emit({ type: GameEventType.INVENTORY_UPSERTED, payload: { farms: [...inventory] } });
      }
      ctx.emit(
        {
          type: GameEventType.FARM_UPSERTED,
          payload: { farm: await buildFarmDto(ctx.tx, sale.farmId) },
        },
        {
          type: GameEventType.PLAYER_UPSERTED,
          payload: { player: await buildPlayerDto(ctx.tx, auth.playerId, ctx.reading) },
        },
        {
          type: GameEventType.LEDGER_APPENDED,
          payload: {
            entries: [toLedgerEntryDto(sale.entry)],
            balance: toWireMoney(sale.balanceAfter),
          },
        },
      );
      return sale;
    });

    const body: RouteReply<'POST /api/market/sell'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: {
        item: outcome.result.item,
        category: outcome.result.category,
        quantitySoldUnits: outcome.result.quantitySoldUnits,
        revenue: toWireMoney(outcome.result.revenue),
        balanceAfter: toWireMoney(outcome.result.balanceAfter),
        usage: outcome.result.usage,
      },
    };
    return body;
  });
}
