// The clock against the real database: re-anchoring, the guard trigger and monotonicity.
//
// Owner: workflow W3-A (backend skeleton).
//
// Three things are asserted, and each of them is a rule that the design states and that nothing
// else in the suite would catch:
//
//   1. Changing the multiplier is a domain operation: it freezes the past under the previous rate
//      as a `WorldTimeSegment`, moves the anchor to the current game instant so nothing is rewound
//      or skipped, and increments `scheduleEpoch` so the jobs of the previous epoch are a
//      different set (plan section 6.1).
//   2. The database refuses a bare update of the rate. That trigger is what makes the rule above
//      impossible to bypass, including from a psql session, and a test is the only way to know it
//      is still there.
//   3. The clock never rewinds. If the host clock steps back, the service holds the highest value
//      it has already handed out, because a clock that goes back one millisecond makes a due guard
//      fire twice for the same event.

import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, registerViaHttp, type Harness } from '../../__tests__/harness.js';
import { realMs as toRealMsValue, type RealMs } from '../../shared/index.js';
import { GameClockService } from '../gameClock.js';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

describe('el re-anclaje', () => {
  it('congela el pasado, re-ancla y incrementa el epoch', async () => {
    harness.advanceGameHours(3);
    const before = await harness.services.clock.read();
    expect(before.world.scheduleEpoch).toBe(0);

    const result = await harness.services.clock.retimeWorld({ rateNum: 24, rateDen: 1 });

    expect(result.previousRate).toEqual({ rateNum: 1, rateDen: 1 });
    expect(result.reading.world.rateNum).toBe(24);
    expect(result.reading.world.scheduleEpoch).toBe(1);
    // Nothing is rewound and nothing is skipped: the new anchor is the game instant the old rate
    // had reached.
    expect(result.reanchoring.anchor.anchorGameMs).toBe(result.reanchoring.frozen.toGameMs);
    expect(result.reading.gameNow).toBeGreaterThanOrEqual(before.gameNow);

    const segments = await harness.prisma.worldTimeSegment.findMany({
      where: { worldId: harness.worldId },
      orderBy: { seq: 'asc' },
    });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.seq).toBe(0);
    // The segment carries the rate that was in force during it, which is what makes a past
    // interval reinterpretable after the change.
    expect(segments[0]?.rateNum).toBe(1);
    expect(segments[0]?.fromGameMs).toBe(before.world.anchorGameMs);

    // Back to the rate of the harness, so the rest of the file is unaffected.
    const restored = await harness.services.clock.retimeWorld({ rateNum: 1, rateDen: 1 });
    expect(restored.reading.world.scheduleEpoch).toBe(2);
  });

  it('la base de datos rechaza un cambio de multiplicador que no re-ancla', async () => {
    // The rule lives in `farm_world_guard_world_retime`, so it holds for any writer, including one
    // that bypasses this module entirely.
    await expect(
      harness.prisma.$executeRaw`
        UPDATE "worlds" SET "rateNum" = 99 WHERE "id" = ${harness.worldId}::uuid
      `,
    ).rejects.toThrow(/re-anchor/i);

    const row = await harness.prisma.world.findUniqueOrThrow({
      where: { id: harness.worldId },
      select: { rateNum: true },
    });
    expect(row.rateNum).toBe(1);
  });

  it('reprograma el horizonte cuando la ruta de desarrollo cambia el multiplicador', async () => {
    const player = await registerViaHttp(harness, 'retime-route');
    // Registration scheduled the first settlement sweep of this player, so there is something in
    // the horizon to reschedule.
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/dev/retime',
      headers: bearer(player.accessToken),
      payload: { rateNum: 2, rateDen: 1 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      clock: { rateNum: number; scheduleEpoch: number };
      rescheduledJobs: number;
    }>();
    expect(body.clock.rateNum).toBe(2);
    expect(body.clock.scheduleEpoch).toBeGreaterThanOrEqual(3);
    expect(body.rescheduledJobs).toBeGreaterThanOrEqual(1);

    await harness.services.clock.retimeWorld({ rateNum: 1, rateDen: 1 });
  });

  it('el arranque no cambia el multiplicador de un mundo vivo desde la configuracion', async () => {
    // El punto 3 de ADR-0007: cambiar el multiplicador es una operacion de dominio y no una
    // actualizacion de configuracion. Arrancar un segundo proceso con otro `GAME_RATE_NUM`
    // en su entorno cambiaba el mundo vivo, en silencio, y un `dev/retime` no sobrevivia a
    // un reinicio (hallazgo H2 de docs/revision-alcance.md).
    const retimed = await harness.services.clock.retimeWorld({ rateNum: 36, rateDen: 1 });
    const epochAfterRetime = retimed.reading.world.scheduleEpoch;

    const ignored = await harness.services.clock.verifyOnStartup(
      { rateNum: 1, rateDen: 1 },
      { applyRateFromConfig: false },
    );
    expect(ignored.retimed).toBe(false);
    expect(ignored.rateMismatchIgnored).toBe(true);
    expect(ignored.reading.world.rateNum).toBe(36);
    expect(ignored.reading.world.scheduleEpoch).toBe(epochAfterRetime);

    // Con la autorizacion explicita si se re-ancla, por el mismo camino de dominio: se
    // congela el pasado y se incrementa la epoca.
    const applied = await harness.services.clock.verifyOnStartup(
      { rateNum: 1, rateDen: 1 },
      { applyRateFromConfig: true },
    );
    expect(applied.retimed).toBe(true);
    expect(applied.rateMismatchIgnored).toBe(false);
    expect(applied.reading.world.rateNum).toBe(1);
    expect(applied.reading.world.scheduleEpoch).toBe(epochAfterRetime + 1);

    // Y sin diferencia no hace nada, que es el caso normal.
    const same = await harness.services.clock.verifyOnStartup({ rateNum: 1, rateDen: 1 });
    expect(same.retimed).toBe(false);
    expect(same.rateMismatchIgnored).toBe(false);
  });

  it('pausa el mundo con rateNum cero, que es la unica mitigacion admisible', async () => {
    const paused = await harness.services.clock.retimeWorld({ rateNum: 0, rateDen: 1 });
    expect(paused.reading.paused).toBe(true);
    // With the world paused a future instant is never reached, so the scheduler parks instead of
    // enqueueing (plan section 6.4).
    expect(
      harness.services.clock.realInstantFor(paused.reading.world, paused.reading.gameNow),
    ).toBe(null);
    const resumed = await harness.services.clock.retimeWorld({ rateNum: 1, rateDen: 1 });
    expect(resumed.reading.paused).toBe(false);
  });
});

describe('la proteccion frente al salto del reloj del anfitrion', () => {
  it('no rebobina: mantiene el valor mas alto ya entregado', async () => {
    let injected = harness.nowRealMs();
    const now = (): RealMs => injected;
    const service = new GameClockService({
      prisma: harness.prisma,
      worldSeed: harness.worldSeed,
      logger: pino({ level: 'silent' }),
      now,
    });

    const first = await service.read();
    // The host clock steps back an hour, which is what an operator correcting a drift looks like.
    injected = toRealMsValue(injected - 3_600_000n);
    const second = await service.read();

    expect(second.gameNow).toBe(first.gameNow);

    // And it moves forward again as soon as real time passes the mark.
    injected = toRealMsValue(first.atRealMs + 60_000n);
    const third = await service.read();
    expect(third.gameNow).toBeGreaterThan(first.gameNow);
  });
});
