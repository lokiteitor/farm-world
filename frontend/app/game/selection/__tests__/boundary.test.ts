// The cell boundary throttle: exactly one update per cell entered.
//
// Owner: workflow W4-G. This is the property plan section 9.5 relies on to keep a drag
// over thousands of cells at sixty frames per second, so it is asserted over a simulated
// pointer path in screen pixels and not over a handful of hand picked cells: at sixteen
// pixels per cell (ADR-0012) a straight drag of 320 pixels produces 321 pointer moves and
// must produce twenty crossings.

import { describe, expect, it } from 'vitest';
import { createBoundaryThrottle } from '../boundary';
import { CELL_PX } from '~/shared/index';

/** The cell a screen offset falls in, with the camera at the origin and zoom 1. */
function cellOfPixel(pixel: number): number {
  return Math.floor(pixel / CELL_PX);
}

describe('createBoundaryThrottle', () => {
  it('fires once for the first cell and never again while the pointer stays in it', () => {
    const throttle = createBoundaryThrottle();
    expect(throttle.accept(4, 7)).toBe(true);
    expect(throttle.accept(4, 7)).toBe(false);
    expect(throttle.accept(4, 7)).toBe(false);
    expect(throttle.current).toEqual({ cellX: 4, cellY: 7 });
  });

  it('fires exactly once per cell over a straight drag of twenty cells', () => {
    const throttle = createBoundaryThrottle();
    const crossings: number[] = [];
    for (let pixel = 0; pixel <= 20 * CELL_PX; pixel += 1) {
      const cellX = cellOfPixel(pixel);
      if (throttle.accept(cellX, 0)) {
        crossings.push(cellX);
      }
    }
    // 321 pointer moves at sixteen pixels per cell: cells 0 to 20, each entered once.
    expect(crossings).toEqual(Array.from({ length: 21 }, (_unused, index) => index));
  });

  it('fires again when the pointer returns to a cell it had left', () => {
    const throttle = createBoundaryThrottle();
    expect(throttle.accept(0, 0)).toBe(true);
    expect(throttle.accept(1, 0)).toBe(true);
    expect(throttle.accept(0, 0)).toBe(true);
  });

  it('distinguishes a move on the other axis', () => {
    const throttle = createBoundaryThrottle();
    expect(throttle.accept(3, 3)).toBe(true);
    expect(throttle.accept(3, 4)).toBe(true);
    expect(throttle.accept(3, 4)).toBe(false);
  });

  it('treats the next move as a crossing after a reset', () => {
    const throttle = createBoundaryThrottle();
    throttle.accept(2, 2);
    expect(throttle.accept(2, 2)).toBe(false);
    throttle.reset();
    expect(throttle.current).toBeNull();
    expect(throttle.accept(2, 2)).toBe(true);
  });
});
