// The interruption of a task (GDD section 106), against a real PostgreSQL and a real Redis.
//
// Owner: workflow W6-A. Module `tasks`.
//
// GDD section 106 states three things and leaves two open, and plan section 2.2 resolves the
// two. All five are asserted here:
//
//   - The field stays in the state it was in before and the partial progress is lost.
//   - The worker and the machines go back to idle, and the worker gains no skill: the task
//     was not completed.
//   - The scheduled work is retired, so no orphan alarm clock survives to complete a task
//     that no longer exists.
//   - Nothing already accrued is refunded (plan section 2.2). What the cancellation does is
//     stop the operating cost of GDD section 94, by closing the interval the accrual of plan
//     section 6.2 integrates over.
//   - The wear is prorated over the hours actually worked, which is the same call the
//     completion makes with a different instant (ADR-0040).
//
// The last case is the `CANCEL_TASKS` step of the forced liquidation of plan section 6.6,
// which `modules/economy` declares and leaves without a strategy because its semantics are
// exactly the four points above (`docs/handoff/NOTES-w5c.md`, item 2.4).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withPlayerAdvanced } from '../../lib/advancePlayer.js';
import { cancelTasksForLiquidation } from '../../modules/tasks/index.js';
import {
  CropCycleState,
  LedgerType,
  MACHINE_CATALOGUE,
  MachineStatus,
  MachineType,
  Money,
  ScheduledEventKind,
  ScheduledEventStatus,
  TaskStatus,
  ValidationCode,
  WorkerStatus,
  bp,
  conditionAfterWork,
  gameHours,
  type PlayerId,
} from '../../shared/index.js';
import { bearer, createHarness, readStock, registerViaHttp, type Harness } from '../harness.js';
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

/** Skill of every worker of this file, so the duration is long enough to interrupt. */
const SKILL_BP = bp(6000);

/** Wage of every worker of this file, so the accrual figures are round. */
const SALARY = Money.fromUnits(20);

interface JsonResponse {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}

async function post(url: string, payload: unknown, token: string): Promise<JsonResponse> {
  const response = await harness.app.inject({
    method: 'POST',
    url,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as never }),
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

function resultOf(response: JsonResponse): Record<string, unknown> {
  return response.body['result'] as Record<string, unknown>;
}

function errorCodeOf(response: JsonResponse): string {
  return (response.body['error'] as Record<string, unknown>)['code'] as string;
}

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

interface Scene {
  readonly label: string;
  readonly playerId: PlayerId;
  readonly token: string;
  readonly farm: TaskFarmFixture;
}

async function scene(label: string, band: number): Promise<Scene> {
  const player = await registerViaHttp(harness, label);
  players.push(player.playerId);
  const farm = await createTaskFarm(harness, player.playerId, band);
  return { label, playerId: player.playerId, token: player.accessToken, farm };
}

/** The sum of the ledger entries of one kind, as a decimal string. */
async function ledgerTotal(playerId: PlayerId, type: LedgerType): Promise<Money> {
  const rows = await harness.prisma.ledgerEntry.findMany({
    where: { playerId, type },
    select: { amount: true },
  });
  return Money.sum(rows.map((row) => Money.fromString(String(row.amount))));
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await cleanUp(harness, players);
  await harness.teardown();
});

// ---------------------------------------------------------------------------
// The all or nothing of GDD section 106
// ---------------------------------------------------------------------------

describe('POST /api/tasks/:taskId/cancel', () => {
  it('devuelve el campo al estado anterior y no deja trabajo agendado huerfano', async () => {
    const { label, playerId, token, farm } = await scene('cancelacion', 5000);
    const workerId = await createWorker(harness, playerId, farm, SKILL_BP, SALARY);
    const tractorId = await createMachine(harness, playerId, farm, MachineType.TRACTOR, bp(10_000));
    const plowId = await createMachine(harness, playerId, farm, MachineType.PLOW, bp(10_000));
    const fieldId = await createFieldRow(harness, playerId, farm);

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
    expect(created.statusCode, JSON.stringify(created.body)).toBe(200);
    const task = resultOf(created)['task'] as Record<string, unknown>;
    const taskId = task['id'] as string;
    const startGameMs = BigInt(task['startGameMs'] as string);

    // Diez horas de juego de las ochenta y nueve que la tarea iba a durar.
    const workedGameHours = 10;
    harness.advanceGameHours(workedGameHours);
    const fresh = await login(label);

    const cancelled = await post(`/api/tasks/${taskId}/cancel`, undefined, fresh);
    expect(cancelled.statusCode, JSON.stringify(cancelled.body)).toBe(200);
    const result = resultOf(cancelled);
    expect((result['task'] as Record<string, unknown>)['status']).toBe(TaskStatus.CANCELED);
    expect(result['releasedStorageUnits']).toBeNull();

    // El campo permanece en el estado ANTERIOR y se pierde el progreso parcial.
    const field = await harness.prisma.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { cropCycleState: true, currentTaskId: true },
    });
    expect(field.cropCycleState).toBe(CropCycleState.VIRGIN);
    expect(field.currentTaskId).toBeNull();

    // Trabajador y maquinas vuelven a ocioso, y la habilidad no sube.
    const worker = await harness.prisma.worker.findUniqueOrThrow({
      where: { id: workerId },
      select: { status: true, currentTaskId: true, skillBp: true, completedTaskCount: true },
    });
    expect(worker.status).toBe(WorkerStatus.IDLE);
    expect(worker.currentTaskId).toBeNull();
    expect(worker.skillBp).toBe(SKILL_BP);
    expect(worker.completedTaskCount).toBe(0);

    // El desgaste se aplica prorrateado sobre las horas realmente trabajadas.
    const closed = await harness.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { endedGameMs: true, scheduledEndGameMs: true },
    });
    const endedGameMs = closed.endedGameMs ?? 0n;
    expect(endedGameMs).toBeLessThan(closed.scheduledEndGameMs);
    expect(Number(endedGameMs - startGameMs) / 3_600_000).toBeCloseTo(workedGameHours, 6);

    const machines = await harness.prisma.machine.findMany({
      where: { id: { in: [tractorId, plowId] } },
      select: { id: true, type: true, status: true, currentTaskId: true, conditionBp: true },
    });
    for (const machine of machines) {
      expect(machine.status).toBe(MachineStatus.IDLE);
      expect(machine.currentTaskId).toBeNull();
      expect(machine.conditionBp).toBe(
        conditionAfterWork(bp(10_000), workedGameHours, MACHINE_CATALOGUE[machine.type]),
      );
      // Y no el desgaste de la tarea entera, que es lo que un cierre sin prorrateo daria.
      expect(machine.conditionBp).toBeGreaterThan(
        conditionAfterWork(bp(10_000), 89, MACHINE_CATALOGUE[machine.type]),
      );
    }

    // No queda ningun trabajo agendado para la tarea: ni pendiente, ni encolado.
    const pending = await harness.prisma.scheduledEvent.findMany({
      where: {
        playerId,
        kind: ScheduledEventKind.TASK_COMPLETE,
        refId: taskId,
      },
      select: { status: true },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe(ScheduledEventStatus.CANCELED);
    expect(
      await harness.prisma.scheduledEvent.count({
        where: { playerId, refId: taskId, status: ScheduledEventStatus.PENDING },
      }),
    ).toBe(0);

    // El coste de operacion ya devengado NO se reembolsa: diez horas de tractor a 22 $/h.
    // El importe del asiento va firmado, y un cargo es negativo (ADR-0009).
    const operating = await ledgerTotal(playerId, LedgerType.MACHINE_OPERATING);
    expect(Money.toString(operating)).toBe(
      Money.toString(
        Money.negate(
          Money.mulHours(
            MACHINE_CATALOGUE[MachineType.TRACTOR].operatingCostPerGameHour,
            gameHours(workedGameHours),
          ),
        ),
      ),
    );
    // Y no hay ninguna compensacion que lo devuelva.
    expect(
      await harness.prisma.ledgerEntry.count({
        where: { playerId, type: LedgerType.COMPENSATION },
      }),
    ).toBe(0);

    // Una segunda cancelacion es un conflicto y no un segundo efecto.
    const again = await post(`/api/tasks/${taskId}/cancel`, undefined, fresh);
    expect(again.statusCode).toBe(409);
    expect(errorCodeOf(again)).toBe(ValidationCode.TASK_ALREADY_FINISHED);
  });

  it('devuelve la capacidad de silo que la cosecha habia reservado', async () => {
    const { label, playerId, token, farm } = await scene('cancelacion-silo', 5100);
    const workerId = await createWorker(harness, playerId, farm, SKILL_BP, SALARY);
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
    const task = resultOf(created)['task'] as Record<string, unknown>;
    const reserved = task['reservedStorageUnits'] as number;
    expect(reserved).toBeGreaterThan(0);

    const committed = await readStock(harness, farm.farmId, 'WHEAT');
    expect(committed.reservedUnits).toBe(reserved);

    harness.advanceGameHours(5);
    const cancelled = await post(
      `/api/tasks/${task['id'] as string}/cancel`,
      undefined,
      await login(label),
    );
    expect(cancelled.statusCode, JSON.stringify(cancelled.body)).toBe(200);
    expect(resultOf(cancelled)['releasedStorageUnits']).toBe(reserved);

    const released = await readStock(harness, farm.farmId, 'WHEAT');
    expect(released.reservedUnits).toBe(0);
    // Y el silo sigue vacio: una tarea cancelada no produce nada (§106).
    expect(released.storedUnits).toBe(0);

    // El campo sigue listo para cosechar, de modo que el jugador puede volver a asignarla.
    const field = await harness.prisma.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { cropCycleState: true, currentTaskId: true },
    });
    expect(field.cropCycleState).toBe(CropCycleState.READY_TO_HARVEST);
    expect(field.currentTaskId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The `CANCEL_TASKS` step of the forced liquidation (plan section 6.6)
// ---------------------------------------------------------------------------

describe('la estrategia CANCEL_TASKS de la liquidacion forzosa', () => {
  it('cancela todas las tareas en curso y devuelve trabajador y maquinaria', async () => {
    const { playerId, token, farm } = await scene('liquidacion', 6000);
    const firstWorker = await createWorker(harness, playerId, farm, SKILL_BP, SALARY);
    const secondWorker = await createWorker(harness, playerId, farm, SKILL_BP, SALARY);
    const tractorId = await createMachine(harness, playerId, farm, MachineType.TRACTOR, bp(10_000));
    const plowId = await createMachine(harness, playerId, farm, MachineType.PLOW, bp(10_000));
    const combineId = await createMachine(
      harness,
      playerId,
      farm,
      MachineType.HARVESTER,
      bp(10_000),
    );
    const trailerId = await createMachine(harness, playerId, farm, MachineType.TRAILER, bp(10_000));
    const virginFieldId = await createFieldRow(harness, playerId, farm);
    const readyFieldId = await createFieldRow(harness, playerId, farm, {
      cropCycleState: CropCycleState.READY_TO_HARVEST,
      cropId: 'WHEAT',
    });

    const plowing = await post(
      '/api/tasks',
      {
        operation: 'PLOW',
        workerId: firstWorker,
        poweredMachineId: tractorId,
        implementMachineId: plowId,
        targetFieldId: virginFieldId,
      },
      token,
    );
    expect(plowing.statusCode, JSON.stringify(plowing.body)).toBe(200);
    const harvesting = await post(
      '/api/tasks',
      {
        operation: 'HARVEST',
        workerId: secondWorker,
        poweredMachineId: combineId,
        implementMachineId: trailerId,
        targetFieldId: readyFieldId,
        destinationFarmId: farm.farmId,
      },
      token,
    );
    expect(harvesting.statusCode, JSON.stringify(harvesting.body)).toBe(200);

    // El paso, invocado como lo invoca `STEP_PLAN` de `modules/economy` a traves del registro
    // de `lib/moduleSeams.ts`: dentro de la transaccion del avance y al instante del evento.
    const outcome = await withPlayerAdvanced(harness.services, playerId, (ctx) =>
      cancelTasksForLiquidation(ctx, ctx.reading.gameNow),
    );
    expect(outcome.result).toHaveLength(2);

    expect(
      await harness.prisma.task.count({
        where: { playerId, status: TaskStatus.IN_PROGRESS },
      }),
    ).toBe(0);
    expect(
      await harness.prisma.machine.count({
        where: { playerId, status: MachineStatus.IDLE, currentTaskId: null },
      }),
    ).toBe(4);
    expect(
      await harness.prisma.worker.count({
        where: { playerId, status: WorkerStatus.IDLE, currentTaskId: null },
      }),
    ).toBe(2);
    expect(
      await harness.prisma.field.count({ where: { playerId, currentTaskId: { not: null } } }),
    ).toBe(0);
    const farmRow = await readStock(harness, farm.farmId, 'WHEAT');
    expect(farmRow.reservedUnits).toBe(0);
    expect(
      await harness.prisma.scheduledEvent.count({
        where: {
          playerId,
          kind: ScheduledEventKind.TASK_COMPLETE,
          status: ScheduledEventStatus.PENDING,
        },
      }),
    ).toBe(0);

    // Idempotente: un segundo recorrido no encuentra nada que cancelar.
    const second = await withPlayerAdvanced(harness.services, playerId, (ctx) =>
      cancelTasksForLiquidation(ctx, ctx.reading.gameNow),
    );
    expect(second.result).toHaveLength(0);
  });
});
