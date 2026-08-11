// Exact decimal money, with four decimal places.
//
// Owner: workflow W2 (vocabulary).
//
// Design (plan sections 5.3 and 6.2):
//
//   - Money is stored in PostgreSQL as `numeric(20,4)` and travels on the wire as
//     a decimal string. The server never returns a formatted amount; formatting
//     for the interface is `toDisplay`, which the client calls.
//   - The arithmetic is exact: an internal `bigint` scaled by 10^4, with no
//     external dependency. Floating point is never used to hold an amount.
//   - Amounts are not kept in whole cents. Settlement is very frequent by design
//     (every write path settles accruals), and rounding to cents on each
//     settlement accumulates a systematic bias in favour of the player.
//   - Rounding, where a division is unavoidable, is half away from zero on the
//     fourth decimal place, which is one hundredth of a cent per operation.
//
// The canonical representation of a `Money` value always carries exactly four
// decimal places ('160000.0000'), and this module is the only place that
// constructs one, so equality of two amounts is string equality.

import { MS_PER_GAME_HOUR, type Bp, type Brand, type GameHours } from './units.js';

/** A decimal amount with four decimal places, as its canonical string form. */
export type Money = Brand<string, 'Money'>;

/** Decimal places of the stored scale. Matches `numeric(20,4)`. */
const SCALE_DECIMALS = 4;

/** 10^SCALE_DECIMALS. */
const SCALE = 10_000n;

/** Decimal places shown in the interface. */
const DISPLAY_DECIMALS = 2;

/** 10^DISPLAY_DECIMALS. */
const DISPLAY_SCALE = 100n;

/** Accepted input: optional sign, up to 24 integer digits, up to 4 decimals. */
const MONEY_TEXT = /^[+-]?\d{1,24}(?:\.\d{1,4})?$/;

/** Fixed precision used to turn a `GameHours` value into an exact rational. */
const HOURS_PRECISION = 1_000_000n;

/** Fixed precision used to turn a floating point ratio into an exact rational. */
const RATIO_PRECISION = 1_000_000_000n;

/** Parses a canonical amount into scaled integer units. */
function parse(text: string): bigint {
  if (!MONEY_TEXT.test(text)) {
    throw new RangeError(`Not a decimal amount: ${JSON.stringify(text)}`);
  }
  const negative = text.startsWith('-');
  const unsigned = negative || text.startsWith('+') ? text.slice(1) : text;
  const dot = unsigned.indexOf('.');
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DECIMALS, '0'));
  return negative ? -scaled : scaled;
}

/** Renders scaled integer units as the canonical four-decimal string. */
function format(scaled: bigint): Money {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / SCALE;
  const fraction = absolute % SCALE;
  const sign = negative ? '-' : '';
  const decimals = fraction.toString().padStart(SCALE_DECIMALS, '0');
  return `${sign}${whole.toString()}.${decimals}` as Money;
}

/** Integer division rounding half away from zero. `denominator` must be > 0. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError(`Denominator must be positive: ${denominator}`);
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Converts a finite multiplier into an exact rational numerator. */
function scaleFactor(factor: number, precision: bigint, label: string): bigint {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`${label} must be finite: ${factor}`);
  }
  const scaled = factor * Number(precision);
  if (!Number.isSafeInteger(Math.round(scaled))) {
    throw new RangeError(`${label} out of the exactly representable range: ${factor}`);
  }
  return BigInt(Math.round(scaled));
}

const ZERO = format(0n);

/**
 * Arithmetic over `Money`. Exported as a namespace object rather than as loose
 * functions so that call sites read as `Money.add(a, b)` and so that the type and
 * its operations share one name.
 */
export const Money = {
  /** 0.0000. */
  ZERO,

  /** Builds an amount from whole currency units, for example 160000 -> '160000.0000'. */
  fromUnits(wholeUnits: number | bigint): Money {
    if (typeof wholeUnits === 'number' && !Number.isSafeInteger(wholeUnits)) {
      throw new RangeError(`Whole currency units must be a safe integer: ${wholeUnits}`);
    }
    return format(BigInt(wholeUnits) * SCALE);
  },

  /** Parses and normalises a decimal literal with up to four decimal places. */
  fromString(text: string): Money {
    return format(parse(text));
  },

  /**
   * Builds an amount from scaled integer units (ten-thousandths). The inverse of
   * `toScaled`; both exist for the ledger self-audit test and for callers that
   * need to sum thousands of rows without re-parsing.
   */
  fromScaled(scaled: bigint): Money {
    return format(scaled);
  },

  /** Scaled integer units (ten-thousandths) of an amount. */
  toScaled(value: Money): bigint {
    return parse(value);
  },

  add(left: Money, right: Money): Money {
    return format(parse(left) + parse(right));
  },

  sub(left: Money, right: Money): Money {
    return format(parse(left) - parse(right));
  },

  negate(value: Money): Money {
    return format(-parse(value));
  },

  sum(values: readonly Money[]): Money {
    let total = 0n;
    for (const value of values) {
      total += parse(value);
    }
    return format(total);
  },

  /**
   * Multiplies a rate per game hour by a duration expressed in game
   * milliseconds. This is the exact path used by the continuous cost accrual of
   * plan section 6.2, where the interval always comes from the game clock.
   */
  mulGameMs(ratePerGameHour: Money, durationGameMs: bigint): Money {
    if (durationGameMs < 0n) {
      throw new RangeError(`A duration cannot be negative: ${durationGameMs}`);
    }
    return format(divideRounded(parse(ratePerGameHour) * durationGameMs, MS_PER_GAME_HOUR));
  },

  /**
   * Multiplies a rate per game hour by a duration in game hours. The duration is
   * taken with a precision of 10^-6 game hours, that is 3.6 milliseconds of game
   * time; prefer `mulGameMs` when the interval comes from stored instants.
   */
  mulHours(ratePerGameHour: Money, hours: GameHours): Money {
    if (hours < 0) {
      throw new RangeError(`A duration cannot be negative: ${hours}`);
    }
    const numerator = parse(ratePerGameHour) * scaleFactor(hours, HOURS_PRECISION, 'Game hours');
    return format(divideRounded(numerator, HOURS_PRECISION));
  },

  /**
   * Multiplies by a floating point ratio, taken with a precision of 10^-9. Used
   * where the multiplier comes from a balance curve; when the multiplier is a
   * stored domain percentage, use `mulBp`, which is exact.
   */
  mulRatio(value: Money, ratio: number): Money {
    const numerator = parse(value) * scaleFactor(ratio, RATIO_PRECISION, 'Ratio');
    return format(divideRounded(numerator, RATIO_PRECISION));
  },

  /** Multiplies by a fraction in basis points. Exact. */
  mulBp(value: Money, factor: Bp): Money {
    return format(divideRounded(parse(value) * BigInt(factor), 10_000n));
  },

  /** -1, 0 or 1, following the convention of a comparison function. */
  compare(left: Money, right: Money): -1 | 0 | 1 {
    const a = parse(left);
    const b = parse(right);
    if (a < b) {
      return -1;
    }
    return a > b ? 1 : 0;
  },

  isNegative(value: Money): boolean {
    return parse(value) < 0n;
  },

  isZero(value: Money): boolean {
    return parse(value) === 0n;
  },

  min(left: Money, right: Money): Money {
    return parse(left) <= parse(right) ? left : right;
  },

  max(left: Money, right: Money): Money {
    return parse(left) >= parse(right) ? left : right;
  },

  /**
   * The canonical four-decimal string. This is what crosses the wire and what
   * reaches `numeric(20,4)`; it exists as a function so that no caller has to
   * touch the brand.
   */
  toString(value: Money): string {
    return value;
  },

  /**
   * Two decimal places, rounded half away from zero, for the interface only.
   * The server never returns a formatted amount (plan section 5.3).
   */
  toDisplay(value: Money): string {
    const cents = divideRounded(parse(value), SCALE / DISPLAY_SCALE);
    const negative = cents < 0n;
    const absolute = negative ? -cents : cents;
    const whole = absolute / DISPLAY_SCALE;
    const fraction = absolute % DISPLAY_SCALE;
    const sign = negative ? '-' : '';
    const decimals = fraction.toString().padStart(DISPLAY_DECIMALS, '0');
    return `${sign}${whole.toString()}.${decimals}`;
  },
} as const;
