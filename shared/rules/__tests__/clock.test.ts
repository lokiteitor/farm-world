import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_RATE } from '../../config/time.js';
import { type WorldClockAnchor } from '../../domain/entities.js';
import { gameMs, realMs } from '../../domain/units.js';
import {
  closeInterval,
  gameMsAt,
  intervalLengthGameMs,
  isPaused,
  overlapGameHours,
  overlapGameMs,
  reanchor,
  realMsFor,
} from '../clock.js';

// Table cases of the clock. The algebraic laws live in properties.test.ts; here the
// point is the concrete arithmetic of the anchor, including the rounding direction on
// each side, which is what the scheduler depends on.

const EPOCH = realMs(1_700_000_000_000n);

function anchorAt(rateNum: number, rateDen: number, gameOffset = 0n): WorldClockAnchor {
  return {
    anchorGameMs: gameMs(gameOffset),
    anchorRealMs: EPOCH,
    rateNum,
    rateDen,
    scheduleEpoch: 1,
  };
}

describe('gameMsAt', () => {
  it('advances 24 game hours per real hour at the default rate', () => {
    // GDD section 51 leaves the multiplier as server configuration; plan section 2 fixes
    // the default at 24 game hours per real hour, so a real hour is a game day.
    const anchor = anchorAt(DEFAULT_GAME_RATE.rateNum, DEFAULT_GAME_RATE.rateDen);
    const oneRealHour = realMs(EPOCH + 3_600_000n);
    expect(gameMsAt(anchor, oneRealHour)).toBe(gameMs(24n * 3_600_000n));
  });

  it('supports the accelerated rate the smoke test uses', () => {
    // Plan section 10: one game hour in ten real milliseconds, so the 325 hour cycle of
    // GDD section 118 completes in about three and a quarter real seconds of clock.
    const anchor = anchorAt(360_000, 1);
    expect(gameMsAt(anchor, realMs(EPOCH + 10n))).toBe(gameMs(3_600_000n));
  });

  it('rounds towards the past, so the clock cannot jump ahead of the elapsed time', () => {
    // Rate 1/3: one game millisecond every three real ones. Two real milliseconds have
    // not yet produced one game millisecond.
    const anchor = anchorAt(1, 3);
    expect(gameMsAt(anchor, realMs(EPOCH + 2n))).toBe(gameMs(0n));
    expect(gameMsAt(anchor, realMs(EPOCH + 3n))).toBe(gameMs(1n));
  });

  it('clamps at the world epoch for a real instant before the anchor', () => {
    const anchor = anchorAt(24, 1);
    expect(gameMsAt(anchor, realMs(EPOCH - 10_000n))).toBe(gameMs(0n));
  });

  it('stands still while the world is paused', () => {
    const anchor = anchorAt(0, 1, 5_000n);
    expect(isPaused(anchor)).toBe(true);
    expect(gameMsAt(anchor, realMs(EPOCH + 10n ** 9n))).toBe(gameMs(5_000n));
  });
});

describe('realMsFor', () => {
  it('inverts the conversion exactly when the rate divides evenly', () => {
    const anchor = anchorAt(24, 1);
    expect(realMsFor(anchor, gameMs(24n * 3_600_000n))).toBe(realMs(EPOCH + 3_600_000n));
  });

  it('rounds up, so a job is never scheduled before its due instant', () => {
    // Rate 3/1: one real millisecond produces three game ones, so game instant 1 is only
    // reached after a whole real millisecond has passed.
    const anchor = anchorAt(3, 1);
    expect(realMsFor(anchor, gameMs(1n))).toBe(realMs(EPOCH + 1n));
    expect(realMsFor(anchor, gameMs(3n))).toBe(realMs(EPOCH + 1n));
    expect(realMsFor(anchor, gameMs(4n))).toBe(realMs(EPOCH + 2n));
  });

  it('returns null for a paused world, which is what parks an event instead of spinning', () => {
    expect(realMsFor(anchorAt(0, 1), gameMs(1_000n))).toBeNull();
  });

  it('rejects an anchor with a non integer or negative rate', () => {
    expect(() => gameMsAt(anchorAt(1.5, 1), EPOCH)).toThrow(RangeError);
    expect(() => gameMsAt(anchorAt(-1, 1), EPOCH)).toThrow(RangeError);
    expect(() => gameMsAt(anchorAt(1, 0), EPOCH)).toThrow(RangeError);
  });
});

describe('reanchor', () => {
  it('freezes the past under the previous rate and re-anchors on the current instant', () => {
    const anchor = anchorAt(24, 1);
    const at = realMs(EPOCH + 3_600_000n);
    const result = reanchor(anchor, at, { rateNum: 1, rateDen: 1 });
    // The game instant is continuous across the change: no rewind and no jump.
    expect(result.anchor.anchorGameMs).toBe(gameMs(24n * 3_600_000n));
    expect(result.anchor.anchorRealMs).toBe(at);
    expect(result.anchor.rateNum).toBe(1);
    expect(result.anchor.scheduleEpoch).toBe(anchor.scheduleEpoch + 1);
    expect(gameMsAt(result.anchor, at)).toBe(gameMsAt(anchor, at));
    // The frozen segment records the stretch that ran under the old multiplier.
    expect(result.frozen).toEqual({
      fromGameMs: gameMs(0n),
      toGameMs: gameMs(24n * 3_600_000n),
      fromRealMs: EPOCH,
      toRealMs: at,
      rateNum: 24,
      rateDen: 1,
    });
  });

  it('pausing and resuming loses no game time', () => {
    const running = anchorAt(24, 1);
    const pauseAt = realMs(EPOCH + 1_000_000n);
    const paused = reanchor(running, pauseAt, { rateNum: 0, rateDen: 1 }).anchor;
    const resumeAt = realMs(EPOCH + 9_000_000n);
    const resumed = reanchor(paused, resumeAt, { rateNum: 24, rateDen: 1 }).anchor;
    expect(gameMsAt(resumed, resumeAt)).toBe(gameMsAt(running, pauseAt));
    // And the clock runs again from there.
    expect(gameMsAt(resumed, realMs(resumeAt + 1_000n))).toBe(
      gameMs(gameMsAt(running, pauseAt) + 24_000n),
    );
  });
});

describe('overlap', () => {
  const hour = 3_600_000n;

  it('measures the intersection of two intervals in game hours', () => {
    const overlap = overlapGameHours(
      { fromGameMs: gameMs(0n), toGameMs: gameMs(10n * hour) },
      { fromGameMs: gameMs(4n * hour), toGameMs: gameMs(30n * hour) },
    );
    expect(overlap).toBe(6);
  });

  it('is zero for disjoint or inverted intervals instead of failing', () => {
    expect(
      overlapGameMs(
        { fromGameMs: gameMs(0n), toGameMs: gameMs(hour) },
        { fromGameMs: gameMs(2n * hour), toGameMs: gameMs(3n * hour) },
      ),
    ).toBe(0n);
    expect(
      overlapGameMs(
        { fromGameMs: gameMs(5n * hour), toGameMs: gameMs(hour) },
        { fromGameMs: gameMs(0n), toGameMs: gameMs(10n * hour) },
      ),
    ).toBe(0n);
  });

  it('closes an open interval at the horizon, which is how a validity interval is read', () => {
    const horizon = gameMs(100n * hour);
    expect(closeInterval({ fromGameMs: gameMs(0n), toGameMs: null }, horizon)).toEqual({
      fromGameMs: gameMs(0n),
      toGameMs: horizon,
    });
    expect(closeInterval({ fromGameMs: gameMs(0n), toGameMs: gameMs(hour) }, horizon)).toEqual({
      fromGameMs: gameMs(0n),
      toGameMs: gameMs(hour),
    });
  });

  it('measures the length of an interval and never a negative one', () => {
    expect(intervalLengthGameMs({ fromGameMs: gameMs(0n), toGameMs: gameMs(hour) })).toBe(hour);
    expect(intervalLengthGameMs({ fromGameMs: gameMs(hour), toGameMs: gameMs(0n) })).toBe(0n);
  });
});
