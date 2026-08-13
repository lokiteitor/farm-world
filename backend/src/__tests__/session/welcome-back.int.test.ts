// The return summary: the economics of GDD section 124 and the life cycle of the mark.
//
// Owner: workflow W6-B. Module `session`.
//
// The case that carries the suite is a simulated absence of four hundred game hours with three
// tasks that ran inside it. It is built that way because it is the only shape in which the
// warning of GDD section 124 is observable: the operating cost of a holding that worked thirty
// hours out of four hundred is thirty hours of operating cost, and any implementation that
// multiplied a rate by the elapsed time would report thirteen times too much. The case asserts
// both, the right figure and the wrong one it is not.
//
// Everything is compared against the shared catalogue and never against a literal amount, so a
// retuned rate moves the assertion with the balance instead of turning it red.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CropCycleState,
  MACHINE_CATALOGUE,
  MS_PER_GAME_HOUR,
  Money,
  bp,
  gameMs as toGameMsValue,
  machineResaleValue,
  welcomeBackReplySchema,
  type GameMs,
  type WelcomeBackReply,
  type World,
} from '../../shared/index.js';
import { createHarness, type Harness } from '../harness.js';
import { bearer } from '../harness.js';
import {
  advanceAndCatchUp,
  balanceOf,
  clearDomain,
  createClosedTask,
  createField,
  createMachine,
  createSessionPlayer,
  createWorker,
  getJson,
  postJson,
  signIn,
  summaryMarkOf,
  type SessionPlayer,
} from './fixtures.js';

let harness: Harness;
let world: World;

/** The absence the suite simulates, in game hours. */
const ABSENCE_GAME_HOURS = 400;

/** Salary of the single worker. A round rate, so every settlement is exact. */
const SALARY = Money.fromUnits(15);

/** The three task intervals, in game hours from the start of the player. */
const TASK_INTERVALS: readonly (readonly [number, number])[] = [
  [10, 20],
  [100, 110],
  [300, 310],
];

/** Game hours between one settlement sweep and the next, from `SETTLE_SWEEP_PERIOD_GAME_MS`. */
const SWEEP_PERIOD_GAME_HOURS = 6;

/** Game hours the three tasks worked in total. */
const WORKED_GAME_HOURS = TASK_INTERVALS.reduce((total, [from, to]) => total + (to - from), 0);

beforeAll(async () => {
  harness = await createHarness();
  world = (await harness.services.clock.read()).world;
});

afterAll(async () => {
  await clearDomain(harness, world);
  await harness.teardown();
});

/** An instant a number of whole game hours after the start of a player. */
function hoursAfter(player: SessionPlayer, hours: number): GameMs {
  return toGameMsValue(player.startedAtGameMs + BigInt(hours) * MS_PER_GAME_HOUR);
}

/**
 * A player who was away four hundred game hours with one worker, one tractor, one plough and
 * three ploughing tasks behind it.
 *
 * The tractor is the only machine of the two with a rate: the plough costs nothing to own and
 * nothing to run in the catalogue of GDD section 89, which is the deviation the balance report
 * documents and which makes the expected figures a single machine's.
 */
async function playerAfterAbsence(label: string): Promise<SessionPlayer> {
  const player = await createSessionPlayer(harness, label);
  const workerId = await createWorker(harness, player, 'Ana', SALARY);
  const tractorId = await createMachine(harness, player, 'TRACTOR');
  const ploughId = await createMachine(harness, player, 'PLOW');

  for (const [from, to] of TASK_INTERVALS) {
    await createClosedTask(harness, player, {
      workerId,
      machineIds: [tractorId, ploughId],
      startGameMs: hoursAfter(player, from),
      endGameMs: hoursAfter(player, to),
    });
  }

  await advanceAndCatchUp(harness, player.playerId, ABSENCE_GAME_HOURS);
  return player;
}

/** The summary of a player, through HTTP and with a token reissued after the absence. */
async function fetchSummary(player: SessionPlayer, accessToken: string): Promise<WelcomeBackReply> {
  const { statusCode, body } = await getJson(harness, accessToken, '/api/session/welcome-back');
  expect(statusCode, JSON.stringify(body)).toBe(200);
  // The reply is validated against the very schema the contract declares, which is what makes
  // this an assertion about the contract and not about the shape this module happens to build.
  return welcomeBackReplySchema.parse(body);
}

describe('GET /api/session/welcome-back', () => {
  it('produce las lineas de la seccion 124 con el coste de operacion derivado de los intervalos de tarea', async () => {
    const player = await playerAfterAbsence('wb-124');
    const token = await signIn(harness, player.email);
    const summary = await fetchSummary(player, token);

    expect(summary.elapsedGameHours).toBe(ABSENCE_GAME_HOURS);
    expect(summary.hasContent).toBe(true);

    // Salaries and maintenance are ownership costs: they run for the whole interval whether or
    // not anything was worked (GDD section 107).
    const expectedSalaries = Money.mulGameMs(SALARY, BigInt(ABSENCE_GAME_HOURS) * MS_PER_GAME_HOUR);
    const expectedMaintenance = Money.mulGameMs(
      MACHINE_CATALOGUE.TRACTOR.maintenanceCostPerGameHour,
      BigInt(ABSENCE_GAME_HOURS) * MS_PER_GAME_HOUR,
    );
    // The operating cost is the integral over the real intervals of the three tasks, computed
    // here by hand from the catalogue so that the assertion does not go through the same
    // function the ledger did.
    const expectedOperating = Money.mulGameMs(
      MACHINE_CATALOGUE.TRACTOR.operatingCostPerGameHour,
      BigInt(WORKED_GAME_HOURS) * MS_PER_GAME_HOUR,
    );

    expect(summary.economy.totalSalaries).toBe(Money.toString(Money.negate(expectedSalaries)));
    expect(summary.economy.totalMaintenance).toBe(
      Money.toString(Money.negate(expectedMaintenance)),
    );
    expect(summary.economy.totalOperating).toBe(Money.toString(Money.negate(expectedOperating)));

    // The warning of GDD section 124 made executable: a rate multiplied by the elapsed time is
    // not the operating cost, and here it is thirteen times too much.
    const naiveOperating = Money.mulGameMs(
      MACHINE_CATALOGUE.TRACTOR.operatingCostPerGameHour,
      BigInt(ABSENCE_GAME_HOURS) * MS_PER_GAME_HOUR,
    );
    expect(summary.economy.totalOperating).not.toBe(Money.toString(Money.negate(naiveOperating)));

    // Nothing was sold, so there is no revenue, and the opening capital of GDD section 117 is
    // outside the interval because it was stamped at the instant the mark started.
    expect(summary.economy.totalRevenue).toBe(Money.toString(Money.ZERO));
    expect(summary.economy.totalOther).toBe(Money.toString(Money.ZERO));

    const kinds = summary.economy.byType.map((line) => line.type).sort();
    expect(kinds).toEqual(['MACHINE_MAINTENANCE', 'MACHINE_OPERATING', 'WORKER_WAGES']);
    for (const line of summary.economy.byType) {
      expect(line.entryCount).toBeGreaterThan(0);
    }

    expect(summary.tasksClosed).toHaveLength(TASK_INTERVALS.length);
    expect(summary.tasksClosed.map((task) => task.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
    ]);
  });

  it('cuadra el neto con la diferencia de saldo del intervalo', async () => {
    const player = await playerAfterAbsence('wb-neto');
    const token = await signIn(harness, player.email);
    const summary = await fetchSummary(player, token);

    const before = Money.fromString(summary.economy.balanceBefore);
    const after = Money.fromString(summary.economy.balanceAfter);
    const net = Money.fromString(summary.economy.netChange);

    // The reconciliation the whole aggregation exists to satisfy: the interval is a partition
    // of the ledger, so the balance at its end is the balance at its start plus what happened.
    expect(Money.toString(Money.add(before, net))).toBe(Money.toString(after));

    // And the end of the interval is the present, so it is also the settled balance of the row.
    expect(Money.toString(await balanceOf(harness, player.playerId))).toBe(Money.toString(after));

    // The net is the sum of the four named blocks plus everything else, which is what makes
    // `byType` an explanation of `netChange` and not a second, unrelated list.
    const recomposed = Money.sum([
      Money.fromString(summary.economy.totalRevenue),
      Money.fromString(summary.economy.totalSalaries),
      Money.fromString(summary.economy.totalMaintenance),
      Money.fromString(summary.economy.totalOperating),
      Money.fromString(summary.economy.totalOther),
    ]);
    expect(Money.toString(recomposed)).toBe(Money.toString(net));
  });

  it('reporta la transicion automatica de campo y el trabajador que quedo ocioso', async () => {
    const player = await createSessionPlayer(harness, 'wb-campo');
    await createWorker(harness, player, 'Bruno', Money.ZERO);
    // Sown at the start, so the three boundaries of the ninety six hour timeline of the wheat
    // (6 h, 18 h, 96 h) all fall inside the absence.
    await createField(harness, player, {
      name: 'Parcela norte',
      cellCount: 250,
      cropId: 'WHEAT',
      cropCycleState: CropCycleState.SEEDED,
      seededAtGameMs: player.startedAtGameMs,
    });

    await advanceAndCatchUp(harness, player.playerId, ABSENCE_GAME_HOURS);
    const token = await signIn(harness, player.email);
    const summary = await fetchSummary(player, token);

    expect(summary.fieldTransitions.map((line) => `${line.fromState}->${line.toState}`)).toEqual([
      'SEEDED->GERMINATING',
      'GERMINATING->GROWING',
      'GROWING->READY_TO_HARVEST',
    ]);
    expect(summary.fieldTransitions[0]?.name).toBe('Parcela norte');

    expect(summary.idleWorkers.map((worker) => worker.name)).toEqual(['Bruno']);

    // The silo is state and not history, which is the "Silo is 72 % full" line of GDD section 68.
    const silo = summary.storage.find((line) => line.resource === 'WHEAT_LITERS');
    expect(silo?.capacityUnits).toBeGreaterThan(0);
    expect(silo?.occupancyBp).toBe(0);
  });
});

describe('GET /api/session/welcome-back, con liquidacion forzosa', () => {
  it('explica que activo se vendio y por que, a partir de los asientos del motor de economia', async () => {
    const player = await createSessionPlayer(harness, 'wb-liquidacion');
    const workerId = await createWorker(harness, player, 'Elena', Money.ZERO);
    const tractorId = await createMachine(harness, player, 'TRACTOR');

    // A debt far above any proportion of the holding, so the trigger of ADR-0039 fires on the
    // first sweep. The development route is the only way to force a balance, and the entry it
    // writes is a `COMPENSATION`, which is the kind reserved for exactly that.
    const forced = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/grant',
      headers: { ...bearer(player.accessToken), 'idempotency-key': 'wb-liq-grant' },
      payload: { amount: Money.toString(Money.fromUnits(-1_000_000)), reason: 'wb-liquidacion' },
    });
    expect(forced.statusCode, forced.body).toBe(200);

    // Past one settlement sweep, which is what triggers the liquidation. It is deliberately
    // the sweep and never the login, so that it does not read as a punishment for returning.
    await advanceAndCatchUp(harness, player.playerId, SWEEP_PERIOD_GAME_HOURS + 1);

    const token = await signIn(harness, player.email);
    const summary = await fetchSummary(player, token);

    const machineLine = summary.liquidations.find((line) => line.subjectId === tractorId);
    expect(machineLine?.subjectType).toBe('MACHINE');
    expect(machineLine?.step).toBe('IDLE_MACHINES');
    expect(machineLine?.amount).toBe(
      Money.toString(
        machineResaleValue({
          purchasePrice: MACHINE_CATALOGUE.TRACTOR.purchasePrice,
          conditionBp: bp(10_000),
        }),
      ),
    );

    // The worker is the case the per asset entries alone could not explain: a dismissal frees
    // no money and therefore writes no sale, so it exists only inside the aggregate entry.
    const workerLine = summary.liquidations.find((line) => line.subjectId === workerId);
    expect(workerLine?.subjectType).toBe('WORKER');
    expect(workerLine?.step).toBe('WORKERS');
    expect(workerLine?.amount).toBe(Money.toString(Money.ZERO));

    const kinds = summary.economy.byType.map((line) => line.type);
    expect(kinds).toContain('MACHINE_SALE');
    expect(kinds).toContain('LIQUIDATION');
    expect(summary.idleWorkers).toEqual([]);
  });
});

describe('POST /api/session/welcome-back/ack', () => {
  it('mantiene el resumen tras recargar y solo lo retira tras el acuse', async () => {
    const player = await playerAfterAbsence('wb-acuse');

    const firstToken = await signIn(harness, player.email);
    const first = await fetchSummary(player, firstToken);
    expect(first.hasContent).toBe(true);

    // The reload: a second login moves `lastLoginGameMs` and must not touch the summary mark,
    // which is the whole reason the two columns are distinct (plan section 6.7).
    const markBefore = await summaryMarkOf(harness, player.playerId);
    const secondToken = await signIn(harness, player.email);
    const second = await fetchSummary(player, secondToken);
    expect(await summaryMarkOf(harness, player.playerId)).toBe(markBefore);
    expect(second).toEqual(first);

    const acknowledged = await postJson(harness, secondToken, '/api/session/welcome-back/ack', {
      throughGameMs: first.toGameMs,
    });
    expect(acknowledged.statusCode, JSON.stringify(acknowledged.body)).toBe(200);
    const result = acknowledged.body['result'] as Record<string, unknown>;
    expect(result['lastSummaryGameMs']).toBe(first.toGameMs);
    expect(await summaryMarkOf(harness, player.playerId)).toBe(BigInt(first.toGameMs));

    // The next summary starts where this one ended, and nothing of the previous interval is in
    // it: the entry stamped exactly at the boundary belonged to the summary that closed there.
    const after = await fetchSummary(player, secondToken);
    expect(after.fromGameMs).toBe(first.toGameMs);
    expect(after.economy.byType).toEqual([]);
    expect(after.tasksClosed).toEqual([]);
    expect(after.hasContent).toBe(false);

    // And the snapshot stops offering it, which is the flag the game page reads on mount.
    const snapshot = await getJson(harness, secondToken, '/api/state/snapshot');
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.body['welcomeBackPending']).toBe(false);
  });

  it('no retrocede la marca ni la adelanta mas alla del instante actual', async () => {
    const player = await playerAfterAbsence('wb-marca');
    const token = await signIn(harness, player.email);
    const summary = await fetchSummary(player, token);

    const forward = await postJson(harness, token, '/api/session/welcome-back/ack', {
      // Far in the future: a client must not be able to acknowledge an interval it was never
      // shown and lose everything that happens between now and then.
      throughGameMs: String(BigInt(summary.toGameMs) + 1_000n * MS_PER_GAME_HOUR),
    });
    expect(forward.statusCode, JSON.stringify(forward.body)).toBe(200);
    const capped = (forward.body['result'] as Record<string, unknown>)['lastSummaryGameMs'];
    expect(capped).toBe(summary.toGameMs);

    const backward = await postJson(harness, token, '/api/session/welcome-back/ack', {
      throughGameMs: String(player.startedAtGameMs),
    });
    expect(backward.statusCode, JSON.stringify(backward.body)).toBe(200);
    expect((backward.body['result'] as Record<string, unknown>)['lastSummaryGameMs']).toBe(
      summary.toGameMs,
    );
  });
});
