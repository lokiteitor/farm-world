// Fixtures of every read model of the contract.
//
// Owner: workflow W2 (API contract). Not a test file: the vitest configuration collects
// `*.test.ts`, so this module is only imported.
//
// Why they are typed and not plain objects. Each fixture is annotated with the type the
// schema infers, so the compiler checks it against the schema and the test then checks
// that the schema accepts it at runtime. The two checks catch different mistakes: the
// compiler catches a field that does not exist or has the wrong TypeScript type, and the
// runtime catches a value that has the right type and the wrong shape, which is exactly
// what a decimal string or a serialised instant is.
//
// They also serve as the reference payloads the simulated server of the frontend starts
// from, which is why they are exported rather than inlined in the tests.

import { MAX_SELECTION_CELLS } from '../../config/world.js';
import { type CellCoordWire, type ClockDto } from '../schemas/common.js';
import { type LedgerEntryDto, type InventoryFarm } from '../schemas/economy.js';
import { type BuildingDto, type FarmDto } from '../schemas/farms.js';
import { type FieldDto } from '../schemas/fields.js';
import { type ForestPlotDto, type TreeDto } from '../schemas/forestry.js';
import { type MachineDto } from '../schemas/machinery.js';
import { type NoticeDto, type PlayerDto } from '../schemas/state.js';
import { type TaskDto } from '../schemas/tasks.js';
import { type WorkerCandidateDto, type WorkerDto } from '../schemas/workers.js';
import { type ChunkCellPatch } from '../schemas/world.js';

/** One game hour past the world epoch, under the default multiplier of 24 to 1. */
export const AT_GAME_MS = '3600000';

export const clockFixture: ClockDto = {
  gameMs: AT_GAME_MS,
  realMs: '1700000150000',
  anchorGameMs: '0',
  anchorRealMs: '1700000000000',
  rateNum: 24,
  rateDen: 1,
  scheduleEpoch: 1,
};

export const playerFixture: PlayerDto = {
  id: 'plr_000000000001',
  email: 'jugadora@example.com',
  displayName: 'Jugadora',
  status: 'ACTIVE',
  // Starting capital of GDD section 117, in canonical four decimal form.
  balance: '160000.0000',
  projectedBalance: '159963.0000',
  startedAtGameMs: '0',
  dayNumber: 1,
  lastAccrualGameMs: AT_GAME_MS,
  lastLoginGameMs: '0',
  lastSummaryGameMs: '0',
  ledgerSeq: 4,
  eventSeq: 12,
  // 12 + 25 of maintenance, which is what the two powered machines of GDD section 89 cost.
  holdingCostPerGameHour: '37.0000',
  atGameMs: AT_GAME_MS,
};

export const farmFixture: FarmDto = {
  id: 'frm_000000000001',
  name: 'Granja del valle',
  wheat: {
    storedUnits: 24_500,
    reservedUnits: 0,
    // Silo of GDD section 116.
    capacityUnits: 100_000,
    occupancyBp: 2450,
  },
  wood: {
    storedUnits: 0,
    reservedUnits: 0,
    capacityUnits: 0,
    occupancyBp: 0,
  },
  machineSlots: { used: 3, total: 4 },
  workerSlots: { used: 1, total: 4 },
  hasWorkshop: false,
  buildingCount: 3,
  createdAtGameMs: '0',
};

export const buildingFixture: BuildingDto = {
  id: 'bld_000000000001',
  farmId: farmFixture.id,
  type: 'GARAGE',
  originCellX: 1200,
  originCellY: -340,
  // 6 x 8 of GDD sections 26 and 116.
  widthCells: 6,
  heightCells: 8,
  capacity: 4,
  occupancy: 3,
  builtAtGameMs: '0',
  // 60 % of 8 000, the resale factor of plan section 6.6.
  resaleValue: '4800.0000',
};

export const fieldFixture: FieldDto = {
  id: 'fld_000000000001',
  farmId: farmFixture.id,
  name: 'Campo norte',
  // The initial field of GDD section 117.
  cellCount: 250,
  cropId: 'WHEAT',
  cropCycleState: 'GROWING',
  soilCondition: 'PLOWED',
  fertilityBp: 10_000,
  fertilityUpdatedAtGameMs: '0',
  weedLevelBp: 600,
  weedLevelUpdatedAtGameMs: '0',
  fertilizationBp: 0,
  fertilizationUpdatedAtGameMs: '0',
  stateEnteredAtGameMs: '64800000',
  seededAtGameMs: '0',
  currentTaskId: null,
  createdAtGameMs: '0',
  projection: {
    atGameMs: AT_GAME_MS,
    cropCycleState: 'GROWING',
    growthProgressBp: 1250,
    weedLevelBp: 660,
    fertilityBp: 10_000,
    fertilizationBp: 0,
    // 96 game hours after sowing (GDD section 82, plan section 2.2).
    readyAtGameMs: '345600000',
    expectedYieldLiters: 22_275,
    availableOperations: [],
  },
};

export const machineFixture: MachineDto = {
  id: 'mch_000000000001',
  farmId: farmFixture.id,
  garageId: buildingFixture.id,
  type: 'TRACTOR',
  conditionBp: 9850,
  conditionUpdatedAtGameMs: AT_GAME_MS,
  status: 'IDLE',
  currentTaskId: null,
  repairEndsAtGameMs: null,
  // GDD section 89.
  purchasePrice: '18000.0000',
  acquiredGameMs: '0',
  resaleValue: '10746.0000',
  // 1.5 points at 54 per point, the derived rate of shared/config/machines.
  repairCost: '81.0000',
  repairDurationGameHours: 0.375,
  assignable: true,
};

export const workerFixture: WorkerDto = {
  id: 'wrk_000000000001',
  farmId: farmFixture.id,
  homeId: 'bld_000000000003',
  name: 'Bruno Herrera',
  skillBp: 6200,
  // The 62 % candidate of GDD section 102 asks 18 per game hour.
  salaryPerGameHour: '18.0000',
  status: 'IDLE',
  currentTaskId: null,
  completedTaskCount: 2,
  hiredGameMs: '0',
  // 0.5 + 0.62 x 0.5 (GDD section 103).
  skillFactor: 0.81,
};

export const workerCandidateFixture: WorkerCandidateDto = {
  id: 'wcd_000000000001',
  name: 'Carla Rivas',
  skillBp: 4500,
  askingSalaryPerGameHour: '12.0000',
  listedAtGameMs: '0',
  skillFactor: 0.725,
};

export const taskFixture: TaskDto = {
  id: 'tsk_000000000001',
  workerId: workerFixture.id,
  machineIds: [machineFixture.id, 'mch_000000000002'],
  operation: 'PLOW',
  status: 'IN_PROGRESS',
  targetFieldId: fieldFixture.id,
  targetForestPlotId: null,
  destinationFarmId: null,
  cropId: null,
  unitsAtStart: 250,
  // 4.2 cells per hour times condition times skill, in thousandths.
  effectiveWorkSpeedMilli: 3352,
  reservedStorageUnits: null,
  startGameMs: '0',
  scheduledEndGameMs: '268560000',
  endedGameMs: null,
  cancelable: true,
  progressBp: 134,
};

export const forestPlotFixture: ForestPlotDto = {
  id: 'fpl_000000000001',
  farmId: farmFixture.id,
  name: 'Pinar del este',
  // The 250 cells of GDD section 138.
  cellCount: 250,
  emptyCellCount: 0,
  standingTreeCount: 250,
  fellableTreeCount: 230,
  // 250 cells at the average volume the generated mix yields (shared/config/forestry).
  standingWoodDm3: 383_500,
  fellableWoodDm3: 382_500,
  fellableWoodValue: '17212.5000',
  stageHistogram: { SAPLING: 20, YOUNG: 50, MATURE: 125, OLD_GROWTH: 55 },
  currentTaskId: null,
  createdAtGameMs: '0',
  atGameMs: AT_GAME_MS,
};

export const treeFixture: TreeDto = {
  id: 'tre_000000000001',
  forestPlotId: forestPlotFixture.id,
  cellX: 1400,
  cellY: -300,
  species: 'PINE',
  plantedAtGameMs: '0',
  status: 'STANDING',
  felledAtGameMs: null,
  naturallyGenerated: true,
  ageGameHours: 1,
  growthStage: 'SAPLING',
  // 0.05 m3 of GDD section 131, in cubic decimetres.
  woodVolumeDm3: 50,
  fellable: false,
  // The 240 hour boundary of GDD section 133.
  nextStageAtGameMs: '864000000',
};

export const ledgerEntryFixture: LedgerEntryDto = {
  id: 'led_000000000001',
  seq: 4,
  type: 'LAND_PURCHASE',
  // 330 cells at 120, the minimum setup of GDD section 117. Negative: an outflow.
  amount: '-39600.0000',
  balanceAfter: '120400.0000',
  atGameMs: '0',
  refType: 'LAND',
  refId: null,
  meta: { cells: 330 },
};

export const inventoryFarmFixture: InventoryFarm = {
  farmId: farmFixture.id,
  lines: [
    {
      resource: 'WHEAT_LITERS',
      storedUnit: 'L',
      displayUnit: 'L',
      displayDivisor: 1,
      usage: farmFixture.wheat,
      // 24 500 litres at 0.22, the price of GDD sections 82 and 119.
      marketValue: '5390.0000',
    },
    {
      resource: 'WOOD_M3',
      storedUnit: 'dm3',
      displayUnit: 'm3',
      displayDivisor: 1000,
      usage: farmFixture.wood,
      marketValue: '0.0000',
    },
  ],
};

export const noticeFixture: NoticeDto = {
  kind: 'HARVEST_OVERFLOW',
  severity: 'WARNING',
  code: 'SILO_CAPACITY_EXCEEDED',
  message: 'Parte de la cosecha no cupo en el silo y se desperdicio.',
  details: { wastedUnits: 1200, farmId: farmFixture.id },
  atGameMs: AT_GAME_MS,
  subjectType: 'FIELD',
  subjectId: fieldFixture.id,
};

export const chunkCellPatchFixture: ChunkCellPatch = {
  idx: 0,
  terrainOverride: null,
  ownerPlayerId: playerFixture.id,
  landUse: 'FIELD',
  fieldId: fieldFixture.id,
  forestPlotId: null,
  buildingId: null,
  hasStandingTree: false,
};

/** A rectangle of cells, used to exercise the ceiling of a selection. */
export function cellRun(count: number, startX = 0, startY = 0): CellCoordWire[] {
  const cells: CellCoordWire[] = [];
  for (let index = 0; index < count; index += 1) {
    cells.push({ cellX: startX + index, cellY: startY });
  }
  return cells;
}

/** A selection exactly at the shared ceiling, which must be accepted. */
export const maximumSelection: CellCoordWire[] = cellRun(MAX_SELECTION_CELLS);

/** A selection one cell above the ceiling, which must be rejected. */
export const oversizedSelection: CellCoordWire[] = cellRun(MAX_SELECTION_CELLS + 1);
