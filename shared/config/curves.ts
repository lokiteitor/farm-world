// Nodes of every balance curve.
//
// Owner: workflow W2 (vocabulary). Interpolated by `interpolateCurve` in
// shared/rules/curves, which is the single implementation: one interpolator and
// many tables, instead of one function per curve.
//
// Convention. The input of a node is a percentage in 0..100, because that is how the
// GDD states these curves, while the stored domain value is in basis points; the
// caller converts with `bpToPercent`. The output is a plain multiplier or penalty.
//
// Outside the first and last node the curve is clamped, never extrapolated. This
// matters for fertility: the GDD gives no node below 10 %, and extrapolating towards
// zero would invent a balance number, whereas clamping keeps the worst case at the
// worst value the GDD states.

/** A node of a curve: input percentage and output value. */
export type CurveNode = readonly [inputPercent: number, output: number];

/** A curve as an ascending table of nodes. */
export type Curve = readonly CurveNode[];

/**
 * Machine condition to work speed factor (GDD section 91), which gives three non
 * collinear points and says nothing below 10 %. Plan section 2.2 completes it with a
 * floor of 0.2 at zero condition: without a floor the factor would reach zero and a
 * task duration would be infinite.
 */
export const CONDITION_FACTOR_CURVE: Curve = [
  [0, 0.2],
  [10, 0.4],
  [50, 0.75],
  [100, 1.0],
];

/** Fertility to yield multiplier (GDD section 77). */
export const FERTILITY_TO_YIELD_CURVE: Curve = [
  [10, 0.25],
  [50, 0.65],
  [100, 1.0],
];

/**
 * Weed level to yield penalty (GDD section 78). The output is the fraction lost, so
 * the yield formula of GDD section 83 uses `1 - penalty`.
 */
export const WEED_TO_YIELD_PENALTY_CURVE: Curve = [
  [0, 0],
  [50, 0.2],
  [100, 0.5],
];

/**
 * Fertilisation to yield multiplier. Fixed at 1.0 for the whole range (GDD sections
 * 79 and 86): fertilisation is modelled but not playable in the MVP. The curve exists
 * so that enabling it later is a change of table and not a change of code.
 */
export const FERTILIZATION_TO_YIELD_CURVE: Curve = [
  [0, 1.0],
  [100, 1.0],
];

/** Every curve, for the coherence test and for the balance report. */
export const BALANCE_CURVES: Readonly<Record<string, Curve>> = {
  conditionFactor: CONDITION_FACTOR_CURVE,
  fertilityToYield: FERTILITY_TO_YIELD_CURVE,
  weedToYieldPenalty: WEED_TO_YIELD_PENALTY_CURVE,
  fertilizationToYield: FERTILIZATION_TO_YIELD_CURVE,
};
