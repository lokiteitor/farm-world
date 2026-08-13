// The body of an assignment, composed once and sent to two different routes.
//
// Owner: W6-D. Read by the assignment panel and by its suite.
//
// The contract splits the seven operations over four routes: `POST /api/tasks/estimate`
// takes all of them because it mutates nothing, `POST /api/tasks` takes the four
// agricultural ones, and the three forestry ones each have their own path with the plot in
// the URL (`shared/api/routes.ts`, and the header comment of `shared/api/schemas/tasks.ts`).
// The request bodies are `strictObject`s, so a field that belongs to another operation is a
// 400 and not a harmless extra.
//
// One composer therefore, and three projections of it. Doing it any other way means the
// preview and the request can disagree about what was asked, which is the one way a panel
// that previews correctly can still send something else.

import { TaskOperation, type CellCoordWire, type CropId, type TaskRequest } from '~/shared/index';

export interface AssignmentChoice {
  readonly operation: TaskOperation;
  readonly workerId: string;
  readonly poweredMachineId: string;
  readonly implementMachineId: string | null;
  readonly targetFieldId: string | null;
  readonly targetForestPlotId: string | null;
  readonly destinationFarmId: string | null;
  readonly cropId: CropId | null;
  readonly cells: readonly CellCoordWire[];
}

/**
 * The body of the estimate, which is the discriminated union of the contract.
 *
 * Built with a switch over the operation and not by spreading an object with optional
 * fields: the union is what says a sowing carries a crop and a felling does not, and
 * composing it positively is what makes the compiler check the shape instead of the server.
 */
export function buildEstimateBody(choice: AssignmentChoice): TaskRequest | null {
  const common = { workerId: choice.workerId, poweredMachineId: choice.poweredMachineId };
  switch (choice.operation) {
    case TaskOperation.PLOW:
    case TaskOperation.CULTIVATE: {
      if (choice.implementMachineId === null || choice.targetFieldId === null) {
        return null;
      }
      return {
        operation: choice.operation,
        ...common,
        implementMachineId: choice.implementMachineId,
        targetFieldId: choice.targetFieldId,
      };
    }
    case TaskOperation.SEED: {
      if (
        choice.implementMachineId === null ||
        choice.targetFieldId === null ||
        choice.cropId === null
      ) {
        return null;
      }
      return {
        operation: TaskOperation.SEED,
        ...common,
        implementMachineId: choice.implementMachineId,
        targetFieldId: choice.targetFieldId,
        cropId: choice.cropId,
      };
    }
    case TaskOperation.HARVEST: {
      if (
        choice.implementMachineId === null ||
        choice.targetFieldId === null ||
        choice.destinationFarmId === null
      ) {
        return null;
      }
      return {
        operation: TaskOperation.HARVEST,
        ...common,
        implementMachineId: choice.implementMachineId,
        targetFieldId: choice.targetFieldId,
        destinationFarmId: choice.destinationFarmId,
      };
    }
    case TaskOperation.FELL: {
      if (choice.targetForestPlotId === null || choice.destinationFarmId === null) {
        return null;
      }
      // An empty selection means the whole plot, which is what the contract says `cells`
      // omitted means (GDD section 132, option B).
      return {
        operation: TaskOperation.FELL,
        ...common,
        targetForestPlotId: choice.targetForestPlotId,
        destinationFarmId: choice.destinationFarmId,
        ...(choice.cells.length === 0 ? {} : { cells: [...choice.cells] }),
      };
    }
    case TaskOperation.REPLANT: {
      if (choice.targetForestPlotId === null || choice.cells.length === 0) {
        return null;
      }
      return {
        operation: TaskOperation.REPLANT,
        ...common,
        targetForestPlotId: choice.targetForestPlotId,
        cells: [...choice.cells],
      };
    }
    case TaskOperation.CLEAR_LAND: {
      if (choice.implementMachineId === null || choice.cells.length === 0) {
        return null;
      }
      return {
        operation: TaskOperation.CLEAR_LAND,
        ...common,
        implementMachineId: choice.implementMachineId,
        cells: [...choice.cells],
        ...(choice.targetForestPlotId === null ? {} : { forestPlotId: choice.targetForestPlotId }),
      };
    }
  }
}

/** Whether the operation is one of the four `POST /api/tasks` accepts. */
export function isAgricultural(operation: TaskOperation): boolean {
  return (
    operation === TaskOperation.PLOW ||
    operation === TaskOperation.CULTIVATE ||
    operation === TaskOperation.SEED ||
    operation === TaskOperation.HARVEST
  );
}
