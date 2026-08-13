// Fixtures shared by the suites of the `tasks` area.
//
// Owner: workflow W6-A. Tests of the module `tasks`.
//
// A task needs a worker, two machines, a field and, for a harvest, a silo, and none of the
// five has anything to do with what these suites test. Going through the HTTP routes of
// `land`, `farms`, `fields`, `machinery` and `workers` for each of them would make every
// case depend on finding buildable terrain for the random seed of the run and on the price
// of that terrain, which is a different suite's subject. The rows are therefore inserted
// directly, exactly as `machinery/fixtures.ts` and `createFarmFixture` of the harness do.
//
// The one figure that is not arbitrary is the size of the field: 300 cells, because that is
// the narrative example of GDD section 110, and reproducing it end to end is the first thing
// these suites have to be able to do.

import {
  BuildingType,
  CropCycleState,
  MachineStatus,
  Money,
  SoilCondition,
  StorageResource,
  WorkerStatus,
  type Bp,
  type CropId,
  type MachineType,
  type PlayerId,
} from '../../shared/index.js';
import { type Harness } from '../harness.js';

/** Cells of the field of GDD section 110. */
export const NARRATIVE_FIELD_CELLS = 300;

/** Machine slots of the garage every fixture raises, generous so the suite never fills it. */
const GARAGE_SLOTS = 8;

/** Worker slots of the home every fixture raises. */
const HOME_SLOTS = 8;

export interface TaskFarmFixture {
  readonly farmId: string;
  readonly garageId: string;
  readonly homeId: string;
  readonly siloId: string | null;
}

/**
 * A farm with a garage, a worker home and, optionally, a silo of a stated capacity.
 *
 * The silo capacity is a parameter because "the store fills to capacity and the rest is
 * wasted" (GDD sections 83 and 97) is only observable when the capacity is smaller than the
 * yield, and the yield of 300 cells of wheat is around 27 000 litres.
 */
export async function createTaskFarm(
  harness: Harness,
  playerId: PlayerId,
  band: number,
  siloCapacityLiters: number | null = 60_000,
): Promise<TaskFarmFixture> {
  const atGameMs = harness.gameNow();
  const farm = await harness.prisma.farm.create({
    data: { playerId, name: `Granja de tareas ${band}`, createdAtGameMs: atGameMs },
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
      capacityWorkers: HOME_SLOTS,
      capacityStorageUnits: 0,
      storageResource: null,
      builtAtGameMs: atGameMs,
    },
    select: { id: true },
  });

  let siloId: string | null = null;
  if (siloCapacityLiters !== null) {
    // The trigger `buildings_farm_storage_capacity` copies the capacity into the farm, so
    // the fixture never writes `farms.capacityWheatLiters` by hand.
    const silo = await harness.prisma.building.create({
      data: {
        farmId: farm.id,
        playerId,
        type: BuildingType.SILO,
        originCellX: 16,
        originCellY: band,
        widthCells: 4,
        heightCells: 4,
        purchasePrice: '0',
        capacityMachines: 0,
        capacityWorkers: 0,
        capacityStorageUnits: siloCapacityLiters,
        storageResource: StorageResource.WHEAT_LITERS,
        builtAtGameMs: atGameMs,
      },
      select: { id: true },
    });
    siloId = silo.id;
  }

  return { farmId: farm.id, garageId: garage.id, homeId: home.id, siloId };
}

/** A machine of a type, idle and at a stated condition. */
export async function createMachine(
  harness: Harness,
  playerId: PlayerId,
  farm: TaskFarmFixture,
  type: MachineType,
  conditionBp: Bp,
): Promise<string> {
  const atGameMs = harness.gameNow();
  const machine = await harness.prisma.machine.create({
    data: {
      playerId,
      farmId: farm.farmId,
      garageId: farm.garageId,
      type,
      conditionBp,
      conditionUpdatedAtGameMs: atGameMs,
      status: MachineStatus.IDLE,
      purchasePrice: '0',
      acquiredGameMs: atGameMs,
    },
    select: { id: true },
  });
  return machine.id;
}

/** A worker of a farm, idle and at a stated skill. */
export async function createWorker(
  harness: Harness,
  playerId: PlayerId,
  farm: TaskFarmFixture,
  skillBp: Bp,
  salaryPerGameHour = Money.fromUnits(20),
): Promise<string> {
  const worker = await harness.prisma.worker.create({
    data: {
      playerId,
      farmId: farm.farmId,
      homeId: farm.homeId,
      name: 'Trabajador de prueba',
      skillBp,
      salaryPerGameHour: Money.toString(salaryPerGameHour),
      status: WorkerStatus.IDLE,
      hiredGameMs: harness.gameNow(),
    },
    select: { id: true },
  });
  return worker.id;
}

export interface FieldFixtureInput {
  readonly cellCount?: number;
  readonly cropCycleState?: CropCycleState;
  readonly cropId?: CropId | null;
  readonly fertilityBp?: number;
  readonly weedLevelBp?: number;
  /** Hours of game time before now the field was sown. Only used by the sown states. */
  readonly seededHoursAgo?: number;
}

/**
 * A field of the farm, with its parallel attributes settled at the instant it is created.
 *
 * Cells are not inserted. A field is a logical entity over the grid and every rule this
 * suite exercises reads `cellCount` (GDD sections 16, 18, 83 and 91); the geometry belongs
 * to the suites of `modules/fields` and of `modules/world`.
 */
export async function createFieldRow(
  harness: Harness,
  playerId: PlayerId,
  farm: TaskFarmFixture,
  input: FieldFixtureInput = {},
): Promise<string> {
  const atGameMs = harness.gameNow();
  const state = input.cropCycleState ?? CropCycleState.VIRGIN;
  const sown =
    state === CropCycleState.SEEDED ||
    state === CropCycleState.GERMINATING ||
    state === CropCycleState.GROWING ||
    state === CropCycleState.READY_TO_HARVEST;
  const seededAtGameMs =
    sown === false ? null : atGameMs - BigInt(Math.round((input.seededHoursAgo ?? 96) * 3_600_000));

  const field = await harness.prisma.field.create({
    data: {
      playerId,
      farmId: farm.farmId,
      name: 'Campo de prueba',
      cellCount: input.cellCount ?? NARRATIVE_FIELD_CELLS,
      // `fields_growth_timeline_check` demands a crop and a timeline inside the sown part
      // of the cycle (GDD sections 76, 80 and 85).
      cropId: input.cropId === undefined ? (sown ? 'WHEAT' : null) : input.cropId,
      cropCycleState: state,
      soilCondition: SoilCondition.UNTOUCHED,
      fertilityBp: input.fertilityBp ?? 10_000,
      fertilityUpdatedAtGameMs: atGameMs,
      weedLevelBp: input.weedLevelBp ?? 0,
      weedLevelUpdatedAtGameMs: atGameMs,
      fertilizationBp: 0,
      fertilizationUpdatedAtGameMs: atGameMs,
      stateEnteredAtGameMs: atGameMs,
      seededAtGameMs,
      createdAtGameMs: atGameMs,
    },
    select: { id: true },
  });
  return field.id;
}

/**
 * Removes everything these suites insert, in the order the foreign keys demand.
 *
 * The stock is emptied before the silos are removed. `farms_stock_check` demands that what
 * is stored fit in the capacity, and the trigger that recomputes the capacity of a farm from
 * its live storage buildings runs on the same statement, so deleting a silo that still holds
 * grain fails — which is the behaviour the interface reports as `BUILDING_NOT_EMPTY` and is
 * correct outside a teardown.
 */
export async function cleanUp(harness: Harness, playerIds: readonly PlayerId[]): Promise<void> {
  for (const playerId of playerIds) {
    await harness.prisma.farm.updateMany({
      where: { playerId },
      data: {
        storedWheatLiters: 0,
        reservedWheatLiters: 0,
        storedWoodDm3: 0,
        reservedWoodDm3: 0,
      },
    });
    await harness.prisma.field.updateMany({ where: { playerId }, data: { currentTaskId: null } });
    await harness.prisma.machine.updateMany({ where: { playerId }, data: { currentTaskId: null } });
    await harness.prisma.worker.updateMany({ where: { playerId }, data: { currentTaskId: null } });
    await harness.prisma.taskMachine.deleteMany({ where: { task: { playerId } } });
    await harness.prisma.task.deleteMany({ where: { playerId } });
    await harness.prisma.field.deleteMany({ where: { playerId } });
    await harness.prisma.worker.deleteMany({ where: { playerId } });
    await harness.prisma.machine.deleteMany({ where: { playerId } });
    await harness.prisma.building.deleteMany({ where: { playerId } });
    await harness.prisma.farm.deleteMany({ where: { playerId } });
  }
}
