// Fixtures shared by the two suites of the `machinery` area.
//
// Owner: workflow W5-A. Tests of the module `machinery`.
//
// A machine needs a farm and a garage, and a repair needs a workshop on top. None of the
// three has anything to do with what these suites are testing, and going through
// `POST /api/farms/:id/buildings` for each of them would make every case depend on finding
// buildable terrain for the random seed of the run. The rows are therefore inserted
// directly, which is exactly what `createFarmFixture` of the harness already does for the
// accrual suite of workflow W3.
//
// The one figure that is not arbitrary is the garage capacity: four slots, because "the
// fifth machine in a garage of four" is the negative assertion GDD section 96 and plan
// section 10 both name.

import { BuildingType, type PlayerId } from '../../shared/index.js';
import { type Harness } from '../harness.js';

/** Machine slots of the garage every fixture raises (GDD section 96). */
export const GARAGE_SLOTS = 4;

export interface FarmFixture {
  readonly farmId: string;
  readonly garageId: string;
  readonly homeId: string;
}

/**
 * A farm with a garage of four slots and a worker home, without a workshop.
 *
 * The footprints are placed far apart on a band of its own per fixture, so that two suites
 * running at once never write the same cells. They occupy no cell at all in fact, because
 * these rows are inserted without going through `world/service.ts`; the coordinates exist
 * only because the columns are not nullable.
 */
export async function createMachineryFarm(
  harness: Harness,
  playerId: PlayerId,
  band: number,
): Promise<FarmFixture> {
  const atGameMs = harness.gameNow();
  const farm = await harness.prisma.farm.create({
    data: { playerId, name: `Granja de maquinaria ${band}`, createdAtGameMs: atGameMs },
    select: { id: true },
  });
  const garage = await harness.prisma.building.create({
    data: {
      farmId: farm.id,
      playerId,
      type: BuildingType.GARAGE,
      originCellX: 0,
      originCellY: band,
      widthCells: 4,
      heightCells: 4,
      purchasePrice: '0',
      capacityMachines: GARAGE_SLOTS,
      capacityWorkers: 0,
      capacityStorageUnits: 0,
      storageResource: null,
      builtAtGameMs: atGameMs,
    },
    select: { id: true },
  });
  const home = await harness.prisma.building.create({
    data: {
      farmId: farm.id,
      playerId,
      type: BuildingType.WORKER_HOME,
      originCellX: 8,
      originCellY: band,
      widthCells: 3,
      heightCells: 3,
      purchasePrice: '0',
      capacityMachines: 0,
      capacityWorkers: 4,
      capacityStorageUnits: 0,
      storageResource: null,
      builtAtGameMs: atGameMs,
    },
    select: { id: true },
  });
  return { farmId: farm.id, garageId: garage.id, homeId: home.id };
}

/** Raises the workshop repair requires (GDD sections 29 and 93). */
export async function addWorkshop(
  harness: Harness,
  playerId: PlayerId,
  farmId: string,
  band: number,
): Promise<string> {
  const building = await harness.prisma.building.create({
    data: {
      farmId,
      playerId,
      type: BuildingType.WORKSHOP,
      originCellX: 16,
      originCellY: band,
      widthCells: 4,
      heightCells: 4,
      purchasePrice: '0',
      capacityMachines: 0,
      capacityWorkers: 0,
      capacityStorageUnits: 0,
      storageResource: null,
      builtAtGameMs: harness.gameNow(),
    },
    select: { id: true },
  });
  return building.id;
}

/** Removes everything these suites insert, in the order the foreign keys demand. */
export async function cleanUp(harness: Harness, playerIds: readonly PlayerId[]): Promise<void> {
  for (const playerId of playerIds) {
    await harness.prisma.taskMachine.deleteMany({ where: { task: { playerId } } });
    await harness.prisma.machine.updateMany({ where: { playerId }, data: { currentTaskId: null } });
    await harness.prisma.worker.updateMany({ where: { playerId }, data: { currentTaskId: null } });
    await harness.prisma.task.deleteMany({ where: { playerId } });
    await harness.prisma.worker.deleteMany({ where: { playerId } });
    await harness.prisma.machine.deleteMany({ where: { playerId } });
    await harness.prisma.building.deleteMany({ where: { playerId } });
    await harness.prisma.farm.deleteMany({ where: { playerId } });
  }
}
