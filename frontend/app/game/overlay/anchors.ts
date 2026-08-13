// Anchoring a label to the world on a camera that does not scroll.
//
// Owner: workflow W4-D (world rendering), on behalf of the overlay scene of plan
// section 9.2. Pure arithmetic, so the part that decides where a label lands is a test
// and not a screenshot.
//
// The problem the overlay solves. A label drawn in the world scene is scaled by the
// camera zoom like everything else, so at zoom 0.25 it is unreadable and at zoom 2.8 it
// is enormous, and the usual fix is to divide its scale by the zoom on every frame,
// which means touching every label on every frame and losing the batch. The overlay
// runs on its own camera with no scroll and no zoom, so a label is drawn at its natural
// size and only its position is recomputed. That is one number per label per frame
// instead of a transform, and it is why plan section 9.2 asks for a fourth scene rather
// than a flag on the third.

import { screenPointOfWorld, type ScrollPoint, type ViewportSize } from '../world/zoom';

/** Where a label wants to sit, in world cells. */
export interface WorldAnchor {
  readonly cellX: number;
  readonly cellY: number;
  /** Offset in screen pixels applied after projection, so it does not scale with zoom. */
  readonly offsetX?: number;
  readonly offsetY?: number;
}

/** Projection of an anchor onto the overlay camera. */
export interface AnchorScreenPoint {
  readonly screenX: number;
  readonly screenY: number;
  /** False when the anchor is outside the viewport and the label can be skipped. */
  readonly onScreen: boolean;
}

/**
 * Projects a world cell onto the overlay.
 *
 * The centre of the cell and not its corner: a label anchored to a corner drifts by
 * half a cell as the zoom changes, which is visible when the anchor is a building whose
 * footprint is two cells across.
 */
export function projectAnchor(
  anchor: WorldAnchor,
  scroll: ScrollPoint,
  size: ViewportSize,
  zoom: number,
  cellPx: number,
  marginPx = 64,
): AnchorScreenPoint {
  const point = screenPointOfWorld(
    scroll,
    size,
    zoom,
    (anchor.cellX + 0.5) * cellPx,
    (anchor.cellY + 0.5) * cellPx,
  );
  const screenX = point.screenX + (anchor.offsetX ?? 0);
  const screenY = point.screenY + (anchor.offsetY ?? 0);
  return {
    screenX,
    screenY,
    onScreen:
      screenX >= -marginPx &&
      screenY >= -marginPx &&
      screenX <= size.width + marginPx &&
      screenY <= size.height + marginPx,
  };
}
