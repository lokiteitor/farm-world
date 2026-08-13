// Repair, wear and accrued maintenance of the `machinery` area.
//
// Owner: workflow W5-A. Module `machinery`.
//
// Three things only a real database and a real clock can show, and all three are decisions
// the plan took over a GDD that leaves them open:
//
//   1. Repair as a scheduled event (plan section 2.2 over GDD sections 29, 93 and 95). The
//      machine goes to `IN_REPAIR`, and it is the due event that returns it to `IDLE` with
//      its condition restored. The handler is registered for real, so
//      `farm_world_scheduled_events_unhandled_total` does not count this kind: the assertion
//      on `unhandledEvents` is what would notice if the wiring were lost.
//   2. Wear per hour worked, never per hour idle (GDD sections 93 and 99). The rate is the
//      invented value of the catalogue, and the assertion compares against the catalogue and
//      not against a literal, so retuning the balance moves the two together.
//   3. The maintenance of GDD section 94 as the integral over the validity interval of the
//      machine (plan section 6.2). Buying opens the interval and selling closes it, and this
//      module writes nothing else that the accrual reads.
//
// The injected clock of the harness runs at one game hour per real hour, so advancing twelve
// game hours expires an access token that was minted twelve real hours earlier in its own
// frame. That is correct and not a defect: the session lives in real time. Every case that
// moves the clock logs in again, exactly as the field suite of workflow W4 does.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advancePlayerNow } from '../../lib/advancePlayer.js';
import { applyMachineWear } from '../../modules/machinery/index.js';
import {
  MACHINE_CATALOGUE,
  MS_PER_GAME_HOUR,
  MachineStatus,
  MachineType,
  Money,
  REPAIR_GAME_HOURS_PER_CONDITION_POINT,
  ScheduledEventKind,
  ScheduledEventStatus,
  ValidationCode,
  bp,
  conditionAfterWork,
  gameMs as toGameMsValue,
  repairCost,
  repairDurationGameHours,
  type PlayerId,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import { addWorkshop, cleanUp, createMachineryFarm, type FarmFixture } from './fixtures.js';

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
    headers: { ...bearer(token), 'idempotency-key': randomUUID() },
    payload: payload as never,
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

function resultOf(response: JsonResponse): Record<string, unknown> {
  return response.body['result'] as Record<string, unknown>;
}

function errorCodeOf(response: JsonResponse): string {
  return (response.body['error'] as Record<string, unknown>)['code'] as string;
}

/** A fresh access token for a player whose session outlived the injected clock. */
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
  readonly accessToken: string;
  readonly farm: FarmFixture;
  readonly machineId: string;
}

/** A player with a farm, a garage, one tractor and, optionally, a workshop. */
async function scenario(label: string, band: number, workshop: boolean): Promise<Scenario> {
  const player = await registerViaHttp(harness, label);
  players.push(player.playerId);
  const farm = await createMachineryFarm(harness, player.playerId, band);
  if (workshop) {
    await addWorkshop(harness, player.playerId, farm.farmId, band);
  }
  const bought = await post(
    '/api/machines',
    { farmId: farm.farmId, type: MachineType.TRACTOR },
    player.accessToken,
  );
  if (bought.statusCode !== 200) {
    throw new Error(`Purchase failed with ${bought.statusCode}: ${JSON.stringify(bought.body)}`);
  }
  const machineId = (resultOf(bought)['machine'] as Record<string, unknown>)['id'] as string;
  return { label, playerId: player.playerId, accessToken: player.accessToken, farm, machineId };
}

/** Puts a machine at a condition without going through a task, which W6 owns. */
async function setCondition(machineId: string, conditionBp: number): Promise<void> {
  await harness.prisma.machine.update({
    where: { id: machineId },
    data: { conditionBp, conditionUpdatedAtGameMs: harness.gameNow() },
  });
}

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await cleanUp(harness, players);
  await harness.teardown();
});

describe('desgaste (GDD §93)', () => {
  it('el desgaste por hora trabajada coincide con la tasa del catalogo', async () => {
    const { machineId } = await scenario('desgaste', 4400, false);
    const worked = 10;
    const at = toGameMsValue(harness.gameNow() + BigInt(worked) * MS_PER_GAME_HOUR);

    await harness.services.transaction(async (tx) => {
      await applyMachineWear(tx, [machineId], worked, at);
    });

    const row = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: machineId },
      select: { conditionBp: true, conditionUpdatedAtGameMs: true },
    });
    // 15 bp/h del tractor por diez horas: 150 bp. La asercion compara con la regla
    // compartida y con el catalogo, nunca con un literal.
    expect(row.conditionBp).toBe(conditionAfterWork(bp(10_000), worked, MACHINE_CATALOGUE.TRACTOR));
    expect(row.conditionBp).toBe(10_000 - MACHINE_CATALOGUE.TRACTOR.wearRateBpPerGameHour * worked);
    expect(row.conditionUpdatedAtGameMs).toBe(at);
  });

  it('no aplica desgaste por inactividad ni retrocede la marca', async () => {
    const { machineId } = await scenario('desgaste-ocioso', 4440, false);
    const at = toGameMsValue(harness.gameNow() + 5n * MS_PER_GAME_HOUR);

    await harness.services.transaction(async (tx) => {
      // Cero horas trabajadas: §93 y §99 dejan la degradacion por inactividad fuera del MVP.
      await applyMachineWear(tx, [machineId], 0, at);
    });
    let row = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: machineId },
      select: { conditionBp: true, conditionUpdatedAtGameMs: true },
    });
    expect(row.conditionBp).toBe(10_000);
    expect(row.conditionUpdatedAtGameMs).toBe(harness.gameNow());

    // Prorrateo de una cancelacion: media hora trabajada de un tramo que iba a durar mas.
    await harness.services.transaction(async (tx) => {
      await applyMachineWear(tx, [machineId], 0.5, at);
    });
    row = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: machineId },
      select: { conditionBp: true, conditionUpdatedAtGameMs: true },
    });
    expect(row.conditionBp).toBe(conditionAfterWork(bp(10_000), 0.5, MACHINE_CATALOGUE.TRACTOR));

    // Una segunda entrega del mismo cierre no vuelve a desgastar: la marca ya esta ahi.
    await harness.services.transaction(async (tx) => {
      await applyMachineWear(tx, [machineId], 0.5, at);
    });
    const again = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: machineId },
      select: { conditionBp: true },
    });
    expect(again.conditionBp).toBe(row.conditionBp);
  });

  it('rechaza la asignacion por debajo de la condicion minima', async () => {
    const { playerId, machineId } = await scenario('condicion-minima', 4480, false);
    // Suelo del 10 %, decision del plan 2.2: §91 no dice nada por debajo de ese punto.
    await setCondition(machineId, 900);

    const { requireAssignableMachines } = await import('../../modules/machinery/index.js');
    await expect(
      requireAssignableMachines(harness.prisma, playerId, [machineId]),
    ).rejects.toMatchObject({ code: ValidationCode.MACHINE_CONDITION_TOO_LOW });

    await setCondition(machineId, 1_000);
    const accepted = await requireAssignableMachines(harness.prisma, playerId, [machineId]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.conditionBp).toBe(1_000);
  });
});

describe('reparacion (GDD §29 y §93)', () => {
  it('rechaza la reparacion en una granja sin taller', async () => {
    const { accessToken, machineId } = await scenario('sin-taller', 4520, false);
    await setCondition(machineId, 5_000);

    const refused = await post(`/api/machines/${machineId}/repair`, {}, accessToken);
    expect(refused.statusCode).toBe(409);
    expect(errorCodeOf(refused)).toBe(ValidationCode.WORKSHOP_REQUIRED);

    const row = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: machineId },
      select: { status: true, conditionBp: true },
    });
    expect(row.status).toBe(MachineStatus.IDLE);
    expect(row.conditionBp).toBe(5_000);
  });

  it('cobra el coste de la formula de §93 y agenda el evento con su duracion', async () => {
    const { playerId, accessToken, machineId } = await scenario('coste', 4560, true);
    await setCondition(machineId, 5_000);

    const response = await post(`/api/machines/${machineId}/repair`, {}, accessToken);
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const result = resultOf(response);

    // §93: repairCost = (100 - condicion) x repairCostPerPoint. Cincuenta puntos a 54 $.
    const expectedCost = repairCost(bp(5_000), MACHINE_CATALOGUE.TRACTOR);
    expect(result['totalPaid']).toBe(Money.toString(expectedCost));
    expect(result['totalPaid']).toBe('2700.0000');
    expect(result['pointsRestored']).toBe(50);

    // Duracion proporcional a los puntos restaurados (plan 2.2): 50 x 0,25 h = 12,5 h.
    const expectedHours = repairDurationGameHours(bp(5_000));
    expect(expectedHours).toBe(50 * REPAIR_GAME_HOURS_PER_CONDITION_POINT);
    const expectedEnd =
      harness.gameNow() + BigInt(Math.round(expectedHours * Number(MS_PER_GAME_HOUR)));
    expect(result['repairEndsAtGameMs']).toBe(expectedEnd.toString());

    // La maquina queda ocupada mientras dura: IN_REPAIR es un estado real (§95 lo dejaba
    // reservado; plan 2.2 lo activa).
    const machine = result['machine'] as Record<string, unknown>;
    expect(machine['status']).toBe(MachineStatus.IN_REPAIR);
    expect(machine['conditionBp']).toBe(5_000);
    expect(machine['assignable']).toBe(false);

    const pending = await harness.prisma.scheduledEvent.findMany({
      where: {
        playerId,
        refType: 'MACHINE',
        refId: machineId,
        status: ScheduledEventStatus.PENDING,
      },
      select: { kind: true, dueGameMs: true },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe(ScheduledEventKind.MACHINE_REPAIR_COMPLETE);
    expect(pending[0]?.dueGameMs).toBe(expectedEnd);

    // El asiento del taller existe con su tipo propio, para que el resumen de regreso de
    // §124 no lo confunda con una compra.
    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId, type: 'MACHINE_REPAIR' },
      select: { amount: true },
    });
    expect(entries).toHaveLength(1);
    expect(Money.toString(Money.fromString(String(entries[0]?.amount)))).toBe('-2700.0000');
  });

  it('pasa por IN_REPAIR y vuelve a IDLE con la condicion restaurada al vencer el evento', async () => {
    const scene = await scenario('ciclo-taller', 4600, true);
    await setCondition(scene.machineId, 5_000);
    expect(
      (await post(`/api/machines/${scene.machineId}/repair`, {}, scene.accessToken)).statusCode,
    ).toBe(200);

    const midway = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: scene.machineId },
      select: { status: true, conditionBp: true, repairEndsAtGameMs: true },
    });
    expect(midway.status).toBe(MachineStatus.IN_REPAIR);
    expect(midway.conditionBp).toBe(5_000);

    // Doce horas y media de juego, que es lo que dura restaurar cincuenta puntos.
    harness.advanceGameHours(13);
    const advance = await advancePlayerNow(harness.services, scene.playerId);
    expect(advance.processedEvents).toBeGreaterThanOrEqual(1);
    // El manejador esta registrado de verdad: la metrica de eventos sin manejador no cuenta
    // este tipo (`docs/handoff/NOTES-w3-cierre.md`, apartado 8).
    expect(advance.unhandledEvents).toBe(0);

    const after = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: scene.machineId },
      select: { status: true, conditionBp: true, repairEndsAtGameMs: true },
    });
    expect(after.status).toBe(MachineStatus.IDLE);
    expect(after.conditionBp).toBe(10_000);
    // `machines_repair_check` solo admite un fin de reparacion en una maquina IN_REPAIR.
    expect(after.repairEndsAtGameMs).toBeNull();

    const pending = await harness.prisma.scheduledEvent.count({
      where: {
        playerId: scene.playerId,
        refId: scene.machineId,
        kind: ScheduledEventKind.MACHINE_REPAIR_COMPLETE,
        status: ScheduledEventStatus.PENDING,
      },
    });
    expect(pending).toBe(0);
  });

  it('admite una reparacion parcial y no admite una segunda mientras dura', async () => {
    const scene = await scenario('reparacion-parcial', 4640, true);
    await setCondition(scene.machineId, 4_000);

    const partial = await post(
      `/api/machines/${scene.machineId}/repair`,
      { toConditionBp: 7_000 },
      scene.accessToken,
    );
    expect(partial.statusCode, JSON.stringify(partial.body)).toBe(200);
    // Treinta puntos: el coste es la misma regla evaluada en los dos extremos.
    expect(resultOf(partial)['pointsRestored']).toBe(30);
    expect(resultOf(partial)['totalPaid']).toBe(
      Money.toString(
        Money.sub(
          repairCost(bp(4_000), MACHINE_CATALOGUE.TRACTOR),
          repairCost(bp(7_000), MACHINE_CATALOGUE.TRACTOR),
        ),
      ),
    );

    const second = await post(`/api/machines/${scene.machineId}/repair`, {}, scene.accessToken);
    expect(second.statusCode).toBe(409);
    expect(errorCodeOf(second)).toBe(ValidationCode.MACHINE_NOT_REPAIRABLE);

    harness.advanceGameHours(8);
    await advancePlayerNow(harness.services, scene.playerId);
    const after = await harness.prisma.machine.findUniqueOrThrow({
      where: { id: scene.machineId },
      select: { status: true, conditionBp: true },
    });
    expect(after.status).toBe(MachineStatus.IDLE);
    expect(after.conditionBp).toBe(7_000);
  });

  it('rechaza reparar una maquina que ya esta en condicion plena', async () => {
    const scene = await scenario('condicion-plena', 4680, true);
    const refused = await post(`/api/machines/${scene.machineId}/repair`, {}, scene.accessToken);
    expect(refused.statusCode).toBe(409);
    expect(errorCodeOf(refused)).toBe(ValidationCode.MACHINE_CONDITION_ALREADY_FULL);
  });
});

describe('mantenimiento devengado (GDD §94)', () => {
  it('el devengo de una maquina coincide con la integral de su intervalo de vigencia', async () => {
    const label = 'mantenimiento';
    const scene = await scenario(label, 4720, false);
    const acquired = harness.gameNow();

    const heldGameHours = 12;
    harness.advanceGameHours(heldGameHours);

    // La sesion vive en tiempo real y el reloj inyectado ha avanzado doce horas.
    const token = await login(label);
    const sold = await post(`/api/machines/${scene.machineId}/sell`, undefined, token);
    expect(sold.statusCode, JSON.stringify(sold.body)).toBe(200);
    const disposed = harness.gameNow();

    // Doce horas mas con la maquina ya vendida: el intervalo esta cerrado y no devenga nada.
    harness.advanceGameHours(12);
    await advancePlayerNow(harness.services, scene.playerId);

    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId: scene.playerId, type: 'MACHINE_MAINTENANCE' },
      select: { amount: true },
    });
    const charged = Money.sum(entries.map((entry) => Money.fromString(String(entry.amount))));
    // La integral del solape: tasa por horas de vigencia, y nada fuera de ella (plan 6.2).
    const expected = Money.negate(
      Money.mulGameMs(MACHINE_CATALOGUE.TRACTOR.maintenanceCostPerGameHour, disposed - acquired),
    );
    expect(Money.toString(charged)).toBe(Money.toString(expected));
    expect(Money.toString(charged)).toBe(`-${12 * heldGameHours}.0000`);
  });
});
