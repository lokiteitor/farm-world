// Branded primitive types of the domain, with their constructors and conversions.
//
// Owner: workflow W2 (vocabulary). Imported by every other shared module, by the
// backend and by the frontend.
//
// Why branded primitives. The domain carries three different notions of time
// (game milliseconds, real milliseconds and game hours) and two different
// notions of "a fraction" (a plain ratio and a value in basis points). All of
// them would be `number` or `bigint` to the compiler, and plan section 6.1 makes
// the distinction load bearing: real instants exist only as traces, game
// instants are the only ones with simulation or economic meaning, and no game
// time is ever derived from a stored real instant.
//
// `Money` is deliberately declared in money.ts and not here: its type and its
// arithmetic namespace share the name `Money`, so both must be exported from the
// same module for the barrel of shared/domain to re-export the name once.

declare const BRAND: unique symbol;

/**
 * Nominal type helper. `Brand<bigint, 'GameMs'>` is assignable to `bigint` but
 * `bigint` is not assignable to it, so the only way to obtain one is through the
 * constructor declared below, which is where the invariants are checked.
 */
export type Brand<TValue, TTag extends string> = TValue & { readonly [BRAND]: TTag };

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Milliseconds of game time since the world epoch (plan section 6.1). */
export type GameMs = Brand<bigint, 'GameMs'>;

/** Milliseconds of wall-clock time (Unix epoch). Traces and scheduling only. */
export type RealMs = Brand<bigint, 'RealMs'>;

/**
 * Hours of game time. Every cost and duration of the GDD is expressed per game
 * hour (GDD sections 89, 107, 134), so this is the unit of the balance
 * catalogues, while stored instants and intervals use `GameMs`.
 */
export type GameHours = Brand<number, 'GameHours'>;

/** Milliseconds of game time in one game hour. */
export const MS_PER_GAME_HOUR = 3_600_000n;

/** The world epoch, `gameMs = 0`. */
export const GAME_MS_ZERO = 0n as GameMs;

/**
 * Constructor of a game instant. Game time starts at the world epoch and never
 * rewinds (plan section 6.1), so negative values are rejected: an elapsed
 * interval is a plain `bigint`, not a `GameMs`.
 */
export function gameMs(value: bigint): GameMs {
  if (value < 0n) {
    throw new RangeError(`A game instant cannot be negative: ${value}`);
  }
  return value as GameMs;
}

/** Constructor of a real instant (Unix epoch milliseconds). */
export function realMs(value: bigint): RealMs {
  if (value < 0n) {
    throw new RangeError(`A real instant cannot be negative: ${value}`);
  }
  return value as RealMs;
}

/** Constructor of a duration or offset in game hours. May be negative. */
export function gameHours(value: number): GameHours {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Game hours must be finite: ${value}`);
  }
  return value as GameHours;
}

/**
 * Exact difference between two game instants, in game hours.
 *
 * The conversion from `bigint` to `number` is exact for magnitudes below
 * 2^53 ms, that is about 285 000 years of game time, so no precision is lost in
 * practice. The result is negative when `to` precedes `from`.
 */
export function gameHoursBetween(from: GameMs, to: GameMs): GameHours {
  const delta = to - from;
  return (Number(delta) / Number(MS_PER_GAME_HOUR)) as GameHours;
}

/**
 * Converts a duration in game hours into game milliseconds.
 *
 * Rounding, defined once here so that every scheduled instant in the system is
 * reproducible: the result is rounded to the nearest whole millisecond and ties
 * are resolved away from zero. Durations in the domain are never negative
 * (a task duration, a phase duration, a repair duration), so negative input is
 * rejected rather than rounded, which keeps the rule unambiguous.
 */
export function gameHoursToGameMs(hours: GameHours): GameMs {
  if (!Number.isFinite(hours)) {
    throw new RangeError(`Game hours must be finite: ${hours}`);
  }
  if (hours < 0) {
    throw new RangeError(`A duration in game hours cannot be negative: ${hours}`);
  }
  const milliseconds = Math.round(hours * Number(MS_PER_GAME_HOUR));
  if (!Number.isSafeInteger(milliseconds)) {
    throw new RangeError(`Duration out of the exactly representable range: ${hours} game hours`);
  }
  return BigInt(milliseconds) as GameMs;
}

/** Advances a game instant by a signed delta of game milliseconds. */
export function addGameMs(instant: GameMs, delta: bigint): GameMs {
  return gameMs(instant + delta);
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

/**
 * Cubic decimetres in a cubic metre, which is also litres in a cubic metre.
 *
 * Wood is counted in cubic decimetres and grain in litres, so every fungible stock
 * is an integer: the volumes of GDD section 131 are multiples of 0.05 m³, and adding
 * thousands of them as floating point numbers would make a lazy sum depend on its
 * order. The interface divides by this factor to show cubic metres.
 */
export const DM3_PER_M3 = 1000;

// ---------------------------------------------------------------------------
// Integer division with defined sign behaviour
// ---------------------------------------------------------------------------
//
// The clock conversions of plan section 6.1 need division that rounds
// consistently for negative numerators: `floorDiv` gives monotonicity of
// `gameMsAt`, and `ceilDiv` guarantees that `realMsFor` never fires a job early.
// The native `bigint` division truncates towards zero, which does neither.

/** Largest integer not greater than `numerator / denominator`. */
export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero');
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const negativeResult = remainder < 0n !== denominator < 0n;
  return remainder !== 0n && negativeResult ? quotient - 1n : quotient;
}

/** Smallest integer not less than `numerator / denominator`. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero');
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const positiveResult = remainder < 0n === denominator < 0n;
  return remainder !== 0n && positiveResult ? quotient + 1n : quotient;
}

// ---------------------------------------------------------------------------
// Basis points
// ---------------------------------------------------------------------------

/**
 * A fraction in basis points: an integer between 0 and 10 000, where 10 000 is
 * 100 %. Every domain percentage (skill, condition, fertility, weed level,
 * fertilisation) is stored like this and not as a floating point number, so that
 * lazy accrual is deterministic and reproducible in the tests (plan section 5.2).
 */
export type Bp = Brand<number, 'Bp'>;

/** 0 %. */
export const BP_ZERO = 0 as Bp;

/** 100 %. */
export const BP_ONE = 10_000 as Bp;

/** Strict constructor: rejects anything outside the integer range 0..10 000. */
export function bp(value: number): Bp {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Basis points must be an integer: ${value}`);
  }
  if (value < 0 || value > BP_ONE) {
    throw new RangeError(`Basis points out of range 0..${BP_ONE}: ${value}`);
  }
  return value as Bp;
}

/** Rounds to the nearest integer and clamps into 0..10 000. */
export function clampBp(value: number): Bp {
  if (Number.isNaN(value)) {
    throw new RangeError('Basis points cannot be NaN');
  }
  if (value <= 0) {
    return BP_ZERO;
  }
  if (value >= BP_ONE) {
    return BP_ONE;
  }
  return Math.round(value) as Bp;
}

/** Basis points as a ratio in 0..1. */
export function bpToRatio(value: Bp): number {
  return value / BP_ONE;
}

/** Ratio in 0..1 as basis points, rounded and clamped. */
export function ratioToBp(ratio: number): Bp {
  return clampBp(ratio * BP_ONE);
}

/** Percentage in 0..100 as basis points, rounded and clamped. */
export function bpFromPercent(percent: number): Bp {
  return clampBp(percent * 100);
}

/**
 * Basis points as a percentage in 0..100. Used to feed the balance curves,
 * whose nodes are expressed in percent because that is how the GDD states them
 * (GDD sections 77, 78, 91).
 */
export function bpToPercent(value: Bp): number {
  return value / 100;
}
