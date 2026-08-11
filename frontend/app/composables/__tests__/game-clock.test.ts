// Extrapolation and hard correction of the client clock.
//
// Owner: W3-C.
//
// Wall time is injected, so what is tested is the arithmetic and not the machine: the clock
// advances by the multiplier between readings, it never goes backwards when the system clock is
// corrected downwards, and a drift beyond the threshold of shared/config is corrected in one
// step rather than absorbed. The last one is the property that matters: a countdown that slides
// towards the truth makes every duration in the interface subtly wrong for as long as it slides.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameClock } from '~/composables/useGameClock';
import {
  CLOCK_RESYNC_THRESHOLD_GAME_MS,
  MS_PER_GAME_HOUR,
  toWireGameMs,
  toWireRealMs,
  gameMs,
  realMs,
  type ClockDto,
} from '~/shared/index';
import { useClockStore } from '~/stores/clock';

const ANCHOR_REAL_MS = 1_700_000_000_000;
const ANCHOR_GAME_MS = 3_456_000_000n;

/** The reading of a world running at twenty four game hours per real hour. */
function reading(overrides: Partial<ClockDto> = {}): ClockDto {
  return {
    gameMs: toWireGameMs(gameMs(ANCHOR_GAME_MS)),
    realMs: toWireRealMs(realMs(BigInt(ANCHOR_REAL_MS))),
    anchorGameMs: toWireGameMs(gameMs(ANCHOR_GAME_MS)),
    anchorRealMs: toWireRealMs(realMs(BigInt(ANCHOR_REAL_MS))),
    rateNum: 24,
    rateDen: 1,
    scheduleEpoch: 1,
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('el reloj del cliente', () => {
  it('extrapola desde el ancla con el multiplicador racional', () => {
    const store = useClockStore();
    let now = ANCHOR_REAL_MS;
    const clock = useGameClock({ now: () => now, autoStart: false });
    store.applyClock(reading(), now);

    // Una hora real a 24x son veinticuatro horas de juego.
    now = ANCHOR_REAL_MS + 3_600_000;
    expect(clock.tick()).toBe(gameMs(ANCHOR_GAME_MS + 24n * MS_PER_GAME_HOUR));

    now = ANCHOR_REAL_MS + 7_200_000;
    expect(clock.tick()).toBe(gameMs(ANCHOR_GAME_MS + 48n * MS_PER_GAME_HOUR));
  });

  it('se detiene con el mundo en pausa', () => {
    const store = useClockStore();
    let now = ANCHOR_REAL_MS;
    const clock = useGameClock({ now: () => now, autoStart: false });
    store.applyClock(reading({ rateNum: 0 }), now);
    clock.tick();

    now = ANCHOR_REAL_MS + 3_600_000;
    expect(clock.tick()).toBe(gameMs(ANCHOR_GAME_MS));
    expect(clock.paused.value).toBe(true);
  });

  it('nunca retrocede cuando el reloj de la maquina se corrige hacia atras', () => {
    const store = useClockStore();
    let now = ANCHOR_REAL_MS + 3_600_000;
    const clock = useGameClock({ now: () => now, autoStart: false });
    store.applyClock(reading(), now);
    const ahead = clock.tick();

    now = ANCHOR_REAL_MS + 600_000;
    expect(clock.tick()).toBe(ahead);
  });

  it('salta en seco cuando la desviacion supera el umbral', () => {
    const store = useClockStore();
    const now = ANCHOR_REAL_MS;
    const clock = useGameClock({ now: () => now, autoStart: false });
    store.applyClock(reading(), now);
    clock.tick();
    expect(clock.hardJumps.value).toBe(0);

    // El servidor re-ancla muy por delante: mas que el umbral de cinco minutos de juego.
    const jumped = ANCHOR_GAME_MS + CLOCK_RESYNC_THRESHOLD_GAME_MS * 10n;
    store.applyClock(
      reading({
        anchorGameMs: toWireGameMs(gameMs(jumped)),
        gameMs: toWireGameMs(gameMs(jumped)),
      }),
      now,
    );

    expect(store.hardJumpCount).toBe(1);
    expect(clock.hardJumps.value).toBe(1);
    expect(clock.gameMs.value).toBe(gameMs(jumped));
  });

  it('no salta por una desviacion menor que el umbral', () => {
    const store = useClockStore();
    const now = ANCHOR_REAL_MS;
    const clock = useGameClock({ now: () => now, autoStart: false });
    store.applyClock(reading(), now);
    clock.tick();

    const nudged = ANCHOR_GAME_MS + CLOCK_RESYNC_THRESHOLD_GAME_MS / 2n;
    store.applyClock(
      reading({
        anchorGameMs: toWireGameMs(gameMs(nudged)),
        gameMs: toWireGameMs(gameMs(nudged)),
      }),
      now,
    );

    expect(store.hardJumpCount).toBe(0);
    // La desviacion se absorbe: el valor mostrado sigue la nueva lectura sin contarse
    // como salto, porque el reloj es monotono y la nueva lectura va por delante.
    expect(clock.gameMs.value).toBe(gameMs(nudged));
  });
});
