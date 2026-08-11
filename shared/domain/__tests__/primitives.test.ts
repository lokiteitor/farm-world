import { describe, expect, it } from 'vitest';
import { Money } from '../money.js';
import {
  BP_ONE,
  bp,
  ceilDiv,
  clampBp,
  floorDiv,
  gameHours,
  gameHoursBetween,
  gameHoursToGameMs,
  gameMs,
} from '../units.js';

// The vocabulary carries three invariants that the rest of the system assumes without
// checking again: money is exact and canonical, integer division rounds in a defined
// direction for negative numerators, and a percentage never leaves 0..10 000.

describe('Money', () => {
  it('normalises to four decimal places', () => {
    expect(Money.toString(Money.fromUnits(160_000))).toBe('160000.0000');
    expect(Money.toString(Money.fromString('0.22'))).toBe('0.2200');
    expect(Money.toString(Money.fromString('-8.75'))).toBe('-8.7500');
    expect(Money.toString(Money.fromString('+12'))).toBe('12.0000');
    expect(Money.toString(Money.ZERO)).toBe('0.0000');
  });

  it('rejects anything that is not a decimal amount', () => {
    expect(() => Money.fromString('')).toThrow(RangeError);
    expect(() => Money.fromString('1.23456')).toThrow(RangeError);
    expect(() => Money.fromString('1e3')).toThrow(RangeError);
    expect(() => Money.fromString('12,50')).toThrow(RangeError);
  });

  it('adds and subtracts exactly, with no floating point drift', () => {
    let total = Money.ZERO;
    for (let index = 0; index < 1000; index += 1) {
      total = Money.add(total, Money.fromString('0.0001'));
    }
    expect(Money.toString(total)).toBe('0.1000');
    expect(Money.toString(Money.sub(Money.fromUnits(0), Money.fromString('0.0001')))).toBe(
      '-0.0001',
    );
  });

  it('multiplies a rate per game hour by an interval of game milliseconds', () => {
    const rate = Money.fromUnits(12); // Tractor maintenance, GDD section 89.
    expect(Money.toString(Money.mulGameMs(rate, 3_600_000n))).toBe('12.0000');
    expect(Money.toString(Money.mulGameMs(rate, 1_800_000n))).toBe('6.0000');
    // 325 game hours of the cycle of GDD section 118.
    expect(Money.toString(Money.mulGameMs(rate, 325n * 3_600_000n))).toBe('3900.0000');
  });

  it('splits an interval without losing a cent', () => {
    // Additivity of the accrual is what makes the order of settlement irrelevant
    // (plan section 6.2). It holds exactly whenever the split points are whole
    // milliseconds and the rate has at most four decimals.
    const rate = Money.fromString('37.0000');
    const whole = Money.mulGameMs(rate, 7_200_000n);
    const parts = Money.add(Money.mulGameMs(rate, 2_700_000n), Money.mulGameMs(rate, 4_500_000n));
    expect(Money.toString(parts)).toBe(Money.toString(whole));
  });

  it('multiplies by basis points exactly', () => {
    // Repair cost per condition point: 0.30 % of the price (see config/machines.ts).
    expect(Money.toString(Money.mulBp(Money.fromUnits(18_000), bp(30)))).toBe('54.0000');
    expect(Money.toString(Money.mulBp(Money.fromUnits(6_500), bp(30)))).toBe('19.5000');
    expect(Money.toString(Money.mulBp(Money.fromUnits(100), BP_ONE))).toBe('100.0000');
  });

  it('rounds half away from zero on the fourth decimal', () => {
    expect(Money.toString(Money.mulRatio(Money.fromString('0.0001'), 0.5))).toBe('0.0001');
    expect(Money.toString(Money.mulRatio(Money.fromString('-0.0001'), 0.5))).toBe('-0.0001');
    expect(Money.toString(Money.mulRatio(Money.fromString('0.0001'), 0.49))).toBe('0.0000');
  });

  it('formats for the interface with two decimals, without changing the stored value', () => {
    const amount = Money.fromString('20699.9950');
    expect(Money.toDisplay(amount)).toBe('20700.00');
    expect(Money.toDisplay(Money.fromString('-4.555'))).toBe('-4.56');
    expect(Money.toString(amount)).toBe('20699.9950');
  });

  it('compares and reports the sign', () => {
    expect(Money.compare(Money.fromUnits(1), Money.fromUnits(2))).toBe(-1);
    expect(Money.compare(Money.fromUnits(2), Money.fromUnits(2))).toBe(0);
    expect(Money.compare(Money.fromUnits(3), Money.fromUnits(2))).toBe(1);
    expect(Money.isNegative(Money.fromString('-0.0001'))).toBe(true);
    expect(Money.isNegative(Money.ZERO)).toBe(false);
    expect(Money.isZero(Money.fromString('-0.0000'))).toBe(true);
  });

  it('sums a list in one pass', () => {
    const total = Money.sum([
      Money.fromUnits(18_000),
      Money.fromUnits(6_500),
      Money.fromUnits(9_800),
      Money.fromUnits(42_000),
      Money.fromUnits(7_200),
    ]);
    // Minimum machinery of GDD section 117.
    expect(Money.toString(total)).toBe('83500.0000');
  });
});

describe('game time', () => {
  it('converts hours to milliseconds with the documented rounding', () => {
    expect(gameHoursToGameMs(gameHours(96))).toBe(345_600_000n);
    expect(gameHoursToGameMs(gameHours(0))).toBe(0n);
    // Ties away from zero on the millisecond. A 256th of a game hour is exactly
    // 14 062.5 ms, and it is exactly representable, so the tie is real and not an
    // artefact of the binary approximation.
    expect(gameHoursToGameMs(gameHours(1 / 256))).toBe(14_063n);
    expect(() => gameHoursToGameMs(gameHours(-1))).toThrow(RangeError);
  });

  it('measures the interval between two instants', () => {
    expect(gameHoursBetween(gameMs(0n), gameMs(345_600_000n))).toBe(96);
    expect(gameHoursBetween(gameMs(345_600_000n), gameMs(0n))).toBe(-96);
  });

  it('refuses a negative instant', () => {
    expect(() => gameMs(-1n)).toThrow(RangeError);
  });
});

describe('integer division', () => {
  it('floors and ceils with the same sign convention for negative numerators', () => {
    expect(floorDiv(7n, 2n)).toBe(3n);
    expect(floorDiv(-7n, 2n)).toBe(-4n);
    expect(floorDiv(-6n, 2n)).toBe(-3n);
    expect(ceilDiv(7n, 2n)).toBe(4n);
    expect(ceilDiv(-7n, 2n)).toBe(-3n);
    expect(ceilDiv(6n, 2n)).toBe(3n);
    expect(() => floorDiv(1n, 0n)).toThrow(RangeError);
    expect(() => ceilDiv(1n, 0n)).toThrow(RangeError);
  });

  it('keeps floorDiv monotonic, which is what the clock relies on', () => {
    let previous = floorDiv(-1000n * 24n, 7n);
    for (let numerator = -999n; numerator <= 1000n; numerator += 1n) {
      const current = floorDiv(numerator * 24n, 7n);
      expect(current >= previous).toBe(true);
      previous = current;
    }
  });
});

describe('basis points', () => {
  it('rejects a value outside the range and clamps on demand', () => {
    expect(() => bp(-1)).toThrow(RangeError);
    expect(() => bp(10_001)).toThrow(RangeError);
    expect(() => bp(1.5)).toThrow(RangeError);
    expect(clampBp(-5)).toBe(0);
    expect(clampBp(20_000)).toBe(10_000);
    expect(clampBp(1234.6)).toBe(1235);
  });
});
