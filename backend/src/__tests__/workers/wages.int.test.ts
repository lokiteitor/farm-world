// Wages as the integral of the validity interval (GDD section 107, plan section 6.2).
//
// Owner: workflow W5-B. Tests of the module `workers`.
//
// The claim under test is the one the whole cost model rests on: what the ledger charges for
// a worker equals his salary times the overlap between the settlement window and the interval
// he was employed for, and nothing else. Three cases cover it, and the third is the one that
// separates an integral from a counter:
//
//   1. A worker hired inside the window and still employed at its end. The charge covers the
//      time since he was hired and not the whole window, so the hire instant is what opens
//      the interval and hiring costs nothing on the spot.
//   2. Several settlements over the same span. Additivity: the sum of the parts equals the
//      whole, which is what makes the order of settlement irrelevant and a worker process
//      that was down harmless.
//   3. A worker hired and dismissed entirely inside one window, with no settlement in
//      between. His wages still appear, exactly for the hours he was employed. A model that
//      charged "whoever is on the payroll now" would charge zero here, and a model that
//      charged the whole window would overcharge; the integral of overlaps gets it right
//      without any special case, which is the property plan section 6.2 exists for.
//
// The expected figure is never a literal: it is recomputed with `accruedWages`, which is the
// same integral `lib/accrual.ts` runs, so the assertion compares the ledger against the rule
// and not against a number somebody typed. The comparison carries a tolerance of one
// ten-thousandth per settlement, which is the rounding the money form of the accrual admits
// and which `shared/rules/holding.ts` documents in its header.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accruedWages, type WorkerRecord } from '../../modules/workers/service.js';
import {
  LedgerType,
  Money,
  WorkerStatus,
  bp,
  gameHours,
  gameMs,
  type GameInterval,
  type GameMs,
  type PlayerId,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';

/** Salary of the fixtures. A round rate keeps a failed assertion readable. */
const SALARY = Money.fromString('12.5000');

let harness: Harness;
let playerId: PlayerId;
let accessToken: string;
let farmId: string;
let homeId: string;

beforeAll(async () => {
  harness = await createHarness();
  const player = await registerViaHttp(harness, 'wages');
  playerId = player.playerId;
  accessToken = player.accessToken;

  const atGameMs = harness.gameNow();
  const farm = await harness.prisma.farm.create({
    data: { playerId, name: 'Granja de nominas', createdAtGameMs: atGameMs },
    select: { id: true },
  });
  farmId = farm.id;
  const home = await harness.prisma.building.create({
    data: {
      farmId,
      playerId,
      type: 'WORKER_HOME',
      originCellX: 0,
      originCellY: 0,
      widthCells: 4,
      heightCells: 4,
      purchasePrice: '0',
      capacityMachines: 0,
      capacityWorkers: 4,
      capacityStorageUnits: 0,
      storageResource: null,
      builtAtGameMs: atGameMs,
    },
    select: { id: true },
  });
  homeId = home.id;
});

afterAll(async () => {
  await harness.prisma.worker.deleteMany({ where: { playerId } });
  await harness.prisma.workerCandidate.deleteMany({ where: { playerId } });
  await harness.prisma.building.deleteMany({ where: { playerId } });
  await harness.prisma.farm.deleteMany({ where: { playerId } });
  await harness.teardown();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A worker written straight into the database with the interval a case needs.
 *
 * The route cannot express "hired two hundred hours ago and dismissed a hundred hours ago",
 * and the subject here is the integral and not the route, which `hiring.int.test.ts` covers.
 * A worker created already terminated occupies no slot, because the trigger only counts a
 * live one, so the fixtures never compete for the four slots of the home.
 */
async function createWorker(
  name: string,
  hiredGameMs: GameMs,
  terminatedGameMs: GameMs | null,
): Promise<WorkerRecord> {
  const row = await harness.prisma.worker.create({
    data: {
      playerId,
      farmId,
      homeId,
      name,
      skillBp: 5_000,
      salaryPerGameHour: Money.toString(SALARY),
      status: WorkerStatus.IDLE,
      completedTaskCount: 0,
      hiredGameMs,
      terminatedGameMs,
    },
    select: { id: true },
  });
  return {
    id: row.id as WorkerRecord['id'],
    playerId,
    farmId: farmId as WorkerRecord['farmId'],
    homeId: homeId as WorkerRecord['homeId'],
    name,
    skillBp: bp(5_000),
    salaryPerGameHour: SALARY,
    status: WorkerStatus.IDLE,
    currentTaskId: null,
    completedTaskCount: 0,
    hiredGameMs,
    terminatedGameMs,
  };
}

/** The settlement mark of the player, which is where the next accrual window starts. */
async function settlementMark(): Promise<GameMs> {
  const row = await harness.prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { lastAccrualGameMs: true },
  });
  return gameMs(row.lastAccrualGameMs);
}

/**
 * Moves the injected clock and renews the session.
 *
 * The access token lives fifteen minutes of real time and the verifier reads the injected
 * clock, so advancing whole game hours expires it. Renewing here keeps every assertion below
 * about wages and never about a session.
 */
async function advanceGameHours(hours: number): Promise<void> {
  harness.advanceGameHours(hours);
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: harness.email('wages'), password: 'contrasena-de-prueba' },
  });
  expect(response.statusCode, response.body).toBe(200);
  accessToken = response.json<{ accessToken: string }>().accessToken;
}

/** Settles the player up to the current instant of the injected clock. */
async function settleNow(): Promise<void> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/dev/advance-player',
    headers: bearer(accessToken),
    payload: { toGameMs: harness.gameNow().toString() },
  });
  expect(response.statusCode, response.body).toBe(200);
}

/** Every wage entry of the player, summed. The ledger is append only, so this only grows. */
async function wagesCharged(): Promise<Money> {
  const rows = await harness.prisma.ledgerEntry.findMany({
    where: { playerId, type: LedgerType.WORKER_WAGES },
    select: { amount: true },
  });
  // The entries are negative, because a charge is a signed amount (ADR-0009); what is
  // compared is the magnitude.
  return Money.negate(Money.sum(rows.map((row) => Money.fromString(row.amount.toFixed(4)))));
}

/** Difference between two amounts, as a number, for a tolerance comparison. */
function gap(left: Money, right: Money): number {
  return Math.abs(Number(Money.toString(Money.sub(left, right))));
}

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

describe('el devengo de un salario (GDD 107)', () => {
  /**
   * Empties the payroll and settles, so every case below starts from an empty window.
   *
   * The rows are deleted rather than dismissed, which a route would never do: the point is to
   * isolate the case, and the ledger entries already written survive anyway, because a
   * ledger entry refers to its origin without a foreign key (ADR-0009). The settlement then
   * closes the previous window, so `lastAccrualGameMs` is exactly where this case begins.
   */
  beforeEach(async () => {
    await harness.prisma.worker.deleteMany({ where: { playerId } });
    await settleNow();
  });

  it('cobra desde el instante de contratacion y no la ventana entera', async () => {
    const chargedBefore = await wagesCharged();
    const windowStart = await settlementMark();

    // Six hours with nobody on the payroll, then a hire, then six more.
    await advanceGameHours(6);
    const hiredAt = harness.gameNow();
    const worker = await createWorker('Contratado a mitad', hiredAt, null);
    await advanceGameHours(6);

    await settleNow();
    const window: GameInterval = { fromGameMs: windowStart, toGameMs: harness.gameNow() };
    const expected = accruedWages(worker, window);

    // Six hours of the twelve, which is the overlap and not the window.
    expect(expected).toBe(Money.mulHours(SALARY, gameHours(6)));
    expect(gap(Money.sub(await wagesCharged(), chargedBefore), expected)).toBeLessThanOrEqual(
      0.0001,
    );
  });

  it('es aditivo: liquidar en dos tramos cobra lo mismo que liquidar de una vez', async () => {
    const chargedBefore = await wagesCharged();
    const windowStart = await settlementMark();
    const worker = await createWorker('Plantilla estable', windowStart, null);

    // Four settlements over twenty hours. Each one charges its own slice, and the sum has to
    // be the integral of the whole span: this is the property that makes a worker process
    // that was down for a day harmless (plan section 6.2).
    for (let step = 0; step < 4; step += 1) {
      await advanceGameHours(5);
      await settleNow();
    }

    const window: GameInterval = { fromGameMs: windowStart, toGameMs: harness.gameNow() };
    const expected = accruedWages(worker, window);
    expect(expected).toBe(Money.mulHours(SALARY, gameHours(20)));
    // Four settlements, so four roundings of one ten-thousandth at most.
    expect(gap(Money.sub(await wagesCharged(), chargedBefore), expected)).toBeLessThanOrEqual(
      0.0004,
    );

    await harness.prisma.worker.update({
      where: { id: worker.id },
      data: { terminatedGameMs: harness.gameNow() },
    });
  });

  it('cobra a un trabajador contratado y despedido dentro de la misma ventana', async () => {
    const chargedBefore = await wagesCharged();
    const windowStart = await settlementMark();

    // The whole employment happens between two settlements: hired three hours in, dismissed
    // ten hours later, and the window runs for thirty. Nobody is on the payroll when the
    // settlement runs, which is exactly the case a "sum the current payroll" model gets
    // wrong.
    const hiredAt = gameMs(windowStart + 3n * 3_600_000n);
    const firedAt = gameMs(windowStart + 13n * 3_600_000n);
    const worker = await createWorker('Temporal', hiredAt, firedAt);

    await advanceGameHours(30);
    await settleNow();

    expect(await harness.prisma.worker.count({ where: { playerId, terminatedGameMs: null } })).toBe(
      0,
    );

    const window: GameInterval = { fromGameMs: windowStart, toGameMs: harness.gameNow() };
    const expected = accruedWages(worker, window);
    expect(expected).toBe(Money.mulHours(SALARY, gameHours(10)));
    expect(gap(Money.sub(await wagesCharged(), chargedBefore), expected)).toBeLessThanOrEqual(
      0.0001,
    );
  });

  it('no cobra nada por un intervalo que no solapa la ventana', async () => {
    const chargedBefore = await wagesCharged();
    const windowStart = await settlementMark();

    // Employed entirely in the past, before the mark: the overlap is empty and the integral
    // is zero, which is what keeps a settlement from charging history twice.
    const worker = await createWorker(
      'Del pasado',
      gameMs(windowStart - 40n * 3_600_000n),
      gameMs(windowStart - 20n * 3_600_000n),
    );
    await advanceGameHours(8);
    await settleNow();

    const window: GameInterval = { fromGameMs: windowStart, toGameMs: harness.gameNow() };
    expect(accruedWages(worker, window)).toBe(Money.ZERO);
    expect(await wagesCharged()).toBe(chargedBefore);
  });

  it('la nomina por hora de juego es la suma de los salarios vivos (GDD 107)', async () => {
    const a = await createWorker('Nomina uno', harness.gameNow(), null);
    const b = await createWorker('Nomina dos', harness.gameNow(), null);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/workers',
      headers: bearer(accessToken),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      workers: { id: string }[];
      totalSalaryPerGameHour: string;
      homeSlotsUsed: number;
      homeSlotsTotal: number;
    }>();

    expect(body.workers.map((worker) => worker.id).sort()).toEqual([a.id, b.id].sort());
    expect(body.totalSalaryPerGameHour).toBe(Money.add(SALARY, SALARY));
    expect(body.homeSlotsUsed).toBe(2);
    expect(body.homeSlotsTotal).toBe(4);
  });
});
