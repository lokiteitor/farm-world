// Anchoring and the debug counter.
//
// Owner: workflow W4-D. The property that justifies a fourth scene: a label anchored to
// a cell lands on the same screen pixel whatever the zoom, without any object being
// rescaled.

import { describe, expect, it } from 'vitest';
import { RENDER_BUDGET } from '../../world/config';
import type { WorldStats } from '../../world/WorldScene';
import { screenPointOfWorld, scrollCenteredOnCell } from '../../world/zoom';
import { projectAnchor } from '../anchors';
import { debugLines, isOverBudget } from '../debugLines';
import { CELL_PX } from '~/shared/index';

const SIZE = { width: 1280, height: 720 };

function statsOf(overrides: Partial<WorldStats> = {}): WorldStats {
  return {
    fps: 60,
    drawCalls: 24,
    quads: 8_000,
    zoom: 1,
    levelOfDetail: 'NEAR',
    liveChunks: 50,
    visibleChunks: 12,
    inFlightRequests: 0,
    outlineSegments: 320,
    lastTickMs: 1.2,
    lastChunkBuildMs: 0.8,
    lastOutlineMs: 2.4,
    ...overrides,
  };
}

describe('projectAnchor', () => {
  it('puts the anchor of the centred cell in the middle of the viewport at any zoom', () => {
    for (const zoom of [0.25, 0.5, 1, 2.8]) {
      const scroll = scrollCenteredOnCell(SIZE, CELL_PX, 40, -12);
      const point = projectAnchor({ cellX: 40, cellY: -12 }, scroll, SIZE, zoom, CELL_PX);
      expect(point.screenX).toBeCloseTo(SIZE.width / 2, 6);
      expect(point.screenY).toBeCloseTo(SIZE.height / 2, 6);
      expect(point.onScreen).toBe(true);
    }
  });

  it('applies the offset in screen pixels, so it does not scale with the zoom', () => {
    const scroll = scrollCenteredOnCell(SIZE, CELL_PX, 0, 0);
    const near = projectAnchor({ cellX: 0, cellY: 0, offsetY: -20 }, scroll, SIZE, 1, CELL_PX);
    const far = projectAnchor({ cellX: 0, cellY: 0, offsetY: -20 }, scroll, SIZE, 0.25, CELL_PX);
    expect(near.screenY).toBeCloseTo(SIZE.height / 2 - 20, 6);
    expect(far.screenY).toBeCloseTo(SIZE.height / 2 - 20, 6);
  });

  it('reports an anchor outside the viewport, so the label can be skipped', () => {
    const scroll = scrollCenteredOnCell(SIZE, CELL_PX, 0, 0);
    const far = projectAnchor({ cellX: 4_000, cellY: 0 }, scroll, SIZE, 1, CELL_PX);
    expect(far.onScreen).toBe(false);
  });

  it('anchors at the centre of the cell and not at its corner', () => {
    const scroll = { x: 0, y: 0 };
    const point = projectAnchor({ cellX: 0, cellY: 0 }, scroll, SIZE, 1, CELL_PX);
    const corner = screenPointOfWorld(scroll, SIZE, 1, 0, 0);
    expect(point.screenX - corner.screenX).toBeCloseTo(CELL_PX / 2, 9);
  });
});

describe('debugLines', () => {
  it('names the seven facts the brief asks for', () => {
    const lines = debugLines(statsOf());
    expect(lines).toHaveLength(7);
    expect(lines.join('\n')).toContain('FPS 60');
    expect(lines.join('\n')).toContain('Zoom 1.00');
    expect(lines.join('\n')).toContain('Detalle cerca');
    expect(lines.join('\n')).toContain('50 cargados');
    expect(lines.join('\n')).toContain('12 visibles');
    expect(lines.join('\n')).toContain('Draw calls 24');
    expect(lines.join('\n')).toContain('Peticiones en vuelo 0');
  });

  it('states the ceiling of the level of detail it is in', () => {
    expect(debugLines(statsOf())[3]).toContain(`/ ${RENDER_BUDGET.near.maxDrawCalls}`);
    expect(debugLines(statsOf({ levelOfDetail: 'FAR', zoom: 0.25 }))[3]).toContain(
      `/ ${RENDER_BUDGET.far.maxDrawCalls}`,
    );
  });

  it('flags a frame rate or a draw call count outside its budget', () => {
    expect(isOverBudget(statsOf())).toBe(false);
    expect(isOverBudget(statsOf({ fps: 41 }))).toBe(true);
    expect(isOverBudget(statsOf({ drawCalls: 500 }))).toBe(true);
    expect(isOverBudget(statsOf({ levelOfDetail: 'FAR', drawCalls: 210 }))).toBe(false);
  });
});
