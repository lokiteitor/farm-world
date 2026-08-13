// The forestry cycle end to end: plot, felling, store, replanting and clearing.
//
// Owner: workflow W6-C. Module `forestry`.
//
// The cases below are the ones the design of the module rests on, and every one of them is a way
// the system could be wrong without any other test failing:
//
//   - The generation of a plot is the pure generator and nothing else, so the same seed and the
//     same coordinates give the same forest (GDD section 130).
//   - Deleting a plot and creating it again over the same ground yields nothing, which is the
//     whole purpose of `world_cells.naturalTreeConsumed` (plan section 5.1).
//   - Agricultural machinery cannot fell: the forestry catalogue is separate (GDD section 134).
//   - The duration of a felling is the formula of GDD section 135 and not an approximation.
//   - The wood a batch produces is the sum of the derived volumes at the instant of completion,
//     recomputed and never read from the reservation.
//   - A full store bounds what it accepts and wastes the rest (GDD sections 83, 97 and 136).
//   - Replanting creates saplings of age zero (GDD section 137).
//   - Clearing leaves the cell fit for a field, which is the closing of the forest against field
//     decision of GDD section 10.
//   - The stage of a tree advances with the clock and no event is ever scheduled per tree
//     (GDD section 131, plan section 6.5).

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advancePlayerNow } from '../../lib/advancePlayer.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { generateNaturalForest } from '../../modules/forestry/generator.js';
import { requirePlot, treeView } from '../../modules/forestry/record.js';
import { syncMilestoneSchedule } from '../../modules/forestry/service.js';
import {
  DM3_PER_M3,
  LandUse,
  MachineStatus,
  MachineType,
  Money,
  PINE,
  ScheduledEventKind,
  ScheduledEventStatus,
  TaskStatus,
  TerrainType,
  TreeStatus,
  ValidationCode,
  WorkerStatus,
  batchWoodVolume,
  bp,
  estimateTaskDuration,
  fellingDurationGameHours,
  gameHours,
  gameHoursToGameMs,
  gameMs,
  treeStageAt,
  woodSaleRevenue,
  type CellCoord,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import {
  WORKER_SKILL_BP,
  buyLand,
  cleanUp,
  consumeNaturalTrees,
  createForestryFarm,
  errorCode,
  findForestRectangle,
  get,
  mutationResult,
  plantTreeAged,
  post,
  rectangleCells,
  type ForestryFarm,
} from './fixtures.js';

let harness: Harness;
let reading: ClockReading;
let world: World;
let playerId: PlayerId;
let accessToken: string;
let mainFarm: ForestryFarm;

/** Chunk rows this file owns, one band per group of cases. */
const BAND = {
  GENERATED: 720,
  CONTROLLED: 725,
  CAPACITY: 730,
  CANCEL: 735,
  SAPLING: 740,
  CLEARED: 745,
} as const;

/** Volume of a mature pine and of a young one, in cubic decimetres (GDD section 131). */
const MATURE_DM3 = PINE.woodVolumeDm3ByStage.MATURE;
const YOUNG_DM3 = PINE.woodVolumeDm3ByStage.YOUNG;

/** Wood capacity of the store of the second farm: exactly what its felling will reserve. */
const TIGHT_CAPACITY_DM3 = 3 * MATURE_DM3 + YOUNG_DM3;

interface PlotFixture {
  readonly id: string;
  readonly cells: readonly CellCoord[];
}

let controlled: PlotFixture;
let witnessTreeId: string;

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
  const player = await registerViaHttp(harness, 'forestry');
  playerId = player.playerId;
  accessToken = player.accessToken;
  mainFarm = await createForestryFarm(harness, playerId, 900, 500 * DM3_PER_M3, [
    MachineType.HARVESTER_FORESTRY,
    MachineType.FORWARDER,
    MachineType.TRACTOR,
    MachineType.PLOW,
  ]);
});

afterAll(async () => {
  await cleanUp(harness, world, [playerId]);
  await harness.teardown();
});

/**
 * Renews the session.
 *
 * The access token lives fifteen minutes and the suite moves the injected clock by whole game
 * hours, which at the one to one rate of the harness is real time as the server reads it. Every
 * case that advances therefore has to log in again before it speaks HTTP, exactly as the `fields`
 * suite does.
 */
async function relogin(): Promise<void> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: harness.email('forestry'), password: 'contrasena-de-prueba' },
  });
  expect(response.statusCode).toBe(200);
  accessToken = response.json<Record<string, unknown>>()['accessToken'] as string;
}

/**
 * Moves the clock and applies what fell due, which is the point of advance of plan section 6.3.
 *
 * `unhandledEvents` is asserted at zero on every advance, which is the executable form of "the
 * metric of events with no handler stays flat at zero" for the two kinds this module produces.
 */
async function advanceAndSettle(hours: number): Promise<void> {
  harness.advanceGameHours(hours);
  const advance = await advancePlayerNow(harness.services, playerId);
  expect(advance.unhandledEvents).toBe(0);
  await relogin();
}

/** The trees of a plot as the module reads them. */
async function treesOf(forestPlotId: string): Promise<
  readonly {
    id: string;
    cellX: number;
    cellY: number;
    plantedAtGameMs: bigint;
    status: TreeStatus;
    felledAtGameMs: bigint | null;
    naturallyGenerated: boolean;
  }[]
> {
  return harness.prisma.tree.findMany({
    where: { forestPlotId },
    orderBy: [{ cellY: 'asc' }, { cellX: 'asc' }],
    select: {
      id: true,
      cellX: true,
      cellY: true,
      plantedAtGameMs: true,
      status: true,
      felledAtGameMs: true,
      naturallyGenerated: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('la creacion de una parcela forestal (GDD 129, 130 y 141)', () => {
  let cells: readonly CellCoord[];
  let plotId: string;

  it('genera el arbolado con el generador determinista de la semilla y las coordenadas', async () => {
    const origin = await findForestRectangle(harness, world, 4, 3, BAND.GENERATED);
    cells = rectangleCells(origin, 4, 3);
    expect((await buyLand(harness, accessToken, cells)).statusCode).toBe(200);

    const { statusCode, body } = await post(harness, accessToken, '/api/forest-plots', {
      name: 'Pinar del norte',
      farmId: mainFarm.farmId,
      cells,
    });
    expect(statusCode).toBe(200);
    const result = mutationResult(body);
    const plot = result['plot'] as Record<string, unknown>;
    plotId = plot['id'] as string;

    // Densidad del 100 % (GDD 138 cuenta 250 arboles sobre 250 celdas): toda celda lleva uno.
    expect(result['generatedTreeCount']).toBe(cells.length);
    expect(plot['standingTreeCount']).toBe(cells.length);
    expect(plot['emptyCellCount']).toBe(0);

    // Y lo generado es exactamente lo que la funcion pura decide para esa semilla.
    const createdAtGameMs = gameMs(BigInt(plot['createdAtGameMs'] as string));
    const expected = generateNaturalForest(
      world.seed,
      world.generatorVersion,
      cells,
      createdAtGameMs,
    );
    const stored = await treesOf(plotId);
    expect(stored).toHaveLength(expected.length);
    const byCell = new Map(stored.map((tree) => [`${tree.cellX},${tree.cellY}`, tree]));
    for (const tree of expected) {
      const row = byCell.get(`${tree.cellX},${tree.cellY}`);
      expect(row).toBeDefined();
      expect(row?.plantedAtGameMs).toBe(tree.plantedAtGameMs);
      expect(row?.naturallyGenerated).toBe(true);
      // La fase no se almacena: se deriva de la marca de plantacion y del reloj.
      expect(
        treeStageAt(
          {
            species: PINE.species,
            plantedAtGameMs: tree.plantedAtGameMs,
            status: TreeStatus.STANDING,
          },
          createdAtGameMs,
        ),
      ).toBe(tree.drawnStage);
    }
  });

  it('borrar y recrear la parcela sobre el mismo suelo no resucita ningun arbol', async () => {
    // No hay ruta de borrado de parcela en el contrato: el aprovechamiento que se quiere cerrar
    // es el de un jugador que la deshiciera por cualquier via, asi que se deshace a mano.
    await harness.prisma.tree.deleteMany({ where: { forestPlotId: plotId } });
    await harness.prisma.worldCell.updateMany({
      where: { forestPlotId: plotId },
      data: { landUse: LandUse.OWNED, forestPlotId: null },
    });
    // Un borrado real cancelaria tambien lo agendado por la parcela; se hace a mano porque el
    // contrato no publica ninguna ruta de borrado.
    await harness.prisma.scheduledEvent.deleteMany({
      where: { playerId, refType: 'FOREST_PLOT', refId: plotId },
    });
    await harness.prisma.forestPlot.delete({ where: { id: plotId } });

    const { statusCode, body } = await post(harness, accessToken, '/api/forest-plots', {
      name: 'Pinar del norte, otra vez',
      farmId: mainFarm.farmId,
      cells,
    });
    expect(statusCode).toBe(200);
    const result = mutationResult(body);
    expect(result['generatedTreeCount']).toBe(0);
    expect(result['trees']).toEqual([]);
    const plot = result['plot'] as Record<string, unknown>;
    expect(plot['standingTreeCount']).toBe(0);
    expect(plot['emptyCellCount']).toBe(cells.length);

    const marks = await harness.prisma.worldCell.findMany({
      where: {
        worldId: world.id,
        OR: cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
      },
      select: { naturalTreeConsumed: true },
    });
    expect(marks).toHaveLength(cells.length);
    expect(marks.every((mark) => mark.naturalTreeConsumed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The controlled plot: felling, replanting and clearing
// ---------------------------------------------------------------------------

describe('el ciclo forestal sobre una parcela de edades fijadas', () => {
  it('prepara la parcela con arboles de edad conocida', async () => {
    const origin = await findForestRectangle(harness, world, 2, 4, BAND.CONTROLLED);
    const cells = rectangleCells(origin, 2, 4);
    expect((await buyLand(harness, accessToken, cells)).statusCode).toBe(200);
    // Se marca el suelo como ya generado, de modo que la parcela nace vacia y cada arbol se
    // planta con la edad que el caso necesita.
    await consumeNaturalTrees(harness, world, cells);

    const { statusCode, body } = await post(harness, accessToken, '/api/forest-plots', {
      name: 'Parcela de ensayo',
      farmId: mainFarm.farmId,
      cells,
    });
    expect(statusCode).toBe(200);
    const result = mutationResult(body);
    expect(result['generatedTreeCount']).toBe(0);
    controlled = { id: (result['plot'] as Record<string, unknown>)['id'] as string, cells };

    const now = harness.gameNow();
    for (const index of [0, 1, 2, 3]) {
      await plantTreeAged(
        harness,
        world,
        playerId,
        controlled.id,
        cells[index] as CellCoord,
        500,
        now,
      );
    }
    // El testigo del crecimiento: joven a una hora de la frontera de madurez.
    witnessTreeId = await plantTreeAged(
      harness,
      world,
      playerId,
      controlled.id,
      cells[4] as CellCoord,
      479,
      now,
    );

    // Los arboles se plantaron fuera de banda, luego el calendario se sincroniza fuera de banda
    // igual que lo haria la ruta que los hubiera creado.
    await harness.services.transaction(async (tx, outbox) => {
      const clock = await harness.services.clock.read(tx);
      const plot = await requirePlot(tx, playerId, controlled.id);
      await syncMilestoneSchedule(tx, outbox, clock, plot, clock.gameNow);
    });
  });

  it('la fase de un arbol avanza con el reloj y no agenda ningun evento por arbol (GDD 131)', async () => {
    const before = await get(harness, accessToken, `/api/forest-plots/${controlled.id}`);
    expect(before.statusCode).toBe(200);
    const treesBefore = before.body['trees'] as Record<string, unknown>[];
    const witnessBefore = treesBefore.find((tree) => tree['id'] === witnessTreeId);
    expect(witnessBefore?.['growthStage']).toBe('YOUNG');
    expect(witnessBefore?.['woodVolumeDm3']).toBe(YOUNG_DM3);
    expect(witnessBefore?.['nextStageAtGameMs']).not.toBeNull();

    // Un unico evento agendado, de la parcela y no de un arbol, para cinco arboles.
    const pending = await harness.prisma.scheduledEvent.findMany({
      where: {
        playerId,
        kind: ScheduledEventKind.FOREST_NOTIFY_MILESTONE,
        status: ScheduledEventStatus.PENDING,
      },
      select: { refType: true, refId: true },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.refType).toBe('FOREST_PLOT');
    expect(pending[0]?.refId).toBe(controlled.id);

    await advanceAndSettle(2);
    const after = await get(harness, accessToken, `/api/forest-plots/${controlled.id}`);
    const treesAfter = after.body['trees'] as Record<string, unknown>[];
    const witnessAfter = treesAfter.find((tree) => tree['id'] === witnessTreeId);
    expect(witnessAfter?.['growthStage']).toBe('MATURE');
    expect(witnessAfter?.['woodVolumeDm3']).toBe(MATURE_DM3);

    // Nada se escribio en la fila del arbol: la fase es derivada.
    const stored = await harness.prisma.tree.findUniqueOrThrow({
      where: { id: witnessTreeId },
      select: { plantedAtGameMs: true, status: true },
    });
    expect(stored.status).toBe(TreeStatus.STANDING);
    expect(stored.plantedAtGameMs).toBe(BigInt(witnessBefore?.['plantedAtGameMs'] as string));
  });

  it('rechaza talar con maquinaria agricola (GDD 134)', async () => {
    const { statusCode, body } = await post(
      harness,
      accessToken,
      `/api/forest-plots/${controlled.id}/fell`,
      {
        workerId: mainFarm.workerId,
        poweredMachineId: mainFarm.machines[MachineType.TRACTOR],
        destinationFarmId: mainFarm.farmId,
      },
    );
    expect(statusCode).toBeGreaterThanOrEqual(400);
    expect(errorCode(body)).toBe(ValidationCode.POWERED_MACHINE_REQUIRED);

    // Y nada quedo reservado por el intento.
    const worker = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: mainFarm.workerId },
      select: { status: true, currentTaskId: true },
    });
    expect(worker.status).toBe(WorkerStatus.IDLE);
    expect(worker.currentTaskId).toBeNull();
    expect(await harness.prisma.task.count({ where: { playerId } })).toBe(0);
  });

  it('la duracion de la tala por lote es la de GDD 135', async () => {
    const batch = controlled.cells.slice(0, 4);
    const { statusCode, body } = await post(
      harness,
      accessToken,
      `/api/forest-plots/${controlled.id}/fell`,
      {
        workerId: mainFarm.workerId,
        poweredMachineId: mainFarm.machines[MachineType.HARVESTER_FORESTRY],
        destinationFarmId: mainFarm.farmId,
        cells: batch,
      },
    );
    expect(statusCode).toBe(200);
    const task = mutationResult(body)['task'] as Record<string, unknown>;
    expect(task['operation']).toBe('FELL');
    expect(task['unitsAtStart']).toBe(4);

    // La regla compartida, no un literal: `treeCount / (workSpeed x conditionFactor x skillFactor)`.
    const expectedHours = fellingDurationGameHours(4, bp(10_000), bp(WORKER_SKILL_BP));
    const start = BigInt(task['startGameMs'] as string);
    const end = BigInt(task['scheduledEndGameMs'] as string);
    expect(end - start).toBe(gameHoursToGameMs(expectedHours));
    // Con una maquina nueva y un operario al 50 % de habilidad: 0,8 x 1,0 x 0,75 = 0,6 arboles/h.
    expect(task['effectiveWorkSpeedMilli']).toBe(600);

    // El lote quedo marcado, que es como la finalizacion sabra que arboles selecciono el jugador.
    const marked = await harness.prisma.tree.count({
      where: { forestPlotId: controlled.id, status: TreeStatus.MARKED_FOR_HARVEST },
    });
    expect(marked).toBe(4);
  });

  it('produce la suma de los volumenes derivados y la deposita en el almacen (GDD 135 y 136)', async () => {
    const task = await harness.prisma.task.findFirstOrThrow({
      where: { playerId, operation: 'FELL', status: TaskStatus.IN_PROGRESS },
      select: { id: true, scheduledEndGameMs: true, reservedStorageUnits: true },
    });
    const dueGameMs = gameMs(task.scheduledEndGameMs);
    const marked = (await treesOf(controlled.id)).filter(
      (tree) => tree.status === TreeStatus.MARKED_FOR_HARVEST,
    );
    const expected = batchWoodVolume(
      marked.map((tree) =>
        treeView({
          id: tree.id,
          forestPlotId: controlled.id,
          playerId,
          worldId: world.id,
          cellX: tree.cellX,
          cellY: tree.cellY,
          species: PINE.species,
          plantedAtGameMs: gameMs(tree.plantedAtGameMs),
          status: tree.status,
          felledAtGameMs: null,
          naturallyGenerated: tree.naturallyGenerated,
        }),
      ),
      dueGameMs,
    );
    expect(expected.volumeDm3).toBe(4 * MATURE_DM3);

    await advanceAndSettle(7);

    const farm = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: mainFarm.farmId },
      select: { storedWoodDm3: true, reservedWoodDm3: true },
    });
    expect(farm.storedWoodDm3).toBe(expected.volumeDm3);
    expect(farm.reservedWoodDm3).toBe(0);

    const felled = (await treesOf(controlled.id)).filter(
      (tree) => tree.status === TreeStatus.FELLED,
    );
    expect(felled).toHaveLength(4);
    // Borrado logico y no borrado: la fila permanece con su instante (plan seccion 2.2).
    expect(felled.every((tree) => tree.felledAtGameMs === dueGameMs)).toBe(true);

    const finished = await harness.prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { status: true, endedGameMs: true },
    });
    expect(finished.status).toBe(TaskStatus.COMPLETED);
    expect(finished.endedGameMs).toBe(dueGameMs);

    const worker = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: mainFarm.workerId },
      select: { status: true, currentTaskId: true, completedTaskCount: true },
    });
    expect(worker.status).toBe(WorkerStatus.IDLE);
    expect(worker.currentTaskId).toBeNull();
    expect(worker.completedTaskCount).toBe(1);

    const machine = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: mainFarm.machines[MachineType.HARVESTER_FORESTRY] as string },
      select: { status: true, currentTaskId: true, conditionBp: true },
    });
    expect(machine.status).toBe(MachineStatus.IDLE);
    expect(machine.currentTaskId).toBeNull();
    // 30 pb/h durante 6,67 h de trabajo (GDD 93, tasa inventada del catalogo).
    expect(machine.conditionBp).toBeLessThan(10_000);

    // La parcela queda con el testigo en pie y cuatro celdas vacias que replantar o desmontar.
    const listing = await get(harness, accessToken, '/api/forest-plots');
    const plots = listing.body['plots'] as Record<string, unknown>[];
    const plot = plots.find((each) => each['id'] === controlled.id);
    expect(plot?.['standingTreeCount']).toBe(1);
    expect(plot?.['emptyCellCount']).toBe(7);
  });

  it('vende la madera al precio fijo de GDD 133', async () => {
    const before = await harness.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { balance: true },
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/market/sell',
      headers: { ...bearer(accessToken), 'idempotency-key': `wood-${randomUUID()}` },
      payload: { farmId: mainFarm.farmId, resource: 'WOOD_M3' },
    });
    expect(response.statusCode).toBe(200);
    const result = mutationResult(response.json<Record<string, unknown>>());
    expect(result['quantitySoldUnits']).toBe(4 * MATURE_DM3);
    expect(result['revenue']).toBe(Money.toString(woodSaleRevenue(PINE, 4 * MATURE_DM3)));
    // 7,2 m3 a 45 $/m3 son 324,00, y el saldo se mueve exactamente eso.
    const after = await harness.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { balance: true },
    });
    expect(Number(after.balance) - Number(before.balance)).toBeCloseTo(324, 4);
  });

  it('la replantacion crea plantones de edad cero (GDD 137)', async () => {
    const cells = controlled.cells.slice(0, 2);
    const { statusCode, body } = await post(
      harness,
      accessToken,
      `/api/forest-plots/${controlled.id}/replant`,
      {
        workerId: mainFarm.workerId,
        poweredMachineId: mainFarm.machines[MachineType.HARVESTER_FORESTRY],
        cells,
      },
    );
    expect(statusCode).toBe(200);
    const task = mutationResult(body)['task'] as Record<string, unknown>;
    expect(task['operation']).toBe('REPLANT');
    expect(task['unitsAtStart']).toBe(2);
    // La condicion de la cosechadora bajo con la tala, y es la maquina que marca el ritmo: la
    // duracion se compara contra la regla evaluada con la condicion real, no contra un literal.
    const harvester = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: mainFarm.machines[MachineType.HARVESTER_FORESTRY] as string },
      select: { conditionBp: true },
    });
    // Y la habilidad del operario subio al completar la tala (GDD 103 y 105), de modo que la
    // duracion se compara con la regla evaluada sobre el estado real de los dos.
    const operator = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: mainFarm.workerId },
      select: { skillBp: true },
    });
    expect(operator.skillBp).toBeGreaterThan(WORKER_SKILL_BP);
    const expectedHours = estimateTaskDuration({
      operation: 'REPLANT',
      units: 2,
      conditionBp: bp(harvester.conditionBp),
      skillBp: bp(operator.skillBp),
    }).durationGameHours;
    const dueGameMs = gameMs(BigInt(task['scheduledEndGameMs'] as string));
    expect(dueGameMs - BigInt(task['startGameMs'] as string)).toBe(
      gameHoursToGameMs(expectedHours),
    );

    await advanceAndSettle(2);

    const planted = (await treesOf(controlled.id)).filter(
      (tree) => tree.status === TreeStatus.STANDING && !tree.naturallyGenerated,
    );
    expect(planted).toHaveLength(2);
    expect(planted.map((tree) => `${tree.cellX},${tree.cellY}`).sort()).toEqual(
      cells.map((cell) => `${cell.cellX},${cell.cellY}`).sort(),
    );
    for (const tree of planted) {
      // Edad cero en el instante en que la tarea acabo, luego `SAPLING` derivado y nada almacenado.
      expect(tree.plantedAtGameMs).toBe(dueGameMs);
      expect(
        treeStageAt(
          {
            species: PINE.species,
            plantedAtGameMs: gameMs(tree.plantedAtGameMs),
            status: TreeStatus.STANDING,
          },
          dueGameMs,
        ),
      ).toBe('SAPLING');
    }
  });

  it('el desmonte deja la celda apta para campo (GDD 10)', async () => {
    // El desmonte convierte la parte talada de la parcela, que es lo que GDD 137 ofrece
    // convertir; una seleccion parcial se rechaza en la asignacion.
    const partial = [controlled.cells[6] as CellCoord];
    const refused = await post(harness, accessToken, '/api/land/clear', {
      workerId: mainFarm.workerId,
      poweredMachineId: mainFarm.machines[MachineType.TRACTOR],
      implementMachineId: mainFarm.machines[MachineType.PLOW],
      cells: partial,
      forestPlotId: controlled.id,
    });
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    expect(errorCode(refused.body)).toBe(ValidationCode.VALIDATION_FAILED);

    const empty = [2, 3, 5, 6, 7].map((index) => controlled.cells[index] as CellCoord);
    const { statusCode, body } = await post(harness, accessToken, '/api/land/clear', {
      workerId: mainFarm.workerId,
      poweredMachineId: mainFarm.machines[MachineType.TRACTOR],
      implementMachineId: mainFarm.machines[MachineType.PLOW],
      cells: empty,
      forestPlotId: controlled.id,
    });
    expect(statusCode).toBe(200);
    const task = mutationResult(body)['task'] as Record<string, unknown>;
    expect(task['operation']).toBe('CLEAR_LAND');
    expect(task['unitsAtStart']).toBe(empty.length);

    await advanceAndSettle(5);

    const rows = await harness.prisma.worldCell.findMany({
      where: {
        worldId: world.id,
        OR: empty.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
      },
      select: {
        cellX: true,
        cellY: true,
        terrainOverride: true,
        landUse: true,
        forestPlotId: true,
      },
    });
    expect(rows).toHaveLength(empty.length);
    for (const row of rows) {
      expect(row.terrainOverride).toBe(TerrainType.GRASS);
      expect(row.landUse).toBe(LandUse.OWNED);
      expect(row.forestPlotId).toBeNull();
    }

    const plot = await harness.prisma.forestPlot.findUniqueOrThrow({
      where: { id: controlled.id },
      select: { cellCount: true },
    });
    expect(plot.cellCount).toBe(controlled.cells.length - empty.length);

    // Y la prueba de que el suelo quedo apto: el servidor acepta un campo sobre el.
    const field = await post(harness, accessToken, '/api/fields', {
      name: 'Campo ganado al bosque',
      farmId: mainFarm.farmId,
      cells: empty,
    });
    expect(field.statusCode).toBe(200);
    const created = mutationResult(field.body)['field'] as Record<string, unknown>;
    expect(created['cellCount']).toBe(empty.length);
    expect(created['cropCycleState']).toBe('VIRGIN');
  });
});

describe('el aviso de hito de una parcela (GDD 131)', () => {
  it('se notifica una vez, por parcela y no por arbol, y sobrevive a la tala', async () => {
    // El testigo maduro en la primera hora de la suite y su ventana no habia vencido todavia
    // cuando la tala termino. Un calendario que se recalculara en cada mutacion lo habria
    // perdido; el que conserva la fila pendiente lo entrega.
    await advanceAndSettle(30);

    const notices = await harness.prisma.gameEvent.findMany({
      where: { playerId, type: 'NOTICE' },
      orderBy: { seq: 'asc' },
      select: { payload: true, atGameMs: true },
    });
    const milestones = notices.filter((event) => {
      const payload = event.payload as { notice?: { kind?: string; subjectId?: string } };
      return payload.notice?.kind === 'FOREST_MILESTONE';
    });
    expect(milestones).toHaveLength(1);
    const notice = (milestones[0]?.payload as { notice: Record<string, unknown> }).notice;
    expect(notice['subjectType']).toBe('FOREST_PLOT');
    expect(notice['subjectId']).toBe(controlled.id);
    expect((notice['details'] as Record<string, unknown>)['treeCount']).toBe(1);

    // Y el aviso viaja con el marco de arboles de la parcela, que es lo que el panel aplica.
    const frames = await harness.prisma.gameEvent.findMany({
      where: { playerId, type: 'TREES_UPSERTED' },
      select: { payload: true },
    });
    expect(
      frames.some((frame) => {
        const payload = frame.payload as { forestPlotId?: string };
        return payload.forestPlotId === controlled.id;
      }),
    ).toBe(true);

    // Ningun evento agendado apunta jamas a un arbol: son cinco arboles y como mucho un evento
    // por parcela, que es lo que hace viable notificar (GDD 130 admite un arbol por celda).
    const scheduled = await harness.prisma.scheduledEvent.findMany({
      where: { playerId, kind: ScheduledEventKind.FOREST_NOTIFY_MILESTONE },
      select: { refType: true, refId: true, status: true },
    });
    expect(scheduled.every((event) => event.refType === 'FOREST_PLOT')).toBe(true);
    const pending = scheduled.filter((event) => event.status === ScheduledEventStatus.PENDING);
    const plots = await harness.prisma.forestPlot.count({ where: { playerId } });
    expect(pending.length).toBeLessThanOrEqual(plots);
    expect(await harness.prisma.tree.count({ where: { playerId } })).toBeGreaterThan(
      pending.length,
    );
  });
});

// ---------------------------------------------------------------------------
// A full store
// ---------------------------------------------------------------------------

describe('el almacen de madera lleno (GDD 83, 97 y 136)', () => {
  it('acota lo depositado a lo que cabe y desperdicia el resto', async () => {
    const farm = await createForestryFarm(harness, playerId, 950, TIGHT_CAPACITY_DM3, [
      MachineType.HARVESTER_FORESTRY,
      MachineType.FORWARDER,
    ]);
    const origin = await findForestRectangle(harness, world, 2, 2, BAND.CAPACITY);
    const cells = rectangleCells(origin, 2, 2);
    expect((await buyLand(harness, accessToken, cells)).statusCode).toBe(200);
    await consumeNaturalTrees(harness, world, cells);

    const created = await post(harness, accessToken, '/api/forest-plots', {
      name: 'Parcela del almacen justo',
      farmId: farm.farmId,
      cells,
    });
    expect(created.statusCode).toBe(200);
    const plotId = (mutationResult(created.body)['plot'] as Record<string, unknown>)[
      'id'
    ] as string;

    const now = harness.gameNow();
    for (const index of [0, 1, 2]) {
      await plantTreeAged(harness, world, playerId, plotId, cells[index] as CellCoord, 500, now);
    }
    // El cuarto arbol cruza a maduro tres horas despues de la asignacion, y la tala dura 6,67 h:
    // lo reservado es 5 800 dm3 y lo producido, 7 200.
    await plantTreeAged(harness, world, playerId, plotId, cells[3] as CellCoord, 477, now);

    const { statusCode, body } = await post(
      harness,
      accessToken,
      `/api/forest-plots/${plotId}/fell`,
      {
        workerId: farm.workerId,
        poweredMachineId: farm.machines[MachineType.HARVESTER_FORESTRY],
        destinationFarmId: farm.farmId,
      },
    );
    expect(statusCode).toBe(200);
    const task = mutationResult(body)['task'] as Record<string, unknown>;
    expect(task['reservedStorageUnits']).toBe(TIGHT_CAPACITY_DM3);

    const reserved = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: farm.farmId },
      select: { reservedWoodDm3: true, capacityWoodDm3: true },
    });
    expect(reserved.reservedWoodDm3).toBe(TIGHT_CAPACITY_DM3);
    expect(reserved.capacityWoodDm3).toBe(TIGHT_CAPACITY_DM3);

    await advanceAndSettle(7);

    const after = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: farm.farmId },
      select: { storedWoodDm3: true, reservedWoodDm3: true, capacityWoodDm3: true },
    });
    // Lo producido, 4 x 1 800 = 7 200, no cabe: se acepta hasta la capacidad y se pierde el resto.
    expect(after.storedWoodDm3).toBe(TIGHT_CAPACITY_DM3);
    expect(after.reservedWoodDm3).toBe(0);
    expect(after.storedWoodDm3).toBeLessThan(4 * MATURE_DM3);
    // Y la restriccion de la tabla nunca se vio violada, que es lo que hace viable el trabajo.
    expect(after.storedWoodDm3 + after.reservedWoodDm3).toBeLessThanOrEqual(after.capacityWoodDm3);

    const felled = await harness.prisma.tree.count({
      where: { forestPlotId: plotId, status: TreeStatus.FELLED },
    });
    expect(felled).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Cancelling a felling
// ---------------------------------------------------------------------------

describe('la cancelacion de una tala (GDD 106 y 132)', () => {
  it('devuelve a STANDING los arboles marcados y libera la madera reservada', async () => {
    const farm = await createForestryFarm(harness, playerId, 960, TIGHT_CAPACITY_DM3 * 4, [
      MachineType.HARVESTER_FORESTRY,
      MachineType.FORWARDER,
    ]);
    const origin = await findForestRectangle(harness, world, 2, 2, BAND.CANCEL);
    const cells = rectangleCells(origin, 2, 2);
    expect((await buyLand(harness, accessToken, cells)).statusCode).toBe(200);
    await consumeNaturalTrees(harness, world, cells);

    const created = await post(harness, accessToken, '/api/forest-plots', {
      name: 'Parcela de la tala cancelada',
      farmId: farm.farmId,
      cells,
    });
    expect(created.statusCode).toBe(200);
    const plotId = (mutationResult(created.body)['plot'] as Record<string, unknown>)[
      'id'
    ] as string;

    const now = harness.gameNow();
    for (const cell of cells) {
      await plantTreeAged(harness, world, playerId, plotId, cell, 500, now);
    }

    const assigned = await post(harness, accessToken, `/api/forest-plots/${plotId}/fell`, {
      workerId: farm.workerId,
      poweredMachineId: farm.machines[MachineType.HARVESTER_FORESTRY],
      destinationFarmId: farm.farmId,
    });
    expect(assigned.statusCode, JSON.stringify(assigned.body)).toBe(200);
    const task = mutationResult(assigned.body)['task'] as Record<string, unknown>;
    const taskId = task['id'] as string;

    expect(
      await harness.prisma.tree.count({
        where: { forestPlotId: plotId, status: TreeStatus.MARKED_FOR_HARVEST },
      }),
    ).toBe(4);

    // La ruta es de `modules/tasks`, que no puede importar a este modulo por ser su hermano de
    // fase: la devolucion de las marcas llega por el registro de `lib/moduleSeams.ts`, que
    // `src/handlers.ts` rellena para los dos procesos (docs/handoff/NOTES-w6c.md 2.2).
    const cancelled = await post(harness, accessToken, `/api/tasks/${taskId}/cancel`, {});
    expect(cancelled.statusCode, JSON.stringify(cancelled.body)).toBe(200);

    expect(
      await harness.prisma.tree.count({
        where: { forestPlotId: plotId, status: TreeStatus.MARKED_FOR_HARVEST },
      }),
    ).toBe(0);
    expect(
      await harness.prisma.tree.count({
        where: { forestPlotId: plotId, status: TreeStatus.STANDING },
      }),
    ).toBe(4);

    // Y la reserva de madera se libera una sola vez. El doble descuento es el riesgo concreto
    // de esta costura: `cancelTask` ya libera la reserva de toda operacion que declare almacen
    // en la tabla de GDD 90, de modo que la estrategia de este modulo no debe repetirlo.
    const after = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: farm.farmId },
      select: { reservedWoodDm3: true, storedWoodDm3: true },
    });
    expect(after.reservedWoodDm3).toBe(0);
    expect(after.storedWoodDm3).toBe(0);

    const plot = await harness.prisma.forestPlot.findUniqueOrThrow({
      where: { id: plotId },
      select: { currentTaskId: true },
    });
    expect(plot.currentTaskId).toBeNull();
    expect(
      await harness.prisma.scheduledEvent.count({
        where: { playerId, refId: taskId, status: ScheduledEventStatus.PENDING },
      }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regressions of workflow W7 (corrections of the adversarial review)
// ---------------------------------------------------------------------------

describe('una tala por lote frente al planton (GDD 131)', () => {
  it('no marca ni tala el planton, y el volumen es el de los arboles talables', async () => {
    const farm = await createForestryFarm(harness, playerId, 970, TIGHT_CAPACITY_DM3 * 4, [
      MachineType.HARVESTER_FORESTRY,
      MachineType.FORWARDER,
    ]);
    const origin = await findForestRectangle(harness, world, 2, 1, BAND.SAPLING);
    const cells = rectangleCells(origin, 2, 1);
    expect((await buyLand(harness, accessToken, cells)).statusCode).toBe(200);
    await consumeNaturalTrees(harness, world, cells);

    const created = await post(harness, accessToken, '/api/forest-plots', {
      name: 'Parcela con planton',
      farmId: farm.farmId,
      cells,
    });
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    const plotId = (mutationResult(created.body)['plot'] as Record<string, unknown>)[
      'id'
    ] as string;

    const now = harness.gameNow();
    // Un arbol maduro y un planton. GDD 131 declara el planton no talable y sin valor
    // comercial, de modo que la tala del lote completo no debe destruirlo.
    await plantTreeAged(harness, world, playerId, plotId, cells[0] as CellCoord, 500, now);
    const saplingId = await plantTreeAged(
      harness,
      world,
      playerId,
      plotId,
      cells[1] as CellCoord,
      10,
      now,
    );

    const assigned = await post(harness, accessToken, `/api/forest-plots/${plotId}/fell`, {
      workerId: farm.workerId,
      poweredMachineId: farm.machines[MachineType.HARVESTER_FORESTRY],
      destinationFarmId: farm.farmId,
    });
    expect(assigned.statusCode, JSON.stringify(assigned.body)).toBe(200);
    const task = mutationResult(assigned.body)['task'] as Record<string, unknown>;
    // La duracion sigue contando los dos arboles: GDD 135 mide sobre los arboles del area.
    expect(task['unitsAtStart']).toBe(2);
    // Y la reserva es la del arbol talable, no la de los dos.
    expect(task['reservedStorageUnits']).toBe(MATURE_DM3);

    expect(
      await harness.prisma.tree.count({
        where: { forestPlotId: plotId, status: TreeStatus.MARKED_FOR_HARVEST },
      }),
    ).toBe(1);

    await advanceAndSettle(6);

    const sapling = await harness.prisma.tree.findUniqueOrThrow({
      where: { id: saplingId },
      select: { status: true, felledAtGameMs: true },
    });
    expect(sapling.status).toBe(TreeStatus.STANDING);
    expect(sapling.felledAtGameMs).toBeNull();

    const store = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: farm.farmId },
      select: { storedWoodDm3: true, reservedWoodDm3: true },
    });
    expect(store.storedWoodDm3).toBe(MATURE_DM3);
    expect(store.reservedWoodDm3).toBe(0);
  });
});

describe('el desmonte de una parcela entera (GDD 10 y 137)', () => {
  it('cierra la parcela en lugar de escribir cellCount = 0, y la tarea termina', async () => {
    const farm = await createForestryFarm(harness, playerId, 980, TIGHT_CAPACITY_DM3, [
      MachineType.TRACTOR,
      MachineType.PLOW,
    ]);
    const origin = await findForestRectangle(harness, world, 2, 1, BAND.CLEARED);
    const cells = rectangleCells(origin, 2, 1);
    expect((await buyLand(harness, accessToken, cells)).statusCode).toBe(200);
    await consumeNaturalTrees(harness, world, cells);

    const created = await post(harness, accessToken, '/api/forest-plots', {
      name: 'Parcela desmontada entera',
      farmId: farm.farmId,
      cells,
    });
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    const plotId = (mutationResult(created.body)['plot'] as Record<string, unknown>)[
      'id'
    ] as string;

    // Sin ningun arbol vivo, las celdas vacias son todas: es el unico desmonte que
    // `requireWholeClearedPart` admite sobre esta parcela y el que la dejaba sin celdas.
    const assigned = await post(harness, accessToken, '/api/land/clear', {
      workerId: farm.workerId,
      poweredMachineId: farm.machines[MachineType.TRACTOR],
      implementMachineId: farm.machines[MachineType.PLOW],
      cells,
      forestPlotId: plotId,
    });
    expect(assigned.statusCode, JSON.stringify(assigned.body)).toBe(200);
    const taskId = (mutationResult(assigned.body)['task'] as Record<string, unknown>)[
      'id'
    ] as string;

    await advanceAndSettle(3);

    const task = await harness.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { status: true, endedGameMs: true },
    });
    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect(task.endedGameMs).not.toBeNull();

    const plot = await harness.prisma.forestPlot.findUniqueOrThrow({
      where: { id: plotId },
      select: { cellCount: true, disposedGameMs: true, currentTaskId: true },
    });
    expect(plot.disposedGameMs).not.toBeNull();
    expect(plot.currentTaskId).toBeNull();
    // La restriccion `forest_plots_geometry_check` exige `cellCount > 0`: la parcela se cierra
    // con su ultimo recuento y no con un cero que abortaria la transaccion.
    expect(plot.cellCount).toBeGreaterThan(0);

    const rows = await harness.prisma.worldCell.findMany({
      where: {
        worldId: world.id,
        OR: cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
      },
      select: { terrainOverride: true, landUse: true, forestPlotId: true },
    });
    expect(rows).toHaveLength(cells.length);
    for (const row of rows) {
      expect(row.terrainOverride).toBe(TerrainType.GRASS);
      expect(row.landUse).toBe(LandUse.OWNED);
      expect(row.forestPlotId).toBeNull();
    }

    // Y los recursos quedan libres, que es lo que el reintento agotado dejaba reservado.
    const worker = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: farm.workerId },
      select: { status: true },
    });
    expect(worker.status).toBe(WorkerStatus.IDLE);
    const machines = await harness.prisma.machine.findMany({
      where: { farmId: farm.farmId },
      select: { status: true },
    });
    expect(machines.every((machine) => machine.status === MachineStatus.IDLE)).toBe(true);

    // La parcela cerrada desaparece de la lectura del jugador.
    const listed = await get(harness, accessToken, '/api/forest-plots');
    expect(listed.statusCode).toBe(200);
    const plots = listed.body['plots'] as Record<string, unknown>[];
    expect(plots.some((row) => row['id'] === plotId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The metric of unhandled events
// ---------------------------------------------------------------------------

describe('la metrica de eventos sin manejador', () => {
  it('no cuenta ningun evento de silvicultura', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    const body = response.body;
    for (const line of body.split('\n')) {
      if (!line.startsWith('farm_world_scheduled_events_unhandled_total{')) {
        continue;
      }
      expect(line).not.toContain('FOREST_NOTIFY_MILESTONE');
      if (line.includes('TASK_COMPLETE')) {
        // El compuesto de este modulo atiende las tres operaciones forestales antes de delegar,
        // de modo que ninguna de las tareas de esta suite pudo dejar un hueco.
        expect(line.trim().endsWith(' 0')).toBe(true);
      }
    }
    void gameHours;
  });
});
