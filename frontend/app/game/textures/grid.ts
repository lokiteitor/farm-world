// Cell grid.
//
// Owner: workflow W3-D (rendering core). One tile of one cell, repeated by a single
// `TileSprite` at scene level, which is what plan section 9.3 prescribes: the grid
// is not a per chunk object and it is not a `Graphics` redrawn on every camera move,
// it is one texture and one draw call for the whole viewport.
//
// It is written pixel by pixel and not with `Graphics`, following plan section 9.4,
// which puts "what is gridded" on the pixel side. The reason is concrete: a one
// pixel line drawn by a canvas stroke lands between two pixels and antialiases into
// two half intensity rows, which at zoom 1 reads as a blurry grid and at fractional
// zoom flickers.
//
// The lines are on the north and west edges only. A tile that closed all four sides
// would double the line where two tiles meet, and the doubled line is twice as dark,
// which is exactly the artefact that makes a tiled grid look wrong.

import { GRID_LINE_ALPHA, PALETTE } from './palette';
import { createPixelBuffer, setPixel, type PixelBuffer } from './pixels';
import { CELL_PX } from '~/shared/config/world';

/** Side of the grid tile: one cell at zoom 1. */
export const GRID_TILE_PX = CELL_PX;

/** The grid tile: transparent, with one line on its north edge and one on its west. */
export function buildGridTile(): PixelBuffer {
  const tile = createPixelBuffer(GRID_TILE_PX, GRID_TILE_PX);
  for (let step = 0; step < GRID_TILE_PX; step += 1) {
    setPixel(tile, step, 0, PALETTE.ui.grid, GRID_LINE_ALPHA);
    setPixel(tile, 0, step, PALETTE.ui.grid, GRID_LINE_ALPHA);
  }
  return tile;
}
