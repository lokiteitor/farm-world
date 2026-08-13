// Hiring, dismissal and the refresh of the pool, over the real HTTP surface.
//
// Owner: workflow W5-B. Tests of the module `workers`.
//
// The four refusals GDD sections 102, 108 and 109 name are the spine of this file, and each
// is asserted against the code the client switches on rather than against a status alone:
// hiring with no home slot, hiring with no money, hiring a candidate who has already left the
// pool, and dismissing a worker in the middle of a task. `make smoke` of plan section 10 lists
// two of them as its deliberate negative assertions, and this is where they are proved
// against the database that enforces them.
//
// The three defences of "no se puede despedir a mitad de tarea" are exercised separately,
// because they fail differently and only one of them is visible to a player: the check of the
// service, the `CHECK` on the row, and the trigger `workers_termination_guard`, which reads
// the tasks instead of the reservation column so the rule survives a caller that cleared
// `currentTaskId` first.
//
// The pool is asserted against the procedural rule and not against literals. The generator is
// deterministic, so the candidates could be pinned by value, but pinning them would make the
// suite fail whenever a coefficient of `shared/config/workers.ts` is retuned, which is the
// opposite of what a balance constant is for.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advancePlayerNow, type AdvanceResult } from '../../lib/advancePlayer.js';
import { fittedSalary } from '../../modules/workers/pool.js';
import {
  POOL_REFRESH_INTERVAL_GAME_MS,
  canOperateFarmMachinery,
  loadPlayerWorkers,
  requireWorkerOfFarm,
} from '../../modules/workers/service.js';
import {
  MachineRole,
  Money,
  POOL_SIZE,
  POOL_SKILL_MAX_BP,
  POOL_SKILL_MIN_BP,
  SALARY_FLOOR,
  SALARY_NOISE_BP,
  ScheduledEventKind,
  ScheduledEventStatus,
  TaskOperation,
  TaskStatus,
  ValidationCode,
  WorkerStatus,
  isApiError,
  skillFactor,
  type Bp,
  type PlayerId,
  type WorkerCandidateDto,
  type WorkerDto,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';

let harness: Harness;
let playerId: PlayerId;
let accessToken: string;
/** Farm with a home of two slots, which is the farm everything is hired into. */
let farmId: string;
let homeId: string;
/** Farm with a garage and no home: the one that refuses a hire and owns foreign machinery. */
let otherFarmId: string;
let otherGarageId: string;

beforeAll(async () => {
  harness = await createHarness();
  const player = await registerViaHttp(harness, 'hiring');
  playerId = player.playerId;
  accessToken = player.accessToken;

  const created = await createFarm('Granja con vivienda', { workerSlots: 2 });
  farmId = created.farmId;
  homeId = created.homeId ?? '';

  const other = await createFarm('Granja sin vivienda', { garage: true });
  otherFarmId = other.farmId;
  otherGarageId = other.garageId ?? '';
});

afterAll(async () => {
  await harness.prisma.taskMachine.deleteMany({ where: { task: { playerId } } });
  await harness.prisma.task.deleteMany({ where: { playerId } });
  await harness.prisma.machine.deleteMany({ where: { playerId } });
  await harness.prisma.worker.deleteMany({ where: { playerId } });
  await harness.prisma.workerCandidate.deleteMany({ where: { playerId } });
  await harness.prisma.building.deleteMany({ where: { playerId } });
  await harness.prisma.farm.deleteMany({ where: { playerId } });
  await harness.teardown();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A farm with the buildings a case needs, written straight into the database.
 *
 * Not through `POST /api/farms/:id/buildings`, on purpose: that route needs buildable terrain
 * and money, and neither is the subject here. What matters is that the counters and the
 * `CHECK` of `buildings` are the real ones, which they are, because the rows are real.
 */
async function createFarm(
  name: string,
  options: { readonly workerSlots?: number; readonly garage?: boolean },
  owner: PlayerId = playerId,
): Promise<{ farmId: string; homeId: string | null; garageId: string | null }> {
  const atGameMs = harness.gameNow();
  const farm = await harness.prisma.farm.create({
    data: { playerId: owner, name, createdAtGameMs: atGameMs },
    select: { id: true },
  });
  let home: string | null = null;
  let garage: string | null = null;
  if (options.workerSlots !== undefined) {
    const row = await harness.prisma.building.create({
      data: {
        farmId: farm.id,
        playerId: owner,
        type: 'WORKER_HOME',
        originCellX: 0,
        originCellY: 0,
        widthCells: 4,
        heightCells: 4,
        purchasePrice: '0',
        capacityMachines: 0,
        capacityWorkers: options.workerSlots,
        capacityStorageUnits: 0,
        storageResource: null,
        builtAtGameMs: atGameMs,
      },
      select: { id: true },
    });
    home = row.id;
  }
  if (options.garage === true) {
    const row = await harness.prisma.building.create({
      data: {
        farmId: farm.id,
        playerId: owner,
        type: 'GARAGE',
        originCellX: 8,
        originCellY: 0,
        widthCells: 6,
        heightCells: 4,
        purchasePrice: '0',
        capacityMachines: 4,
        capacityWorkers: 0,
        capacityStorageUnits: 0,
        storageResource: null,
        builtAtGameMs: atGameMs,
      },
      select: { id: true },
    });
    garage = row.id;
  }
  return { farmId: farm.id, homeId: home, garageId: garage };
}

async function getPool(token: string = accessToken): Promise<{
  candidates: WorkerCandidateDto[];
  nextRefreshAtGameMs: string | null;
}> {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/workers/pool',
    headers: bearer(token),
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function hire(candidateId: string, targetFarmId: string, token: string = accessToken) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/workers/hire',
    headers: bearer(token),
    payload: { candidateId, farmId: targetFarmId },
  });
}

function codeOf(response: { json: <T>() => T }): string {
  return response.json<{ error: { code: string } }>().error.code;
}

/**
 * Moves the injected clock and renews the session.
 *
 * The access token lives fifteen minutes of real time and the verifier reads the injected
 * clock, so advancing whole game hours expires it. Logging in again is what the client would
 * do with its refresh cookie, and it keeps the session out of the way of the assertion.
 */
async function advanceAndReauthenticate(gameHours: number): Promise<AdvanceResult> {
  harness.advanceGameHours(gameHours);
  // The advance is driven here rather than left to the login, so that what the point of
  // advance reports about this module can be asserted directly.
  const advanced = await advancePlayerNow(harness.services, playerId);
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: harness.email('hiring'), password: 'contrasena-de-prueba' },
  });
  expect(response.statusCode, response.body).toBe(200);
  accessToken = response.json<{ accessToken: string }>().accessToken;
  return advanced;
}

/** Pool refresh events already applied, which is what counts a catch-up. */
async function processedRefreshes(): Promise<number> {
  return harness.prisma.scheduledEvent.count({
    where: {
      playerId,
      kind: ScheduledEventKind.WORKER_POOL_REFRESH,
      status: ScheduledEventStatus.PROCESSED,
    },
  });
}

/** The message of a rejected promise, so a database refusal can be named in an assertion. */
async function refusalMessage(body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('La escritura no fue rechazada');
}

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

describe('GET /api/workers/pool', () => {
  it('lista el primer pool del jugador y agenda su refresco', async () => {
    const before = await harness.prisma.workerCandidate.count({ where: { playerId } });
    expect(before).toBe(0);

    const pool = await getPool();
    expect(pool.candidates).toHaveLength(POOL_SIZE);
    // The refresh is 48 game hours away, which is the value `shared/config/workers.ts` fixes
    // for the `poolRefreshInterval` GDD section 102 names without quantifying.
    expect(BigInt(pool.nextRefreshAtGameMs ?? '0') - harness.gameNow()).toBe(
      POOL_REFRESH_INTERVAL_GAME_MS,
    );

    const scheduled = await harness.prisma.scheduledEvent.count({
      where: {
        playerId,
        kind: ScheduledEventKind.WORKER_POOL_REFRESH,
        status: ScheduledEventStatus.PENDING,
      },
    });
    expect(scheduled).toBe(1);
  });

  it('no vuelve a listar en la segunda llamada', async () => {
    const first = await getPool();
    const second = await getPool();
    expect(second.candidates.map((candidate) => candidate.id)).toEqual(
      first.candidates.map((candidate) => candidate.id),
    );
    expect(await harness.prisma.workerCandidate.count({ where: { playerId } })).toBe(POOL_SIZE);
  });

  it('cada candidato cae dentro de la banda de habilidad y de salario de GDD 102', async () => {
    const pool = await getPool();
    const halfWidth = SALARY_NOISE_BP / 10_000;
    for (const candidate of pool.candidates) {
      expect(candidate.skillBp).toBeGreaterThanOrEqual(POOL_SKILL_MIN_BP);
      expect(candidate.skillBp).toBeLessThanOrEqual(POOL_SKILL_MAX_BP);
      // The correlation with noise, asserted on what the server actually wrote and not on
      // the generator: this is the row a hire will copy the salary from.
      const fitted = Number(fittedSalary(candidate.skillBp as Bp));
      const floor = Number(SALARY_FLOOR);
      const asked = Number(candidate.askingSalaryPerGameHour);
      expect(asked).toBeGreaterThanOrEqual(Math.max(floor, fitted * (1 - halfWidth)) - 0.001);
      expect(asked).toBeLessThanOrEqual(Math.max(floor, fitted * (1 + halfWidth)) + 0.001);
      // `skillFactor` travels derived, with the floor of 0.5 of GDD section 103.
      expect(candidate.skillFactor).toBeCloseTo(skillFactor(candidate.skillBp as Bp), 12);
      expect(candidate.skillFactor).toBeGreaterThanOrEqual(0.5);
    }
  });
});

// ---------------------------------------------------------------------------
// Hiring
// ---------------------------------------------------------------------------

describe('POST /api/workers/hire', () => {
  it('contrata al candidato, lo deja IDLE y lo retira del pool', async () => {
    const pool = await getPool();
    const candidate = pool.candidates[0];
    expect(candidate).toBeDefined();

    const response = await hire(candidate?.id ?? '', farmId);
    expect(response.statusCode).toBe(200);
    const result = response.json<{
      seq: number;
      result: {
        worker: WorkerDto;
        pool: { candidates: WorkerCandidateDto[] };
        homeSlotsUsed: number;
        homeSlotsTotal: number;
      };
    }>();

    // The route is `sequenced`, so it ran inside `withPlayerAdvanced` and carries a sequence.
    expect(result.seq).toBeGreaterThan(0);
    const worker = result.result.worker;
    expect(worker.status).toBe(WorkerStatus.IDLE);
    expect(worker.currentTaskId).toBeNull();
    expect(worker.completedTaskCount).toBe(0);
    expect(worker.farmId).toBe(farmId);
    expect(worker.homeId).toBe(homeId);
    // No negotiation (GDD section 102): the asking salary is the salary.
    expect(worker.salaryPerGameHour).toBe(candidate?.askingSalaryPerGameHour);
    expect(worker.skillBp).toBe(candidate?.skillBp);
    // The instant of hiring opens the validity interval the wage accrual integrates over.
    expect(BigInt(worker.hiredGameMs)).toBe(harness.gameNow());

    // The candidate is gone and no replacement appeared: one arrives at the next refresh.
    expect(result.result.pool.candidates).toHaveLength(POOL_SIZE - 1);
    expect(result.result.pool.candidates.some((entry) => entry.id === candidate?.id)).toBe(false);
    expect(result.result.homeSlotsUsed).toBe(1);
    expect(result.result.homeSlotsTotal).toBe(2);

    // The counter of the home is the trigger's, not the application's.
    const home = await harness.prisma.building.findUniqueOrThrow({
      where: { id: homeId },
      select: { workerCount: true },
    });
    expect(home.workerCount).toBe(1);
  });

  it('rechaza contratar dos veces al mismo candidato', async () => {
    const hiredIds = (
      await harness.prisma.workerCandidate.findMany({
        where: { playerId, removedGameMs: { not: null } },
        select: { id: true },
      })
    ).map((row) => row.id);
    expect(hiredIds.length).toBeGreaterThan(0);

    const response = await hire(hiredIds[0] ?? '', farmId);
    expect(response.statusCode).toBe(409);
    expect(codeOf(response)).toBe(ValidationCode.CANDIDATE_NOT_AVAILABLE);
  });

  it('rechaza contratar en una granja sin plaza de vivienda (GDD 108)', async () => {
    const pool = await getPool();
    const response = await hire(pool.candidates[0]?.id ?? '', otherFarmId);
    expect(response.statusCode).toBe(409);
    expect(codeOf(response)).toBe(ValidationCode.HOME_CAPACITY_EXCEEDED);
    const details = response.json<{ error: { details: { occupancy: number; capacity: number } } }>()
      .error.details;
    expect(details).toEqual({ occupancy: 0, capacity: 0 });

    // Nothing was written: the candidate is still listed and no worker exists on that farm.
    const stillListed = await getPool();
    expect(stillListed.candidates.map((entry) => entry.id)).toEqual(
      pool.candidates.map((entry) => entry.id),
    );
    expect(await harness.prisma.worker.count({ where: { farmId: otherFarmId } })).toBe(0);
  });

  it('rechaza contratar cuando la vivienda esta llena (GDD 108)', async () => {
    // The home has two slots and one is taken, so the second hire fits and the third does not.
    const pool = await getPool();
    const second = await hire(pool.candidates[0]?.id ?? '', farmId);
    expect(second.statusCode).toBe(200);

    const remaining = await getPool();
    expect(remaining.candidates).toHaveLength(POOL_SIZE - 2);
    const third = await hire(remaining.candidates[0]?.id ?? '', farmId);
    expect(third.statusCode).toBe(409);
    expect(codeOf(third)).toBe(ValidationCode.HOME_CAPACITY_EXCEEDED);
    expect(
      third.json<{ error: { details: { occupancy: number; capacity: number } } }>().error.details,
    ).toEqual({ occupancy: 2, capacity: 2 });

    // The refused hire left the candidate listed, which is what makes the refusal actionable.
    const after = await getPool();
    expect(after.candidates).toHaveLength(POOL_SIZE - 2);
  });
});

describe('POST /api/workers/hire sin dinero (GDD 102)', () => {
  it('rechaza contratar con el saldo liquidado en negativo', async () => {
    const broke = await registerViaHttp(harness, 'broke');
    const farm = await createFarm('Granja arruinada', { workerSlots: 4 }, broke.playerId);
    const pool = await getPool(broke.accessToken);
    expect(pool.candidates).toHaveLength(POOL_SIZE);

    const player = await harness.prisma.player.findUniqueOrThrow({
      where: { id: broke.playerId },
      select: { balance: true },
    });
    const debit = Money.add(Money.fromString(player.balance.toFixed(4)), Money.fromUnits(1));
    const granted = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/grant',
      headers: { ...bearer(broke.accessToken), 'idempotency-key': randomUUID() },
      payload: { amount: Money.toString(Money.negate(debit)), reason: 'prueba de contratacion' },
    });
    expect(granted.statusCode).toBe(200);

    const response = await hire(pool.candidates[0]?.id ?? '', farm.farmId, broke.accessToken);
    // Committing to a salary is discretionary spending, which a negative settled balance
    // blocks (GDD section 102 "validar dinero", plan section 6.6). 402 and not 409: the
    // player is not breaking a rule of the game, he cannot pay.
    expect(response.statusCode).toBe(402);
    expect(codeOf(response)).toBe(ValidationCode.SPENDING_BLOCKED_IN_DEBT);
    expect(await harness.prisma.worker.count({ where: { playerId: broke.playerId } })).toBe(0);

    await harness.prisma.workerCandidate.deleteMany({ where: { playerId: broke.playerId } });
    await harness.prisma.building.deleteMany({ where: { playerId: broke.playerId } });
    await harness.prisma.farm.deleteMany({ where: { playerId: broke.playerId } });
  });
});

// ---------------------------------------------------------------------------
// Dismissal
// ---------------------------------------------------------------------------

describe('POST /api/workers/:workerId/fire (GDD 109)', () => {
  it('rechaza despedir a un trabajador con una tarea en curso', async () => {
    const workers = await loadPlayerWorkers(harness.prisma, playerId);
    const busy = workers[0];
    expect(busy).toBeDefined();
    const workerId = busy?.id ?? '';

    const task = await harness.prisma.task.create({
      data: {
        playerId,
        workerId,
        operation: TaskOperation.PLOW,
        status: TaskStatus.IN_PROGRESS,
        unitsAtStart: 250,
        effectiveWorkSpeedMilli: 3_500,
        startGameMs: harness.gameNow(),
        scheduledEndGameMs: harness.gameNow() + 72n * 3_600_000n,
      },
      select: { id: true },
    });
    await harness.prisma.worker.update({
      where: { id: workerId },
      data: { status: WorkerStatus.WORKING, currentTaskId: task.id },
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/workers/${workerId}/fire`,
      headers: bearer(accessToken),
    });
    expect(response.statusCode).toBe(409);
    expect(codeOf(response)).toBe(ValidationCode.WORKER_NOT_IDLE);

    // Second defence: the trigger `workers_termination_guard`, which is a `BEFORE UPDATE` and
    // therefore speaks before the `CHECK` does. It reads the tasks and not the reservation
    // column, so clearing `currentTaskId` first — which is exactly the shortcut a dismissal
    // path is tempted to take — does not get past it either.
    const byTrigger = await refusalMessage(() =>
      harness.prisma.worker.update({
        where: { id: workerId },
        data: { terminatedGameMs: harness.gameNow() },
      }),
    );
    expect(byTrigger).toContain('GDD section 109');

    await harness.prisma.worker.update({
      where: { id: workerId },
      data: { status: WorkerStatus.IDLE, currentTaskId: null },
    });
    const withoutReservation = await refusalMessage(() =>
      harness.prisma.worker.update({
        where: { id: workerId },
        data: { terminatedGameMs: harness.gameNow() },
      }),
    );
    expect(withoutReservation).toContain('GDD section 109');

    // Third defence: with the task closed the trigger is satisfied, and the `CHECK` on the
    // row is what refuses a termination that still holds a reservation. It is the layer that
    // survives a future path which closed the task but forgot to release the worker.
    await harness.prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.COMPLETED, endedGameMs: harness.gameNow() },
    });
    await harness.prisma.worker.update({
      where: { id: workerId },
      data: { status: WorkerStatus.WORKING, currentTaskId: task.id },
    });
    const byCheck = await refusalMessage(() =>
      harness.prisma.worker.update({
        where: { id: workerId },
        data: { terminatedGameMs: harness.gameNow() },
      }),
    );
    expect(byCheck).toContain('workers_life_check');

    // Back to a task in progress being visible where the service looks for it, which is the
    // state the farm guard below needs.
    await harness.prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.IN_PROGRESS, endedGameMs: null },
    });
    const stillRefused = await harness.app.inject({
      method: 'POST',
      url: `/api/workers/${workerId}/fire`,
      headers: bearer(accessToken),
    });
    expect(stillRefused.statusCode).toBe(409);
  });

  it('despide a un trabajador ocioso, libera la plaza y conserva la fila', async () => {
    const workers = await loadPlayerWorkers(harness.prisma, playerId);
    const idle = workers.find((worker) => worker.status === WorkerStatus.IDLE);
    expect(idle).toBeDefined();
    const workerId = idle?.id ?? '';

    const before = await harness.app.inject({
      method: 'GET',
      url: '/api/workers',
      headers: bearer(accessToken),
    });
    const payrollBefore = before.json<{ totalSalaryPerGameHour: string; homeSlotsUsed: number }>();

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/workers/${workerId}/fire`,
      headers: bearer(accessToken),
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<{
      result: { workerId: string; homeSlotsUsed: number; totalSalaryPerGameHour: string };
    }>().result;

    expect(result.workerId).toBe(workerId);
    expect(result.homeSlotsUsed).toBe(payrollBefore.homeSlotsUsed - 1);
    expect(result.totalSalaryPerGameHour).toBe(
      Money.sub(
        Money.fromString(payrollBefore.totalSalaryPerGameHour),
        idle?.salaryPerGameHour ?? Money.ZERO,
      ),
    );

    // The row survives with the interval closed, which is what keeps the wages of every past
    // window recomputable and the ledger pointing at something (plan section 5.3).
    const row = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: workerId },
      select: { terminatedGameMs: true, hiredGameMs: true },
    });
    expect(row.terminatedGameMs).not.toBeNull();
    expect(row.terminatedGameMs).toBe(harness.gameNow());
    expect(row.terminatedGameMs ?? 0n).toBeGreaterThanOrEqual(row.hiredGameMs);

    // The slot came back through the trigger, not through a write of the module.
    const home = await harness.prisma.building.findUniqueOrThrow({
      where: { id: homeId },
      select: { workerCount: true },
    });
    expect(home.workerCount).toBe(result.homeSlotsUsed);

    // And he is gone from the payroll, which lists live workers only.
    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/workers',
      headers: bearer(accessToken),
    });
    expect(
      after.json<{ workers: WorkerDto[] }>().workers.some((worker) => worker.id === workerId),
    ).toBe(false);
  });

  it('rechaza despedir dos veces al mismo trabajador', async () => {
    const terminated = await harness.prisma.worker.findFirstOrThrow({
      where: { playerId, terminatedGameMs: { not: null } },
      select: { id: true },
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/workers/${terminated.id}/fire`,
      headers: bearer(accessToken),
    });
    expect(response.statusCode).toBe(404);
    expect(codeOf(response)).toBe(ValidationCode.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// The farm a worker belongs to (GDD section 108)
// ---------------------------------------------------------------------------

describe('un trabajador pertenece a la granja de su vivienda (GDD 108)', () => {
  it('la comprobacion expuesta rechaza operar maquinaria de otra granja', async () => {
    const workers = await loadPlayerWorkers(harness.prisma, playerId);
    const worker = workers[0];
    expect(worker).toBeDefined();
    if (worker === undefined) {
      return;
    }

    expect(canOperateFarmMachinery(worker, farmId)).toBe(true);
    expect(canOperateFarmMachinery(worker, otherFarmId)).toBe(false);
    expect(() => {
      requireWorkerOfFarm(worker, farmId);
    }).not.toThrow();
    try {
      requireWorkerOfFarm(worker, otherFarmId);
      throw new Error('La comprobacion no rechazo la granja ajena');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      expect(isApiError(error) ? error.code : '').toBe(ValidationCode.WORKER_WRONG_FARM);
    }
  });

  it('el disparador de la base de datos refuerza la misma regla', async () => {
    const worker = (await loadPlayerWorkers(harness.prisma, playerId))[0];
    expect(worker).toBeDefined();
    if (worker === undefined) {
      return;
    }

    const foreign = await harness.prisma.machine.create({
      data: {
        playerId,
        farmId: otherFarmId,
        garageId: otherGarageId,
        type: 'TRACTOR',
        conditionUpdatedAtGameMs: harness.gameNow(),
        purchasePrice: '0',
        acquiredGameMs: harness.gameNow(),
      },
      select: { id: true },
    });
    const task = await harness.prisma.task.findFirstOrThrow({
      where: { playerId, workerId: worker.id, status: TaskStatus.IN_PROGRESS },
      select: { id: true },
    });

    // `task_machines_farm_guard`: the task is the single authoritative link between a worker
    // and a machine, so if it can be written wrong the whole cost attribution of a farm can
    // be written wrong (plan section 5.2).
    const refused = await refusalMessage(() =>
      harness.prisma.taskMachine.create({
        data: { taskId: task.id, machineId: foreign.id, role: MachineRole.POWERED },
      }),
    );
    expect(refused).toContain('GDD section 108');
  });
});

// ---------------------------------------------------------------------------
// The refresh
// ---------------------------------------------------------------------------

describe('el refresco del pool (GDD 102)', () => {
  it('renueva el pool al vencer el evento y no devuelve al candidato contratado', async () => {
    const before = await getPool();
    const dueAt = BigInt(before.nextRefreshAtGameMs ?? '0');
    const hiredCandidateIds = (
      await harness.prisma.workerCandidate.findMany({
        where: { playerId, removedGameMs: { not: null } },
        select: { id: true, name: true },
      })
    ).map((row) => row.id);
    expect(hiredCandidateIds.length).toBeGreaterThan(0);

    // Past the boundary, and the event is applied by the point of advance: the queue is a
    // requirement of punctuality and not of correctness, so the request path is enough.
    const advanced = await advanceAndReauthenticate(48);
    expect(harness.gameNow()).toBeGreaterThanOrEqual(dueAt);
    expect(advanced.processedEvents).toBeGreaterThanOrEqual(1);
    // The metric of events with no handler does not count this module any more: the handler
    // is registered for real and is no longer the scaffolding of workflow W3-A
    // (`docs/handoff/NOTES-w3-cierre.md`, section 8).
    expect(advanced.unhandledEvents).toBe(0);

    const after = await getPool();
    expect(after.candidates).toHaveLength(POOL_SIZE);
    const afterIds = new Set(after.candidates.map((candidate) => candidate.id));
    // Neither the hired candidate nor the ones that were merely listed come back: the pool is
    // replaced whole, and a retired row keeps `removedGameMs` so it can never be hired twice.
    for (const id of hiredCandidateIds) {
      expect(afterIds.has(id)).toBe(false);
    }
    for (const candidate of before.candidates) {
      expect(afterIds.has(candidate.id)).toBe(false);
    }

    // The next boundary is one interval past the one that fired, and there is again exactly
    // one pending event, because the handler schedules it on its way out.
    expect(BigInt(after.nextRefreshAtGameMs ?? '0')).toBe(dueAt + POOL_REFRESH_INTERVAL_GAME_MS);
    expect(
      await harness.prisma.scheduledEvent.count({
        where: {
          playerId,
          kind: ScheduledEventKind.WORKER_POOL_REFRESH,
          status: ScheduledEventStatus.PENDING,
        },
      }),
    ).toBe(1);

    // And the event that fired is recorded as processed, not left pending.
    const processed = await harness.prisma.scheduledEvent.count({
      where: {
        playerId,
        kind: ScheduledEventKind.WORKER_POOL_REFRESH,
        status: ScheduledEventStatus.PROCESSED,
      },
    });
    expect(processed).toBeGreaterThanOrEqual(1);
  });

  it('recupera de una ausencia larga con un solo refresco y sin dejar el evento atrasado', async () => {
    const before = await getPool();
    const dueAt = BigInt(before.nextRefreshAtGameMs ?? '0');

    // Ten intervals away, which is what a player who was gone for three weeks of game time
    // looks like. The pool carries no history, so the boundaries in between are skipped
    // rather than replayed one pass of the queue at a time.
    const refreshesBefore = await processedRefreshes();
    const advanced = await advanceAndReauthenticate(48 * 10);
    expect(advanced.unhandledEvents).toBe(0);
    // One refresh and not ten: the boundaries in between are skipped, not replayed. The count
    // is of this kind alone, because the same advance also processes the periodic settlement
    // sweep, which belongs to `lib/jobs.ts` and not to this module.
    expect((await processedRefreshes()) - refreshesBefore).toBe(1);
    const after = await getPool();
    expect(after.candidates).toHaveLength(POOL_SIZE);

    const next = BigInt(after.nextRefreshAtGameMs ?? '0');
    expect(next).toBeGreaterThan(harness.gameNow());
    // The new boundary is still on the original lattice: it is the first multiple of the
    // interval strictly after now, so the schedule never drifts.
    expect((next - dueAt) % POOL_REFRESH_INTERVAL_GAME_MS).toBe(0n);
    expect(next - harness.gameNow()).toBeLessThanOrEqual(POOL_REFRESH_INTERVAL_GAME_MS);

    const listedAt = await harness.prisma.workerCandidate.findFirstOrThrow({
      where: { playerId, removedGameMs: null },
      select: { listedAtGameMs: true },
    });
    expect(listedAt.listedAtGameMs).toBe(next - POOL_REFRESH_INTERVAL_GAME_MS);
  });
});
