// The cosmetic route: determinism, coverage and monotonicity.
//
// Owner: workflow W5-D (canvas entities). These are the three properties the design of
// GDD section 92 rests on, and the reason the movement can be derived instead of
// transmitted: a route that were not deterministic would differ between two tabs, one
// that did not cover the field would show a machine finishing work it never did, and a
// position that were not monotone in the progress would make a tractor jump backwards
// whenever the clock resynchronised.

import { describe, expect, it } from 'vitest';
import {
  pathCursor,
  pathSeed,
  poseAt,
  serpentinePath,
  serpentineShape,
  taskProgressRatio,
  travelledCells,
  type PathCell,
} from '../serpentine';
import { rectCells } from './fixtures';

const FIELD = rectCells(12, 7, 11, 6) as readonly PathCell[];

/** Every one of the eight orientations, as a seed. */
const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7];

function keyOf(cell: PathCell): string {
  return `${cell.cellX},${cell.cellY}`;
}

describe('serpentinePath (GDD section 92)', () => {
  it('covers every cell of the field exactly once, in all eight orientations', () => {
    for (const seed of SEEDS) {
      const path = serpentinePath(FIELD, seed);
      expect(path).toHaveLength(FIELD.length);
      const visited = new Set(path.map(keyOf));
      expect(visited.size).toBe(FIELD.length);
      for (const cell of FIELD) {
        expect(visited.has(keyOf(cell))).toBe(true);
      }
    }
  });

  it('is a serpentine: every step inside a band advances one cell', () => {
    for (const seed of SEEDS) {
      const path = serpentinePath(FIELD, seed);
      const shape = serpentineShape(seed);
      let stepsInsideBand = 0;
      for (let index = 1; index < path.length; index += 1) {
        const from = path[index - 1];
        const to = path[index];
        if (from === undefined || to === undefined) {
          continue;
        }
        const sameBand = shape.columnMajor ? from.cellX === to.cellX : from.cellY === to.cellY;
        if (!sameBand) {
          continue;
        }
        stepsInsideBand += 1;
        const advance = shape.columnMajor
          ? Math.abs(to.cellY - from.cellY)
          : Math.abs(to.cellX - from.cellX);
        expect(advance).toBe(1);
      }
      // Six bands of eleven cells or eleven of six: either way most steps stay in a band.
      expect(stepsInsideBand).toBeGreaterThan(path.length / 2);
    }
  });

  it('does not depend on the order the cells arrived in', () => {
    // The cells of a field arrive as a page of an API reply. Two clients that received
    // them in a different order have to draw the same route.
    const shuffled = [...FIELD].reverse();
    const alternating = FIELD.filter((_cell, index) => index % 2 === 0).concat(
      FIELD.filter((_cell, index) => index % 2 === 1),
    );
    for (const seed of SEEDS) {
      const reference = serpentinePath(FIELD, seed);
      expect(serpentinePath(shuffled, seed)).toEqual(reference);
      expect(serpentinePath(alternating, seed)).toEqual(reference);
    }
  });

  it('collapses a repeated cell, so a machine cannot stall on one', () => {
    const withDuplicates = [...FIELD, ...FIELD.slice(0, 5)];
    expect(serpentinePath(withDuplicates, 3)).toEqual(serpentinePath(FIELD, 3));
  });

  it('gives the same route to the same task identifier, always', () => {
    const first = serpentinePath(FIELD, pathSeed('task-9f3a'));
    const second = serpentinePath(FIELD, pathSeed('task-9f3a'));
    expect(second).toEqual(first);
    expect(pathSeed('task-9f3a')).toBe(pathSeed('task-9f3a'));
  });

  it('does not move two different tasks in formation', () => {
    const shapes = new Set(
      ['task-a', 'task-b', 'task-c', 'task-d', 'task-e', 'task-f'].map((id) =>
        JSON.stringify(serpentineShape(pathSeed(id))),
      ),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('answers an empty route for a target with no cells', () => {
    expect(serpentinePath([], 1)).toEqual([]);
  });
});

describe('pathCursor and poseAt', () => {
  it('is monotone in the progress, by index and by distance travelled', () => {
    const path = serpentinePath(FIELD, pathSeed('task-monotone'));
    let lastArc = -1;
    let lastDistance = -1;
    for (let step = 0; step <= 400; step += 1) {
      const progress = step / 400;
      const cursor = pathCursor(path.length, progress);
      const arc = cursor.index + cursor.frac;
      expect(arc).toBeGreaterThanOrEqual(lastArc);
      lastArc = arc;
      const distance = travelledCells(path, progress);
      expect(distance).toBeGreaterThanOrEqual(lastDistance - 1e-9);
      lastDistance = distance;
    }
  });

  it('clamps a progress out of range instead of leaving the route', () => {
    const path = serpentinePath(FIELD, 0);
    expect(pathCursor(path.length, -5)).toEqual({ index: 0, frac: 0 });
    expect(pathCursor(path.length, 5)).toEqual({ index: path.length - 2, frac: 1 });
  });

  it('starts on the first cell and ends on the last one', () => {
    const path = serpentinePath(FIELD, 0);
    const first = path[0];
    const last = path[path.length - 1];
    const start = poseAt(path, 0);
    const end = poseAt(path, 1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(start?.cellX).toBeCloseTo((first?.cellX ?? 0) + 0.5, 10);
    expect(start?.cellY).toBeCloseTo((first?.cellY ?? 0) + 0.5, 10);
    expect(end?.cellX).toBeCloseTo((last?.cellX ?? 0) + 0.5, 10);
    expect(end?.cellY).toBeCloseTo((last?.cellY ?? 0) + 0.5, 10);
  });

  it('takes the heading from the tangent of the route', () => {
    const eastward: readonly PathCell[] = [
      { cellX: 0, cellY: 0 },
      { cellX: 1, cellY: 0 },
      { cellX: 2, cellY: 0 },
    ];
    expect(poseAt(eastward, 0)?.headingRad).toBeCloseTo(0, 10);
    const westward = [...eastward].reverse();
    expect(Math.abs(poseAt(westward, 0)?.headingRad ?? 0)).toBeCloseTo(Math.PI, 10);
    const southward: readonly PathCell[] = [
      { cellX: 0, cellY: 0 },
      { cellX: 0, cellY: 1 },
    ];
    expect(poseAt(southward, 0)?.headingRad).toBeCloseTo(Math.PI / 2, 10);
  });

  it('gives a one cell route a pose and no heading', () => {
    const single: readonly PathCell[] = [{ cellX: 4, cellY: 9 }];
    expect(poseAt(single, 0.5)).toEqual({
      cellX: 4.5,
      cellY: 9.5,
      headingRad: 0,
      index: 0,
      frac: 0,
    });
  });

  it('has no pose without a route', () => {
    expect(poseAt([], 0.5)).toBeNull();
  });

  it('is identical in two tabs, that is in two independent evaluations', () => {
    const seed = pathSeed('task-two-tabs');
    const tabOne = serpentinePath(FIELD, seed);
    const tabTwo = serpentinePath([...FIELD].reverse(), seed);
    for (let step = 0; step <= 50; step += 1) {
      expect(poseAt(tabTwo, step / 50)).toEqual(poseAt(tabOne, step / 50));
    }
  });
});

describe('taskProgressRatio', () => {
  const window = { startGameMs: 1_000n, scheduledEndGameMs: 5_000n };

  it('is zero before the start and one past the scheduled end', () => {
    expect(taskProgressRatio(window, 0n)).toBe(0);
    expect(taskProgressRatio(window, 1_000n)).toBe(0);
    expect(taskProgressRatio(window, 5_000n)).toBe(1);
    expect(taskProgressRatio(window, 9_000n)).toBe(1);
  });

  it('interpolates linearly between the two ends', () => {
    expect(taskProgressRatio(window, 3_000n)).toBeCloseTo(0.5, 12);
    expect(taskProgressRatio(window, 2_000n)).toBeCloseTo(0.25, 12);
  });

  it('stops where the task was cancelled (GDD section 106)', () => {
    // Cancellation is not completion, so the bar must not keep filling.
    const cancelled = { ...window, endedGameMs: 3_000n };
    expect(taskProgressRatio(cancelled, 4_500n)).toBeCloseTo(0.5, 12);
    expect(taskProgressRatio(cancelled, 9_000n)).toBeCloseTo(0.5, 12);
  });

  it('treats an empty interval as finished instead of dividing by zero', () => {
    expect(taskProgressRatio({ startGameMs: 7n, scheduledEndGameMs: 7n }, 7n)).toBe(1);
    expect(taskProgressRatio({ startGameMs: 9n, scheduledEndGameMs: 4n }, 9n)).toBe(1);
  });
});
