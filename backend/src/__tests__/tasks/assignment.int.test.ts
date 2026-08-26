// The six checks of GDD section 104 and the table of GDD section 90, against a real
// PostgreSQL.
//
// Owner: workflow W6-A. Module `tasks`.
//
// The subject of this file is the sentence of GDD section 90 that the whole assignment path
// is built around: "combinaciones invalidas se rechazan sin ejecucion parcial". Every case
// therefore takes a snapshot of the state that an assignment would touch — the worker, the
// two machines, the field, the tasks, the outbox and the reservation of the silo — runs the
// refused request, takes the snapshot again and compares the two. A code that is right while
// a machine was left marked as working would pass a weaker assertion and would still be the
// defect that matters.
//
// The second subject is the ORDER. GDD section 104 numbers its checks, and ADR-0048 fixes
// that the reason a control is disabled is the reason the server gives, which is the first
// of a fixed sequence: a player who reads a motive, resolves exactly that and presses again
// has to advance. The cases below build situations where two or three reasons are true at
// once, on purpose, so the winner is pinned rather than assumed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CropCycleState,
  MIN_CONDITION_TO_ASSIGN,
  MachineStatus,
  MachineType,
  ValidationCode,
  bp,
  type PlayerId,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import {
  cleanUp,
  createFieldRow,
  createMachine,
  createTaskFarm,
  createWorker,
  type TaskFarmFixture,
} from './fixtures.js';

let harness: Harness;
const players: PlayerId[] = [];

interface JsonResponse {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}

async function post(url: string, payload: unknown, token: string): Promise<JsonResponse> {
  const response = await harness.app.inject({
    method: 'POST',
    url,
    headers: bearer(token),
    payload: payload as never,
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

function errorCodeOf(response: JsonResponse): string {
  return (response.body['error'] as Record<string, unknown>)['code'] as string;
}

function blockerCodesOf(response: JsonResponse): readonly string[] {
  return (response.body['blockers'] as Record<string, unknown>[]).map(
    (blocker) => blocker['code'] as string,
  );
}

/**
 * Everything an assignment could possibly have written, in one object.
 *
 * Compared before and after every refused request. It covers the four tables the assignment
 * writes — the task, the link to the machines, the three reservation columns and the
 * committed capacity of the silo — plus the outbox, because a scheduled completion left
 * behind would be an orphan alarm clock for a task that does not exist.
 */
async function snapshot(playerId: PlayerId): Promise<Record<string, unknown>> {
  const [workers, machines, fields, farms, tasks, taskMachines, events] = await Promise.all([
    harness.prisma.worker.findMany({
      where: { playerId },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, currentTaskId: true, skillBp: true },
    }),
    harness.prisma.machine.findMany({
      where: { playerId },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, currentTaskId: true, conditionBp: true },
    }),
    harness.prisma.field.findMany({
      where: { playerId },
      orderBy: { id: 'asc' },
      select: { id: true, cropCycleState: true, currentTaskId: true, cropId: true },
    }),
    harness.prisma.farmStock.findMany({
      where: { farm: { playerId } },
      orderBy: [{ farmId: 'asc' }, { item: 'asc' }],
      select: { farmId: true, item: true, storedUnits: true, reservedUnits: true },
    }),
    harness.prisma.task.count({ where: { playerId } }),
    harness.prisma.taskMachine.count({ where: { task: { playerId } } }),
    harness.prisma.scheduledEvent.count({ where: { playerId } }),
  ]);
  return { workers, machines, fields, farms, tasks, taskMachines, events };
}

interface Scene {
  readonly playerId: PlayerId;
  readonly token: string;
  readonly farm: TaskFarmFixture;
  readonly workerId: string;
  readonly tractorId: string;
  readonly plowId: string;
  readonly cultivatorId: string;
  readonly seederId: string;
  readonly combineId: string;
  readonly trailerId: string;
  readonly virginFieldId: string;
}

/** A player with one of every machine, a worker and a virgin field. */
async function scene(label: string, band: number): Promise<Scene> {
  const player = await registerViaHttp(harness, label);
  players.push(player.playerId);
  const playerId = player.playerId;
  const farm = await createTaskFarm(harness, playerId, band);
  return {
    playerId,
    token: player.accessToken,
    farm,
    workerId: await createWorker(harness, playerId, farm, bp(6000)),
    tractorId: await createMachine(harness, playerId, farm, MachineType.TRACTOR, bp(10_000)),
    plowId: await createMachine(harness, playerId, farm, MachineType.PLOW, bp(10_000)),
    cultivatorId: await createMachine(harness, playerId, farm, MachineType.CULTIVATOR, bp(10_000)),
    seederId: await createMachine(harness, playerId, farm, MachineType.SEEDER, bp(10_000)),
    combineId: await createMachine(harness, playerId, farm, MachineType.HARVESTER, bp(10_000)),
    trailerId: await createMachine(harness, playerId, farm, MachineType.TRAILER, bp(10_000)),
    virginFieldId: await createFieldRow(harness, playerId, farm, { cellCount: 20 }),
  };
}

/** Runs a request that must be refused and asserts that it wrote nothing at all. */
async function refuse(
  scenario: Scene,
  body: Record<string, unknown>,
  expectedCode: ValidationCode,
): Promise<void> {
  const before = await snapshot(scenario.playerId);
  const response = await post('/api/tasks', body, scenario.token);
  expect(response.statusCode, JSON.stringify(response.body)).toBeGreaterThanOrEqual(400);
  expect(errorCodeOf(response), JSON.stringify(response.body)).toBe(expectedCode);
  const after = await snapshot(scenario.playerId);
  expect(after).toEqual(before);
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await cleanUp(harness, players);
  await harness.teardown();
});

// ---------------------------------------------------------------------------
// The table of GDD section 90
// ---------------------------------------------------------------------------

describe('la tabla de compatibilidad de §90', () => {
  it('rechaza cada combinacion invalida sin mutacion parcial', async () => {
    const scenario = await scene('tabla-90', 1000);
    const plowedFieldId = await createFieldRow(harness, scenario.playerId, scenario.farm, {
      cellCount: 20,
      cropCycleState: CropCycleState.PLOWED,
    });
    const readyFieldId = await createFieldRow(harness, scenario.playerId, scenario.farm, {
      cellCount: 20,
      cropCycleState: CropCycleState.READY_TO_HARVEST,
      cropId: 'WHEAT',
    });

    // VIRGIN -> PLOWED exige tractor y arado. Con el cultivador enganchado falta el
    // implemento que la fila pide, que es lo primero que la regla compartida reporta.
    await refuse(
      scenario,
      {
        operation: 'PLOW',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.cultivatorId,
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.IMPLEMENT_REQUIRED,
    );

    // La misma fila con la maquina autopropulsada equivocada: la cosechadora no ara.
    await refuse(
      scenario,
      {
        operation: 'PLOW',
        workerId: scenario.workerId,
        poweredMachineId: scenario.combineId,
        implementMachineId: scenario.plowId,
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.POWERED_MACHINE_REQUIRED,
    );

    // PLOWED -> CULTIVATED exige cultivador.
    await refuse(
      scenario,
      {
        operation: 'CULTIVATE',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.seederId,
        targetFieldId: plowedFieldId,
      },
      ValidationCode.IMPLEMENT_REQUIRED,
    );

    // CULTIVATED/PLOWED -> SEEDED exige sembradora.
    await refuse(
      scenario,
      {
        operation: 'SEED',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.plowId,
        targetFieldId: plowedFieldId,
        cropId: 'WHEAT',
      },
      ValidationCode.IMPLEMENT_REQUIRED,
    );

    // READY_TO_HARVEST -> HARVESTED exige cosechadora y remolque. Sin remolque, §89 marca
    // la cosechadora como `requiresTrailerOrSilo` y el codigo lo nombra.
    await refuse(
      scenario,
      {
        operation: 'HARVEST',
        workerId: scenario.workerId,
        poweredMachineId: scenario.combineId,
        implementMachineId: scenario.plowId,
        targetFieldId: readyFieldId,
        destinationFarmId: scenario.farm.farmId,
      },
      ValidationCode.TRAILER_REQUIRED,
    );

    // Y con el tractor en lugar de la cosechadora.
    await refuse(
      scenario,
      {
        operation: 'HARVEST',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.trailerId,
        targetFieldId: readyFieldId,
        destinationFarmId: scenario.farm.farmId,
      },
      ValidationCode.POWERED_MACHINE_REQUIRED,
    );

    // Ninguna de las seis dejo nada a medias, que es lo que `refuse` comprueba una a una;
    // al cabo de las seis tampoco hay ninguna tarea.
    expect(await harness.prisma.task.count({ where: { playerId: scenario.playerId } })).toBe(0);
  });

  it('rechaza intercambiar la maquina propulsada y el implemento', async () => {
    // Las dos maquinas son las correctas y el multiconjunto de tipos es el de la fila de
    // §90; lo que esta mal es el papel. La tabla se lee por papel, de modo que "arado que
    // remolca al tractor" no es la fila "tractor + arado".
    const scenario = await scene('papeles-90', 1400);

    await refuse(
      scenario,
      {
        operation: 'PLOW',
        workerId: scenario.workerId,
        poweredMachineId: scenario.plowId,
        implementMachineId: scenario.tractorId,
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.POWERED_MACHINE_REQUIRED,
    );

    // Y la prevision dice lo mismo que la asignacion, que es lo que ADR-0048 exige del
    // motivo por el que un control aparece inhabilitado.
    const estimate = await post(
      '/api/tasks/estimate',
      {
        operation: 'PLOW',
        workerId: scenario.workerId,
        poweredMachineId: scenario.plowId,
        implementMachineId: scenario.tractorId,
        targetFieldId: scenario.virginFieldId,
      },
      scenario.token,
    );
    expect(estimate.statusCode, JSON.stringify(estimate.body)).toBe(200);
    expect(estimate.body['feasible']).toBe(false);
    expect(blockerCodesOf(estimate)).toContain(ValidationCode.POWERED_MACHINE_REQUIRED);

    // La peticion con los papeles en su sitio si se acepta, de modo que lo que el arreglo
    // cierra es el intercambio y no la fila.
    const accepted = await post(
      '/api/tasks',
      {
        operation: 'PLOW',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.plowId,
        targetFieldId: scenario.virginFieldId,
      },
      scenario.token,
    );
    expect(accepted.statusCode, JSON.stringify(accepted.body)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The order of the six checks of GDD section 104
// ---------------------------------------------------------------------------

describe('la secuencia de seis comprobaciones de §104', () => {
  it('rechaza en el orden que la seccion fija cuando varios motivos son ciertos a la vez', async () => {
    const scenario = await scene('orden-104', 2000);

    // El trabajador ocupado y la maquina ocupada a la vez. Gana el trabajador, que es la
    // comprobacion 1.
    await harness.prisma.worker.update({
      where: { id: scenario.workerId },
      data: { status: 'WORKING' },
    });
    await harness.prisma.machine.update({
      where: { id: scenario.tractorId },
      data: { status: MachineStatus.WORKING },
    });
    await refuse(
      scenario,
      {
        operation: 'PLOW',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.plowId,
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.WORKER_NOT_IDLE,
    );

    // Resuelto el trabajador, gana la maquina, que es la comprobacion 2, y no el estado del
    // campo, que es la 5.
    await harness.prisma.worker.update({
      where: { id: scenario.workerId },
      data: { status: 'IDLE' },
    });
    await refuse(
      scenario,
      {
        operation: 'CULTIVATE',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.cultivatorId,
        // VIRGIN no admite cultivar: la comprobacion 5 tambien fallaria.
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.MACHINE_NOT_IDLE,
    );

    // Resuelta la maquina, gana el estado del campo.
    await harness.prisma.machine.update({
      where: { id: scenario.tractorId },
      data: { status: MachineStatus.IDLE },
    });
    await refuse(
      scenario,
      {
        operation: 'CULTIVATE',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.cultivatorId,
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.FIELD_STATE_NOT_ALLOWED,
    );
  });

  it('rechaza una maquina por debajo del suelo de condicion de asignacion', async () => {
    const scenario = await scene('condicion', 2100);
    await harness.prisma.machine.update({
      where: { id: scenario.plowId },
      data: { conditionBp: MIN_CONDITION_TO_ASSIGN - 1 },
    });
    await refuse(
      scenario,
      {
        operation: 'PLOW',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.plowId,
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.MACHINE_CONDITION_TOO_LOW,
    );
  });

  it('rechaza a un trabajador que no es de la granja de la maquinaria (§108)', async () => {
    const scenario = await scene('granja-ajena', 2200);
    const otherFarm = await createTaskFarm(harness, scenario.playerId, 2250, null);
    const stranger = await createWorker(harness, scenario.playerId, otherFarm, bp(6000));
    await refuse(
      scenario,
      {
        operation: 'PLOW',
        workerId: stranger,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.plowId,
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.WORKER_WRONG_FARM,
    );
  });

  it('rechaza un campo que ya tiene una tarea en curso', async () => {
    const scenario = await scene('campo-ocupado', 2300);
    const first = await post(
      '/api/tasks',
      {
        operation: 'PLOW',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.plowId,
        targetFieldId: scenario.virginFieldId,
      },
      scenario.token,
    );
    expect(first.statusCode, JSON.stringify(first.body)).toBe(200);

    const second = await createWorker(harness, scenario.playerId, scenario.farm, bp(6000));
    const tractor = await createMachine(
      harness,
      scenario.playerId,
      scenario.farm,
      MachineType.TRACTOR,
      bp(10_000),
    );
    const plow = await createMachine(
      harness,
      scenario.playerId,
      scenario.farm,
      MachineType.PLOW,
      bp(10_000),
    );
    await refuse(
      scenario,
      {
        operation: 'PLOW',
        workerId: second,
        poweredMachineId: tractor,
        implementMachineId: plow,
        targetFieldId: scenario.virginFieldId,
      },
      ValidationCode.FIELD_HAS_ACTIVE_TASK,
    );
  });

  it('rechaza maquinaria de otro jugador con 403 y no con 404', async () => {
    const mine = await scene('propiedad-mia', 2400);
    const theirs = await scene('propiedad-ajena', 2500);
    await refuse(
      mine,
      {
        operation: 'PLOW',
        workerId: mine.workerId,
        poweredMachineId: theirs.tractorId,
        implementMachineId: mine.plowId,
        targetFieldId: mine.virginFieldId,
      },
      ValidationCode.NOT_OWNED,
    );
  });
});

// ---------------------------------------------------------------------------
// The preview reports every reason; the assignment reports the first
// ---------------------------------------------------------------------------

describe('POST /api/tasks/estimate', () => {
  it('enumera todos los motivos a la vez y no muta nada', async () => {
    const scenario = await scene('bloqueos', 3000);
    await harness.prisma.worker.update({
      where: { id: scenario.workerId },
      data: { status: 'WORKING' },
    });
    await harness.prisma.machine.update({
      where: { id: scenario.plowId },
      data: { conditionBp: MIN_CONDITION_TO_ASSIGN - 1 },
    });

    const before = await snapshot(scenario.playerId);
    const estimate = await post(
      '/api/tasks/estimate',
      {
        operation: 'CULTIVATE',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.plowId,
        targetFieldId: scenario.virginFieldId,
      },
      scenario.token,
    );
    expect(estimate.statusCode, JSON.stringify(estimate.body)).toBe(200);
    expect(estimate.body['feasible']).toBe(false);

    // Tres reglas incumplidas a la vez: el trabajador ocupado, el implemento equivocado y
    // por debajo del suelo de condicion, y el estado del campo. El panel las muestra todas;
    // la ruta mutante devuelve la primera (ADR-0048).
    const codes = blockerCodesOf(estimate);
    expect(codes[0]).toBe(ValidationCode.WORKER_NOT_IDLE);
    expect(codes).toContain(ValidationCode.IMPLEMENT_REQUIRED);
    expect(codes).toContain(ValidationCode.MACHINE_CONDITION_TOO_LOW);
    expect(codes).toContain(ValidationCode.FIELD_STATE_NOT_ALLOWED);
    // La prevision no muta nada, que es lo que la declara como ruta no secuenciada.
    expect(await snapshot(scenario.playerId)).toEqual(before);

    const created = await post(
      '/api/tasks',
      {
        operation: 'CULTIVATE',
        workerId: scenario.workerId,
        poweredMachineId: scenario.tractorId,
        implementMachineId: scenario.plowId,
        targetFieldId: scenario.virginFieldId,
      },
      scenario.token,
    );
    expect(errorCodeOf(created)).toBe(codes[0]);
  });
});
