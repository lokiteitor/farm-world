// The five routes of the `tasks` area.
//
// Owner: workflow W6-A. Module `tasks`.
//
//   GET  /api/tasks                    the board, with the progress at the clock of the reply.
//   GET  /api/tasks/:taskId            one task.
//   POST /api/tasks/estimate           the preview: duration, cost, production and blockers.
//   POST /api/tasks                    the assignment of GDD section 104.
//   POST /api/tasks/:taskId/cancel     the all or nothing interruption of GDD section 106.
//
// The two mutating routes are `sequenced` in the contract, so both run inside
// `withPlayerAdvanced`: it advances the player in the same transaction as the writes, which
// is what makes an assignment validate against a field whose growth job has not run yet,
// and it is the only thing that returns the `seq` a sequenced reply has to carry (ADR-0017).
//
// Neither of them moves money and neither carries an idempotency key, exactly as the
// contract declares. Creating a task is free: the operating cost of GDD section 94 is a
// continuous accrual over the interval the task runs (plan section 6.2), so there is nothing
// to charge at the moment of assignment and nothing a double submission could duplicate.
// What protects the assignment from a double click is the conditional reservation of the
// worker and the machines, which answers `WORKER_NOT_IDLE` or `MACHINE_NOT_IDLE`.
//
// `POST /api/tasks/estimate` is declared as advancing the player and not as sequenced, so
// the guard of `plugins/routes.ts` catches the player up before the handler runs and the
// preview is computed against the same state the assignment would see. It writes nothing.
//
// The handlers are thin on purpose. Everything that decides anything is in `assignment.ts`
// and `service.ts`; what lives here is the conversion between the wire types and the domain
// types, in both directions, because the branded identifiers of `shared/domain` do not cross
// the cable (ADR-0006).

import { type FastifyInstance } from 'fastify';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  gameMsToGameHours,
  toWireGameMs,
  toWireMoney,
  type ApiErrorBody,
  type CellCoord,
  type RouteReply,
  type TaskRequest,
} from '../../shared/index.js';
import { evaluateAssignment, type AssignmentRequest } from './assignment.js';
import { loadTaskPage, requireTask, toTaskDto } from './record.js';
import { cancelTaskById, createTask } from './service.js';

/**
 * The wire request as the domain reads it.
 *
 * The schema is a discriminated union per operation, so every branch carries exactly the
 * fields its row of the table of GDD section 90 needs and no others; this flattening is
 * where that shape is turned into the one the evaluation works on. It is written as a
 * lookup on the discriminant rather than with optional chaining so that a member added to
 * the union does not compile until it is handled.
 */
function toAssignmentRequest(body: TaskRequest): AssignmentRequest {
  const common = {
    operation: body.operation,
    workerId: body.workerId,
    poweredMachineId: body.poweredMachineId,
  };
  switch (body.operation) {
    case 'PLOW':
    case 'CULTIVATE':
      return {
        ...common,
        implementMachineId: body.implementMachineId,
        targetFieldId: body.targetFieldId,
      };
    case 'SEED':
      return {
        ...common,
        implementMachineId: body.implementMachineId,
        targetFieldId: body.targetFieldId,
        cropId: body.cropId,
      };
    case 'HARVEST':
      return {
        ...common,
        implementMachineId: body.implementMachineId,
        targetFieldId: body.targetFieldId,
        destinationFarmId: body.destinationFarmId,
      };
    case 'FELL':
      return {
        ...common,
        targetForestPlotId: body.targetForestPlotId,
        destinationFarmId: body.destinationFarmId,
        ...(body.cells === undefined ? {} : { cells: toCells(body.cells) }),
      };
    case 'REPLANT':
      return {
        ...common,
        targetForestPlotId: body.targetForestPlotId,
        cells: toCells(body.cells),
      };
    default:
      return {
        ...common,
        implementMachineId: body.implementMachineId,
        cells: toCells(body.cells),
      };
  }
}

function toCells(
  cells: readonly { readonly cellX: number; readonly cellY: number }[],
): CellCoord[] {
  return cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY }));
}

/** Registra las rutas del area `tasks`. Invocada una vez por `src/app.ts`. */
export function registerTasksRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/tasks
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/tasks', async (request) => {
    const auth = requirePlayer(request);
    const reading = await readClock(request);
    const page = await loadTaskPage(request.server.services.prisma, auth.playerId, {
      status: request.query.status,
      limit: request.query.limit,
      cursor: request.query.cursor,
    });
    const body: RouteReply<'GET /api/tasks'> = {
      tasks: page.tasks.map((task) => toTaskDto(task, reading.gameNow)),
      nextCursor: page.nextCursor,
      atGameMs: toWireGameMs(reading.gameNow),
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // GET /api/tasks/:taskId
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/tasks/:taskId', async (request) => {
    const auth = requirePlayer(request);
    const reading = await readClock(request);
    const task = await requireTask(
      request.server.services.prisma,
      auth.playerId,
      request.params.taskId,
    );
    const body: RouteReply<'GET /api/tasks/:taskId'> = {
      task: toTaskDto(task, reading.gameNow),
      atGameMs: toWireGameMs(reading.gameNow),
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/estimate
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/tasks/estimate', async (request) => {
    const auth = requirePlayer(request);
    const reading = await readClock(request);
    const evaluation = await evaluateAssignment(
      request.server.services.prisma,
      auth.playerId,
      reading,
      toAssignmentRequest(request.body),
    );

    const body: RouteReply<'POST /api/tasks/estimate'> = {
      feasible: evaluation.blockers.length === 0,
      // Every reason at once, and each one a full error body with the same code the
      // mutating route would answer: reporting them one at a time turns the assignment
      // panel into a guessing game (`shared/api/schemas/tasks.ts`).
      blockers: evaluation.blockers.map((error): ApiErrorBody => error.toReply().error),
      operation: evaluation.operation,
      units: evaluation.units,
      effectiveWorkSpeedMilli: evaluation.duration.effectiveWorkSpeedMilli,
      durationGameHours: gameMsToGameHours(evaluation.durationGameMs),
      durationGameMs: toWireGameMs(evaluation.durationGameMs),
      scheduledEndGameMs: toWireGameMs(evaluation.scheduledEndGameMs),
      operatingCost: toWireMoney(evaluation.operatingCost),
      workerWages: toWireMoney(evaluation.workerWages),
      conditionLossBp: evaluation.conditionLossBp,
      expectedProductionUnits: evaluation.expectedProductionUnits,
      reservedStorageUnits: evaluation.reservedStorageUnits,
      overflowUnits: evaluation.overflowUnits,
      atGameMs: toWireGameMs(reading.gameNow),
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/tasks', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;

    const outcome = await withPlayerAdvanced(services, auth.playerId, (ctx) =>
      createTask(ctx, toAssignmentRequest(request.body)),
    );

    const body: RouteReply<'POST /api/tasks'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: {
        task: toTaskDto(outcome.result.task, outcome.atGameMs),
        targetFieldId: outcome.result.task.targetFieldId,
        targetForestPlotId: outcome.result.task.targetForestPlotId,
      },
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/tasks/:taskId/cancel
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/tasks/:taskId/cancel', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;

    const outcome = await withPlayerAdvanced(services, auth.playerId, (ctx) =>
      cancelTaskById(ctx, request.params.taskId),
    );

    const body: RouteReply<'POST /api/tasks/:taskId/cancel'> = {
      seq: outcome.seq,
      atGameMs: toWireGameMs(outcome.atGameMs),
      result: {
        task: toTaskDto(outcome.result.task, outcome.atGameMs),
        machineConditionBp: outcome.result.machines.map((machine) => ({
          machineId: machine.id,
          conditionBp: machine.conditionBp,
        })),
        releasedStorageUnits: outcome.result.releasedStorageUnits,
      },
    };
    return body;
  });
}
