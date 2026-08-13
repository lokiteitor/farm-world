// The two routes of the `land` area.
//
// Owner: workflow W4-A. Module `land`.
//
// `POST /api/land/quote` is the budget the purchase panel shows. It is a POST because the
// selection is up to two thousand cells and does not fit in a query string, and it mutates
// nothing, which is why the contract gives it no idempotency key.
//
// `POST /api/land/purchase` is the canonical money moving route of the contract: it is
// `sequenced`, it declares `movesMoney` and therefore `requiresIdempotencyKey`, and it
// emits `CHUNK_PATCHED`, `PLAYER_UPSERTED` and `LEDGER_APPENDED`. It runs inside
// `withPlayerAdvanced`, which is not a style choice: a sequenced route must, because that
// wrapper is the only thing that advances the player in the same transaction as its own
// writes and the only thing that returns the `seq` the reply has to carry
// (`docs/handoff/NOTES-w3a.md`, item 2.4).
//
// Both handlers are deliberately thin. Everything that decides anything lives in
// `service.ts`, so the HTTP layer is the conversion between the wire types and the domain
// types and nothing else. The conversion is explicit in both directions because the branded
// types of `shared/domain` do not cross the cable (ADR-0006).

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { requestKey } from '../../lib/ids.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  fromWireMoney,
  idempotencyKeyRequired,
  toWireGameMs,
  toWireMoney,
  type LandQuoteCell,
  type RouteReply,
} from '../../shared/index.js';
import { purchaseLand, quoteSelection } from './service.js';

/** Verb of the idempotency key of this area, so an entry is greppable in the ledger. */
const PURCHASE_KEY_VERB = 'land-purchase';

/** Registers the routes of the area. Invoked once by `src/app.ts`. */
export function registerLandRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // POST /api/land/quote
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/land/quote', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const reading = await readClock(request);

    const quote = await quoteSelection(
      services,
      services.prisma,
      reading.world,
      auth.playerId,
      request.body.cells,
    );

    const body: RouteReply<'POST /api/land/quote'> = {
      cells: quote.cells.map((cell): LandQuoteCell => ({
        cellX: cell.cellX,
        cellY: cell.cellY,
        terrain: cell.terrain,
        price: cell.price === null ? null : toWireMoney(cell.price),
        blockedBy: cell.blockedBy,
      })),
      purchasableCount: quote.purchasableCount,
      blockedCount: quote.blockedCount,
      total: toWireMoney(quote.total),
      balance: toWireMoney(quote.balance),
      affordable: quote.affordable,
      firstBlockedCell: quote.firstBlockedCell,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/land/purchase
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/land/purchase', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;

    // The guard of `plugins/routes.ts` installs the record for every route the map marks
    // with `requiresIdempotencyKey`, so this is never null in practice. Refusing rather
    // than inventing a key keeps the ledger key derived from the client key and only from
    // it, which is what makes a retry land on the same entry.
    const record = request.idempotency;
    if (record === null) {
      throw idempotencyKeyRequired();
    }

    const expectedTotal = request.body.expectedTotal;
    const outcome = await withPlayerAdvanced(services, auth.playerId, (ctx) =>
      purchaseLand(ctx, {
        cells: request.body.cells,
        allowPartial: request.body.allowPartial,
        expectedTotal: expectedTotal === undefined ? null : fromWireMoney(expectedTotal),
        idempotencyKey: requestKey(auth.playerId, PURCHASE_KEY_VERB, record.key),
      }),
    );

    const body: RouteReply<'POST /api/land/purchase'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: {
        purchasedCells: outcome.result.purchasedCells.map((cell) => ({
          cellX: cell.cellX,
          cellY: cell.cellY,
        })),
        purchasedCount: outcome.result.purchasedCount,
        skippedCount: outcome.result.skippedCount,
        totalPaid: toWireMoney(outcome.result.totalPaid),
        balanceAfter: toWireMoney(outcome.result.balanceAfter),
      },
    };
    return body;
  });
}
