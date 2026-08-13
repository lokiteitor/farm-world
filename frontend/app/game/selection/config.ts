// Constants of the selection tool.
//
// Owner: workflow W4-G (selection tool). Every number the tool obeys is declared here
// with the clause that fixes it, for the same reason `game/world/config.ts` exists: a
// budget or a colour argued about in one place instead of spread over six modules as
// literals.
//
// The one number that is not declared here is the ceiling of a selection. It is
// `MAX_SELECTION_CELLS` of `shared/config/world.ts` and it is deliberately shared with
// the server (ADR-0012): the client stops a drag from growing past it and the endpoint
// refuses the same figure with its own code, so the green highlight and the rejection
// cannot disagree.

import { PALETTE } from '../textures/palette';
import { DEPTH } from '../world/config';

/**
 * Depth of the selection layer inside the world scene.
 *
 * Above `DEPTH.OUTLINES`, as NOTES-w4d section 3 asks: the highlight of what the player
 * is about to do has to read over the outline of what already exists, and the ten point
 * gaps of that table are there so a later layer can slot in without renumbering.
 */
export const SELECTION_DEPTH = DEPTH.OUTLINES + 10;

/** Fill of the cells that pass their rule, and of the ones that do not. */
export const SELECTION_COLOUR = {
  valid: PALETTE.ui.cursorValid,
  invalid: PALETTE.ui.cursorInvalid,
  /** Cells whose chunk is not loaded yet, so no verdict can be given about them. */
  unresolved: PALETTE.ui.cursorNeutral,
  outline: PALETTE.ui.selection,
} as const;

/**
 * Alpha of the fills.
 *
 * Low on purpose: the fill says "these cells", and the terrain and the usage tile under
 * it are what the player is judging. An opaque highlight hides exactly the information
 * the selection is being made against (GDD section 60).
 */
export const SELECTION_ALPHA = {
  valid: 0.3,
  invalid: 0.36,
  unresolved: 0.22,
  outline: 0.95,
} as const;

/** Width of the outline of the whole set, in world pixels at zoom 1. */
export const SELECTION_OUTLINE_WIDTH = 2;

/**
 * Offset of the live readout from the cell under the cursor, in screen pixels.
 *
 * Screen pixels and not world pixels because the readout lives on the overlay camera,
 * which neither scrolls nor zooms (plan section 9.2), so the label keeps the same
 * distance from the cursor at every zoom.
 */
export const READOUT_OFFSET = { offsetX: 0, offsetY: -12 } as const;
