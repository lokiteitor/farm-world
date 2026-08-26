// Conversions between real time and game time, and the overlap integral.
//
// Owner: workflow W2 (pure rules). Imported by the backend clock plugin, by the
// scheduler and by the extrapolating clock of the client.
//
// Invariant 1 of plan section 6.1: every instant with simulation or economic
// meaning is a `GameMs`, the anchor carries a rational multiplier so that the
// conversion is invertible without floating point error, and the clock never
// rewinds. Two consequences are encoded here rather than left to the callers:
//
//   - `gameMsAt` uses `floorDiv` and is therefore monotone non decreasing in the
//     real instant. A clock that could go backwards for one millisecond would
//     make a due guard fire twice.
//   - `realMsFor` uses `ceilDiv`, so the real instant it returns never precedes
//     the game instant asked for: `gameMsAt(realMsFor(g)) >= g` for every `g`.
//     That is the "no early firing" property the scheduler depends on, since a
//     job that runs early is re-enqueued and, with a paused world, would spin.
//
// Everything here is total: an interval whose end precedes its start is empty
// rather than an error, and an instant that would fall before the world epoch is
// clamped to it. The only inputs that throw are a malformed anchor (a negative or
// non integer rate, a zero denominator), which is corrupt data and not a domain
// edge case.

import { GAME_HOURS_PER_SEASON, SEASON_EPOCH_GAME_MS } from '../config/time.js';
import { type WorldClockAnchor } from '../domain/entities.js';
import { SEASONS, Season } from '../domain/enums.js';
import {
  GAME_MS_ZERO,
  MS_PER_GAME_HOUR,
  ceilDiv,
  floorDiv,
  gameHours,
  gameMs,
  realMs,
  type GameHours,
  type GameMs,
  type RealMs,
} from '../domain/units.js';

/** Rational multiplier: game milliseconds elapsed per real millisecond. */
export interface ClockRate {
  readonly rateNum: number;
  readonly rateDen: number;
}

/** A closed-open interval of game time, `[fromGameMs, toGameMs)`. */
export interface GameInterval {
  readonly fromGameMs: GameMs;
  readonly toGameMs: GameMs;
}

/**
 * An interval of game time whose end may still be open, which is the shape every
 * validity interval of plan section 5.3 has: a worker that has not been dismissed,
 * a machine that has not been sold, a task that has not ended.
 */
export interface OpenGameInterval {
  readonly fromGameMs: GameMs;
  readonly toGameMs: GameMs | null;
}

/**
 * The stretch of world time that a re-anchoring freezes under the previous
 * multiplier. The backend completes it with `worldId` and `seq` to write a
 * `WorldTimeSegment` row; those two are storage identity and not clock arithmetic,
 * which is why they are not computed here.
 */
export interface FrozenTimeSegment {
  readonly fromGameMs: GameMs;
  readonly toGameMs: GameMs;
  readonly fromRealMs: RealMs;
  readonly toRealMs: RealMs;
  readonly rateNum: number;
  readonly rateDen: number;
}

/** Result of a re-anchoring: the new anchor and the segment it closed. */
export interface Reanchoring {
  readonly anchor: WorldClockAnchor;
  readonly frozen: FrozenTimeSegment;
}

/**
 * Rejects a malformed anchor. A rate is a non negative integer over a positive
 * integer: `rateNum = 0` is a paused world, a negative numerator would rewind the
 * clock, and a non integer would defeat the whole point of a rational anchor.
 */
function assertRate(rate: ClockRate): void {
  if (!Number.isInteger(rate.rateNum) || !Number.isInteger(rate.rateDen)) {
    throw new RangeError(
      `The clock rate must be a ratio of integers: ${rate.rateNum}/${rate.rateDen}`,
    );
  }
  if (rate.rateNum < 0) {
    throw new RangeError(`The clock rate cannot be negative: ${rate.rateNum}`);
  }
  if (rate.rateDen <= 0) {
    throw new RangeError(`The denominator of the clock rate must be positive: ${rate.rateDen}`);
  }
}

/** True when the world is paused, which is `rateNum = 0` (plan section 6.1). */
export function isPaused(rate: ClockRate): boolean {
  assertRate(rate);
  return rate.rateNum === 0;
}

/**
 * Game instant corresponding to a real instant.
 *
 * `anchorGameMs + floorDiv((realMs - anchorRealMs) x rateNum, rateDen)`, clamped at
 * the world epoch: a real instant before the anchor of a world that started at
 * `gameMs = 0` has no game instant of its own, and clamping keeps the function
 * total and still monotone.
 */
export function gameMsAt(anchor: WorldClockAnchor, atRealMs: RealMs): GameMs {
  assertRate(anchor);
  const elapsedRealMs = atRealMs - anchor.anchorRealMs;
  const elapsedGameMs = floorDiv(elapsedRealMs * BigInt(anchor.rateNum), BigInt(anchor.rateDen));
  const value = anchor.anchorGameMs + elapsedGameMs;
  return value <= 0n ? GAME_MS_ZERO : gameMs(value);
}

/**
 * Real instant at which a game instant is reached, or null if the world is paused
 * and the instant is therefore never reached.
 *
 * `anchorRealMs + ceilDiv((gameMs - anchorGameMs) x rateDen, rateNum)`, clamped at
 * zero. Rounding up is what guarantees the absence of early firing; clamping only
 * ever moves the instant later, so it preserves the guarantee.
 */
export function realMsFor(anchor: WorldClockAnchor, targetGameMs: GameMs): RealMs | null {
  assertRate(anchor);
  if (anchor.rateNum === 0) {
    return null;
  }
  const deltaGameMs = targetGameMs - anchor.anchorGameMs;
  const deltaRealMs = ceilDiv(deltaGameMs * BigInt(anchor.rateDen), BigInt(anchor.rateNum));
  const value = anchor.anchorRealMs + deltaRealMs;
  return value <= 0n ? realMs(0n) : realMs(value);
}

/**
 * Re-anchors the clock at a real instant under a new multiplier (plan section 6.1).
 *
 * Changing the multiplier is a domain operation and not a configuration update: the
 * past is frozen under the previous rate, the anchor moves to the current game
 * instant so that nothing is rewound or skipped, and `scheduleEpoch` is
 * incremented so that jobs written under the previous epoch can be discarded
 * instead of firing at the wrong time.
 */
export function reanchor(
  anchor: WorldClockAnchor,
  atRealMs: RealMs,
  nextRate: ClockRate,
): Reanchoring {
  assertRate(anchor);
  assertRate(nextRate);
  const atGameMs = gameMsAt(anchor, atRealMs);
  return {
    anchor: {
      anchorGameMs: atGameMs,
      anchorRealMs: atRealMs,
      rateNum: nextRate.rateNum,
      rateDen: nextRate.rateDen,
      scheduleEpoch: anchor.scheduleEpoch + 1,
    },
    frozen: {
      fromGameMs: anchor.anchorGameMs,
      toGameMs: atGameMs,
      fromRealMs: anchor.anchorRealMs,
      toRealMs: atRealMs,
      rateNum: anchor.rateNum,
      rateDen: anchor.rateDen,
    },
  };
}

/** Resolves an open interval against a horizon, which is the instant "now". */
export function closeInterval(interval: OpenGameInterval, horizonGameMs: GameMs): GameInterval {
  return {
    fromGameMs: interval.fromGameMs,
    toGameMs: interval.toGameMs === null ? horizonGameMs : interval.toGameMs,
  };
}

/**
 * Length of the intersection of two intervals, in whole game milliseconds.
 *
 * This is the primitive the continuous cost accrual of plan section 6.2 is built
 * on, and it is exact: `bigint` arithmetic, no rounding. Empty intersections and
 * inverted intervals give zero, which makes the function total and makes the sum
 * over a partition of an interval exactly equal to the whole.
 */
export function overlapGameMs(a: GameInterval, b: GameInterval): bigint {
  const from = a.fromGameMs > b.fromGameMs ? a.fromGameMs : b.fromGameMs;
  const to = a.toGameMs < b.toGameMs ? a.toGameMs : b.toGameMs;
  const length = to - from;
  return length > 0n ? length : 0n;
}

/** Length of an interval in whole game milliseconds; zero when it is inverted. */
export function intervalLengthGameMs(interval: GameInterval): bigint {
  const length = interval.toGameMs - interval.fromGameMs;
  return length > 0n ? length : 0n;
}

/** A duration in game milliseconds as game hours. */
export function gameMsToGameHours(durationGameMs: bigint): GameHours {
  return gameHours(Number(durationGameMs) / Number(MS_PER_GAME_HOUR));
}

/**
 * Length of the intersection of two intervals, in game hours.
 *
 * Commutative, never negative and additive over a partition. Additivity is exact
 * in the millisecond form above and holds here only up to the representation error
 * of a binary floating point number, which is why every economic path uses
 * `overlapGameMs` and this function exists for display and for the estimates of
 * the interface.
 */
export function overlapGameHours(a: GameInterval, b: GameInterval): GameHours {
  return gameMsToGameHours(overlapGameMs(a, b));
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

/**
 * Season of the world at a game instant.
 *
 * Derived and never stored, exactly like the growth stage of a tree: there is no season
 * column anywhere, so nothing can drift out of step with the clock. It is a property of
 * the world and not of the player, taken from the absolute `gameMs`; deriving it from
 * the player's own `startedAtGameMs` would put two players of one world in different
 * seasons at the same instant.
 *
 * Instants before the season epoch clamp to the first spring rather than counting
 * backwards, which is the same total treatment the rest of this module gives an instant
 * before the world epoch.
 */
export function seasonAtGameMs(atGameMs: GameMs): Season {
  // The index is a remainder over the length of the list, so it is always in range; the
  // fallback exists because the type of an index access says otherwise and a non null
  // assertion is forbidden here for good reasons.
  return SEASONS[seasonIndexAt(atGameMs)] ?? Season.SPRING;
}

/** Game instant the season containing `atGameMs` began at. */
export function seasonStartGameMs(atGameMs: GameMs): GameMs {
  const elapsed = elapsedSinceEpoch(atGameMs);
  const seasonMs = seasonLengthGameMs();
  return gameMs(SEASON_EPOCH_GAME_MS + (elapsed / seasonMs) * seasonMs);
}

/** Game instant the next season begins at. Strictly greater than `atGameMs`. */
export function nextSeasonStartGameMs(atGameMs: GameMs): GameMs {
  return gameMs(seasonStartGameMs(atGameMs) + seasonLengthGameMs());
}

/**
 * Game instant at which `seasons` next admits sowing, or `atGameMs` itself when the
 * season already does. Null when the window is empty, which the catalogue forbids and
 * a test enforces, so in practice it never happens.
 *
 * It is what turns a refusal into an answer: the panel can say "maize is sown in
 * spring, three days from now" instead of only saying no.
 */
export function nextSowingWindowGameMs(
  seasons: readonly Season[],
  atGameMs: GameMs,
): GameMs | null {
  if (seasons.length === 0) {
    return null;
  }
  if (seasons.includes(seasonAtGameMs(atGameMs))) {
    return atGameMs;
  }
  let cursor = nextSeasonStartGameMs(atGameMs);
  // At most one full turn of the wheel: the window is non empty, so one of the four
  // seasons matches and the loop cannot run past them.
  for (let step = 1; step < SEASONS.length; step += 1) {
    if (seasons.includes(seasonAtGameMs(cursor))) {
      return cursor;
    }
    cursor = nextSeasonStartGameMs(cursor);
  }
  return null;
}

/** Length of one season in game milliseconds. */
function seasonLengthGameMs(): bigint {
  return BigInt(GAME_HOURS_PER_SEASON) * MS_PER_GAME_HOUR;
}

/** Game milliseconds elapsed since the season epoch, clamped at zero. */
function elapsedSinceEpoch(atGameMs: GameMs): bigint {
  const elapsed = atGameMs - SEASON_EPOCH_GAME_MS;
  return elapsed > 0n ? elapsed : 0n;
}

/** Index of the season in `SEASONS`, which is the cycle order. */
function seasonIndexAt(atGameMs: GameMs): number {
  const seasonsElapsed = elapsedSinceEpoch(atGameMs) / seasonLengthGameMs();
  return Number(seasonsElapsed % BigInt(SEASONS.length));
}
