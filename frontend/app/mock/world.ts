// The sample world of the simulated server.
//
// Owner: W3-C. It is what the panel agents of W4, W5 and W6 develop against, so it has to be
// coherent rather than merely valid: a farm whose garage holds four machines while the
// machine list has five would make a panel look broken for a reason that is not in the
// panel.
//
// Coherence here means four things, and they are the four the interface actually depends on.
// The origin comes from `assignSpawn` of shared/world, so the owned cells are grass in the
// same terrain the client generates locally rather than a rectangle that happens to overlap
// a lake. The capacities of the buildings come from `BUILDING_CATALOGUE` and their occupancy
// equals the number of machines and workers that name them. The prices come from
// `MACHINE_CATALOGUE` and `CROPS`, so a panel that previews a cost with the shared rules gets
// the figure the simulated server would charge. And every instant is derived from one anchor,
// so the clock, the ages of the trees and the progress of the task agree.
//
// Nothing here is random in the sense that matters: the whole world derives from one seed
// through mock/rng.ts, so two reloads give the same farm and a component test is
// reproducible.

import { createRng, type Rng } from '~/mock/rng';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  CROPS,
  CropCycleState,
  CROP_IDS,
  CropId,
  STORAGE_RESOURCES,
  DEFAULT_GAME_RATE,
  GAME_HOURS_PER_GAME_DAY,
  GENERATOR_VERSION,
  INITIAL_ANCHOR_GAME_MS,
  LandUse,
  MACHINE_CATALOGUE,
  MIN_CONDITION_TO_ASSIGN,
  MachineStatus,
  MachineType,
  Money,
  PINE,
  PlayerStatus,
  SALARY_FLOOR,
  SALARY_INTERCEPT,
  SALARY_PER_SKILL_POINT,
  SHARED_CONTRACT_VERSION,
  STORAGE_RESOURCE_UNITS,
  SoilCondition,
  StorageResource,
  TaskOperation,
  TaskStatus,
  TreeGrowthStage,
  TreeSpecies,
  TreeStatus,
  WorkerStatus,
  addGameMs,
  assignSpawn,
  bp,
  buildingResaleValue,
  cellIndex,
  cellKey,
  chunkOf,
  estimateTaskDuration,
  finalYieldLiters,
  gameHours,
  gameHoursToGameMs,
  gameMs,
  holdingRatePerGameHour,
  machineResaleValue,
  multiplyByCount,
  nextStageBoundaryGameMs,
  realMs,
  skillFactor,
  terrainAt,
  toWireGameMs,
  toWireMoney,
  toWireRealMs,
  treeAgeGameHours,
  treeStageAt,
  treeWoodVolumeDm3,
  type BuildingDto,
  type CellCoordWire,
  type ChunkCellPatch,
  type ClockDto,
  type FarmDto,
  type FieldDto,
  type ForestPlotDto,
  type GameMs,
  type InventoryFarm,
  type LedgerEntryDto,
  type MachineDto,
  type MarketPrice,
  type NoticeDto,
  type PlayerDto,
  type StorageUsage,
  type TaskDto,
  type TreeDto,
  type WorkerCandidateDto,
  type WorkerDto,
} from '~/shared/index';

/**
 * Sale price of wood per stored unit, that is per cubic decimetre. Derived from the 45 per
 * cubic metre of GDD section 133 by exact integer division of the scaled amount, so the
 * quotation is per stored unit and `revenue = price x quantity` stays exact.
 */
export const MOCK_WOOD_PRICE_PER_DM3 = Money.fromScaled(
  Money.toScaled(PINE.sellPricePerM3) / 1000n,
);

export const MOCK_SEED = 20_260_811;
export const MOCK_WORLD_ID = 'world-mock';
export const MOCK_PLAYER_ID = 'player-mock';
export const MOCK_FARM_ID = 'farm-mock';

/**
 * Real instant the sample world is anchored at.
 *
 * It is the wall clock of the moment the world is built, and it is the one value here that is
 * not fixed. The game state is fully reproducible without it -- every instant of every entity
 * derives from `INITIAL_ANCHOR_GAME_MS` plus a fixed number of game hours -- but the mapping
 * from game time to wall time cannot be: an anchor pinned to a literal in the past would make
 * the client extrapolate from then to now and show a day number in the thousands, because at
 * twenty four game hours per real hour a few months of drift are a few thousand game days.
 */
function mockAnchorRealMs(): number {
  return Date.now();
}
/** Game hours the sample world has run for beyond the initial anchor. */
const ELAPSED_GAME_HOURS = 420;

/** A cell that belongs to the player, with the use assigned to it. */
export interface MockCell {
  readonly cellX: number;
  readonly cellY: number;
  landUse: LandUse;
  fieldId: string | null;
  forestPlotId: string | null;
  buildingId: string | null;
  hasStandingTree: boolean;
}

/** The whole mutable state of the simulated server. */
export interface MockWorld {
  readonly rng: Rng;
  readonly seed: number;
  readonly spawnCell: CellCoordWire;
  readonly anchorGameMs: GameMs;
  /** Wall instant the clock is anchored at, fixed for the life of this world. */
  readonly anchorRealMs: number;
  nowGameMs: GameMs;
  eventSeq: number;
  ledgerSeq: number;
  balance: Money;
  player: PlayerDto;
  farm: FarmDto;
  buildings: BuildingDto[];
  fields: FieldDto[];
  fieldCells: Map<string, CellCoordWire[]>;
  machines: MachineDto[];
  workers: WorkerDto[];
  candidates: WorkerCandidateDto[];
  tasks: TaskDto[];
  forestPlots: ForestPlotDto[];
  forestPlotCells: Map<string, CellCoordWire[]>;
  trees: TreeDto[];
  inventory: InventoryFarm[];
  ledger: LedgerEntryDto[];
  notices: NoticeDto[];
  /** Owned cells by packed key, which is what a chunk reply is built from. */
  cells: Map<number, MockCell>;
  /** Version of each chunk, incremented whenever one of its cells changes. */
  chunkVersions: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usage(storedUnits: number, capacityUnits: number, reservedUnits = 0): StorageUsage {
  const occupancy =
    capacityUnits <= 0
      ? 0
      : Math.min(10_000, Math.round(((storedUnits + reservedUnits) / capacityUnits) * 10_000));
  return { storedUnits, reservedUnits, capacityUnits, occupancyBp: occupancy };
}

/**
 * The procedural salary of GDD section 102, as plan section 2.2 fits it: `0.45 x skill -
 * 8.75`, floored at `SALARY_FLOOR`. Computed with the constants of shared/config and not
 * with a literal, so a candidate of the simulated pool costs what the real one would.
 */
function mockSalary(skillBp: number): Money {
  const skillPercent = Math.round(skillBp / 100);
  return Money.max(
    SALARY_FLOOR,
    Money.add(multiplyByCount(SALARY_PER_SKILL_POINT, skillPercent), SALARY_INTERCEPT),
  );
}

function chunkVersionKey(cellX: number, cellY: number): string {
  const chunk = chunkOf(cellX, cellY);
  return `${chunk.chunkX}:${chunk.chunkY}`;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Builds the sample world. Called once per page load, and again by a test that wants a
 * pristine one.
 */
export function createMockWorld(seed: number = MOCK_SEED): MockWorld {
  const rng = createRng(seed);
  const spawn = assignSpawn(seed, 0);
  const anchorGameMs = INITIAL_ANCHOR_GAME_MS;
  const nowGameMs = addGameMs(anchorGameMs, gameHoursToGameMs(gameHours(ELAPSED_GAME_HOURS)));

  const cells = new Map<number, MockCell>();
  const chunkVersions = new Map<string, number>();

  /** Claims a rectangle of grass cells for the player, skipping anything else. */
  const claim = (
    fromCellX: number,
    fromCellY: number,
    width: number,
    height: number,
    landUse: LandUse,
    subject: { fieldId?: string; forestPlotId?: string; buildingId?: string } = {},
  ): CellCoordWire[] => {
    const claimed: CellCoordWire[] = [];
    for (let dy = 0; dy < height; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        const cellX = fromCellX + dx;
        const cellY = fromCellY + dy;
        const terrain = terrainAt(seed, cellX, cellY);
        const wantsForest = landUse === LandUse.FOREST_PLOT;
        if (wantsForest ? terrain !== 'FOREST' : terrain !== 'GRASS') {
          continue;
        }
        const key = cellKey(cellX, cellY);
        cells.set(key, {
          cellX,
          cellY,
          landUse,
          fieldId: subject.fieldId ?? null,
          forestPlotId: subject.forestPlotId ?? null,
          buildingId: subject.buildingId ?? null,
          hasStandingTree: wantsForest,
        });
        chunkVersions.set(chunkVersionKey(cellX, cellY), 1);
        claimed.push({ cellX, cellY });
      }
    }
    return claimed;
  };

  const origin = spawn.originCell;

  // --- buildings ---------------------------------------------------------
  // The footprints come from the catalogue, so their cell count and their price are the
  // ones the placement panel will compute (GDD sections 116 and 136).
  const buildingPlan: readonly { id: string; type: BuildingType; dx: number; dy: number }[] = [
    { id: 'building-garage', type: BuildingType.GARAGE, dx: 0, dy: 0 },
    { id: 'building-silo', type: BuildingType.SILO, dx: 8, dy: 0 },
    { id: 'building-home', type: BuildingType.WORKER_HOME, dx: 0, dy: 8 },
    { id: 'building-workshop', type: BuildingType.WORKSHOP, dx: 8, dy: 8 },
  ];

  const buildings: BuildingDto[] = buildingPlan.map((entry) => {
    const definition = BUILDING_CATALOGUE[entry.type];
    const originCellX = origin.cellX + entry.dx;
    const originCellY = origin.cellY + entry.dy;
    claim(
      originCellX,
      originCellY,
      definition.widthCells,
      definition.heightCells,
      LandUse.BUILDING,
      { buildingId: entry.id },
    );
    return {
      id: entry.id,
      farmId: MOCK_FARM_ID,
      type: entry.type,
      originCellX,
      originCellY,
      widthCells: definition.widthCells,
      heightCells: definition.heightCells,
      capacity: definition.capacity ?? 0,
      occupancy: 0,
      builtAtGameMs: toWireGameMs(anchorGameMs),
      resaleValue: toWireMoney(buildingResaleValue(entry.type)),
    };
  });

  // --- fields ------------------------------------------------------------
  const fieldCells = new Map<string, CellCoordWire[]>();
  const fieldPlan: readonly {
    id: string;
    name: string;
    dx: number;
    dy: number;
    width: number;
    height: number;
    state: CropCycleState;
    sownHoursAgo: number | null;
  }[] = [
    {
      id: 'field-north',
      name: 'Parcela norte',
      dx: 0,
      dy: -18,
      width: 18,
      height: 14,
      state: CropCycleState.GROWING,
      sownHoursAgo: 60,
    },
    {
      id: 'field-east',
      name: 'Parcela este',
      dx: 20,
      dy: 0,
      width: 14,
      height: 12,
      state: CropCycleState.VIRGIN,
      sownHoursAgo: null,
    },
  ];

  const fields: FieldDto[] = fieldPlan.map((entry) => {
    const claimed = claim(
      origin.cellX + entry.dx,
      origin.cellY + entry.dy,
      entry.width,
      entry.height,
      LandUse.FIELD,
      { fieldId: entry.id },
    );
    fieldCells.set(entry.id, claimed);
    const crop = CROPS[CropId.WHEAT];
    const seededAt =
      entry.sownHoursAgo === null
        ? null
        : gameMs(nowGameMs - gameHoursToGameMs(gameHours(entry.sownHoursAgo)));
    const weedBp = bp(entry.state === CropCycleState.VIRGIN ? 2_400 : 3_600);
    const fertilityBp = bp(8_200);
    const fertilizationBp = bp(0);
    const expected = finalYieldLiters({
      cellCount: claimed.length,
      crop,
      fertilityBp,
      fertilizationBp,
      weedLevelBp: weedBp,
    });
    const readyAt =
      seededAt === null
        ? null
        : addGameMs(seededAt, gameHoursToGameMs(crop.growthDurationGameHours));
    return {
      id: entry.id,
      farmId: MOCK_FARM_ID,
      name: entry.name,
      cellCount: claimed.length,
      cropId: seededAt === null ? null : CropId.WHEAT,
      cropCycleState: entry.state,
      soilCondition:
        entry.state === CropCycleState.VIRGIN ? SoilCondition.UNTOUCHED : SoilCondition.PLOWED,
      fertilityBp,
      fertilityUpdatedAtGameMs: toWireGameMs(nowGameMs),
      weedLevelBp: weedBp,
      weedLevelUpdatedAtGameMs: toWireGameMs(nowGameMs),
      fertilizationBp,
      fertilizationUpdatedAtGameMs: toWireGameMs(nowGameMs),
      stateEnteredAtGameMs: toWireGameMs(seededAt ?? anchorGameMs),
      seededAtGameMs: seededAt === null ? null : toWireGameMs(seededAt),
      currentTaskId: null,
      createdAtGameMs: toWireGameMs(anchorGameMs),
      projection: {
        atGameMs: toWireGameMs(nowGameMs),
        cropCycleState: entry.state,
        growthProgressBp: entry.state === CropCycleState.GROWING ? bp(6_250) : bp(0),
        weedLevelBp: weedBp,
        fertilityBp,
        fertilizationBp,
        readyAtGameMs: readyAt === null ? null : toWireGameMs(readyAt),
        expectedYieldLiters: expected.liters,
        availableOperations: entry.state === CropCycleState.VIRGIN ? [TaskOperation.PLOW] : [],
      },
    };
  });

  // --- forest plot -------------------------------------------------------
  const forestPlotCells = new Map<string, CellCoordWire[]>();
  const forestClaimed = claim(origin.cellX - 24, origin.cellY, 16, 16, LandUse.FOREST_PLOT, {
    forestPlotId: 'plot-west',
  });
  forestPlotCells.set('plot-west', forestClaimed);

  const stageOffsets: Readonly<Record<TreeGrowthStage, number>> = {
    SAPLING: 120,
    YOUNG: 320,
    MATURE: 560,
    OLD_GROWTH: 820,
  };
  const stageOrder: readonly TreeGrowthStage[] = [
    TreeGrowthStage.SAPLING,
    TreeGrowthStage.YOUNG,
    TreeGrowthStage.MATURE,
    TreeGrowthStage.OLD_GROWTH,
  ];
  const trees: TreeDto[] = forestClaimed.map((cell, index) => {
    const stage = stageOrder[index % stageOrder.length] ?? TreeGrowthStage.MATURE;
    const ageHours = stageOffsets[stage] + rng.int(0, 40);
    const plantedAt = gameMs(nowGameMs - gameHoursToGameMs(gameHours(ageHours)));
    const view = {
      species: TreeSpecies.PINE,
      plantedAtGameMs: plantedAt,
      status: TreeStatus.STANDING,
    };
    const derivedStage = treeStageAt(view, nowGameMs);
    const nextBoundary = nextStageBoundaryGameMs(view, nowGameMs);
    return {
      id: `tree-${index}`,
      forestPlotId: 'plot-west',
      cellX: cell.cellX,
      cellY: cell.cellY,
      species: TreeSpecies.PINE,
      plantedAtGameMs: toWireGameMs(plantedAt),
      status: TreeStatus.STANDING,
      felledAtGameMs: null,
      naturallyGenerated: true,
      ageGameHours: treeAgeGameHours(plantedAt, nowGameMs),
      growthStage: derivedStage,
      woodVolumeDm3: treeWoodVolumeDm3(view, nowGameMs),
      fellable: PINE.fellableStages.includes(derivedStage),
      nextStageAtGameMs: nextBoundary === null ? null : toWireGameMs(nextBoundary),
    };
  });

  const histogram = { SAPLING: 0, YOUNG: 0, MATURE: 0, OLD_GROWTH: 0 };
  let standingWoodDm3 = 0;
  let fellableWoodDm3 = 0;
  let fellableTreeCount = 0;
  for (const tree of trees) {
    histogram[tree.growthStage] += 1;
    standingWoodDm3 += tree.woodVolumeDm3;
    if (tree.fellable) {
      fellableTreeCount += 1;
      fellableWoodDm3 += tree.woodVolumeDm3;
    }
  }

  const forestPlots: ForestPlotDto[] = [
    {
      id: 'plot-west',
      farmId: MOCK_FARM_ID,
      name: 'Bosque del oeste',
      cellCount: forestClaimed.length,
      emptyCellCount: 0,
      standingTreeCount: trees.length,
      fellableTreeCount,
      standingWoodDm3,
      fellableWoodDm3,
      fellableWoodValue: toWireMoney(multiplyByCount(MOCK_WOOD_PRICE_PER_DM3, fellableWoodDm3)),
      stageHistogram: histogram,
      currentTaskId: null,
      createdAtGameMs: toWireGameMs(anchorGameMs),
      atGameMs: toWireGameMs(nowGameMs),
    },
  ];

  // --- machinery ---------------------------------------------------------
  const machinePlan: readonly { id: string; type: MachineType; conditionBp: number }[] = [
    { id: 'machine-tractor', type: MachineType.TRACTOR, conditionBp: 8_600 },
    { id: 'machine-plow', type: MachineType.PLOW, conditionBp: 7_900 },
    { id: 'machine-seeder', type: MachineType.SEEDER, conditionBp: 9_200 },
    { id: 'machine-combine', type: MachineType.HARVESTER, conditionBp: 900 },
  ];
  const garageId = buildings.find((building) => building.type === BuildingType.GARAGE)?.id ?? null;
  const machines: MachineDto[] = machinePlan.map((entry) => {
    const definition = MACHINE_CATALOGUE[entry.type];
    const condition = bp(entry.conditionBp);
    const pointsToFull = Math.ceil((10_000 - entry.conditionBp) / 100);
    return {
      id: entry.id,
      farmId: MOCK_FARM_ID,
      garageId,
      type: entry.type,
      conditionBp: condition,
      conditionUpdatedAtGameMs: toWireGameMs(nowGameMs),
      status: MachineStatus.IDLE,
      currentTaskId: null,
      repairEndsAtGameMs: null,
      purchasePrice: toWireMoney(definition.purchasePrice),
      acquiredGameMs: toWireGameMs(anchorGameMs),
      resaleValue: toWireMoney(
        machineResaleValue({ purchasePrice: definition.purchasePrice, conditionBp: condition }),
      ),
      repairCost: toWireMoney(
        multiplyByCount(definition.repairCostPerConditionPoint, pointsToFull),
      ),
      repairDurationGameHours: pointsToFull * 0.25,
      assignable: entry.conditionBp >= MIN_CONDITION_TO_ASSIGN,
    };
  });

  // --- payroll -----------------------------------------------------------
  const homeId = buildings.find((building) => building.type === BuildingType.WORKER_HOME)?.id ?? '';
  const workerPlan: readonly { id: string; name: string; skillBp: number }[] = [
    { id: 'worker-elena', name: 'Elena Prado', skillBp: 7_400 },
    { id: 'worker-marc', name: 'Marc Ferrer', skillBp: 5_100 },
  ];
  const workers: WorkerDto[] = workerPlan.map((entry) => ({
    id: entry.id,
    farmId: MOCK_FARM_ID,
    homeId,
    name: entry.name,
    skillBp: bp(entry.skillBp),
    salaryPerGameHour: toWireMoney(mockSalary(bp(entry.skillBp))),
    status: WorkerStatus.IDLE,
    currentTaskId: null,
    completedTaskCount: 4,
    hiredGameMs: toWireGameMs(anchorGameMs),
    skillFactor: skillFactor(bp(entry.skillBp)),
  }));

  const candidates: WorkerCandidateDto[] = ['Ana Soler', 'Bruno Vidal', 'Carla Ruiz'].map(
    (name, index) => {
      const skillBp = bp(3_000 + index * 2_500 + rng.int(0, 400));
      return {
        id: `candidate-${index}`,
        name,
        skillBp,
        askingSalaryPerGameHour: toWireMoney(mockSalary(skillBp)),
        listedAtGameMs: toWireGameMs(nowGameMs),
        skillFactor: skillFactor(skillBp),
      };
    },
  );

  // --- one task in flight -------------------------------------------------
  //
  // The sample world starts with a plough running on the east field, so that a panel of W6
  // sees a countdown, a reserved worker and two reserved machines without having to create
  // one first. The duration comes from `estimateTaskDuration`, which is the same function
  // the assignment panel previews with and the server schedules with, so the bar is not
  // showing an invented interval (GDD sections 91 and 105).
  const plowTarget = fields[1];
  const plowMachines = ['machine-tractor', 'machine-plow'];
  const plowWorkerId = 'worker-elena';
  const plowEstimate = estimateTaskDuration({
    operation: TaskOperation.PLOW,
    units: plowTarget?.cellCount ?? 100,
    conditionBp: bp(7_900),
    skillBp: bp(7_400),
  });
  const taskStart = gameMs(nowGameMs - gameHoursToGameMs(gameHours(4)));
  const taskEnd = addGameMs(taskStart, gameHoursToGameMs(plowEstimate.durationGameHours));
  const taskProgressBp = Math.min(
    10_000,
    Math.max(
      0,
      Math.round(
        (Number(nowGameMs - taskStart) / Math.max(1, Number(taskEnd - taskStart))) * 10_000,
      ),
    ),
  );
  const tasks: TaskDto[] = [
    {
      id: 'task-plow-east',
      workerId: plowWorkerId,
      machineIds: plowMachines,
      operation: TaskOperation.PLOW,
      status: TaskStatus.IN_PROGRESS,
      targetFieldId: plowTarget?.id ?? null,
      targetForestPlotId: null,
      destinationFarmId: null,
      cropId: null,
      unitsAtStart: plowTarget?.cellCount ?? 100,
      effectiveWorkSpeedMilli: Math.max(1, plowEstimate.effectiveWorkSpeedMilli),
      reservedStorageUnits: null,
      startGameMs: toWireGameMs(taskStart),
      scheduledEndGameMs: toWireGameMs(taskEnd),
      endedGameMs: null,
      cancelable: true,
      progressBp: taskProgressBp,
    },
  ];

  // The reservation is a state of the entities and not a second pointer: the task is the
  // authoritative link (plan section 5.2), and these fields are what it derives.
  for (const machine of machines) {
    if (plowMachines.includes(machine.id)) {
      machine.status = MachineStatus.WORKING;
      machine.currentTaskId = 'task-plow-east';
    }
  }
  for (const worker of workers) {
    if (worker.id === plowWorkerId) {
      worker.status = WorkerStatus.WORKING;
      worker.currentTaskId = 'task-plow-east';
    }
  }
  if (plowTarget !== undefined) {
    const index = fields.indexOf(plowTarget);
    fields[index] = {
      ...plowTarget,
      currentTaskId: 'task-plow-east',
      projection: { ...plowTarget.projection, availableOperations: [] },
    };
  }

  // --- storage, prices, ledger and notices --------------------------------
  const wheatCapacity = BUILDING_CATALOGUE[BuildingType.SILO].capacity ?? 50_000;
  const wheatStored = 18_400;
  const woodStored = 0;
  const wheatUsage = usage(wheatStored, wheatCapacity);
  const woodUsage = usage(woodStored, 0);

  const farm: FarmDto = {
    id: MOCK_FARM_ID,
    name: 'Granja del origen',
    storage: STORAGE_RESOURCES.map((category) => ({
      category,
      usage:
        category === StorageResource.GRAIN_LITERS
          ? wheatUsage
          : category === StorageResource.WOOD_M3
            ? woodUsage
            : usage(0, 0),
    })),
    machineSlots: {
      used: machines.length,
      total: BUILDING_CATALOGUE[BuildingType.GARAGE].capacity ?? 4,
    },
    workerSlots: {
      used: workers.length,
      total: BUILDING_CATALOGUE[BuildingType.WORKER_HOME].capacity ?? 4,
    },
    hasWorkshop: true,
    buildingCount: buildings.length,
    createdAtGameMs: toWireGameMs(anchorGameMs),
  };

  for (const building of buildings) {
    if (building.type === BuildingType.GARAGE) {
      building.occupancy = machines.length;
    }
    if (building.type === BuildingType.WORKER_HOME) {
      building.occupancy = workers.length;
    }
  }

  // Dos niveles, como el contrato: un medidor por categoria y una linea por pila. La
  // muestra siembra dos cultivos de familias distintas para que el selector agrupado y el
  // mercado de dos niveles sean ejercitables sin servidor.
  const inventory: InventoryFarm[] = [
    {
      farmId: MOCK_FARM_ID,
      categories: STORAGE_RESOURCES.map((category) => ({
        category,
        storedUnit: STORAGE_RESOURCE_UNITS[category].storedUnit,
        displayUnit: STORAGE_RESOURCE_UNITS[category].displayUnit,
        displayDivisor: STORAGE_RESOURCE_UNITS[category].displayDivisor,
        usage:
          category === StorageResource.GRAIN_LITERS
            ? wheatUsage
            : category === StorageResource.WOOD_M3
              ? woodUsage
              : usage(0, 0),
      })),
      lines: [
        {
          item: 'WHEAT',
          category: StorageResource.GRAIN_LITERS,
          storedUnit: STORAGE_RESOURCE_UNITS.GRAIN_LITERS.storedUnit,
          displayUnit: STORAGE_RESOURCE_UNITS.GRAIN_LITERS.displayUnit,
          displayDivisor: STORAGE_RESOURCE_UNITS.GRAIN_LITERS.displayDivisor,
          storedUnits: wheatStored,
          reservedUnits: 0,
          marketValue: toWireMoney(multiplyByCount(CROPS.WHEAT.sellPricePerLiter, wheatStored)),
        },
      ],
    },
  ];

  const holding = holdingRatePerGameHour({
    workers: workers.map((worker) => ({
      salaryPerGameHour: Money.fromString(worker.salaryPerGameHour),
    })),
    machines: machines.map((machine) => ({ type: machine.type, status: machine.status })),
  });

  const balance = Money.fromUnits(28_450);
  const player: PlayerDto = {
    id: MOCK_PLAYER_ID,
    email: 'dev@farm-world.local',
    displayName: 'Explotacion de prueba',
    status: PlayerStatus.ACTIVE,
    balance: toWireMoney(balance),
    projectedBalance: toWireMoney(balance),
    startedAtGameMs: toWireGameMs(anchorGameMs),
    dayNumber: Math.floor(ELAPSED_GAME_HOURS / GAME_HOURS_PER_GAME_DAY) + 1,
    lastAccrualGameMs: toWireGameMs(nowGameMs),
    lastLoginGameMs: toWireGameMs(nowGameMs),
    lastSummaryGameMs: toWireGameMs(gameMs(nowGameMs - gameHoursToGameMs(gameHours(72)))),
    ledgerSeq: 12,
    eventSeq: 0,
    holdingCostPerGameHour: toWireMoney(holding.totalPerGameHour),
    atGameMs: toWireGameMs(nowGameMs),
  };

  const ledger: LedgerEntryDto[] = [
    {
      id: 'ledger-1',
      seq: 11,
      type: 'STARTING_CAPITAL',
      amount: toWireMoney(Money.fromUnits(160_000)),
      balanceAfter: toWireMoney(Money.fromUnits(160_000)),
      atGameMs: toWireGameMs(anchorGameMs),
      refType: 'PLAYER',
      refId: MOCK_PLAYER_ID,
      meta: { gddSection: 117 },
    },
    {
      id: 'ledger-2',
      seq: 12,
      type: 'WORKER_WAGES',
      amount: toWireMoney(Money.negate(Money.fromUnits(1_240))),
      balanceAfter: toWireMoney(balance),
      atGameMs: toWireGameMs(nowGameMs),
      refType: 'ACCRUAL',
      refId: 'accrual-wages',
      meta: null,
    },
  ];

  const notices: NoticeDto[] = [
    {
      kind: 'FIELD_PHASE_ADVANCED',
      severity: 'INFO',
      code: null,
      message: 'La parcela norte paso a crecimiento mientras no habia nadie mirando.',
      details: null,
      atGameMs: toWireGameMs(nowGameMs),
      subjectType: 'FIELD',
      subjectId: 'field-north',
    },
  ];

  return {
    rng,
    seed,
    spawnCell: { cellX: origin.cellX, cellY: origin.cellY },
    anchorGameMs,
    anchorRealMs: mockAnchorRealMs(),
    nowGameMs,
    eventSeq: 0,
    ledgerSeq: 12,
    balance,
    player,
    farm,
    buildings,
    fields,
    fieldCells,
    machines,
    workers,
    candidates,
    tasks,
    forestPlots,
    forestPlotCells,
    trees,
    inventory,
    ledger,
    notices,
    cells,
    chunkVersions,
  };
}

// ---------------------------------------------------------------------------
// Derived reads
// ---------------------------------------------------------------------------

export function mockClock(world: MockWorld): ClockDto {
  return {
    gameMs: toWireGameMs(world.nowGameMs),
    realMs: toWireRealMs(realMs(BigInt(world.anchorRealMs))),
    anchorGameMs: toWireGameMs(world.nowGameMs),
    anchorRealMs: toWireRealMs(realMs(BigInt(world.anchorRealMs))),
    rateNum: DEFAULT_GAME_RATE.rateNum,
    rateDen: DEFAULT_GAME_RATE.rateDen,
    scheduleEpoch: 1,
  };
}

/**
 * One line per crop of the catalogue, plus timber: the price belongs to the crop, so the
 * list the panel groups by category is as long as the catalogue.
 */
export function mockMarketPrices(): readonly MarketPrice[] {
  const crops = CROP_IDS.map((id): MarketPrice => {
    const crop = CROPS[id];
    const units = STORAGE_RESOURCE_UNITS[crop.storageResource];
    return {
      item: id,
      category: crop.storageResource,
      pricePerStoredUnit: toWireMoney(crop.sellPricePerLiter),
      storedUnit: units.storedUnit,
      pricePerDisplayUnit: toWireMoney(crop.sellPricePerLiter),
      displayUnit: units.displayUnit,
    };
  });
  return [
    ...crops,
    {
      item: 'WOOD',
      category: StorageResource.WOOD_M3,
      pricePerStoredUnit: toWireMoney(MOCK_WOOD_PRICE_PER_DM3),
      storedUnit: STORAGE_RESOURCE_UNITS.WOOD_M3.storedUnit,
      pricePerDisplayUnit: toWireMoney(PINE.sellPricePerM3),
      displayUnit: STORAGE_RESOURCE_UNITS.WOOD_M3.displayUnit,
    },
  ];
}

/** The modification layer of one chunk, built from the owned cells. */
export function mockChunkCells(world: MockWorld, chunkX: number, chunkY: number): ChunkCellPatch[] {
  const patches: ChunkCellPatch[] = [];
  for (const cell of world.cells.values()) {
    const chunk = chunkOf(cell.cellX, cell.cellY);
    if (chunk.chunkX !== chunkX || chunk.chunkY !== chunkY) {
      continue;
    }
    patches.push({
      idx: cellIndex(cell.cellX, cell.cellY),
      terrainOverride: null,
      ownerPlayerId: MOCK_PLAYER_ID,
      landUse: cell.landUse,
      fieldId: cell.fieldId,
      forestPlotId: cell.forestPlotId,
      buildingId: cell.buildingId,
      hasStandingTree: cell.hasStandingTree,
    });
  }
  return patches.sort((left, right) => left.idx - right.idx);
}

export function mockChunkVersion(world: MockWorld, chunkX: number, chunkY: number): number {
  return world.chunkVersions.get(`${chunkX}:${chunkY}`) ?? 0;
}

/** Advances the sample clock, which is what makes a countdown move in the mock. */
export function advanceMockClock(world: MockWorld, gameHoursElapsed: number): void {
  world.nowGameMs = addGameMs(world.nowGameMs, gameHoursToGameMs(gameHours(gameHoursElapsed)));
  world.player = { ...world.player, atGameMs: toWireGameMs(world.nowGameMs) };
}

/** Contract version the simulated server claims, which has to match the client's. */
export const MOCK_CONTRACT_VERSION = SHARED_CONTRACT_VERSION;

/** Generator version the simulated world was built with. */
export const MOCK_GENERATOR_VERSION = GENERATOR_VERSION;
