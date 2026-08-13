// The complete game loop, over HTTP, against the real stack.
//
// Owner: workflow W7-B. `scripts/smoke/**`. Invoked by `make smoke`.
//
// What this is, and what it deliberately is not (plan sections 10 and 12, step 4):
//
//   - It talks to a real Fastify process over a real socket, against the PostgreSQL and the
//     Redis of the project, with a real BullMQ worker consuming the queue. Nothing is injected
//     and nothing is simulated: `frontend/app/mock` exists for panel development and has no part
//     here.
//   - The wait is solved with the multiplier and never with a shortcut. The world runs at
//     360 000 game milliseconds per real millisecond, that is one game hour every ten real
//     milliseconds, so the 325 hour cycle of GDD section 118 completes in seconds while every
//     completion still travels as a delayed job through Redis. No development route is used to
//     jump a wait on the happy path.
//   - Every figure is compared against the pure rules of `shared/rules` and the catalogues of
//     `shared/config`, never against a number typed here. A balance change the catalogue
//     justifies makes this file follow it; a balance the game got wrong makes it fail.
//
// The two development routes that are used are the two plan section 10 sanctions explicitly:
// `POST /api/dev/retime`, to put the multiplier of the world back where `.env` had it before the
// run gives the stack back, and `POST /api/dev/grant`, to set a balance. The grants appear in
// the table of variations as their own rows and are never folded into another step: the full
// loop of the GDD, forestry included, costs about 283 000 in capital against the 160 000 of GDD
// section 117, so a run that reached the forestry steps without one would only ever be asserting
// `SPENDING_BLOCKED_IN_DEBT`.

import process from 'node:process';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  CropCycleState,
  DM3_PER_M3,
  LedgerType,
  MACHINE_CATALOGUE,
  MachineStatus,
  MachineType,
  Money,
  NATURAL_FOREST,
  OPERATION_REQUIREMENTS,
  PINE,
  POOL_SIZE,
  POOL_SKILL_MAX_BP,
  POOL_SKILL_MIN_BP,
  SALARY_FLOOR,
  SHARED_CONTRACT_VERSION,
  STARTING_CAPITAL,
  StorageResource,
  TIMED_CROP_PHASE_ORDER,
  TREE_SPECIES_CATALOGUE,
  TaskOperation,
  TaskStatus,
  TerrainType,
  TreeGrowthStage,
  WHEAT,
  WorkerStatus,
  batchWoodVolume,
  bp,
  conditionAfterWork,
  cropSaleRevenue,
  estimateTaskDuration,
  fertilityAfterHarvest,
  finalYieldLiters,
  fromWireGameMs,
  gameHours,
  gameHoursToGameMs,
  isFellable,
  landPurchasePrice,
  projectCropPhase,
  projectWeedLevel,
  realBuildingCost,
  skillAfterTask,
  skillFactor,
  woodSaleRevenue,
  type Bp,
  type CellCoord,
  type MachineDto,
  type RouteBody,
  type TaskDto,
  type TreeDto,
  type TreeSpecies,
  type TreeStatus,
} from '../../shared/index.js';
import { SMOKE_RATE_DEN, SMOKE_RATE_NUM, readSmokeEnvironment } from './env.js';
import { ApiClient } from './http.js';
import { Report, SmokeFailure } from './report.js';
import { SiteFinder, rectCells, type CellRect } from './site.js';
import { SmokeStack, stopStackOnSignals } from './stack.js';
import { GameSocket } from './ws.js';

// ---------------------------------------------------------------------------
// Sizes of the run
// ---------------------------------------------------------------------------

/**
 * Shape of the field: 250 cells, which is the figure of GDD section 117, laid out as 25 by 10 so
 * that the search can place it across a chunk border and satisfy GDD section 18.
 */
const FIELD_WIDTH_CELLS = 25;
const FIELD_HEIGHT_CELLS = 10;
const FIELD_CELLS = FIELD_WIDTH_CELLS * FIELD_HEIGHT_CELLS;

/**
 * Shape of the forest plot: 40 cells, one tree each at the density of `NATURAL_FOREST`. Smaller
 * than the 250 of GDD section 138 on purpose: the felling head of GDD section 134 works at 0.8
 * trees per game hour, and 250 trees would spend the whole run inside one task without asserting
 * anything the 40 do not.
 */
const FOREST_WIDTH_CELLS = 8;
const FOREST_HEIGHT_CELLS = 5;
const FOREST_CELLS = FOREST_WIDTH_CELLS * FOREST_HEIGHT_CELLS;

/**
 * Cells of forest turned into arable land, which is the one direction GDD section 10 has. They
 * form a plot of their own because a clearing converts the empty cells of one plot, all of them
 * and no others (`backend/src/modules/forestry/tasks.ts`).
 */
const CLEAR_WIDTH_CELLS = 4;
const CLEAR_HEIGHT_CELLS = 2;

/**
 * Working capital, granted explicitly and reported as its own row of the table.
 *
 * Two independent reasons make it necessary, and neither is a defect of the game:
 *
 *   1. The full loop costs about 283 000 in capital — 330 cells of land, five buildings, seven
 *      machines — against the 160 000 of GDD section 117, which sizes the starting capital for
 *      the minimum agricultural setup and nothing else.
 *   2. At one game hour every ten real milliseconds, the wall clock of the run is itself an
 *      expense: two hundred HTTP round trips and the waits between them are worth thousands of
 *      game hours of wages and maintenance (GDD section 107). A run that went into debt would
 *      have its stock sold by the forced liquidation of plan section 6.6 before it could sell it
 *      itself, and would then be asserting the liquidation and not the market.
 *
 * The figure is deliberately generous rather than tuned: a smoke test that fails because the
 * machine it runs on was slow reports nothing about the game.
 *
 * Raised in W7 from 400 000 to four million each, for the second of the two reasons and not the
 * first. Reason 2 is not a fixed cost: at 100 game hours per real second, a holding of seven
 * machines and a worker burns of the order of ten thousand per real second of the run, so the
 * bill is proportional to how long the machine takes and a loaded machine took the balance
 * negative before the harvest. The forced liquidation then sold the grain and the run asserted
 * an empty silo. The grant is working capital of the harness, has its own row in the table of
 * variations and enters no figure of the GDD.
 */
const AGRICULTURAL_GRANT = Money.fromUnits(4_000_000);
const FORESTRY_GRANT = Money.fromUnits(4_000_000);

/** Real time a task is given to complete. Generous: the longest of the run is under five seconds. */
const TASK_TIMEOUT_REAL_MS = 120_000;

/** Real time a crop phase transition is given to arrive. */
const PHASE_TIMEOUT_REAL_MS = 60_000;

/**
 * Real time the clearing of step 16 is given. Shorter than a task timeout because the failure it
 * currently produces is a job that exhausts its five BullMQ attempts in about sixteen seconds:
 * waiting two minutes for it would only make the report slower to read.
 */
const CLEAR_TIMEOUT_REAL_MS = 30_000;

/** Cells of a chunk on a side, used only to count the chunks a field touches (GDD section 6). */
const CHUNK_SIDE_CELLS = 32;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Identifier of the run, which keeps two consecutive runs from colliding on the account. */
const RUN_ID = Date.now().toString(36);

let idempotencyCounter = 0;

/** A fresh idempotency key. Unique per request and greppable back to the run. */
function nextKey(verb: string): string {
  idempotencyCounter += 1;
  return `smoke-${RUN_ID}-${verb}-${String(idempotencyCounter)}`;
}

/**
 * The machine whose condition sets the pace of an operation.
 *
 * Read off `OPERATION_REQUIREMENTS` and `MACHINE_CATALOGUE` with the rule the duration formula
 * of GDD section 91 implies — the implement when it has a speed of its own, the powered machine
 * otherwise — so it is a derivation of the shared catalogue and not a table written here.
 */
function paceMachineType(operation: TaskOperation): MachineType {
  const requirement = OPERATION_REQUIREMENTS[operation];
  const implement = requirement.requiredImplement;
  if (implement !== null && MACHINE_CATALOGUE[implement].workSpeedUnitsPerGameHour !== null) {
    return implement;
  }
  return requirement.poweredMachine;
}

/** A tree of the wire at the shape the pure forestry rules take. */
function treeView(tree: TreeDto): {
  readonly species: TreeSpecies;
  readonly plantedAtGameMs: ReturnType<typeof fromWireGameMs>;
  readonly status: TreeStatus;
} {
  return {
    species: tree.species,
    plantedAtGameMs: fromWireGameMs(tree.plantedAtGameMs),
    status: tree.status,
  };
}

/** Game hours a task actually worked, which is the interval that wears and that is billed. */
function workedGameHours(task: TaskDto): number {
  const start = fromWireGameMs(task.startGameMs);
  const end = fromWireGameMs(task.endedGameMs ?? task.scheduledEndGameMs);
  return Number(end - start) / 3_600_000;
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const env = await readSmokeEnvironment();
  const stack = new SmokeStack(env);
  const client = new ApiClient(env.baseUrl);
  const socket = new GameSocket(client);
  const report = new Report();

  stopStackOnSignals(stack);

  /** Condition of the machine that sets the pace of an operation, out of the current fleet. */
  const paceConditionOf = (machines: readonly MachineDto[], operation: TaskOperation): Bp => {
    const type = paceMachineType(operation);
    const machine = machines.find((candidate) => candidate.type === type);
    return bp(machine?.conditionBp ?? 0);
  };

  /** Asserts the figures GDD section 91 fixes once, when the task starts. */
  const assertTaskFigures = (
    label: string,
    task: TaskDto,
    operation: TaskOperation,
    units: number,
    conditionBp: Bp,
    skillBp: Bp,
  ): void => {
    report.equal(`${label}: unidades al arrancar`, task.unitsAtStart, units);
    const expected = estimateTaskDuration({ operation, units, conditionBp, skillBp });
    report.equal(
      `${label}: velocidad efectiva de §91`,
      task.effectiveWorkSpeedMilli,
      expected.effectiveWorkSpeedMilli,
    );
    report.equal(
      `${label}: duracion agendada de §91, en ms de juego`,
      String(fromWireGameMs(task.scheduledEndGameMs) - fromWireGameMs(task.startGameMs)),
      String(gameHoursToGameMs(expected.durationGameHours)),
    );
  };

  /**
   * Waits for the completion of a task to arrive over the socket.
   *
   * This is the wait plan section 10 is about: nothing polls a domain route, the frame is
   * produced by the BullMQ job the server scheduled when the task was created, and the only
   * reason it arrives within seconds is the multiplier.
   */
  const awaitCompletion = async (label: string, task: TaskDto): Promise<TaskDto> => {
    const frame = await socket.waitFor(
      `la finalizacion de ${label}`,
      (candidate) =>
        candidate.type === 'TASK_UPSERTED' &&
        candidate.payload.task.id === task.id &&
        candidate.payload.task.status === TaskStatus.COMPLETED,
      TASK_TIMEOUT_REAL_MS,
    );
    if (frame.type !== 'TASK_UPSERTED') {
      throw new Error('unreachable: el predicado exige TASK_UPSERTED');
    }
    report.equal(`${label}: la tarea termina`, frame.payload.task.status, TaskStatus.COMPLETED);
    return frame.payload.task;
  };

  let balance = Money.ZERO;

  try {
    report.begin('0', 'Pila real y reloj acelerado');
    await stack.start();
    report.note(
      `servidor en ${env.baseUrl}, worker con /health en ${String(env.workerMetricsPort)}`,
    );

    // ---------------------------------------------------------------------
    // 1. Registration
    // ---------------------------------------------------------------------
    report.begin('1', 'Registro');
    const email = `smoke-${RUN_ID}@farm-world.local`;
    const session = await client.call('POST /api/auth/register', {
      body: { email, password: 'smoke-password-1', displayName: `Smoke ${RUN_ID}` },
    });
    client.setAccessToken(session.accessToken);
    report.money('saldo inicial (§117)', session.player.balance, Money.toString(STARTING_CAPITAL));
    report.equal('el primer acceso se marca como tal', session.firstSession, true);
    report.equal('multiplicador del mundo, numerador', session.clock.rateNum, SMOKE_RATE_NUM);
    report.equal('multiplicador del mundo, denominador', session.clock.rateDen, SMOKE_RATE_DEN);

    await socket.connect(env.baseUrl);
    report.equal('el WebSocket abre una sola conexion', socket.stats.connections, 1);

    const openingLedger = await client.call('GET /api/economy/ledger', { query: { limit: 50 } });
    const startingEntry = openingLedger.entries.find(
      (entry) => entry.type === LedgerType.STARTING_CAPITAL,
    );
    report.check(
      'el ledger abre con el asiento de capital inicial',
      startingEntry !== undefined,
      'un asiento STARTING_CAPITAL',
      startingEntry === undefined ? 'ninguno' : startingEntry.type,
    );
    report.money(
      'importe del asiento',
      startingEntry?.amount ?? '0',
      Money.toString(STARTING_CAPITAL),
    );
    report.money(
      'saldo resultante del asiento',
      startingEntry?.balanceAfter ?? '0',
      Money.toString(STARTING_CAPITAL),
    );

    balance = Money.fromString(session.player.balance);
    report.recordBalance('capital inicial (§117)', Money.toString(STARTING_CAPITAL), balance);

    const grantOne = await client.call('POST /api/dev/grant', {
      body: {
        amount: Money.toString(AGRICULTURAL_GRANT),
        reason: 'smoke: capital de trabajo del ciclo agricola',
      },
      idempotencyKey: nextKey('grant-agricola'),
    });
    report.recordBalance(
      'aportacion de capital, ajena al juego',
      Money.toString(AGRICULTURAL_GRANT),
      grantOne.result.balanceAfter,
    );
    balance = Money.fromString(grantOne.result.balanceAfter);
    report.note(
      'la aportacion no forma parte de la economia del juego: se declara porque el bucle ' +
        'completo cuesta mas capital del que §117 concede.',
    );

    // ---------------------------------------------------------------------
    // 2. The world around the assigned origin
    // ---------------------------------------------------------------------
    report.begin('2', 'Consulta del mundo alrededor del origen asignado');
    const world = await client.call('GET /api/world/info');
    report.equal('la semilla es la del entorno', world.seed, env.worldSeed);
    report.equal(
      'la version del contrato coincide',
      world.contractVersion,
      SHARED_CONTRACT_VERSION,
    );
    report.check(
      'el asignador dio un origen al jugador',
      world.spawnCellX !== null && world.spawnCellY !== null,
      'una celda de origen',
      `${String(world.spawnCellX)},${String(world.spawnCellY)}`,
    );
    const spawn: CellCoord = { cellX: world.spawnCellX ?? 0, cellY: world.spawnCellY ?? 0 };

    const finder = new SiteFinder(world.seed, spawn);
    const windowChunks = finder.windowChunks();
    const chunkBatch = await client.call('POST /api/world/chunks', {
      body: {
        chunks: windowChunks.map((chunk) => ({ chunkX: chunk.chunkX, chunkY: chunk.chunkY })),
      },
    });
    report.equal(
      'la carga por lote devuelve un chunk por peticion',
      chunkBatch.chunks.length,
      windowChunks.length,
    );
    report.note(
      `celdas ya modificadas en la ventana: ${String(finder.blockModifiedCells(chunkBatch.chunks))}`,
    );

    /** Reserves a surface of the requested shape and terrain, or fails naming what was sought. */
    const takeRect = (
      label: string,
      widthCells: number,
      heightCells: number,
      terrain: TerrainType,
      options: { readonly spanningChunks?: boolean } = {},
    ): CellRect => {
      const rect = finder.findRect(widthCells, heightCells, terrain, options);
      report.check(
        `hay superficie para ${label}`,
        rect !== null,
        `${String(widthCells)}x${String(heightCells)} de ${terrain}`,
        rect === null ? 'ninguna' : `${String(rect.cellX)},${String(rect.cellY)}`,
      );
      if (rect === null) {
        throw new Error('unreachable: la comprobacion anterior ya habria fallado');
      }
      finder.reserve(rect);
      return rect;
    };

    const fieldRect = takeRect(
      'el campo, cruzando chunk (§18)',
      FIELD_WIDTH_CELLS,
      FIELD_HEIGHT_CELLS,
      TerrainType.GRASS,
      { spanningChunks: true },
    );
    const garagePlot = takeRect(
      'el garaje',
      BUILDING_CATALOGUE.GARAGE.widthCells,
      BUILDING_CATALOGUE.GARAGE.heightCells,
      TerrainType.GRASS,
    );
    const siloPlot = takeRect(
      'el silo',
      BUILDING_CATALOGUE.SILO.widthCells,
      BUILDING_CATALOGUE.SILO.heightCells,
      TerrainType.GRASS,
    );
    const homePlot = takeRect(
      'la vivienda',
      BUILDING_CATALOGUE.WORKER_HOME.widthCells,
      BUILDING_CATALOGUE.WORKER_HOME.heightCells,
      TerrainType.GRASS,
    );
    const garageTwoPlot = takeRect(
      'el segundo garaje',
      BUILDING_CATALOGUE.GARAGE.widthCells,
      BUILDING_CATALOGUE.GARAGE.heightCells,
      TerrainType.GRASS,
    );
    const woodStoragePlot = takeRect(
      'el almacen de madera',
      BUILDING_CATALOGUE.WOOD_STORAGE.widthCells,
      BUILDING_CATALOGUE.WOOD_STORAGE.heightCells,
      TerrainType.GRASS,
    );
    const forestRect = takeRect(
      'la parcela forestal',
      FOREST_WIDTH_CELLS,
      FOREST_HEIGHT_CELLS,
      TerrainType.FOREST,
    );
    const clearRect = takeRect(
      'el desmonte',
      CLEAR_WIDTH_CELLS,
      CLEAR_HEIGHT_CELLS,
      TerrainType.FOREST,
    );

    // ---------------------------------------------------------------------
    // 3. Quote and purchase of land
    // ---------------------------------------------------------------------
    report.begin('3', 'Presupuesto y compra de tierra (§115)');
    const setupCells = [
      ...rectCells(fieldRect),
      ...rectCells(garagePlot),
      ...rectCells(siloPlot),
      ...rectCells(homePlot),
    ];
    report.equal('la compra inicial es la de §117', setupCells.length, 330);

    const quote = await client.call('POST /api/land/quote', { body: { cells: setupCells } });
    report.equal('todas las celdas son comprables', quote.purchasableCount, setupCells.length);
    report.equal('ninguna esta bloqueada', quote.blockedCount, 0);
    report.equal(
      'el terreno que informa el servidor coincide con el generador local',
      quote.cells.filter((cell) => cell.terrain === TerrainType.GRASS).length,
      setupCells.length,
    );
    const setupPrice = landPurchasePrice(quote.cells.map((cell) => cell.terrain)).total;
    report.money('presupuesto de §115', quote.total, Money.toString(setupPrice));
    report.equal('el presupuesto es asequible', quote.affordable, true);

    const purchase = await client.call('POST /api/land/purchase', {
      body: { cells: setupCells, expectedTotal: quote.total, allowPartial: false },
      idempotencyKey: nextKey('land-setup'),
    });
    report.equal('se compran todas las celdas', purchase.result.purchasedCount, setupCells.length);
    report.money('cargo de §115', purchase.result.totalPaid, Money.toString(setupPrice));
    report.money(
      'saldo tras la compra',
      purchase.result.balanceAfter,
      Money.toString(Money.sub(balance, setupPrice)),
    );
    report.recordBalance(
      `tierra, ${String(setupCells.length)} celdas (§115)`,
      Money.toString(Money.negate(setupPrice)),
      purchase.result.balanceAfter,
    );
    balance = Money.fromString(purchase.result.balanceAfter);

    await socket.waitFor(
      'el evento CHUNK_PATCHED de la compra',
      (frame) => frame.type === 'CHUNK_PATCHED',
      15_000,
    );
    report.check(
      'la compra llego por WebSocket',
      socket.framesOf('CHUNK_PATCHED').length > 0,
      '>= 1 fotograma CHUNK_PATCHED',
      String(socket.framesOf('CHUNK_PATCHED').length),
    );

    // ---------------------------------------------------------------------
    // 4. Farm, garage and silo
    // ---------------------------------------------------------------------
    report.begin('4', 'Fundacion de granja, garaje y silo (§116)');
    const farmCreated = await client.call('POST /api/farms', {
      body: { name: `Granja ${RUN_ID}` },
    });
    const farmId = farmCreated.result.farm.id;
    report.equal(
      'la granja nace sin plazas de maquinaria',
      farmCreated.result.farm.machineSlots.total,
      0,
    );

    /** Raises one building on its reserved footprint and asserts the charge of GDD section 116. */
    const build = async (
      type: BuildingType,
      rect: CellRect,
      label: string,
    ): Promise<{ readonly machineSlotsTotal: number; readonly workerSlotsTotal: number }> => {
      const cost = realBuildingCost(type, { landAlreadyOwned: true, terrain: TerrainType.GRASS });
      const placed = await client.call('POST /api/farms/:farmId/buildings', {
        params: { farmId },
        body: {
          type,
          originCellX: rect.cellX,
          originCellY: rect.cellY,
          purchaseFootprintLand: false,
          expectedTotal: Money.toString(cost.total),
        },
        idempotencyKey: nextKey(`build-${label.replace(/[^a-z]/gi, '')}`),
      });
      report.money(`cargo de ${label} (§116)`, placed.result.totalPaid, Money.toString(cost.total));
      report.money(
        `${label}: el suelo ya era del jugador y no se recobra`,
        placed.result.landPaid,
        Money.toString(Money.ZERO),
      );
      report.equal(
        `huella de ${label} (§116)`,
        placed.result.footprintCells.length,
        BUILDING_CATALOGUE[type].footprintCells,
      );
      report.recordBalance(
        `${label} (§116)`,
        Money.toString(Money.negate(cost.total)),
        placed.result.balanceAfter,
      );
      balance = Money.fromString(placed.result.balanceAfter);
      return {
        machineSlotsTotal: placed.result.farm.machineSlots.total,
        workerSlotsTotal: placed.result.farm.workerSlots.total,
      };
    };

    const afterGarage = await build(BuildingType.GARAGE, garagePlot, 'garaje');
    report.equal(
      'el garaje aporta las plazas de §96',
      afterGarage.machineSlotsTotal,
      BUILDING_CATALOGUE.GARAGE.capacity ?? 0,
    );
    await build(BuildingType.SILO, siloPlot, 'silo');
    const farmsAfterSilo = await client.call('GET /api/farms');
    report.equal(
      'el silo aporta la capacidad de §116',
      farmsAfterSilo.farms.find((farm) => farm.id === farmId)?.wheat.capacityUnits,
      BUILDING_CATALOGUE.SILO.capacity ?? 0,
    );

    // ---------------------------------------------------------------------
    // 5. Machinery, the fifth machine and the second garage
    // ---------------------------------------------------------------------
    report.begin('5', 'Compra de maquinaria y capacidad de garaje (§96)');
    const machineIds = new Map<MachineType, string>();

    const buyMachine = async (type: MachineType, expectedSlotsUsed: number): Promise<string> => {
      const definition = MACHINE_CATALOGUE[type];
      const bought = await client.call('POST /api/machines', {
        body: { farmId, type, expectedTotal: Money.toString(definition.purchasePrice) },
        idempotencyKey: nextKey(`buy-${type.toLowerCase()}`),
      });
      report.money(
        `precio de ${type} (§89/§134)`,
        bought.result.totalPaid,
        Money.toString(definition.purchasePrice),
      );
      report.equal(
        `plazas de garaje ocupadas tras ${type}`,
        bought.result.garageSlotsUsed,
        expectedSlotsUsed,
      );
      report.recordBalance(
        `${type} (§89/§134)`,
        Money.toString(Money.negate(definition.purchasePrice)),
        bought.result.balanceAfter,
      );
      balance = Money.fromString(bought.result.balanceAfter);
      machineIds.set(type, bought.result.machine.id);
      return bought.result.machine.id;
    };

    const tractorId = await buyMachine(MachineType.TRACTOR, 1);
    const plowId = await buyMachine(MachineType.PLOW, 2);
    const seederId = await buyMachine(MachineType.SEEDER, 3);
    const trailerId = await buyMachine(MachineType.TRAILER, 4);

    const fifthMachine = await client.expectRefusal('POST /api/machines', {
      body: { farmId, type: MachineType.HARVESTER },
      idempotencyKey: nextKey('buy-harvester-rechazada'),
    });
    report.equal('la quinta maquina se rechaza con conflicto (§96)', fifthMachine.status, 409);
    report.equal('y con el codigo de capacidad', fifthMachine.code, 'GARAGE_CAPACITY_EXCEEDED');

    const garageTwoCells = rectCells(garageTwoPlot);
    const garageTwoQuote = await client.call('POST /api/land/quote', {
      body: { cells: garageTwoCells },
    });
    const garageTwoLand = await client.call('POST /api/land/purchase', {
      body: { cells: garageTwoCells, expectedTotal: garageTwoQuote.total, allowPartial: false },
      idempotencyKey: nextKey('land-garaje2'),
    });
    report.money(
      'suelo del segundo garaje (§115)',
      garageTwoLand.result.totalPaid,
      Money.toString(landPurchasePrice(garageTwoQuote.cells.map((cell) => cell.terrain)).total),
    );
    report.recordBalance(
      `tierra, ${String(garageTwoCells.length)} celdas (§115)`,
      Money.toString(Money.negate(Money.fromString(garageTwoLand.result.totalPaid))),
      garageTwoLand.result.balanceAfter,
    );
    balance = Money.fromString(garageTwoLand.result.balanceAfter);

    const afterGarageTwo = await build(BuildingType.GARAGE, garageTwoPlot, 'segundo garaje');
    report.equal(
      'el segundo garaje duplica las plazas',
      afterGarageTwo.machineSlotsTotal,
      (BUILDING_CATALOGUE.GARAGE.capacity ?? 0) * 2,
    );
    const harvesterId = await buyMachine(MachineType.HARVESTER, 5);

    // ---------------------------------------------------------------------
    // 6. Housing and hiring
    // ---------------------------------------------------------------------
    report.begin('6', 'Vivienda y contratacion (§102, §108)');
    report.note(
      'la vivienda se levanta aqui y no en el paso 4 porque el rechazo de §108 solo es ' +
        'observable mientras la granja no tiene ninguna plaza de alojamiento.',
    );
    const poolBefore = await client.call('GET /api/workers/pool');
    report.equal('el pool ofrece los candidatos de §102', poolBefore.candidates.length, POOL_SIZE);
    for (const offered of poolBefore.candidates) {
      report.check(
        `la habilidad de ${offered.name} esta en la banda de §102`,
        offered.skillBp >= POOL_SKILL_MIN_BP && offered.skillBp <= POOL_SKILL_MAX_BP,
        `${String(POOL_SKILL_MIN_BP)}..${String(POOL_SKILL_MAX_BP)} bp`,
        `${String(offered.skillBp)} bp`,
      );
      report.check(
        `el salario de ${offered.name} respeta el suelo de §102`,
        Money.compare(Money.fromString(offered.askingSalaryPerGameHour), SALARY_FLOOR) >= 0,
        `>= ${Money.toString(SALARY_FLOOR)}`,
        offered.askingSalaryPerGameHour,
      );
    }
    const firstCandidate = poolBefore.candidates[0];
    if (firstCandidate === undefined) {
      throw new Error('unreachable: el pool acaba de declarar candidatos');
    }
    const hireRefusal = await client.expectRefusal('POST /api/workers/hire', {
      body: { candidateId: firstCandidate.id, farmId },
    });
    report.equal('contratar sin vivienda se rechaza con conflicto (§108)', hireRefusal.status, 409);
    report.equal('y con el codigo de alojamiento', hireRefusal.code, 'HOME_CAPACITY_EXCEEDED');

    const afterHome = await build(BuildingType.WORKER_HOME, homePlot, 'vivienda');
    report.equal(
      'la vivienda aporta las plazas de §108',
      afterHome.workerSlotsTotal,
      BUILDING_CATALOGUE.WORKER_HOME.capacity ?? 0,
    );

    const pool = await client.call('GET /api/workers/pool');
    const candidate = [...pool.candidates].sort((left, right) => right.skillBp - left.skillBp)[0];
    if (candidate === undefined) {
      throw new Error('unreachable: el pool acaba de declarar candidatos');
    }
    const hired = await client.call('POST /api/workers/hire', {
      body: { candidateId: candidate.id, farmId },
    });
    const workerId = hired.result.worker.id;
    report.equal(
      'la habilidad contratada es la del candidato',
      hired.result.worker.skillBp,
      candidate.skillBp,
    );
    report.money(
      'el salario contratado es el pedido (§102)',
      hired.result.worker.salaryPerGameHour,
      candidate.askingSalaryPerGameHour,
    );
    report.near(
      'el factor de habilidad es el de §103',
      hired.result.worker.skillFactor,
      skillFactor(bp(candidate.skillBp)),
      1e-9,
    );
    report.equal('ocupa una plaza de vivienda', hired.result.homeSlotsUsed, 1);
    let skillBp = bp(candidate.skillBp);

    // ---------------------------------------------------------------------
    // 7. The field
    // ---------------------------------------------------------------------
    report.begin('7', 'Creacion del campo de 250 celdas (§17, §18)');
    const fieldCells = rectCells(fieldRect);
    const fieldCreated = await client.call('POST /api/fields', {
      body: { name: `Parcela ${RUN_ID}`, farmId, cells: fieldCells },
    });
    const fieldId = fieldCreated.result.field.id;
    report.equal('el campo tiene 250 celdas', fieldCreated.result.field.cellCount, FIELD_CELLS);
    report.equal(
      'y nace virgen (§13, §19)',
      fieldCreated.result.field.cropCycleState,
      CropCycleState.VIRGIN,
    );
    const fieldChunks = new Set(
      fieldCreated.result.cells.map(
        (cell) =>
          `${String(Math.floor(cell.cellX / CHUNK_SIDE_CELLS))},` +
          `${String(Math.floor(cell.cellY / CHUNK_SIDE_CELLS))}`,
      ),
    );
    report.check(
      'el campo abarca al menos dos chunks (§18)',
      fieldChunks.size >= 2,
      '>= 2 chunks',
      `${String(fieldChunks.size)} chunks`,
    );

    // ---------------------------------------------------------------------
    // 8. Plowing
    // ---------------------------------------------------------------------
    report.begin('8', 'Arado (§90, §91, §93, §103)');
    const machinesBeforePlow = await client.call('GET /api/machines');
    const plowEstimate = await client.call('POST /api/tasks/estimate', {
      body: {
        operation: TaskOperation.PLOW,
        workerId,
        poweredMachineId: tractorId,
        implementMachineId: plowId,
        targetFieldId: fieldId,
      },
    });
    report.equal('la operacion es viable', plowEstimate.feasible, true);
    report.equal('la unidad de trabajo son las celdas del campo', plowEstimate.units, FIELD_CELLS);
    const plowExpected = estimateTaskDuration({
      operation: TaskOperation.PLOW,
      units: FIELD_CELLS,
      conditionBp: paceConditionOf(machinesBeforePlow.machines, TaskOperation.PLOW),
      skillBp,
    });
    report.equal(
      'la velocidad efectiva prevista es la de §91',
      plowEstimate.effectiveWorkSpeedMilli,
      plowExpected.effectiveWorkSpeedMilli,
    );
    report.near(
      'la duracion prevista es la de §91',
      plowEstimate.durationGameHours,
      plowExpected.durationGameHours,
      1e-6,
    );

    const plowBody: RouteBody<'POST /api/tasks'> = {
      operation: TaskOperation.PLOW,
      workerId,
      poweredMachineId: tractorId,
      implementMachineId: plowId,
      targetFieldId: fieldId,
    };
    const plowCreated = await client.call('POST /api/tasks', { body: plowBody });
    assertTaskFigures(
      'arado',
      plowCreated.result.task,
      TaskOperation.PLOW,
      FIELD_CELLS,
      paceConditionOf(machinesBeforePlow.machines, TaskOperation.PLOW),
      skillBp,
    );
    const plowTask = await awaitCompletion('arado', plowCreated.result.task);

    const fieldAfterPlow = await client.call('GET /api/fields/:fieldId', { params: { fieldId } });
    report.equal(
      'el campo queda arado (§76)',
      fieldAfterPlow.field.cropCycleState,
      CropCycleState.PLOWED,
    );
    report.equal('y sin tarea en curso', fieldAfterPlow.field.currentTaskId, null);

    const workersAfterPlow = await client.call('GET /api/workers');
    const workerAfterPlow = workersAfterPlow.workers.find((entry) => entry.id === workerId);
    report.equal(
      'el trabajador vuelve a ocioso (§105)',
      workerAfterPlow?.status,
      WorkerStatus.IDLE,
    );
    report.equal('sin tarea asignada', workerAfterPlow?.currentTaskId, null);
    report.equal(
      'la habilidad sube un punto (§103, §110)',
      workerAfterPlow?.skillBp,
      skillAfterTask(skillBp),
    );
    report.equal('y la tarea queda anotada', workerAfterPlow?.completedTaskCount, 1);
    skillBp = skillAfterTask(skillBp);

    const machinesAfterPlow = await client.call('GET /api/machines');
    for (const machineId of [tractorId, plowId]) {
      const before = machinesBeforePlow.machines.find((entry) => entry.id === machineId);
      const after = machinesAfterPlow.machines.find((entry) => entry.id === machineId);
      if (before === undefined || after === undefined) {
        throw new Error('unreachable: las dos maquinas se acaban de comprar');
      }
      report.equal(
        `la condicion de ${after.type} baja segun §93`,
        after.conditionBp,
        conditionAfterWork(
          bp(before.conditionBp),
          workedGameHours(plowTask),
          MACHINE_CATALOGUE[after.type],
        ),
      );
      report.equal(`y ${after.type} vuelve a ociosa`, after.status, MachineStatus.IDLE);
    }

    // ---------------------------------------------------------------------
    // 9. Sowing and the automatic phases
    // ---------------------------------------------------------------------
    report.begin('9', 'Siembra de trigo y fases automaticas (§76, §82)');
    const machinesBeforeSeed = await client.call('GET /api/machines');
    const seedBody: RouteBody<'POST /api/tasks'> = {
      operation: TaskOperation.SEED,
      workerId,
      poweredMachineId: tractorId,
      implementMachineId: seederId,
      targetFieldId: fieldId,
      cropId: WHEAT.id,
    };
    const seedCreated = await client.call('POST /api/tasks', { body: seedBody });
    assertTaskFigures(
      'siembra',
      seedCreated.result.task,
      TaskOperation.SEED,
      FIELD_CELLS,
      paceConditionOf(machinesBeforeSeed.machines, TaskOperation.SEED),
      skillBp,
    );
    await awaitCompletion('siembra', seedCreated.result.task);
    skillBp = skillAfterTask(skillBp);

    // The transition to `SEEDED` is asserted on the frame the completion produced and not on a
    // later read of the field. At one game hour per ten real milliseconds the six hours of
    // `SEEDED` (GDD section 84) last sixty, so a read issued right afterwards legitimately finds
    // the field already germinating: the state is a projection of the clock, and reading it late
    // would be asserting the latency of the test and not the state machine.
    const seededFrame = await socket.waitFor(
      'el fotograma que deja el campo sembrado',
      (candidateFrame) =>
        candidateFrame.type === 'FIELD_UPSERTED' &&
        candidateFrame.payload.field.id === fieldId &&
        candidateFrame.payload.field.cropCycleState === CropCycleState.SEEDED,
      PHASE_TIMEOUT_REAL_MS,
    );
    if (seededFrame.type !== 'FIELD_UPSERTED') {
      throw new Error('unreachable: el predicado exige FIELD_UPSERTED');
    }
    report.equal(
      'el campo queda sembrado (§76)',
      seededFrame.payload.field.cropCycleState,
      CropCycleState.SEEDED,
    );
    report.equal('con el cultivo declarado', seededFrame.payload.field.cropId, WHEAT.id);
    const seededAt = fromWireGameMs(seededFrame.payload.field.seededAtGameMs ?? '0');

    // Boundaries of the automatic part of the cycle, accumulated from the phase durations of the
    // catalogue: 6 h to germinate, 18 h to start growing and 96 h to be ready (GDD sections 76,
    // 82 and 84). The instant asserted is the one the frame carries, which is the due instant of
    // the scheduled event and not the instant it happened to be delivered, so a job that ran late
    // is still placed where it belongs and the assertion does not measure the queue.
    let boundaryGameHours = 0;
    for (const [phase, timedPhase] of [
      [CropCycleState.GERMINATING, TIMED_CROP_PHASE_ORDER[0]],
      [CropCycleState.GROWING, TIMED_CROP_PHASE_ORDER[1]],
      [CropCycleState.READY_TO_HARVEST, TIMED_CROP_PHASE_ORDER[2]],
    ] as const) {
      if (timedPhase === undefined) {
        throw new Error('unreachable: el orden de fases del cultivo tiene tres miembros');
      }
      boundaryGameHours += WHEAT.phaseDurationsGameHours[timedPhase];
      const frame = await socket.waitFor(
        `la transicion automatica a ${phase}`,
        (candidateFrame) =>
          candidateFrame.type === 'FIELD_UPSERTED' &&
          candidateFrame.payload.field.id === fieldId &&
          candidateFrame.payload.field.cropCycleState === phase,
        PHASE_TIMEOUT_REAL_MS,
      );
      const atGameMs = fromWireGameMs(frame.atGameMs);
      report.equal(
        `se observa ${phase} a las ${String(boundaryGameHours)} h de la siembra (§76, §82)`,
        String(atGameMs - seededAt),
        String(gameHoursToGameMs(gameHours(boundaryGameHours))),
      );
      report.equal(
        `y la proyeccion pura de §76 coincide en ${phase}`,
        projectCropPhase(seededAt, atGameMs, WHEAT).state,
        phase,
      );
    }
    report.equal(
      'el ciclo completo dura lo que §82 publica',
      boundaryGameHours,
      WHEAT.growthDurationGameHours,
    );

    // ---------------------------------------------------------------------
    // 10. Harvest
    // ---------------------------------------------------------------------
    report.begin('10', 'Cosecha (§77, §78, §83)');
    const machinesBeforeHarvest = await client.call('GET /api/machines');
    const harvestBody: RouteBody<'POST /api/tasks'> = {
      operation: TaskOperation.HARVEST,
      workerId,
      poweredMachineId: harvesterId,
      implementMachineId: trailerId,
      targetFieldId: fieldId,
      destinationFarmId: farmId,
    };
    const harvestCreated = await client.call('POST /api/tasks', { body: harvestBody });
    assertTaskFigures(
      'cosecha',
      harvestCreated.result.task,
      TaskOperation.HARVEST,
      FIELD_CELLS,
      paceConditionOf(machinesBeforeHarvest.machines, TaskOperation.HARVEST),
      skillBp,
    );
    // Read while the harvester works: these are the stored attributes the formula of GDD section
    // 83 will be applied to, and the only one that moves before the completion is the weed level,
    // which the pure rule projects to the instant the task ends.
    const fieldDuringHarvest = (
      await client.call('GET /api/fields/:fieldId', { params: { fieldId } })
    ).field;
    report.equal(
      'el campo esta listo para cosechar',
      fieldDuringHarvest.cropCycleState,
      CropCycleState.READY_TO_HARVEST,
    );
    const harvestTask = await awaitCompletion('cosecha', harvestCreated.result.task);
    skillBp = skillAfterTask(skillBp);

    const harvestInstant = fromWireGameMs(
      harvestTask.endedGameMs ?? harvestTask.scheduledEndGameMs,
    );
    const weedAtHarvest = projectWeedLevel({
      weedLevelBp: bp(fieldDuringHarvest.weedLevelBp),
      updatedAtGameMs: fromWireGameMs(fieldDuringHarvest.weedLevelUpdatedAtGameMs),
      toGameMs: harvestInstant,
      cropCycleState: CropCycleState.READY_TO_HARVEST,
      crop: WHEAT,
    });
    const expectedYield = finalYieldLiters({
      cellCount: FIELD_CELLS,
      crop: WHEAT,
      fertilityBp: bp(fieldDuringHarvest.fertilityBp),
      fertilizationBp: bp(fieldDuringHarvest.fertilizationBp),
      weedLevelBp: weedAtHarvest,
    });
    report.note(
      `malezas proyectadas al instante de la cosecha: ${String(weedAtHarvest)} bp, ` +
        `penalizacion de §78 del ${(expectedYield.weedPenalty * 100).toFixed(1)} %`,
    );

    const inventory = await client.call('GET /api/inventory');
    const wheatLine = inventory.farms
      .find((entry) => entry.farmId === farmId)
      ?.lines.find((line) => line.resource === StorageResource.WHEAT_LITERS);
    const harvestedLiters = wheatLine?.usage.storedUnits ?? 0;
    report.near(
      'el rendimiento coincide con la regla pura de §83',
      harvestedLiters,
      expectedYield.liters,
      Math.max(1, Math.round(expectedYield.liters * 0.005)),
    );
    report.equal('y la reserva de silo se libera', wheatLine?.usage.reservedUnits, 0);

    const fieldAfterHarvest = await client.call('GET /api/fields/:fieldId', {
      params: { fieldId },
    });
    report.equal(
      'la fertilidad baja segun §77',
      fieldAfterHarvest.field.fertilityBp,
      fertilityAfterHarvest(bp(fieldDuringHarvest.fertilityBp), WHEAT),
    );
    report.equal(
      'el campo vuelve a su estado de configuracion (§76)',
      fieldAfterHarvest.field.cropCycleState,
      WHEAT.afterHarvestState,
    );
    report.equal('sin cultivo asignado', fieldAfterHarvest.field.cropId, null);
    // La cosecha no reinicia las malezas. §78 enumera una unica via en el MVP, `CULTIVATE`, y
    // §89 recoge el efecto como `sideEffect` exclusivo del cultivador: el nivel liquidado en
    // el instante de la cosecha se conserva y lo hereda el ciclo siguiente. Se compara contra
    // la regla pura y no contra un literal, que es la norma de este recorrido.
    report.equal(
      'las malezas no se reinician al cosechar (§78, §89)',
      fieldAfterHarvest.field.weedLevelBp,
      weedAtHarvest,
    );

    // ---------------------------------------------------------------------
    // 11. Selling the wheat
    // ---------------------------------------------------------------------
    report.begin('11', 'Venta del trigo (§123)');
    const prices = await client.call('GET /api/market/prices');
    report.money(
      'el precio por litro es el de §82/§123',
      prices.prices.find((price) => price.resource === StorageResource.WHEAT_LITERS)
        ?.pricePerStoredUnit ?? '0',
      Money.toString(WHEAT.sellPricePerLiter),
    );
    const sale = await client.call('POST /api/market/sell', {
      body: { farmId, resource: StorageResource.WHEAT_LITERS },
      idempotencyKey: nextKey('venta-trigo'),
    });
    report.equal('se vende todo el grano libre', sale.result.quantitySoldUnits, harvestedLiters);
    report.money(
      'el abono es cantidad por precio (§123)',
      sale.result.revenue,
      Money.toString(cropSaleRevenue(WHEAT, harvestedLiters)),
    );
    report.recordBalance(
      `venta de ${String(harvestedLiters)} L de trigo (§123)`,
      sale.result.revenue,
      sale.result.balanceAfter,
    );
    balance = Money.fromString(sale.result.balanceAfter);

    // ---------------------------------------------------------------------
    // 12. Return summary
    // ---------------------------------------------------------------------
    report.begin('12', 'Resumen de regreso (§68, §124)');
    const welcome = await client.call('GET /api/session/welcome-back');
    report.equal('el resumen no esta vacio', welcome.hasContent, true);
    report.money(
      'el saldo de partida del resumen es el de §117',
      welcome.economy.balanceBefore,
      Money.toString(STARTING_CAPITAL),
    );
    report.money(
      'el neto cuadra con la variacion de saldo del recorrido',
      welcome.economy.netChange,
      Money.toString(
        Money.sub(
          Money.fromString(welcome.economy.balanceAfter),
          Money.fromString(welcome.economy.balanceBefore),
        ),
      ),
    );
    const closedIds = new Set(welcome.tasksClosed.map((task) => task.taskId));
    for (const [label, taskId] of [
      ['arado', plowTask.id],
      ['siembra', seedCreated.result.task.id],
      ['cosecha', harvestTask.id],
    ] as const) {
      report.check(
        `la tarea de ${label} aparece entre las cerradas (§68)`,
        closedIds.has(taskId),
        taskId,
        [...closedIds].join(', '),
      );
    }
    const harvestLine = welcome.tasksClosed.find((task) => task.taskId === harvestTask.id);
    report.equal(
      'y la cosecha declara lo que produjo',
      harvestLine?.producedUnits,
      harvestedLiters,
    );
    report.check(
      'el resumen informa la ocupacion de los almacenes (§68)',
      welcome.storage.some((line) => line.farmId === farmId),
      `una linea de la granja ${farmId}`,
      String(welcome.storage.length),
    );
    // `fieldTransitions` no longer derives anything for this field, and that is the documented
    // behaviour and not a defect: the harvest clears `seededAtGameMs`, so the growth timeline the
    // block is derived from no longer exists, and the harvest itself is the line GDD section 68
    // shows (`backend/src/modules/session/welcomeBack.ts`, header). The three automatic
    // transitions are asserted in step 9, on the frames that reported them.
    report.note(
      `transiciones automaticas derivables tras la cosecha: ` +
        `${String(welcome.fieldTransitions.length)}, por el borrado de la linea de crecimiento`,
    );
    const acked = await client.call('POST /api/session/welcome-back/ack', {
      body: { throughGameMs: welcome.toGameMs },
    });
    report.equal(
      'la marca de resumen avanza al instante confirmado',
      acked.result.lastSummaryGameMs,
      welcome.toGameMs,
    );

    // ---------------------------------------------------------------------
    // 13. The ledger
    // ---------------------------------------------------------------------
    report.begin('13', 'Ledger: un asiento por paso economico y suma cuadrada');
    const entries: { readonly seq: number; readonly type: LedgerType; readonly amount: string }[] =
      [];
    let cursor: string | undefined;
    let newestBalanceAfter = '0';
    let newestSeq = 0;
    for (let page = 0; page < 64; page += 1) {
      const reply = await client.call('GET /api/economy/ledger', {
        query: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      });
      for (const entry of reply.entries) {
        if (entries.length === 0 && page === 0) {
          newestBalanceAfter = entry.balanceAfter;
          newestSeq = entry.seq;
        }
        if (entry.seq <= newestSeq) {
          entries.push({ seq: entry.seq, type: entry.type, amount: entry.amount });
        }
      }
      if (reply.nextCursor === null) {
        break;
      }
      cursor = reply.nextCursor;
    }
    report.check(
      'el ledger tiene asientos',
      entries.length > 0,
      '>= 1 asiento',
      String(entries.length),
    );
    report.equal(
      'sin secuencias repetidas',
      new Set(entries.map((entry) => entry.seq)).size,
      entries.length,
    );
    report.equal(
      'la secuencia es contigua hasta el asiento mas reciente',
      Math.min(...entries.map((entry) => entry.seq)) + entries.length - 1,
      newestSeq,
    );
    report.money(
      'la suma de los asientos cuadra con el saldo que dejo el ultimo',
      Money.toString(Money.sum(entries.map((entry) => Money.fromString(entry.amount)))),
      newestBalanceAfter,
    );
    for (const type of [
      LedgerType.STARTING_CAPITAL,
      LedgerType.COMPENSATION,
      LedgerType.LAND_PURCHASE,
      LedgerType.BUILDING_PURCHASE,
      LedgerType.MACHINE_PURCHASE,
      LedgerType.WORKER_WAGES,
      LedgerType.MACHINE_MAINTENANCE,
      LedgerType.MACHINE_OPERATING,
      LedgerType.CROP_SALE,
    ] as const) {
      const count = entries.filter((entry) => entry.type === type).length;
      report.check(`hay asiento de ${type}`, count > 0, '>= 1', String(count));
    }

    // ---------------------------------------------------------------------
    // 14. Forestry
    // ---------------------------------------------------------------------
    report.begin('14', 'Silvicultura (§10, §130-§138)');
    const grantTwo = await client.call('POST /api/dev/grant', {
      body: {
        amount: Money.toString(FORESTRY_GRANT),
        reason: 'smoke: capital de trabajo de la fase forestal',
      },
      idempotencyKey: nextKey('grant-forestal'),
    });
    report.recordBalance(
      'aportacion de capital, ajena al juego',
      Money.toString(FORESTRY_GRANT),
      grantTwo.result.balanceAfter,
    );
    balance = Money.fromString(grantTwo.result.balanceAfter);

    const forestCells = rectCells(forestRect);
    const clearCells = rectCells(clearRect);
    const forestryLandCells = [...forestCells, ...clearCells, ...rectCells(woodStoragePlot)];
    const forestryQuote = await client.call('POST /api/land/quote', {
      body: { cells: forestryLandCells },
    });
    report.money(
      'el suelo se cobra al precio por terreno de §115',
      forestryQuote.total,
      Money.toString(landPurchasePrice(forestryQuote.cells.map((cell) => cell.terrain)).total),
    );
    const forestryLand = await client.call('POST /api/land/purchase', {
      body: { cells: forestryLandCells, expectedTotal: forestryQuote.total, allowPartial: false },
      idempotencyKey: nextKey('land-forestal'),
    });
    report.equal(
      'se compran todas las celdas',
      forestryLand.result.purchasedCount,
      forestryLandCells.length,
    );
    report.recordBalance(
      `tierra forestal, ${String(forestryLandCells.length)} celdas (§115)`,
      Money.toString(Money.negate(Money.fromString(forestryLand.result.totalPaid))),
      forestryLand.result.balanceAfter,
    );
    balance = Money.fromString(forestryLand.result.balanceAfter);

    await build(BuildingType.WOOD_STORAGE, woodStoragePlot, 'almacen de madera');
    const farmsAfterStore = await client.call('GET /api/farms');
    report.equal(
      'el almacen aporta la capacidad de §136',
      farmsAfterStore.farms.find((farm) => farm.id === farmId)?.wood.capacityUnits,
      BUILDING_CATALOGUE.WOOD_STORAGE.capacity ?? 0,
    );

    const forestryHarvesterId = await buyMachine(MachineType.HARVESTER_FORESTRY, 6);
    await buyMachine(MachineType.FORWARDER, 7);

    const plotCreated = await client.call('POST /api/forest-plots', {
      body: { name: `Bosque ${RUN_ID}`, farmId, cells: forestCells },
    });
    const forestPlotId = plotCreated.result.plot.id;
    report.equal(
      'la parcela nace poblada (§130, §141)',
      plotCreated.result.generatedTreeCount,
      Math.round((FOREST_CELLS * NATURAL_FOREST.treeDensityBp) / 10_000),
    );
    report.equal(
      'todos los arboles nacen en pie',
      plotCreated.result.plot.standingTreeCount,
      plotCreated.result.generatedTreeCount,
    );
    const generatedTrees = plotCreated.result.trees;
    report.equal(
      'el volumen en pie es el de §131 arbol a arbol',
      plotCreated.result.plot.standingWoodDm3,
      generatedTrees.reduce(
        (total, tree) => total + TREE_SPECIES_CATALOGUE.PINE.woodVolumeDm3ByStage[tree.growthStage],
        0,
      ),
    );
    report.money(
      'y su valor es el de §133',
      plotCreated.result.plot.fellableWoodValue,
      Money.toString(woodSaleRevenue(PINE, plotCreated.result.plot.fellableWoodDm3)),
    );

    const machinesBeforeFell = await client.call('GET /api/machines');
    const fellPlan = batchWoodVolume(
      generatedTrees.map(treeView),
      fromWireGameMs(plotCreated.result.plot.atGameMs),
    );
    const fellCreated = await client.call('POST /api/forest-plots/:forestPlotId/fell', {
      params: { forestPlotId },
      body: { workerId, poweredMachineId: forestryHarvesterId, destinationFarmId: farmId },
    });
    assertTaskFigures(
      'tala por lote',
      fellCreated.result.task,
      TaskOperation.FELL,
      fellPlan.treeCount,
      paceConditionOf(machinesBeforeFell.machines, TaskOperation.FELL),
      skillBp,
    );
    const fellTask = await awaitCompletion('tala por lote', fellCreated.result.task);
    skillBp = skillAfterTask(skillBp);

    // Lo que la tala produce son los arboles que §131 admite talar, elegidos en el instante de
    // la asignacion, valorados en el instante en que la tarea termina: siguen creciendo
    // mientras el procesador trabaja (§135). Un planton no entra en el lote —§131 lo declara
    // no talable y sin valor comercial— aunque cruce una frontera de fase durante la tala,
    // que es lo que haria depender el resultado de cuanto durase.
    const fellBatch = generatedTrees.filter((tree) =>
      isFellable(treeView(tree), fromWireGameMs(fellCreated.result.task.startGameMs)),
    );
    const producedWood = batchWoodVolume(
      fellBatch.map(treeView),
      fromWireGameMs(fellTask.endedGameMs ?? fellTask.scheduledEndGameMs),
    );
    const inventoryAfterFell = await client.call('GET /api/inventory');
    const woodLine = inventoryAfterFell.farms
      .find((entry) => entry.farmId === farmId)
      ?.lines.find((line) => line.resource === StorageResource.WOOD_M3);
    report.equal(
      'la madera almacenada es la suma de volumenes de §135',
      woodLine?.usage.storedUnits,
      producedWood.volumeDm3,
    );
    report.equal('y la reserva del almacen se libera', woodLine?.usage.reservedUnits, 0);
    report.note(
      `${String(producedWood.fellableCount)} arboles talables de ` +
        `${String(producedWood.treeCount)}, ` +
        `${(producedWood.volumeDm3 / DM3_PER_M3).toFixed(2)} m3`,
    );

    const woodSale = await client.call('POST /api/market/sell', {
      body: { farmId, resource: StorageResource.WOOD_M3 },
      idempotencyKey: nextKey('venta-madera'),
    });
    report.money(
      'el abono de la madera es el de §133',
      woodSale.result.revenue,
      Money.toString(woodSaleRevenue(PINE, woodSale.result.quantitySoldUnits)),
    );
    report.recordBalance(
      `venta de ${(woodSale.result.quantitySoldUnits / DM3_PER_M3).toFixed(2)} m3 de madera (§133)`,
      woodSale.result.revenue,
      woodSale.result.balanceAfter,
    );
    balance = Money.fromString(woodSale.result.balanceAfter);

    const plotAfterFell = await client.call('GET /api/forest-plots/:forestPlotId', {
      params: { forestPlotId },
      query: { limit: FOREST_CELLS },
    });
    // De la parcela se retira lo que §131 admite talar y nada mas: el planton sigue en pie,
    // porque la seccion lo declara no talable y sin valor comercial. Lo que queda es por tanto
    // el arbolado del que la tala no se llevo, contado con la misma regla pura.
    const survivors = generatedTrees.length - fellBatch.length;
    report.equal(
      'en la parcela solo quedan los arboles que §131 no admite talar',
      plotAfterFell.plot.standingTreeCount,
      survivors,
    );
    report.equal(
      'y las celdas vacias son las que la tala dejo',
      plotAfterFell.plot.emptyCellCount,
      FOREST_CELLS - survivors,
    );

    // La replantacion nombra sus celdas una a una (§137), y las que puede nombrar son las
    // vacias: una celda con arbol vivo se rechaza con `CELL_ALREADY_HAS_TREE`.
    const occupiedAfterFell = new Set(
      plotAfterFell.trees
        .filter((tree) => tree.status !== 'FELLED')
        .map((tree) => `${String(tree.cellX)},${String(tree.cellY)}`),
    );
    const replantCells = forestCells.filter(
      (cell) => !occupiedAfterFell.has(`${String(cell.cellX)},${String(cell.cellY)}`),
    );
    report.equal(
      'las celdas a replantar son exactamente las vacias',
      replantCells.length,
      plotAfterFell.plot.emptyCellCount,
    );

    const machinesBeforeReplant = await client.call('GET /api/machines');
    const replantCreated = await client.call('POST /api/forest-plots/:forestPlotId/replant', {
      params: { forestPlotId },
      body: { workerId, poweredMachineId: forestryHarvesterId, cells: replantCells },
    });
    assertTaskFigures(
      'replantacion',
      replantCreated.result.task,
      TaskOperation.REPLANT,
      replantCells.length,
      paceConditionOf(machinesBeforeReplant.machines, TaskOperation.REPLANT),
      skillBp,
    );
    await awaitCompletion('replantacion', replantCreated.result.task);
    skillBp = skillAfterTask(skillBp);

    const plotAfterReplant = await client.call('GET /api/forest-plots/:forestPlotId', {
      params: { forestPlotId },
      query: { limit: FOREST_CELLS },
    });
    report.equal(
      'la replantacion repuebla la parcela (§137)',
      plotAfterReplant.plot.standingTreeCount,
      FOREST_CELLS,
    );
    report.check(
      'los brotes nuevos nacen como plantones, que §131 no permite talar',
      plotAfterReplant.plot.stageHistogram[TreeGrowthStage.SAPLING] >= replantCells.length,
      `>= ${String(replantCells.length)}`,
      String(plotAfterReplant.plot.stageHistogram[TreeGrowthStage.SAPLING]),
    );
    // El recuento de talables es el de la regla pura sobre el arbolado real: cero si los
    // supervivientes siguen siendo plantones, y su numero si alguno ha crecido durante la
    // tala, que es lo que la edad derivada de §131 produce sin que nada se almacene.
    report.equal(
      'y los talables son los que la regla pura cuenta',
      plotAfterReplant.plot.fellableTreeCount,
      plotAfterReplant.trees.filter((tree) =>
        isFellable(treeView(tree), fromWireGameMs(plotAfterReplant.atGameMs)),
      ).length,
    );

    // ---------------------------------------------------------------------
    // 15. The socket
    // ---------------------------------------------------------------------
    report.begin('15', 'WebSocket: una conexion, secuencia sin huecos');
    await socket.reconcile();
    report.equal('una sola conexion durante todo el recorrido', socket.stats.connections, 1);
    report.equal('sin cierres inesperados', socket.unexpectedClose, null);
    const integrity = socket.sequenceIntegrity();
    report.check(
      'la secuencia aplicada es estrictamente creciente y sin huecos',
      integrity.ok,
      'sin saltos',
      integrity.detail,
    );
    report.equal(
      'y arranca en el primer evento del jugador',
      socket.appliedFrames[0]?.frame.seq,
      1,
    );
    report.note(
      `fotogramas en vivo ${String(socket.stats.liveFramesReceived)}, ` +
        `duplicados ${String(socket.stats.duplicates)}, ` +
        `huecos ${String(socket.stats.gaps)}, ` +
        `recuperados por reproduccion ${String(socket.stats.replayed)}, ` +
        `de transporte ${String(socket.stats.transportFrames)}, ` +
        `latidos enviados ${String(socket.heartbeatCount)}`,
    );

    // ---------------------------------------------------------------------
    // 16. Clearing felled forest into arable land
    // ---------------------------------------------------------------------
    //
    // Beyond the fifteen steps of the brief, and last on purpose: it is step 8 of the acceptance
    // criteria of plan section 12, and it is the one part of the loop that does not work. It is
    // placed after the socket assertions so that a defect in it neither hides nor is hidden by
    // the rest of the run.
    //
    // Clearing converts the empty cells of one plot, all of them and no others, which
    // `requireClearingPlot` and `requireEmptyClearing` enforce. So the ground it converts comes
    // from a plot that was felled and not replanted, and this second small plot is what gives the
    // run one without destroying the plot step 14 just replanted.
    report.begin('16', 'Desmonte de bosque talado a terreno agricola (§10)');
    const clearingPlot = await client.call('POST /api/forest-plots', {
      body: { name: `Tala rasa ${RUN_ID}`, farmId, cells: clearCells },
    });
    const clearingPlotId = clearingPlot.result.plot.id;
    report.equal(
      'la parcela a desmontar nace poblada (§130)',
      clearingPlot.result.generatedTreeCount,
      clearCells.length,
    );
    const clearingFell = await client.call('POST /api/forest-plots/:forestPlotId/fell', {
      params: { forestPlotId: clearingPlotId },
      body: { workerId, poweredMachineId: forestryHarvesterId, destinationFarmId: farmId },
    });
    await awaitCompletion('tala de la parcela a desmontar', clearingFell.result.task);
    skillBp = skillAfterTask(skillBp);

    // Lo desmontable es la parte talada de la parcela, que es lo que GDD 10 y 137 ofrecen
    // convertir y lo que la asignacion exige cubrir entera. Cuantas celdas sean depende de la
    // mezcla de fases que el generador dio a estas coordenadas: un planton no se tala (§131) y
    // su celda sigue ocupada. Se deriva del arbolado en pie y no de un supuesto.
    const clearingPlotAfterFell = await client.call('GET /api/forest-plots/:forestPlotId', {
      params: { forestPlotId: clearingPlotId },
      query: { limit: clearCells.length },
    });
    const occupiedAfterClearFell = new Set(
      clearingPlotAfterFell.trees
        .filter((tree) => tree.status !== 'FELLED')
        .map((tree) => `${String(tree.cellX)},${String(tree.cellY)}`),
    );
    const clearableCells = clearCells.filter(
      (cell) => !occupiedAfterClearFell.has(`${String(cell.cellX)},${String(cell.cellY)}`),
    );
    report.equal(
      'las celdas desmontables son las que la tala vacio',
      clearableCells.length,
      clearingPlotAfterFell.plot.emptyCellCount,
    );
    report.check(
      'y la tala dejo al menos una',
      clearableCells.length > 0,
      '>= 1',
      String(clearableCells.length),
    );

    const machinesBeforeClear = await client.call('GET /api/machines');
    const clearCreated = await client.call('POST /api/land/clear', {
      body: {
        workerId,
        poweredMachineId: tractorId,
        implementMachineId: plowId,
        cells: clearableCells,
        forestPlotId: clearingPlotId,
      },
    });
    assertTaskFigures(
      'desmonte',
      clearCreated.result.task,
      TaskOperation.CLEAR_LAND,
      clearableCells.length,
      paceConditionOf(machinesBeforeClear.machines, TaskOperation.CLEAR_LAND),
      skillBp,
    );
    try {
      await socket.waitFor(
        'la finalizacion del desmonte',
        (frame) =>
          frame.type === 'TASK_UPSERTED' &&
          frame.payload.task.id === clearCreated.result.task.id &&
          frame.payload.task.status === TaskStatus.COMPLETED,
        CLEAR_TIMEOUT_REAL_MS,
      );
    } catch {
      throw new SmokeFailure(
        report.currentStep,
        'el desmonte de la parte talada de una parcela termina',
        'la tarea CLEAR_LAND pasa a COMPLETED y las celdas quedan cultivables',
        'la tarea sigue IN_PROGRESS. Si el desmonte cubria la parcela entera, el caso es el ' +
          'que la ventana de correccion de W7 arreglo: el manejador de TASK_COMPLETE abortaba ' +
          'con 23514 forest_plots_geometry_check al recalcular cellCount = 0, agotaba los cinco ' +
          'reintentos de BullMQ y dejaba trabajador, maquinaria y parcela reservados. Fichero: ' +
          'backend/src/modules/forestry/tasks.ts, completeClearLand',
      );
    }
    skillBp = skillAfterTask(skillBp);
    // Una parcela desmontada por completo se cierra con `disposedGameMs` en lugar de quedar
    // con cero celdas, que es lo que la restriccion de geometria prohibe: deja de listarse.
    if (clearableCells.length === clearCells.length) {
      const plotsAfterClear = await client.call('GET /api/forest-plots');
      report.check(
        'la parcela desmontada entera deja de listarse (§10)',
        !plotsAfterClear.plots.some((plot) => plot.id === clearingPlotId),
        'no listada',
        String(plotsAfterClear.plots.some((plot) => plot.id === clearingPlotId)),
      );
    }
    const clearedQuote = await client.call('POST /api/land/quote', {
      body: { cells: clearableCells },
    });
    report.equal(
      'las celdas desmontadas pasan a pradera (§10)',
      clearedQuote.cells.filter((cell) => cell.terrain === TerrainType.GRASS).length,
      clearableCells.length,
    );

    report.printBalanceTable();
    report.printSummary(client.requestCount);
  } catch (error) {
    report.printFailure(error, stack.logTail());
  } finally {
    socket.close();
    try {
      // The multiplier is a property of the world row, so it is put back where `.env` had it
      // before the stack is given away. The clock never rewinds: `dev/retime` freezes the past
      // under the previous rate and re-anchors (plan section 6.1).
      await client.call('POST /api/dev/retime', {
        body: { rateNum: env.originalRateNum, rateDen: env.originalRateDen },
      });
    } catch {
      // The stack is going away either way; a failure here must not mask the real one.
    }
    await stack.stop();
  }
}

await run();
process.exit(process.exitCode === undefined ? 0 : 1);
