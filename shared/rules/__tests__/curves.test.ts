import { describe, expect, it } from 'vitest';
import {
  BALANCE_CURVES,
  CONDITION_FACTOR_CURVE,
  FERTILITY_TO_YIELD_CURVE,
  FERTILIZATION_TO_YIELD_CURVE,
  WEED_TO_YIELD_PENALTY_CURVE,
  type Curve,
} from '../../config/curves.js';
import { bp } from '../../domain/units.js';
import { interpolateCurve, interpolateCurveAtBp } from '../curves.js';

// Case tables at the nodes of every curve and between them, which is the third priority
// of plan section 8. A curve that is right at its nodes and wrong between them is the
// failure this catches, and it is the one a hand written formula per curve produces.

describe('interpolateCurve at the nodes', () => {
  it('returns the published value of GDD section 91 at each condition node', () => {
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, 100)).toBe(1);
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, 50)).toBe(0.75);
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, 10)).toBe(0.4);
    // The floor at zero condition is added by plan section 2.2: without it the factor
    // would reach zero and a task duration would be infinite.
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, 0)).toBe(0.2);
  });

  it('returns the published value of GDD section 77 at each fertility node', () => {
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, 100)).toBe(1);
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, 50)).toBe(0.65);
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, 10)).toBe(0.25);
  });

  it('returns the published value of GDD section 78 at each weed node', () => {
    expect(interpolateCurve(WEED_TO_YIELD_PENALTY_CURVE, 0)).toBe(0);
    expect(interpolateCurve(WEED_TO_YIELD_PENALTY_CURVE, 50)).toBe(0.2);
    expect(interpolateCurve(WEED_TO_YIELD_PENALTY_CURVE, 100)).toBe(0.5);
  });

  it('keeps fertilisation neutral across the whole range (GDD sections 79 and 86)', () => {
    for (const percent of [0, 1, 25, 50, 75, 99, 100]) {
      expect(interpolateCurve(FERTILIZATION_TO_YIELD_CURVE, percent)).toBe(1);
    }
  });
});

describe('interpolateCurve between the nodes', () => {
  it('interpolates the condition curve linearly on each segment', () => {
    // Between 10 -> 0.4 and 50 -> 0.75 the slope is 0.00875 per point.
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, 30)).toBeCloseTo(0.575, 12);
    // Between 50 -> 0.75 and 100 -> 1.0 the slope is 0.005 per point.
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, 75)).toBeCloseTo(0.875, 12);
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, 95)).toBeCloseTo(0.975, 12);
    // Between 0 -> 0.2 and 10 -> 0.4.
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, 5)).toBeCloseTo(0.3, 12);
  });

  it('interpolates the fertility curve linearly on each segment', () => {
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, 30)).toBeCloseTo(0.45, 12);
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, 75)).toBeCloseTo(0.825, 12);
    // 85 % fertility, which is what a field is left at after one wheat cycle (GDD 84).
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, 85)).toBeCloseTo(0.895, 12);
  });

  it('interpolates the weed penalty linearly, including the 20 % of GDD section 119', () => {
    expect(interpolateCurve(WEED_TO_YIELD_PENALTY_CURVE, 20)).toBeCloseTo(0.08, 12);
    expect(interpolateCurve(WEED_TO_YIELD_PENALTY_CURVE, 34)).toBeCloseTo(0.136, 12);
    expect(interpolateCurve(WEED_TO_YIELD_PENALTY_CURVE, 75)).toBeCloseTo(0.35, 12);
  });
});

describe('interpolateCurve outside the table', () => {
  it('clamps instead of extrapolating, which is what keeps fertility from inventing a value', () => {
    // GDD section 77 gives no node below 10 %; extrapolating towards zero would invent a
    // balance number, so the worst case stays at the worst value the GDD states.
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, 0)).toBe(0.25);
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, -50)).toBe(0.25);
    expect(interpolateCurve(FERTILITY_TO_YIELD_CURVE, 500)).toBe(1);
    expect(interpolateCurve(CONDITION_FACTOR_CURVE, -1)).toBe(0.2);
    expect(interpolateCurve(WEED_TO_YIELD_PENALTY_CURVE, 250)).toBe(0.5);
  });

  it('rejects an empty table and a NaN input rather than returning a plausible number', () => {
    expect(() => interpolateCurve([], 50)).toThrow(RangeError);
    expect(() => interpolateCurve(CONDITION_FACTOR_CURVE, Number.NaN)).toThrow(RangeError);
  });

  it('takes the later node when a table leaves two nodes at the same input', () => {
    const degenerate: Curve = [
      [0, 0],
      [50, 0.4],
      [50, 0.9],
      [100, 1],
    ];
    expect(interpolateCurve(degenerate, 50)).toBe(0.4);
    expect(interpolateCurve(degenerate, 50.000001)).toBeCloseTo(0.9, 5);
  });
});

describe('interpolateCurveAtBp', () => {
  it('converts basis points into the percentage the tables are stated in', () => {
    expect(interpolateCurveAtBp(CONDITION_FACTOR_CURVE, bp(10_000))).toBe(1);
    expect(interpolateCurveAtBp(CONDITION_FACTOR_CURVE, bp(5_000))).toBe(0.75);
    expect(interpolateCurveAtBp(WEED_TO_YIELD_PENALTY_CURVE, bp(2_000))).toBeCloseTo(0.08, 12);
  });
});

describe('the tables themselves', () => {
  it('are ascending in the input, which the interpolation assumes', () => {
    for (const [name, curve] of Object.entries(BALANCE_CURVES)) {
      for (let index = 1; index < curve.length; index += 1) {
        const previous = curve[index - 1];
        const current = curve[index];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        expect(current?.[0] ?? 0, `${name} is not ascending`).toBeGreaterThan(previous?.[0] ?? 0);
      }
    }
  });
});
