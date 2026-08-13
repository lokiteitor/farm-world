// Camera arithmetic: discrete zoom, cursor anchoring and the visible rectangle.
//
// Owner: workflow W4-D (world rendering). Pure functions over numbers, so the piece of
// the camera that is easy to get subtly wrong is the piece a test can pin down.
//
// The camera model is Phaser's, written out so nothing here depends on reading the
// engine source again. With no rotation and the default origin of 0.5:
//
//   worldX = scrollX + halfWidth + (screenX - halfWidth) / zoom
//
// that is, `scrollX + halfWidth` is the point the camera looks at and the zoom scales
// around it. Everything below follows from that one line.
//
// Cursor anchored zoom is the only thing that makes a discrete zoom feel right (plan
// section 9.5). Keeping the world point under the pointer fixed while the zoom changes
// from z1 to z2 gives
//
//   scrollX' = scrollX + (screenX - halfWidth) x (1/z1 - 1/z2)
//
// which is exact and needs no iteration. Zooming about the centre instead is the
// version that feels wrong: the thing the player is pointing at slides away as they
// zoom towards it.

import { LevelOfDetail, MAX_ZOOM, MIN_ZOOM, NEAR_LOD_MIN_ZOOM, ZOOM_STEPS } from './config';
import { type CellRect } from './viewport';

/** Scroll of the camera, in world pixels. */
export interface ScrollPoint {
  readonly x: number;
  readonly y: number;
}

/** Size of the viewport, in screen pixels. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** A point in world pixels. */
export interface WorldPoint {
  readonly worldX: number;
  readonly worldY: number;
}

/** The zoom clamped into the range the steps define. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The step nearest to a zoom, in logarithmic distance, which is how zoom is perceived. */
export function snapZoom(zoom: number): number {
  const target = clampZoom(zoom);
  let best = ZOOM_STEPS[0] ?? 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const step of ZOOM_STEPS) {
    const distance = Math.abs(Math.log(step) - Math.log(target));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = step;
    }
  }
  return best;
}

/**
 * The next step in a direction. `direction` is +1 to zoom in and -1 to zoom out.
 *
 * The current zoom is snapped first, so a camera left mid transition still moves one
 * whole step and never lands between two steps.
 */
export function stepZoom(current: number, direction: number): number {
  const snapped = snapZoom(current);
  const index = ZOOM_STEPS.indexOf(snapped);
  if (index < 0) {
    return snapped;
  }
  const next = index + (direction > 0 ? 1 : -1);
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, next))] ?? snapped;
}

/**
 * The level of detail of a zoom (plan section 9.3).
 *
 * The threshold is a parameter with the constant of `config.ts` as its default, because
 * the settings panel lets the player move it: a machine that renders the near level
 * comfortably can keep it further out, and one that does not can pull it in. The default
 * is the constant and not a second opinion about it, so a caller that does not care about
 * the preference keeps the behaviour it had.
 */
export function levelOfDetail(zoom: number, thresholdZoom = NEAR_LOD_MIN_ZOOM): LevelOfDetail {
  return zoom >= thresholdZoom ? LevelOfDetail.NEAR : LevelOfDetail.FAR;
}

/** The world point under a screen position. */
export function worldPointOfScreen(
  scroll: ScrollPoint,
  size: ViewportSize,
  zoom: number,
  screenX: number,
  screenY: number,
): WorldPoint {
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  return {
    worldX: scroll.x + halfWidth + (screenX - halfWidth) / zoom,
    worldY: scroll.y + halfHeight + (screenY - halfHeight) / zoom,
  };
}

/** The screen position of a world point. Inverse of `worldPointOfScreen`. */
export function screenPointOfWorld(
  scroll: ScrollPoint,
  size: ViewportSize,
  zoom: number,
  worldX: number,
  worldY: number,
): { readonly screenX: number; readonly screenY: number } {
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  return {
    screenX: halfWidth + (worldX - scroll.x - halfWidth) * zoom,
    screenY: halfHeight + (worldY - scroll.y - halfHeight) * zoom,
  };
}

/**
 * The scroll that keeps the world point under the pointer fixed across a zoom change.
 *
 * Exact, by construction: substituting the result into `worldPointOfScreen` at the new
 * zoom gives the same world point, which is what the test asserts over a grid of
 * pointers, zooms and viewport sizes rather than at one hand picked value.
 */
export function anchoredScroll(
  scroll: ScrollPoint,
  size: ViewportSize,
  fromZoom: number,
  toZoom: number,
  screenX: number,
  screenY: number,
): ScrollPoint {
  if (fromZoom <= 0 || toZoom <= 0) {
    return scroll;
  }
  const factor = 1 / fromZoom - 1 / toZoom;
  return {
    x: scroll.x + (screenX - size.width / 2) * factor,
    y: scroll.y + (screenY - size.height / 2) * factor,
  };
}

/**
 * The scroll clamped to the soft bound.
 *
 * There is no hard world limit (plan section 9.5): what this prevents is numerical
 * drift, because a scroll of 10^12 world pixels has lost sub pixel precision and the
 * tilemap positions start to shear against the grid. Clamping is silent and symmetric,
 * so a player who holds an arrow key for an hour stops rather than tears.
 */
export function softClampScroll(scroll: ScrollPoint, boundPx: number): ScrollPoint {
  return {
    x: Math.min(boundPx, Math.max(-boundPx, scroll.x)),
    y: Math.min(boundPx, Math.max(-boundPx, scroll.y)),
  };
}

/**
 * The visible rectangle in cells, inclusive, with no margin added.
 *
 * `floor` on the near edge and `ceil - 1` on the far edge, so a cell that is one pixel
 * inside the viewport counts as visible. The streamer adds the prefetch ring on top of
 * this; adding a margin here as well would double it invisibly.
 */
export function visibleCellRect(
  scroll: ScrollPoint,
  size: ViewportSize,
  zoom: number,
  cellPx: number,
): CellRect {
  const topLeft = worldPointOfScreen(scroll, size, zoom, 0, 0);
  const bottomRight = worldPointOfScreen(scroll, size, zoom, size.width, size.height);
  return {
    minCellX: Math.floor(topLeft.worldX / cellPx),
    minCellY: Math.floor(topLeft.worldY / cellPx),
    maxCellX: Math.ceil(bottomRight.worldX / cellPx) - 1,
    maxCellY: Math.ceil(bottomRight.worldY / cellPx) - 1,
  };
}

/** The cell under a screen position. */
export function cellOfScreen(
  scroll: ScrollPoint,
  size: ViewportSize,
  zoom: number,
  cellPx: number,
  screenX: number,
  screenY: number,
): { readonly cellX: number; readonly cellY: number } {
  const point = worldPointOfScreen(scroll, size, zoom, screenX, screenY);
  return {
    cellX: Math.floor(point.worldX / cellPx),
    cellY: Math.floor(point.worldY / cellPx),
  };
}

/** The scroll that centres the camera on a cell. */
export function scrollCenteredOnCell(
  size: ViewportSize,
  cellPx: number,
  cellX: number,
  cellY: number,
): ScrollPoint {
  return {
    x: (cellX + 0.5) * cellPx - size.width / 2,
    y: (cellY + 0.5) * cellPx - size.height / 2,
  };
}
