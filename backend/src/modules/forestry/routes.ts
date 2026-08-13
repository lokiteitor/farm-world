// The six routes of the `forestry` area.
//
// Owner: workflow W6-C. Module `forestry`.
//
//   GET  /api/forest-plots                          the plots, with their counters derived.
//   GET  /api/forest-plots/:forestPlotId            one plot and a page of its trees.
//   POST /api/forest-plots                          creates a plot and populates it once.
//   POST /api/forest-plots/:forestPlotId/fell       schedules a batch felling (GDD 132).
//   POST /api/forest-plots/:forestPlotId/replant    schedules a replanting (GDD 137).
//   POST /api/land/clear                            schedules a clearing (GDD 10).
//
// The two reads carry `advancesPlayer` and no sequence, so the guard of `plugins/routes.ts`
// catches the player up before the handler runs and a listing never shows a state that is behind
// the clock. The four writes are `sequenced`, so each one runs inside `withPlayerAdvanced`, which
// advances the player in the same transaction as its own writes and is the only thing that
// returns the `seq` the reply has to carry (ADR-0017).
//
// None of the four moves money and none carries an idempotency key, which is what the contract
// declares. Creating a plot moves none because the land was paid for when it was bought (GDD
// section 115); the three operations move none at the moment of assignment because their cost is
// the continuous operating cost of the task (plan section 6.2). What protects them from a double
// submission is the reservation of the worker, the machinery and the plot, each a conditional
// update whose row count decides (ADR-0018).
//
// `POST /api/land/clear` lives in the `land` namespace and is registered by this module, which is
// literal with respect to plan section 7 and respects the ESLint zones: `forestry` and `tasks` are
// siblings of the same phase and cannot import each other (`docs/handoff/NOTES-W2c.md`, item 2.5).

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced, type MutationContext } from '../../lib/advancePlayer.js';
import { type DomainEventDraft } from '../../lib/events.js';
import { type Db } from '../../lib/tx.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  MAX_TREES_PER_REPLY,
  TreeStatus,
  toWireGameMs,
  type CellCoord,
  type CreateTaskResult,
  type ForestPlotDto,
  type GameMs,
  type PlayerId,
  type RouteReply,
} from '../../shared/index.js';
import { machineUpsertedFrame } from '../machinery/readModel.js';
import { workerUpsertedFrame } from '../workers/service.js';
import { buildForestPlotDto, forestPlotUpsertedFrame, toTaskDto, toTreeDto } from './readModel.js';
import {
  TREE_SELECT,
  loadPlayerPlots,
  pageTrees,
  requirePlot,
  toTreeRecord,
  type ForestPlotRecord,
  type TreeRecord,
} from './record.js';
import { chunkFrames, createForestPlot } from './service.js';
import {
  assignClearLandTask,
  assignFellTask,
  assignReplantTask,
  liveTreesOfArea,
  type ForestryAssignment,
} from './tasks.js';

/** The cells of a request, as the domain reads them. */
function toCells(
  cells: readonly { readonly cellX: number; readonly cellY: number }[],
): CellCoord[] {
  return cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY }));
}

/**
 * The live trees of a set of plots, grouped by plot, in one statement.
 *
 * "Live" and not "standing": a tree marked by a felling in flight still occupies its cell and
 * still counts towards the volume of the plot (GDD sections 130 and 135).
 */
async function liveTreesByPlot(
  db: Db,
  plotIds: readonly string[],
): Promise<ReadonlyMap<string, readonly TreeRecord[]>> {
  const grouped = new Map<string, TreeRecord[]>();
  for (const plotId of plotIds) {
    grouped.set(plotId, []);
  }
  if (plotIds.length === 0) {
    return grouped;
  }
  const rows = await db.tree.findMany({
    where: {
      forestPlotId: { in: [...plotIds] },
      status: { in: [TreeStatus.STANDING, TreeStatus.MARKED_FOR_HARVEST] },
    },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: TREE_SELECT,
  });
  for (const row of rows) {
    grouped.get(row.forestPlotId)?.push(toTreeRecord(row));
  }
  return grouped;
}

/** A plot with its aggregate recomputed over every live tree it holds. */
async function plotDto(db: Db, plot: ForestPlotRecord, atGameMs: GameMs): Promise<ForestPlotDto> {
  return buildForestPlotDto(plot, await liveTreesOfArea(db, plot.id, null), atGameMs);
}

/** Registra las rutas del area `forestry`. Invocada una vez por `src/app.ts`. */
export function registerForestryRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/forest-plots
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/forest-plots', async (request) => {
    const auth = requirePlayer(request);
    const reading = await readClock(request);
    const db = request.server.services.prisma;
    const plots = await loadPlayerPlots(db, auth.playerId);
    const trees = await liveTreesByPlot(
      db,
      plots.map((plot) => plot.id),
    );
    const body: RouteReply<'GET /api/forest-plots'> = {
      plots: plots.map((plot) =>
        buildForestPlotDto(plot, trees.get(plot.id) ?? [], reading.gameNow),
      ),
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/forest-plots/:forestPlotId
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/forest-plots/:forestPlotId', async (request) => {
    const auth = requirePlayer(request);
    const reading = await readClock(request);
    const db = request.server.services.prisma;
    const plot = await requirePlot(db, auth.playerId, request.params.forestPlotId);

    const limit = Math.min(request.query.limit, MAX_TREES_PER_REPLY);
    const page = await pageTrees(db, plot.id, {
      status: request.query.status,
      limit,
      afterId: request.query.cursor,
    });
    // The cursor is the identifier of the last tree of the page, which is a total order because
    // the page is ordered by it. A page shorter than the limit is the last one.
    const last = page[page.length - 1];
    const nextCursor = page.length === limit && last !== undefined ? last.id : null;

    const body: RouteReply<'GET /api/forest-plots/:forestPlotId'> = {
      // The aggregate is over every live tree of the plot and not over the page: a page of
      // twenty trees must not make the plot report that it holds twenty.
      plot: await plotDto(db, plot, reading.gameNow),
      trees: page.map((tree) => toTreeDto(tree, reading.gameNow)),
      nextCursor,
      atGameMs: toWireGameMs(reading.gameNow),
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/forest-plots
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/forest-plots', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const world = context.reading.world;
      const created = await createForestPlot(services, context, world, playerId, {
        name: request.body.name,
        farmId: request.body.farmId,
        cells: toCells(request.body.cells),
      });
      const atGameMs = context.reading.gameNow;
      context.emit(
        // The geometry travels in the frame and not in `ForestPlotDto`, which is the one
        // channel the contract gives it (ADR-0051).
        forestPlotUpsertedFrame(created.plot, created.trees, atGameMs, created.cells),
        {
          type: 'TREES_UPSERTED',
          payload: {
            forestPlotId: created.plot.id,
            trees: created.trees
              .slice(0, MAX_TREES_PER_REPLY)
              .map((tree) => toTreeDto(tree, atGameMs)),
            removedTreeIds: [],
            plot: buildForestPlotDto(created.plot, created.trees, atGameMs),
          },
        },
        ...(await chunkFrames(services, context.tx, world, created.cells)),
      );
      return {
        plot: buildForestPlotDto(created.plot, created.trees, atGameMs),
        trees: created.trees.slice(0, MAX_TREES_PER_REPLY).map((tree) => toTreeDto(tree, atGameMs)),
        generatedTreeCount: created.generatedTreeCount,
      };
    });

    const body: RouteReply<'POST /api/forest-plots'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/forest-plots/:forestPlotId/fell
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/forest-plots/:forestPlotId/fell', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const assignment = await assignFellTask(context, playerId, request.params.forestPlotId, {
        workerId: request.body.workerId,
        poweredMachineId: request.body.poweredMachineId,
        destinationFarmId: request.body.destinationFarmId,
        cells: request.body.cells === undefined ? undefined : toCells(request.body.cells),
      });
      return emitAssignment(context, assignment, context.reading.gameNow);
    });

    const body: RouteReply<'POST /api/forest-plots/:forestPlotId/fell'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/forest-plots/:forestPlotId/replant
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/forest-plots/:forestPlotId/replant', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const assignment = await assignReplantTask(
        context,
        context.reading.world,
        playerId,
        request.params.forestPlotId,
        {
          workerId: request.body.workerId,
          poweredMachineId: request.body.poweredMachineId,
          cells: toCells(request.body.cells),
        },
      );
      return emitAssignment(context, assignment, context.reading.gameNow);
    });

    const body: RouteReply<'POST /api/forest-plots/:forestPlotId/replant'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/land/clear
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/land/clear', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const playerId: PlayerId = auth.playerId;

    const outcome = await withPlayerAdvanced(services, playerId, async (context) => {
      const assignment = await assignClearLandTask(
        services,
        context,
        context.reading.world,
        playerId,
        {
          workerId: request.body.workerId,
          poweredMachineId: request.body.poweredMachineId,
          implementMachineId: request.body.implementMachineId,
          cells: toCells(request.body.cells),
          forestPlotId: request.body.forestPlotId,
        },
      );
      // The contract declares no plot frame for this route: the conversion of the ground, and
      // with it the geometry of the plot, happens at completion (`shared/api/routes.ts`).
      return emitAssignment(context, assignment, context.reading.gameNow, { withPlot: false });
    });

    const body: RouteReply<'POST /api/land/clear'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: outcome.result,
    };
    return body;
  });
}

/**
 * The frames and the reply an assignment produces, which are the same for the three operations.
 *
 * The frames are exactly the tags the contract declares for each route, so a client that trusts
 * `emits` is never surprised: the task, its machinery and its worker for all three, plus the plot
 * for the two that reserve one.
 */
async function emitAssignment(
  context: MutationContext,
  assignment: ForestryAssignment,
  atGameMs: GameMs,
  options: { readonly withPlot?: boolean } = {},
): Promise<CreateTaskResult> {
  const plot = assignment.plot;
  const plotFrames: DomainEventDraft[] =
    plot === null || options.withPlot === false
      ? []
      : [
          forestPlotUpsertedFrame(
            plot,
            await liveTreesOfArea(context.tx, plot.id, null),
            atGameMs,
            null,
          ),
        ];
  context.emit(
    { type: 'TASK_UPSERTED', payload: { task: toTaskDto(assignment.task, atGameMs) } },
    ...assignment.machines.map((machine) => machineUpsertedFrame(machine)),
    workerUpsertedFrame(assignment.worker),
    ...plotFrames,
  );
  return {
    task: toTaskDto(assignment.task, atGameMs),
    targetFieldId: null,
    targetForestPlotId: assignment.task.targetForestPlotId,
  };
}
