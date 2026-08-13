// The `machinery` area against a real PostgreSQL and a real Redis: catalogue, purchase and
// sale.
//
// Owner: workflow W5-A. Module `machinery`.
//
// What this file pins down is the half of the module that only a real database can show:
// the garage limit of GDD section 96, which is a counter maintained by a trigger and a
// `CHECK`, and what happens when two purchases race for the last slot. The repair, the wear
// and the accrued maintenance are in `repair.int.test.ts`.
//
// The negative assertion of plan section 10 is the one that gives the suite its shape: "the
// fifth machine in a garage of four slots must return a conflict". Everything else in the
// file exists so that assertion cannot pass for the wrong reason.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MACHINE_CATALOGUE,
  MACHINE_TYPES,
  MachineStatus,
  MachineType,
  Money,
  TASK_OPERATIONS,
  TaskStatus,
  ValidationCode,
  bp,
  machineResaleValue,
  type PlayerId,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import { GARAGE_SLOTS, cleanUp, createMachineryFarm, type FarmFixture } from './fixtures.js';

let harness: Harness;

/** Every player the file created, so the teardown can clear their rows. */
const players: PlayerId[] = [];

interface JsonResponse {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}

async function post(url: string, payload: unknown, token: string): Promise<JsonResponse> {
  const response = await harness.app.inject({
    method: 'POST',
    url,
    headers: { ...bearer(token), 'idempotency-key': randomUUID() },
    payload: payload as never,
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

async function get(url: string, token?: string): Promise<JsonResponse> {
  const response = await harness.app.inject({
    method: 'GET',
    url,
    ...(token === undefined ? {} : { headers: bearer(token) }),
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

function resultOf(response: JsonResponse): Record<string, unknown> {
  return response.body['result'] as Record<string, unknown>;
}

function errorCodeOf(response: JsonResponse): string {
  return (response.body['error'] as Record<string, unknown>)['code'] as string;
}

/** A player with a farm, a garage of four slots and a home. One band per case. */
async function scenario(
  label: string,
  band: number,
): Promise<{
  readonly playerId: PlayerId;
  readonly accessToken: string;
  readonly farm: FarmFixture;
}> {
  const player = await registerViaHttp(harness, label);
  players.push(player.playerId);
  const farm = await createMachineryFarm(harness, player.playerId, band);
  return { playerId: player.playerId, accessToken: player.accessToken, farm };
}

/** Buys one machine of a type, without asserting anything. */
async function buy(
  token: string,
  farmId: string,
  type: MachineType,
  extra: Record<string, unknown> = {},
): Promise<JsonResponse> {
  return post('/api/machines', { farmId, type, ...extra }, token);
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await cleanUp(harness, players);
  await harness.teardown();
});

describe('GET /api/machines/catalog', () => {
  it('publica el catalogo de §89 y §134 y la tabla de compatibilidad de §90', async () => {
    // The one route of the area the contract marks `requiresAuth: false`: it carries balance
    // data and no state of any player.
    const response = await get('/api/machines/catalog');
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);

    const machines = response.body['machines'] as Record<string, unknown>[];
    expect(machines).toHaveLength(MACHINE_TYPES.length);

    const tractor = machines.find((entry) => entry['type'] === MachineType.TRACTOR);
    // 18.000 $ de compra (GDD §89); 6 $/h de mantenimiento y 10 $/h de operacion, las
    // tasas de la revision de balance de 2026-08.
    expect(tractor?.['purchasePrice']).toBe('18000.0000');
    expect(tractor?.['maintenanceCostPerGameHour']).toBe('6.0000');
    expect(tractor?.['operatingCostPerGameHour']).toBe('10.0000');
    expect(tractor?.['compatibleImplements']).toEqual([
      MachineType.PLOW,
      MachineType.CULTIVATOR,
      MachineType.SEEDER,
      MachineType.TRAILER,
    ]);
    // Tasa de desgaste inventada (plan 2.2): §93 exige `wearRatePerHour` y no lo define.
    expect(tractor?.['wearRateBpPerGameHour']).toBe(15);

    const operations = response.body['operations'] as Record<string, unknown>[];
    expect(operations).toHaveLength(TASK_OPERATIONS.length);
    // GDD §90: VIRGIN -> PLOWED exige tractor mas arado.
    const plow = operations.find((entry) => entry['operation'] === 'PLOW');
    expect(plow?.['poweredMachine']).toBe(MachineType.TRACTOR);
    expect(plow?.['requiredImplement']).toBe(MachineType.PLOW);
    // GDD §90: la cosecha exige cosechadora mas remolque.
    const harvest = operations.find((entry) => entry['operation'] === 'HARVEST');
    expect(harvest?.['poweredMachine']).toBe(MachineType.HARVESTER);
    expect(harvest?.['requiredImplement']).toBe(MachineType.TRAILER);

    // Suelo de condicion para asignar, decision del plan 2.2 sobre §91.
    expect(response.body['minConditionToAssignBp']).toBe(1000);
    expect(response.body['conditionWarningThresholdBp']).toBe(2000);
  });
});

describe('POST /api/machines', () => {
  it('compra una maquina, la deja en IDLE al 100 % y ocupa una plaza de garaje', async () => {
    const { playerId, accessToken, farm } = await scenario('compra', 4000);

    const response = await buy(accessToken, farm.farmId, MachineType.TRACTOR);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);

    const result = resultOf(response);
    const machine = result['machine'] as Record<string, unknown>;
    expect(machine['type']).toBe(MachineType.TRACTOR);
    // GDD §93: una maquina nueva esta al 100 % de condicion.
    expect(machine['conditionBp']).toBe(10_000);
    // GDD §95: IDLE y WORKING son los estados activos; BROKEN queda reservado.
    expect(machine['status']).toBe(MachineStatus.IDLE);
    expect(machine['garageId']).toBe(farm.garageId);
    expect(machine['currentTaskId']).toBeNull();
    expect(machine['repairEndsAtGameMs']).toBeNull();
    expect(machine['assignable']).toBe(true);
    // El instante de adquisicion es el inicio del intervalo de vigencia del mantenimiento.
    expect(machine['acquiredGameMs']).toBe(harness.gameNow().toString());
    expect(result['totalPaid']).toBe('18000.0000');
    expect(result['garageSlotsUsed']).toBe(1);
    expect(result['garageSlotsTotal']).toBe(GARAGE_SLOTS);

    // El contador de plazas lo mantiene el disparador `machines_garage_occupancy`, no este
    // modulo: si dejara de dispararse, esta comprobacion es la que falla.
    const garage = await harness.prisma.building.findUniqueOrThrow({
      where: { id: farm.garageId },
      select: { machineCount: true },
    });
    expect(garage.machineCount).toBe(1);

    // El asiento de la compra existe y el saldo cuadra con el (§117).
    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId, type: 'MACHINE_PURCHASE' },
      select: { amount: true, refId: true },
    });
    expect(entries).toHaveLength(1);
    expect(Money.toString(Money.fromString(String(entries[0]?.amount)))).toBe('-18000.0000');
    expect(entries[0]?.refId).toBe(machine['id']);
  });

  it('rechaza la quinta maquina en un garaje de cuatro plazas con GARAGE_CAPACITY_EXCEEDED', async () => {
    const { accessToken, farm } = await scenario('garaje-lleno', 4040);

    for (let index = 0; index < GARAGE_SLOTS; index += 1) {
      const accepted = await buy(accessToken, farm.farmId, MachineType.PLOW);
      expect(accepted.statusCode, JSON.stringify(accepted.body)).toBe(200);
      expect(resultOf(accepted)['garageSlotsUsed']).toBe(index + 1);
    }

    // GDD §96: bloqueo simple, no se puede comprar maquinaria sin plaza libre.
    const refused = await buy(accessToken, farm.farmId, MachineType.PLOW);
    expect(refused.statusCode).toBe(409);
    expect(errorCodeOf(refused)).toBe(ValidationCode.GARAGE_CAPACITY_EXCEEDED);
    const details = (refused.body['error'] as Record<string, unknown>)['details'] as Record<
      string,
      unknown
    >;
    expect(details['occupancy']).toBe(GARAGE_SLOTS);
    expect(details['capacity']).toBe(GARAGE_SLOTS);
  });

  it('con una sola plaza libre, dos compras concurrentes dejan ganar a una', async () => {
    const { playerId, accessToken, farm } = await scenario('carrera-garaje', 4080);
    for (let index = 0; index < GARAGE_SLOTS - 1; index += 1) {
      expect((await buy(accessToken, farm.farmId, MachineType.PLOW)).statusCode).toBe(200);
    }

    const [first, second] = await Promise.all([
      buy(accessToken, farm.farmId, MachineType.CULTIVATOR),
      buy(accessToken, farm.farmId, MachineType.CULTIVATOR),
    ]);

    const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(codes, JSON.stringify([first.body, second.body])).toEqual([200, 409]);
    const loser = first.statusCode === 409 ? first : second;
    expect(errorCodeOf(loser)).toBe(ValidationCode.GARAGE_CAPACITY_EXCEEDED);

    // La serializacion la da el bloqueo de la fila del jugador de `withPlayerAdvanced`, y el
    // contador es la prueba de que solo una escritura llego (plan 5.4).
    const garage = await harness.prisma.building.findUniqueOrThrow({
      where: { id: farm.garageId },
      select: { machineCount: true },
    });
    expect(garage.machineCount).toBe(GARAGE_SLOTS);
    expect(await harness.prisma.machine.count({ where: { playerId, disposedGameMs: null } })).toBe(
      GARAGE_SLOTS,
    );
  });

  it('rechaza un presupuesto obsoleto sin cobrar nada', async () => {
    const { playerId, accessToken, farm } = await scenario('presupuesto', 4120);
    const refused = await buy(accessToken, farm.farmId, MachineType.TRACTOR, {
      expectedTotal: '17000.0000',
    });
    expect(refused.statusCode).toBe(400);
    expect(errorCodeOf(refused)).toBe(ValidationCode.VALIDATION_FAILED);
    expect(await harness.prisma.machine.count({ where: { playerId } })).toBe(0);
  });

  it('rechaza un garaje que no es de la granja', async () => {
    const first = await scenario('garaje-ajeno-a', 4160);
    const second = await scenario('garaje-ajeno-b', 4200);
    const refused = await buy(first.accessToken, first.farm.farmId, MachineType.TRACTOR, {
      garageId: second.farm.garageId,
    });
    expect(refused.statusCode).toBe(404);
    expect(errorCodeOf(refused)).toBe(ValidationCode.NOT_FOUND);
  });
});

describe('POST /api/machines/:machineId/sell', () => {
  it('libera la plaza, cierra el intervalo de vigencia y abona el valor de reventa', async () => {
    const { accessToken, farm } = await scenario('venta', 4240);
    const bought = await buy(accessToken, farm.farmId, MachineType.TRACTOR);
    expect(bought.statusCode, JSON.stringify(bought.body)).toBe(200);
    const machineId = (resultOf(bought)['machine'] as Record<string, unknown>)['id'] as string;

    const sold = await post(`/api/machines/${machineId}/sell`, undefined, accessToken);
    expect(sold.statusCode, JSON.stringify(sold.body)).toBe(200);

    const expected = machineResaleValue({
      purchasePrice: MACHINE_CATALOGUE.TRACTOR.purchasePrice,
      conditionBp: bp(10_000),
    });
    expect(resultOf(sold)['refund']).toBe(Money.toString(expected));
    expect(resultOf(sold)['garageSlotsUsed']).toBe(0);

    const row = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: machineId },
      select: { disposedGameMs: true, garageId: true },
    });
    // Borrado logico: la fila permanece, porque el asiento apunta a ella sin clave ajena
    // (ADR-0009), y el instante cierra el intervalo del mantenimiento de §94.
    expect(row.disposedGameMs).toBe(harness.gameNow());

    const garage = await harness.prisma.building.findUniqueOrThrow({
      where: { id: farm.garageId },
      select: { machineCount: true },
    });
    expect(garage.machineCount).toBe(0);

    // La maquina vendida ya no aparece en el listado.
    const listed = await get('/api/machines', accessToken);
    expect(listed.statusCode).toBe(200);
    expect(listed.body['machines']).toHaveLength(0);
  });

  it('rechaza vender una maquina asignada a una tarea en curso', async () => {
    const { playerId, accessToken, farm } = await scenario('venta-ocupada', 4280);
    const bought = await buy(accessToken, farm.farmId, MachineType.TRACTOR);
    const machineId = (resultOf(bought)['machine'] as Record<string, unknown>)['id'] as string;

    // Una tarea en curso con su trabajador y su enlace, que es el vinculo autoritativo entre
    // trabajador y maquina (plan 5.2, frente a los punteros cruzados de §98 y §101).
    const worker = await harness.prisma.worker.create({
      data: {
        playerId,
        farmId: farm.farmId,
        homeId: farm.homeId,
        name: 'Operario de prueba',
        skillBp: 5_000,
        salaryPerGameHour: '15',
        hiredGameMs: harness.gameNow(),
      },
      select: { id: true },
    });
    const task = await harness.prisma.task.create({
      data: {
        playerId,
        workerId: worker.id,
        operation: 'PLOW',
        status: TaskStatus.IN_PROGRESS,
        unitsAtStart: 10,
        effectiveWorkSpeedMilli: 4_200,
        startGameMs: harness.gameNow(),
        scheduledEndGameMs: harness.gameNow() + 3_600_000n,
      },
      select: { id: true },
    });
    await harness.prisma.taskMachine.create({
      data: { taskId: task.id, machineId, role: 'POWERED' },
    });
    await harness.prisma.machine.update({
      where: { id: machineId },
      data: { status: MachineStatus.WORKING, currentTaskId: task.id },
    });

    const refused = await post(`/api/machines/${machineId}/sell`, undefined, accessToken);
    expect(refused.statusCode).toBe(409);
    expect(errorCodeOf(refused)).toBe(ValidationCode.MACHINE_NOT_IDLE);

    // Tercera capa: aunque el estado y la columna de reserva se limpiaran, el enlace de la
    // tarea en curso sigue impidiendo la venta.
    await harness.prisma.machine.update({
      where: { id: machineId },
      data: { status: MachineStatus.IDLE, currentTaskId: null },
    });
    const stillRefused = await post(`/api/machines/${machineId}/sell`, undefined, accessToken);
    expect(stillRefused.statusCode).toBe(409);
    expect(errorCodeOf(stillRefused)).toBe(ValidationCode.MACHINE_NOT_IDLE);

    const row = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: machineId },
      select: { disposedGameMs: true },
    });
    expect(row.disposedGameMs).toBeNull();
  });
});
