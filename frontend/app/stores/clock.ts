// The clock anchor, as the server last reported it.
//
// Owner: W3-C.
//
// This store holds the anchor and nothing that ticks. The reason for the split is plan
// section 7: no countdown asks the server for the time, so the interface needs a value
// that advances on its own, and a Pinia state that is written on every animation frame
// would invalidate every computed value that reads it sixty times a second. The anchor
// changes only when a `CLOCK` frame or a reply brings a new one; `useGameClock` is what
// extrapolates from it.
//
// The multiplier is rational and is applied with the same shared function the server
// uses (`gameMsAt`), so the client and the server cannot disagree about what instant it
// is. `rateNum = 0` is a paused world and the interface has to be able to say so: a
// paused clock and a broken client look identical otherwise.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  GAME_MS_ZERO,
  fromWireGameMs,
  fromWireRealMs,
  gameMsAt,
  isPaused,
  realMs,
  realMsFor,
  type ClockDto,
  type GameMs,
  type RealMs,
  type WorldClockAnchor,
} from '~/shared/index';

export const useClockStore = defineStore('clock', () => {
  /** The last reading the server sent, untouched. */
  const dto = ref<ClockDto | null>(null);
  /** Real instant, on this machine, at which that reading was received. */
  const receivedAtRealMs = ref<number | null>(null);
  /**
   * Game instant the extrapolation is showing. Written by `useGameClock` at a low
   * frequency, and read by every countdown; the shell shows it and the panels derive
   * durations from it.
   */
  const displayGameMs = ref<GameMs>(GAME_MS_ZERO);
  /** Times the extrapolation had to jump because it had drifted (plan section 7). */
  const hardJumpCount = ref(0);

  const anchor = computed<WorldClockAnchor | null>(() => {
    const reading = dto.value;
    if (reading === null) {
      return null;
    }
    return {
      anchorGameMs: fromWireGameMs(reading.anchorGameMs),
      anchorRealMs: fromWireRealMs(reading.anchorRealMs),
      rateNum: reading.rateNum,
      rateDen: reading.rateDen,
      scheduleEpoch: reading.scheduleEpoch,
    };
  });

  const paused = computed(() => {
    const reading = dto.value;
    return reading === null ? false : isPaused(reading);
  });

  const ready = computed(() => dto.value !== null);

  /** Game instant the anchor implies for a real instant. Null before the first reading. */
  function gameMsAtRealMs(atRealMs: number): GameMs | null {
    const current = anchor.value;
    if (current === null) {
      return null;
    }
    return gameMsAt(current, realMs(BigInt(Math.trunc(atRealMs))));
  }

  /** Real instant a game instant is reached at, or null with a paused world. */
  function realMsForGameMs(target: GameMs): RealMs | null {
    const current = anchor.value;
    return current === null ? null : realMsFor(current, target);
  }

  /** Applies a reading. Called by the reducer for `CLOCK`, `HELLO` and every reply. */
  function applyClock(reading: ClockDto, atRealMs: number): void {
    dto.value = reading;
    receivedAtRealMs.value = atRealMs;
  }

  function setDisplayGameMs(value: GameMs): void {
    displayGameMs.value = value;
  }

  function countHardJump(): void {
    hardJumpCount.value += 1;
  }

  function reset(): void {
    dto.value = null;
    receivedAtRealMs.value = null;
    displayGameMs.value = GAME_MS_ZERO;
    hardJumpCount.value = 0;
  }

  return {
    dto,
    receivedAtRealMs,
    displayGameMs,
    hardJumpCount,
    anchor,
    paused,
    ready,
    gameMsAtRealMs,
    realMsForGameMs,
    applyClock,
    setDisplayGameMs,
    countHardJump,
    reset,
  };
});
