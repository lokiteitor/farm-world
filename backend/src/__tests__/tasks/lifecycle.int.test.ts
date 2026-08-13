// The task engine end to end against a real PostgreSQL and a real Redis.
//
// Owner: workflow W6-A. Module `tasks`.
//
// What this file pins down is the loop the whole project exists for: a field is assigned a
// task, the task falls due while nobody is watching, and the world moves. Four properties
// that only a real database can show:
//
//   - The narrative example of GDD section 110, reproduced from the duration to the skill
//     increment, with the arithmetic of the erratum resolved (docs/erratas-gdd-stack.md,
//     item 31: the published "84 h" is the GDD's own miscalculation and the table of GDD
//     section 91 interpolates the condition factor to 0.975, which gives 86.1883 h).
//   - The yield of GDD section 83 deposited in the silo is the yield the pure rule computes
//     over the very same attributes, weeds included, at the instant the task ends.
//   - A silo that cannot hold the harvest fills to capacity and the rest is wasted with an
//     entry, which is how plan section 2.2 resolves GDD sections 83 and 97.
//   - The completion applied twice produces one effect, which is the conditional transition
//     of plan section 6.3 and not a lucky ordering.
//
// Nothing in this file runs a BullMQ worker. That is deliberate and it is the fourth
// property: every completion here is applied by the reconciliation path of
// `advancePlayer`, which is what a player whose worker was down would get, and it has to
// produce the same rows a punctual run would (plan section 6.3).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CropCycleState,
  MACHINE_CATALOGUE,
  MachineStatus,
  MachineType,
  ScheduledEventKind,
  ScheduledEventStatus,
  SoilCondition,
  TaskStatus,
  WHEAT,
  WorkerStatus,
  bp,
  conditionAfterWork,
  estimateTaskDuration,
  finalYieldLiters,
  gameMs as toGameMsValue,
  projectWeedLevel,
  type PlayerId,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import {
  NARRATIVE_FIELD_CELLS,
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

async function get(url: string, token: string): Promise<JsonResponse> {
  const response = await harness.app.inject({ method: 'GET', url, headers: bearer(token) });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

function resultOf(response: JsonResponse): Record<string, unknown> {
  return response.body['result'] as Record<string, unknown>;
}

/**
 * A fresh access token for a player whose session outlived the injected clock.
 *
 * The clock of the harness runs at one game hour per real hour, so a case that advances
 * eighty seven game hours expires an access token minted eighty seven real hours earlier in
 * its own frame. That is correct and not a defect — the session lives in real time — and it
 * is what the machinery suite of workflow W5 already does.
 */
async function login(label: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: harness.email(label), password: 'contrasena-de-prueba' },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Login failed with ${response.statusCode}: ${response.body}`);
  }
  return response.json<Record<string, unknown>>()['accessToken'] as string;
}

interface Scenario {
  readonly label: string;
  readonly playerId: PlayerId;
  readonly token: string;
  readonly farm: TaskFarmFixture;
}

async function scenario(
  label: string,
  band: number,
  siloCapacityLiters: number | null = 60_000,
): Promise<Scenario> {
  const player = await registerViaHttp(harness, label);
  players.push(player.playerId);
  const farm = await createTaskFarm(harness, player.playerId, band, siloCapacityLiters);
  return { label, playerId: player.playerId, token: player.accessToken, farm };
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await cleanUp(harness, players);
  await harness.teardown();
});

// ---------------------------------------------------------------------------
// GDD section 110, end to end
// ---------------------------------------------------------------------------

describe('el ejemplo narrativo de §110', () => {
  it('reproduce la duracion, el cambio de estados y la subida de habilidad', async () => {
    const { label, playerId, token, farm } = await scenario('narrative', 100);
    // "Worker #7 (Skill 70%) IDLE — Tractor #2 IDLE — Plow #1 IDLE — Field #12 VIRGIN".
    // La condicion del arado es del 95 %, que es la que §110 usa; la tabla de §91 la
    // interpola a 0,975 y no a los 0,95 que el ejemplo aplica directamente (erratas 31).
    const workerId = await createWorker(harness, playerId, farm, bp(7000));
    const tractorId = await createMachine(harness, playerId, farm, MachineType.TRACTOR, bp(10_000));
    const plowId = await createMachine(harness, playerId, farm, MachineType.PLOW, bp(9500));
    const fieldId = await createFieldRow(harness, playerId, farm);

    const request = {
      operation: 'PLOW',
      workerId,
      poweredMachineId: tractorId,
      implementMachineId: plowId,
      targetFieldId: fieldId,
    };

    // La prevision usa la misma formula que la creacion, que es lo que impide que el panel
    // habilite un boton que el servidor rechaza (ADR-0048).
    const estimate = await post('/api/tasks/estimate', request, token);
    expect(estimate.statusCode, JSON.stringify(estimate.body)).toBe(200);
    expect(estimate.body['feasible']).toBe(true);
    expect(estimate.body['blockers']).toEqual([]);
    expect(estimate.body['units']).toBe(NARRATIVE_FIELD_CELLS);
    // 4,2 celdas/h x 0,975 x 0,85 = 3,48075 celdas/h.
    expect(estimate.body['effectiveWorkSpeedMilli']).toBe(3481);
    expect(estimate.body['durationGameHours'] as number).toBeCloseTo(86.1883, 4);

    const created = await post('/api/tasks', request, token);
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    const task = resultOf(created)['task'] as Record<string, unknown>;
    expect(task['status']).toBe(TaskStatus.IN_PROGRESS);
    expect(task['machineIds']).toEqual([tractorId, plowId]);
    expect(task['unitsAtStart']).toBe(NARRATIVE_FIELD_CELLS);
    expect(task['effectiveWorkSpeedMilli']).toBe(3481);

    // "Worker #7 -> WORKING / Tractor #2 -> WORKING", y el campo queda reservado.
    const reservedWorker = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: workerId },
      select: { status: true, currentTaskId: true },
    });
    expect(reservedWorker.status).toBe(WorkerStatus.WORKING);
    expect(reservedWorker.currentTaskId).toBe(task['id']);
    const reservedMachines = await harness.prisma.machine.findMany({
      where: { id: { in: [tractorId, plowId] } },
      select: { status: true, currentTaskId: true },
    });
    expect(reservedMachines.map((machine) => machine.status)).toEqual([
      MachineStatus.WORKING,
      MachineStatus.WORKING,
    ]);
    expect(new Set(reservedMachines.map((machine) => machine.currentTaskId))).toEqual(
      new Set([task['id']]),
    );

    // "Evento agendado: CompleteTask @ +84h".
    const scheduled = await harness.prisma.scheduledEvent.findMany({
      where: { playerId, kind: ScheduledEventKind.TASK_COMPLETE, refId: task['id'] as string },
      select: { status: true, dueGameMs: true },
    });
    expect(scheduled).toHaveLength(1);
    expect(String(scheduled[0]?.dueGameMs)).toBe(task['scheduledEndGameMs']);

    // "--- Desconexion, 84h despues el servidor procesa el evento ---". Aqui nadie ejecuta
    // la cola: lo aplica el camino de reconciliacion de la primera peticion.
    harness.advanceGameHours(87);
    const board = await get('/api/tasks', await login(label));
    expect(board.statusCode, JSON.stringify(board.body)).toBe(200);

    // "Field #12 -> PLOWED".
    const field = await harness.prisma.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { cropCycleState: true, soilCondition: true, currentTaskId: true },
    });
    expect(field.cropCycleState).toBe(CropCycleState.PLOWED);
    expect(field.soilCondition).toBe(SoilCondition.PLOWED);
    expect(field.currentTaskId).toBeNull();

    // "Worker #7 -> IDLE (skill 70% -> 71%)".
    const worker = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: workerId },
      select: { status: true, currentTaskId: true, skillBp: true, completedTaskCount: true },
    });
    expect(worker.status).toBe(WorkerStatus.IDLE);
    expect(worker.currentTaskId).toBeNull();
    expect(worker.skillBp).toBe(7100);
    expect(worker.completedTaskCount).toBe(1);

    // "Tractor #2 -> IDLE", con el desgaste de las horas realmente trabajadas (§93).
    const closed = await harness.prisma.task.findUniqueOrThrow({
      where: { id: task['id'] as string },
      select: { status: true, endedGameMs: true, scheduledEndGameMs: true, startGameMs: true },
    });
    expect(closed.status).toBe(TaskStatus.COMPLETED);
    expect(closed.endedGameMs).toBe(closed.scheduledEndGameMs);

    const workedHours = Number((closed.endedGameMs ?? 0n) - closed.startGameMs) / 3_600_000;
    const machines = await harness.prisma.machine.findMany({
      where: { id: { in: [tractorId, plowId] } },
      orderBy: { type: 'asc' },
      select: { id: true, type: true, status: true, currentTaskId: true, conditionBp: true },
    });
    for (const machine of machines) {
      expect(machine.status).toBe(MachineStatus.IDLE);
      expect(machine.currentTaskId).toBeNull();
      const before = machine.id === plowId ? bp(9500) : bp(10_000);
      expect(machine.conditionBp).toBe(
        conditionAfterWork(before, workedHours, MACHINE_CATALOGUE[machine.type]),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The harvest (GDD sections 83 and 97)
// ---------------------------------------------------------------------------

describe('la cosecha', () => {
  it('deposita en el silo el rendimiento que calcula la regla pura', async () => {
    const { label, playerId, token, farm } = await scenario('harvest', 200);
    const workerId = await createWorker(harness, playerId, farm, bp(7000));
    const combineId = await createMachine(
      harness,
      playerId,
      farm,
      MachineType.HARVESTER,
      bp(10_000),
    );
    const trailerId = await createMachine(harness, playerId, farm, MachineType.TRAILER, bp(10_000));
    const fieldId = await createFieldRow(harness, playerId, farm, {
      cropCycleState: CropCycleState.READY_TO_HARVEST,
      cropId: 'WHEAT',
    });

    const request = {
      operation: 'HARVEST',
      workerId,
      poweredMachineId: combineId,
      implementMachineId: trailerId,
      targetFieldId: fieldId,
      destinationFarmId: farm.farmId,
    };

    const estimate = await post('/api/tasks/estimate', request, token);
    expect(estimate.statusCode, JSON.stringify(estimate.body)).toBe(200);
    expect(estimate.body['feasible']).toBe(true);
    // La cosechadora marca el ritmo porque el remolque no tiene velocidad propia (§89).
    const pace = estimateTaskDuration({
      operation: 'HARVEST',
      units: NARRATIVE_FIELD_CELLS,
      conditionBp: bp(10_000),
      skillBp: bp(7000),
    });
    expect(estimate.body['effectiveWorkSpeedMilli']).toBe(pace.effectiveWorkSpeedMilli);
    expect(estimate.body['overflowUnits']).toBe(0);

    const created = await post('/api/tasks', request, token);
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    const task = resultOf(created)['task'] as Record<string, unknown>;
    const startGameMs = toGameMsValue(BigInt(task['startGameMs'] as string));
    const endGameMs = toGameMsValue(BigInt(task['scheduledEndGameMs'] as string));

    // La reserva de capacidad de la asignacion es exactamente lo que se va a depositar
    // (plan 5.4, capa uno).
    const reservedFarm = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: farm.farmId },
      select: { reservedWheatLiters: true, storedWheatLiters: true },
    });
    expect(reservedFarm.reservedWheatLiters).toBe(task['reservedStorageUnits']);
    expect(reservedFarm.storedWheatLiters).toBe(0);

    // La regla pura, recalculada aqui y no copiada de la respuesta: las malezas de §78
    // siguen creciendo mientras la cosechadora trabaja, porque READY_TO_HARVEST es uno de
    // sus estados de crecimiento.
    const weedLevelBp = projectWeedLevel({
      weedLevelBp: bp(0),
      updatedAtGameMs: startGameMs,
      toGameMs: endGameMs,
      cropCycleState: CropCycleState.READY_TO_HARVEST,
      crop: WHEAT,
    });
    const expected = finalYieldLiters({
      cellCount: NARRATIVE_FIELD_CELLS,
      crop: WHEAT,
      fertilityBp: bp(10_000),
      fertilizationBp: bp(0),
      weedLevelBp,
    }).liters;
    expect(estimate.body['expectedProductionUnits']).toBe(expected);

    harness.advanceGameHours(120);
    await get('/api/tasks', await login(label));

    const stored = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: farm.farmId },
      select: { storedWheatLiters: true, reservedWheatLiters: true },
    });
    expect(stored.storedWheatLiters).toBe(expected);
    expect(stored.reservedWheatLiters).toBe(0);

    // El ciclo vuelve a tierra virgen y la fertilidad baja lo que §77 y §82 fijan.
    const field = await harness.prisma.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { cropCycleState: true, cropId: true, fertilityBp: true, weedLevelBp: true },
    });
    expect(field.cropCycleState).toBe(CropCycleState.VIRGIN);
    expect(field.cropId).toBeNull();
    expect(field.fertilityBp).toBe(10_000 - WHEAT.fertilityDrainPerCycleBp);
    // Las malezas no se reinician al cosechar: GDD 78 atribuye esa via unicamente a
    // `CULTIVATE` y GDD 89 recoge el efecto como propio del cultivador (correccion W7 del
    // hallazgo H3 de docs/revision-formulas.md). El nivel que quedo es el que la tarea
    // acumulo, y es el mismo con el que se calculo el rendimiento de esta cosecha.
    expect(field.weedLevelBp).toBe(weedLevelBp);
  });

  it('llena el silo hasta la capacidad y registra el desperdicio', async () => {
    const siloCapacity = 10_000;
    const { label, playerId, token, farm } = await scenario('overflow', 300, siloCapacity);
    const workerId = await createWorker(harness, playerId, farm, bp(7000));
    const combineId = await createMachine(
      harness,
      playerId,
      farm,
      MachineType.HARVESTER,
      bp(10_000),
    );
    const trailerId = await createMachine(harness, playerId, farm, MachineType.TRAILER, bp(10_000));
    const fieldId = await createFieldRow(harness, playerId, farm, {
      cropCycleState: CropCycleState.READY_TO_HARVEST,
      cropId: 'WHEAT',
    });

    const request = {
      operation: 'HARVEST',
      workerId,
      poweredMachineId: combineId,
      implementMachineId: trailerId,
      targetFieldId: fieldId,
      destinationFarmId: farm.farmId,
    };

    // Un silo que no cabe no es un rechazo: §83 y §97 se resuelven como aviso al asignar,
    // llenado hasta capacidad al completar y desperdicio del resto (plan 2.2).
    const estimate = await post('/api/tasks/estimate', request, token);
    expect(estimate.body['feasible']).toBe(true);
    const production = estimate.body['expectedProductionUnits'] as number;
    expect(production).toBeGreaterThan(siloCapacity);
    expect(estimate.body['reservedStorageUnits']).toBe(siloCapacity);
    expect(estimate.body['overflowUnits']).toBe(production - siloCapacity);

    const created = await post('/api/tasks', request, token);
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    const taskId = (resultOf(created)['task'] as Record<string, unknown>)['id'] as string;

    harness.advanceGameHours(120);
    await get('/api/tasks', await login(label));

    const stored = await harness.prisma.farm.findUniqueOrThrow({
      where: { id: farm.farmId },
      select: { storedWheatLiters: true, reservedWheatLiters: true },
    });
    expect(stored.storedWheatLiters).toBe(siloCapacity);
    expect(stored.reservedWheatLiters).toBe(0);

    const waste = await harness.prisma.ledgerEntry.findMany({
      where: { playerId, type: 'HARVEST_WASTE' },
      select: { amount: true, refId: true, meta: true },
    });
    expect(waste).toHaveLength(1);
    expect(waste[0]?.refId).toBe(taskId);
    // El asiento no mueve dinero: existe para que el resumen de regreso pueda explicar la
    // perdida fisica (plan 2.2, §83 y §97).
    expect(Number(waste[0]?.amount)).toBe(0);
    const meta = waste[0]?.meta as Record<string, unknown>;
    expect(meta['acceptedUnits']).toBe(siloCapacity);
    expect(meta['wastedUnits']).toBe(production - siloCapacity);
  });
});

// ---------------------------------------------------------------------------
// Idempotence and the reconciliation path
// ---------------------------------------------------------------------------

describe('el manejador de TASK_COMPLETE', () => {
  it('ejecutado dos veces produce un solo efecto', async () => {
    const { label, playerId, token, farm } = await scenario('idempotent', 400);
    const workerId = await createWorker(harness, playerId, farm, bp(7000));
    const combineId = await createMachine(
      harness,
      playerId,
      farm,
      MachineType.HARVESTER,
      bp(10_000),
    );
    const trailerId = await createMachine(harness, playerId, farm, MachineType.TRAILER, bp(10_000));
    const fieldId = await createFieldRow(harness, playerId, farm, {
      cropCycleState: CropCycleState.READY_TO_HARVEST,
      cropId: 'WHEAT',
    });

    const created = await post(
      '/api/tasks',
      {
        operation: 'HARVEST',
        workerId,
        poweredMachineId: combineId,
        implementMachineId: trailerId,
        targetFieldId: fieldId,
        destinationFarmId: farm.farmId,
      },
      token,
    );
    const taskId = (resultOf(created)['task'] as Record<string, unknown>)['id'] as string;

    harness.advanceGameHours(120);
    await get('/api/tasks', await login(label));

    const after = await snapshot(playerId, fieldId, workerId, farm.farmId);
    expect(after.field.cropCycleState).toBe(CropCycleState.VIRGIN);
    expect(after.worker.skillBp).toBe(7100);
    expect(after.farm.storedWheatLiters).toBeGreaterThan(0);

    // Una segunda entrega del mismo vencimiento. La puerta exterior de `advancePlayer` ya
    // reclamo la fila del evento, asi que devolverla a PENDING es la unica forma de llegar
    // al manejador otra vez, que es exactamente lo que se quiere comprobar: quien decide es
    // la transicion condicional de la tarea y no la del evento.
    const reopened = await harness.prisma.scheduledEvent.updateMany({
      where: { playerId, refId: taskId, kind: ScheduledEventKind.TASK_COMPLETE },
      data: { status: ScheduledEventStatus.PENDING, processedAtGameMs: null },
    });
    expect(reopened.count).toBe(1);

    harness.advanceGameHours(1);
    await get('/api/tasks', await login(label));

    const again = await snapshot(playerId, fieldId, workerId, farm.farmId);
    expect(again.field.cropCycleState).toBe(CropCycleState.VIRGIN);
    expect(again.field.fertilityBp).toBe(after.field.fertilityBp);
    expect(again.worker.skillBp).toBe(after.worker.skillBp);
    expect(again.worker.completedTaskCount).toBe(after.worker.completedTaskCount);
    expect(again.farm.storedWheatLiters).toBe(after.farm.storedWheatLiters);
    expect(again.taskCount).toBe(after.taskCount);
  });

  it('aplica una tarea cuyo vencimiento ya paso, aunque el worker haya estado caido', async () => {
    const { label, playerId, token, farm } = await scenario('reconcile', 500);
    const workerId = await createWorker(harness, playerId, farm, bp(5000));
    const tractorId = await createMachine(harness, playerId, farm, MachineType.TRACTOR, bp(10_000));
    const plowId = await createMachine(harness, playerId, farm, MachineType.PLOW, bp(10_000));
    const fieldId = await createFieldRow(harness, playerId, farm, { cellCount: 40 });

    const created = await post(
      '/api/tasks',
      {
        operation: 'PLOW',
        workerId,
        poweredMachineId: tractorId,
        implementMachineId: plowId,
        targetFieldId: fieldId,
      },
      token,
    );
    const task = resultOf(created)['task'] as Record<string, unknown>;
    const scheduledEnd = task['scheduledEndGameMs'] as string;

    // Muy por encima del vencimiento: el jugador vuelve mucho despues y nadie proceso la
    // cola mientras tanto.
    harness.advanceGameHours(500);
    const detail = await get(`/api/tasks/${task['id'] as string}`, await login(label));
    expect(detail.statusCode, JSON.stringify(detail.body)).toBe(200);

    const closed = await harness.prisma.task.findUniqueOrThrow({
      where: { id: task['id'] as string },
      select: { status: true, endedGameMs: true },
    });
    expect(closed.status).toBe(TaskStatus.COMPLETED);
    // El instante es el del vencimiento y nunca el actual: un trabajo que corrio tarde
    // coloca el cambio donde ocurrio (plan 6.4).
    expect(String(closed.endedGameMs)).toBe(scheduledEnd);

    const field = await harness.prisma.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { cropCycleState: true, stateEnteredAtGameMs: true },
    });
    expect(field.cropCycleState).toBe(CropCycleState.PLOWED);
    expect(String(field.stateEnteredAtGameMs)).toBe(scheduledEnd);

    // El desgaste se contabiliza sobre las horas de la tarea y no sobre las 500 que
    // pasaron: §93 excluye la degradacion por inactividad.
    const plow = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: plowId },
      select: { conditionBp: true },
    });
    const workedHours =
      Number(BigInt(scheduledEnd) - BigInt(task['startGameMs'] as string)) / 3_600_000;
    expect(plow.conditionBp).toBe(
      conditionAfterWork(bp(10_000), workedHours, MACHINE_CATALOGUE[MachineType.PLOW]),
    );
  });
});

/** The rows the idempotence case compares before and after the second delivery. */
async function snapshot(
  playerId: PlayerId,
  fieldId: string,
  workerId: string,
  farmId: string,
): Promise<{
  readonly field: { readonly cropCycleState: CropCycleState; readonly fertilityBp: number };
  readonly worker: { readonly skillBp: number; readonly completedTaskCount: number };
  readonly farm: { readonly storedWheatLiters: number };
  readonly taskCount: number;
}> {
  const field = await harness.prisma.field.findUniqueOrThrow({
    where: { id: fieldId },
    select: { cropCycleState: true, fertilityBp: true },
  });
  const worker = await harness.prisma.worker.findUniqueOrThrow({
    where: { id: workerId },
    select: { skillBp: true, completedTaskCount: true },
  });
  const farm = await harness.prisma.farm.findUniqueOrThrow({
    where: { id: farmId },
    select: { storedWheatLiters: true },
  });
  const taskCount = await harness.prisma.task.count({ where: { playerId } });
  return { field, worker, farm, taskCount };
}
