import { describe, expect, it } from 'vitest';
import {
  GAME_DAYS_PER_SEASON,
  GAME_HOURS_PER_SEASON,
  INITIAL_ANCHOR_GAME_MS,
  SEASON_EPOCH_GAME_MS,
} from '../../config/time.js';
import { SEASONS, Season } from '../../domain/enums.js';
import { MS_PER_GAME_HOUR, gameMs, type GameMs } from '../../domain/units.js';
import {
  nextSeasonStartGameMs,
  nextSowingWindowGameMs,
  seasonAtGameMs,
  seasonStartGameMs,
} from '../clock.js';

const SEASON_MS = BigInt(GAME_HOURS_PER_SEASON) * MS_PER_GAME_HOUR;

/** The instant `seasons` seasons after the epoch, plus an optional offset in game ms. */
function atSeason(index: number, offsetMs = 0n): GameMs {
  return gameMs(SEASON_EPOCH_GAME_MS + BigInt(index) * SEASON_MS + offsetMs);
}

describe('seasons (GDD sections 82 and 86, added by the multi crop catalogue)', () => {
  it('anchors the first spring on the clock anchor and not on zero', () => {
    // The world starts at 960 game hours so a generated old growth tree can carry a
    // planting instant in the past; anchoring the seasons anywhere else would start
    // every world part way through one.
    expect(SEASON_EPOCH_GAME_MS).toBe(INITIAL_ANCHOR_GAME_MS);
    expect(seasonAtGameMs(SEASON_EPOCH_GAME_MS)).toBe(Season.SPRING);
    expect(seasonStartGameMs(SEASON_EPOCH_GAME_MS)).toBe(SEASON_EPOCH_GAME_MS);
  });

  it('turns the four seasons in order and wraps into the next year', () => {
    for (let index = 0; index < SEASONS.length * 3; index += 1) {
      expect(seasonAtGameMs(atSeason(index))).toBe(SEASONS[index % SEASONS.length]);
    }
  });

  it('is closed on the left at every boundary', () => {
    const boundary = atSeason(1);
    expect(seasonAtGameMs(gameMs(boundary - 1n))).toBe(Season.SPRING);
    expect(seasonAtGameMs(boundary)).toBe(Season.SUMMER);
  });

  it('clamps instants before the epoch to the first spring instead of counting back', () => {
    expect(seasonAtGameMs(gameMs(0n))).toBe(Season.SPRING);
    expect(seasonStartGameMs(gameMs(0n))).toBe(SEASON_EPOCH_GAME_MS);
  });

  it('is a pure function of the instant', () => {
    const instant = atSeason(5, SEASON_MS / 3n);
    expect(seasonAtGameMs(instant)).toBe(seasonAtGameMs(instant));
    expect(seasonStartGameMs(instant)).toBe(seasonStartGameMs(instant));
  });

  it('advances by exactly one season length and never stands still', () => {
    const instant = atSeason(2, 17n);
    const next = nextSeasonStartGameMs(instant);
    expect(next).toBeGreaterThan(instant);
    expect(next - seasonStartGameMs(instant)).toBe(SEASON_MS);
    expect(seasonAtGameMs(next)).not.toBe(seasonAtGameMs(instant));
  });

  it('measures a season as thirty game days and a year as four of them', () => {
    expect(GAME_HOURS_PER_SEASON).toBe(GAME_DAYS_PER_SEASON * 24);
    const year = atSeason(SEASONS.length);
    expect(year - SEASON_EPOCH_GAME_MS).toBe(BigInt(SEASONS.length) * SEASON_MS);
    expect(seasonAtGameMs(year)).toBe(Season.SPRING);
  });
});

describe('nextSowingWindowGameMs', () => {
  it('answers with the instant itself when the window is already open', () => {
    const spring = atSeason(0, 5n);
    expect(nextSowingWindowGameMs([Season.SPRING, Season.SUMMER], spring)).toBe(spring);
  });

  it('answers with the start of the next admitted season when it is closed', () => {
    // Standing in spring, a crop sown only in autumn waits two boundaries.
    expect(nextSowingWindowGameMs([Season.AUTUMN], atSeason(0, 5n))).toBe(atSeason(2));
  });

  it('wraps around the year when the window is behind', () => {
    // Standing in summer, a crop sown only in spring waits until the next year.
    expect(nextSowingWindowGameMs([Season.SPRING], atSeason(1, 5n))).toBe(atSeason(4));
  });

  it('answers null for an empty window, which the catalogue forbids', () => {
    expect(nextSowingWindowGameMs([], atSeason(0))).toBeNull();
  });
});
