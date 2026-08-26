// Camera arithmetic.
//
// Owner: workflow W4-D. The property that matters is the anchoring: after a zoom step
// the world point under the pointer has to be the same world point, to the last bit,
// and that is asserted over a grid of pointers, zooms and viewport sizes rather than at
// one convenient value.

import { describe, expect, it } from 'vitest';
import { NEAR_LOD_MIN_ZOOM, ZOOM_STEPS } from '../config';
import {
  anchoredScroll,
  cellOfScreen,
  clampZoom,
  levelOfDetail,
  screenPointOfWorld,
  scrollCenteredOnCell,
  snapZoom,
  softClampScroll,
  stepZoom,
  visibleCellRect,
  worldPointOfScreen,
} from '../zoom';
import { CELL_PX } from '~/shared/index';

const SIZE = { width: 1920, height: 1080 };

describe('discrete zoom', () => {
  it('clamps to the range the steps define', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_STEPS[0]);
    expect(clampZoom(99)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('snaps to the nearest step in logarithmic distance', () => {
    expect(snapZoom(1)).toBe(1);
    expect(snapZoom(0.9)).toBe(1);
    expect(snapZoom(0.26)).toBe(0.25);
  });

  it('moves one step at a time and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.4);
    expect(stepZoom(1, -1)).toBe(0.7);
    expect(stepZoom(ZOOM_STEPS[0] ?? 0.25, -1)).toBe(ZOOM_STEPS[0]);
    const top = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 2.8;
    expect(stepZoom(top, 1)).toBe(top);
  });

  it('leaves no step sitting on the level of detail threshold', () => {
    expect(ZOOM_STEPS).not.toContain(NEAR_LOD_MIN_ZOOM);
    expect(levelOfDetail(0.35)).toBe('FAR');
    expect(levelOfDetail(0.5)).toBe('NEAR');
    expect(levelOfDetail(NEAR_LOD_MIN_ZOOM)).toBe('NEAR');
  });
});

describe('projection', () => {
  it('is invertible', () => {
    const scroll = { x: -1234.5, y: 987.25 };
    for (const zoom of ZOOM_STEPS) {
      const world = worldPointOfScreen(scroll, SIZE, zoom, 300, 200);
      const screen = screenPointOfWorld(scroll, SIZE, zoom, world.worldX, world.worldY);
      expect(screen.screenX).toBeCloseTo(300, 9);
      expect(screen.screenY).toBeCloseTo(200, 9);
    }
  });

  it('centres the camera on a cell', () => {
    const scroll = scrollCenteredOnCell(SIZE, CELL_PX, 10, -4);
    const centre = worldPointOfScreen(scroll, SIZE, 1, SIZE.width / 2, SIZE.height / 2);
    expect(Math.floor(centre.worldX / CELL_PX)).toBe(10);
    expect(Math.floor(centre.worldY / CELL_PX)).toBe(-4);
  });

  it('resolves the cell under a screen position in every quadrant', () => {
    const scroll = scrollCenteredOnCell(SIZE, CELL_PX, -100, -100);
    const cell = cellOfScreen(scroll, SIZE, 1, CELL_PX, SIZE.width / 2, SIZE.height / 2);
    expect(cell).toEqual({ cellX: -100, cellY: -100 });
  });
});

describe('anchoredScroll', () => {
  it('keeps the world point under the pointer fixed across a zoom step', () => {
    const scrolls = [
      { x: 0, y: 0 },
      { x: -5000.5, y: 12_345.75 },
      { x: 987_654.125, y: -321.5 },
    ];
    const pointers = [
      { x: 0, y: 0 },
      { x: 17, y: 1063 },
      { x: 960, y: 540 },
      { x: 1919, y: 3 },
    ];
    for (const scroll of scrolls) {
      for (const pointer of pointers) {
        for (let index = 0; index < ZOOM_STEPS.length - 1; index += 1) {
          const from = ZOOM_STEPS[index] ?? 1;
          const to = ZOOM_STEPS[index + 1] ?? 1;
          const before = worldPointOfScreen(scroll, SIZE, from, pointer.x, pointer.y);
          const next = anchoredScroll(scroll, SIZE, from, to, pointer.x, pointer.y);
          const after = worldPointOfScreen(next, SIZE, to, pointer.x, pointer.y);
          expect(after.worldX).toBeCloseTo(before.worldX, 6);
          expect(after.worldY).toBeCloseTo(before.worldY, 6);
        }
      }
    }
  });

  it('moves nothing when the zoom does not change', () => {
    const scroll = { x: 42, y: -42 };
    expect(anchoredScroll(scroll, SIZE, 1, 1, 100, 100)).toEqual(scroll);
  });

  it('refuses a non positive zoom rather than producing an infinity', () => {
    const scroll = { x: 1, y: 2 };
    expect(anchoredScroll(scroll, SIZE, 0, 1, 10, 10)).toEqual(scroll);
    expect(anchoredScroll(scroll, SIZE, 1, 0, 10, 10)).toEqual(scroll);
  });

  it('composes: stepping out and back in returns to the same scroll', () => {
    const scroll = { x: 1234.5, y: -678.25 };
    const pointer = { x: 400, y: 700 };
    const out = anchoredScroll(scroll, SIZE, 1, 0.7, pointer.x, pointer.y);
    const back = anchoredScroll(out, SIZE, 0.7, 1, pointer.x, pointer.y);
    expect(back.x).toBeCloseTo(scroll.x, 9);
    expect(back.y).toBeCloseTo(scroll.y, 9);
  });
});

describe('softClampScroll', () => {
  it('is symmetric and silent', () => {
    expect(softClampScroll({ x: 10, y: -10 }, 100)).toEqual({ x: 10, y: -10 });
    expect(softClampScroll({ x: 1e12, y: -1e12 }, 100)).toEqual({ x: 100, y: -100 });
  });
});

describe('visibleCellRect', () => {
  it('covers the viewport and grows as the zoom falls', () => {
    const scroll = { x: 0, y: 0 };
    const near = visibleCellRect(scroll, SIZE, 1, CELL_PX);
    const far = visibleCellRect(scroll, SIZE, 0.25, CELL_PX);
    const nearCells = (near.maxCellX - near.minCellX + 1) * (near.maxCellY - near.minCellY + 1);
    const farCells = (far.maxCellX - far.minCellX + 1) * (far.maxCellY - far.minCellY + 1);
    // With CELL_PX = 32: about 2 040 cells at zoom 1 and about 32 000
    // at zoom 0.25, maintaining the sixteenfold ratio across zoom steps.
    expect(nearCells).toBeGreaterThan(1_800);
    expect(nearCells).toBeLessThan(2_500);
    expect(farCells / nearCells).toBeGreaterThan(15);
  });
});
