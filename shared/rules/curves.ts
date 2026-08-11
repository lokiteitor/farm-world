// Interpolation of the balance curves.
//
// Owner: workflow W2 (pure rules).
//
// One interpolator and many tables, instead of one function per curve: the tables
// live in shared/config/curves and every balance curve of the GDD (condition,
// fertility, weeds, fertilisation) is a table of nodes read by this function.
//
// Outside the first and the last node the curve is clamped, never extrapolated
// (plan section 8, and the header of shared/config/curves). It matters most for
// fertility: GDD section 77 gives no node below 10 %, and extrapolating towards
// zero would invent a balance number, whereas clamping keeps the worst case at the
// worst value the GDD publishes.

import { type Curve } from '../config/curves.js';
import { bpToPercent, type Bp } from '../domain/units.js';

/**
 * Value of a curve at an input expressed as a percentage in 0..100, with linear
 * interpolation between nodes and clamping outside the table.
 *
 * The nodes are expected in ascending order of input, which is a property of the
 * tables and is asserted by the coherence test of shared/config. An empty table is
 * rejected: it is a corrupt catalogue, not a domain edge case, and returning some
 * neutral value would hide the mistake behind plausible arithmetic.
 */
export function interpolateCurve(curve: Curve, inputPercent: number): number {
  const first = curve[0];
  if (first === undefined) {
    throw new RangeError('A balance curve must have at least one node');
  }
  if (Number.isNaN(inputPercent)) {
    throw new RangeError('The input of a balance curve cannot be NaN');
  }
  if (inputPercent <= first[0]) {
    return first[1];
  }
  const last = curve[curve.length - 1];
  if (last === undefined || inputPercent >= last[0]) {
    // `last` is only undefined for an empty table, already rejected above; the
    // check is here because `noUncheckedIndexedAccess` cannot know that.
    return last === undefined ? first[1] : last[1];
  }
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1];
    const current = curve[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (inputPercent <= current[0]) {
      const span = current[0] - previous[0];
      if (span <= 0) {
        // Two nodes at the same input: the later one wins, which keeps the
        // function total for a table that a future edit leaves degenerate.
        return current[1];
      }
      const ratio = (inputPercent - previous[0]) / span;
      return previous[1] + (current[1] - previous[1]) * ratio;
    }
  }
  return last[1];
}

/**
 * Value of a curve at a stored domain percentage. Every domain percentage is held
 * in basis points and every curve is stated in percent, so this is the conversion
 * the callers would otherwise repeat at each site.
 */
export function interpolateCurveAtBp(curve: Curve, value: Bp): number {
  return interpolateCurve(curve, bpToPercent(value));
}
