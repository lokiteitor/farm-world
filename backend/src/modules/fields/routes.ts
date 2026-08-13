// The six routes of the `fields` area.
//
// Owner: workflow W4-C. Module `fields`.
//
// Two read paths and four geometry operations, and the split between them is the one the
// contract draws. The two reads carry `advancesPlayer` and no sequence, so the guard of
// `plugins/routes.ts` catches the player up before the handler runs and a listing never
// shows a state that is behind the clock. The four writes are `sequenced`, so each one runs
// inside `withPlayerAdvanced`, which advances the player in the same transaction as its own
// writes and is the only thing that returns the `seq` the reply has to carry (ADR-0017).
//
// None of the four moves money and none of them carries an idempotency key: the land is
// already owned and a field is a logical entity over it (GDD sections 13 and 19). What
// protects them from a double submission is the exclusivity of use of the cell, which is a
// conditional update whose row count decides (ADR-0018): the second submission finds the
// cells already carrying `FIELD` and is refused with `CELL_IN_USE`.
//
// The geometry travels in the detail and not in the listing, which is what the contract
// asks for: a player with many fields would otherwise download the whole geometry of the
// holding on every refresh, while the renderer already gets it from the chunk layer.

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { type DomainEventDraft } from '../../lib/events.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  toWireGameMs,
  type CellCoord,
  type PlayerId,
  type RouteReply,
} from '../../shared/index.js';
import {
  buildFieldDto,
  chunkFrames,
  createField,
  extendField,
  fieldCells,
  fieldUpsertedFrame,
  loadPlayerFields,
  mergeFields,
  requireField,
  splitField,
} from './service.js';

/** The cells of a request, as the domain reads them. */
function toCells(
  cells: readonly { readonly cellX: number; readonly cellY: number }[],
): CellCoord[] {
  return cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY }));
}

/** Registers the routes of the area. Invoked once by `src/app.ts`. */
export function registerFieldsRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/fields
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/fields', async (request) => {
    const auth = requirePlayer(request);
    const reading = await readClock(request);
    const fields = await loadPlayerFields(request.server.services.prisma, auth.playerId);
    const body: RouteReply<'GET /api/fields'> = {
      fields: fields.map((field) => buildFieldDto(field, reading.gameNow)),
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/fields/:fieldId
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/fields/:fieldId', async (request) => {
    const auth = requirePlayer(request);
    const reading = await readClock(request);
    const db = request.server.services.prisma;
    const field = await requireField(db, auth.playerId, request.params.fieldId);
    const cells = await fieldCells(db, field.id);
    const body: RouteReply<'GET /api/fields/:fieldId'> = {
      field: buildFieldDto(field, reading.gameNow),
      cells: [...cells],
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/fields
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/fields', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const world = context.reading.world;
      const created = await createField(services, context, world, playerId, {
        name: request.body.name,
        farmId: request.body.farmId,
        cells: toCells(request.body.cells),
      });
      context.emit(
        fieldUpsertedFrame(created.field, context.reading.gameNow, created.cells),
        ...(await chunkFrames(services, context.tx, world, created.cells)),
      );
      return {
        field: buildFieldDto(created.field, context.reading.gameNow),
        cells: [...created.cells],
      };
    });

    const body: RouteReply<'POST /api/fields'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/fields/:fieldId/extend
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/fields/:fieldId/extend', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const world = context.reading.world;
      const field = await requireField(context.tx, playerId, request.params.fieldId);
      const added = toCells(request.body.cells);
      const extended = await extendField(services, context, world, field, added);
      context.emit(
        fieldUpsertedFrame(extended.field, context.reading.gameNow, extended.cells),
        // Only the added cells changed use, so only their chunks carry a patch.
        ...(await chunkFrames(services, context.tx, world, added)),
      );
      return {
        field: buildFieldDto(extended.field, context.reading.gameNow),
        cells: [...extended.cells],
      };
    });

    const body: RouteReply<'POST /api/fields/:fieldId/extend'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/fields/:fieldId/split
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/fields/:fieldId/split', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const world = context.reading.world;
      const field = await requireField(context.tx, playerId, request.params.fieldId);
      const split = await splitField(services, context, world, field, {
        name: request.body.name,
        cells: toCells(request.body.cells),
      });
      const atGameMs = context.reading.gameNow;
      context.emit(
        fieldUpsertedFrame(split.original, atGameMs, split.remainingCells),
        fieldUpsertedFrame(split.created, atGameMs, split.movedCells),
        ...(await chunkFrames(services, context.tx, world, split.movedCells)),
      );
      return {
        original: buildFieldDto(split.original, atGameMs),
        created: buildFieldDto(split.created, atGameMs),
        movedCells: [...split.movedCells],
      };
    });

    const body: RouteReply<'POST /api/fields/:fieldId/split'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/fields/merge
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/fields/merge', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const world = context.reading.world;
      const merged = await mergeFields(services, context, world, playerId, {
        name: request.body.name,
        fieldIds: request.body.fieldIds,
      });
      const atGameMs = context.reading.gameNow;
      context.emit(
        fieldUpsertedFrame(merged.field, atGameMs, merged.cells),
        ...merged.removedFieldIds.map((fieldId): DomainEventDraft => ({
          type: 'FIELD_REMOVED',
          payload: { fieldId },
        })),
        ...(await chunkFrames(services, context.tx, world, merged.cells)),
      );
      return {
        field: buildFieldDto(merged.field, atGameMs),
        removedFieldIds: [...merged.removedFieldIds],
      };
    });

    const body: RouteReply<'POST /api/fields/merge'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });
}
