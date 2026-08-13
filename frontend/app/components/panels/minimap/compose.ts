// Geometry of the minimap: which chunks it shows and where a point of it lands.
//
// Owner: W4-E. Pure: no canvas, no store, no clock, so the arithmetic that decides where a
// click goes is asserted in Vitest instead of being eyeballed in a browser.
//
// The minimap is a window of whole chunks centred on the camera and never a fixed region of
// the world. The world is virtually infinite (GDD section 5), so there is no map to show all
// of; what a player needs is the neighbourhood of where they are, at a scale where a field
// is a few pixels. Whole chunks and not an arbitrary rectangle because the picture it is
// made of is the chunk thumbnail of `game/world/thumbnail.ts`: one pixel per cell, written
// once when the chunk is loaded, and the very bytes the far level of detail draws. There is
// no second data path, which is what stops the minimap and the world from disagreeing about
// what a region looks like (plan section 9.3).

import { CHUNK_SIZE, floorMod } from '~/shared/index';

/** Chunks across the minimap, in both directions. Odd, so the camera has a middle chunk. */
export const MINIMAP_CHUNKS_ACROSS = 7;

export interface MinimapWindow {
  /** Top left chunk of the window. */
  readonly fromChunkX: number;
  readonly fromChunkY: number;
  readonly chunksAcross: number;
  readonly chunkSize: number;
  /** Top left cell of the window, which is the origin every conversion below uses. */
  readonly originCellX: number;
  readonly originCellY: number;
  /** Side of the window in cells, that is in thumbnail pixels. */
  readonly sideCells: number;
}

/** The window of chunks centred on a cell. */
export function minimapWindow(
  centreCellX: number,
  centreCellY: number,
  chunkSize: number = CHUNK_SIZE,
  chunksAcross: number = MINIMAP_CHUNKS_ACROSS,
): MinimapWindow {
  const half = Math.floor(chunksAcross / 2);
  const centreChunkX = Math.floor(centreCellX / chunkSize);
  const centreChunkY = Math.floor(centreCellY / chunkSize);
  const fromChunkX = centreChunkX - half;
  const fromChunkY = centreChunkY - half;
  return {
    fromChunkX,
    fromChunkY,
    chunksAcross,
    chunkSize,
    originCellX: fromChunkX * chunkSize,
    originCellY: fromChunkY * chunkSize,
    sideCells: chunksAcross * chunkSize,
  };
}

/** Every chunk of the window, in row major order, which is the order it is painted in. */
export function windowChunks(
  view: MinimapWindow,
): readonly { readonly chunkX: number; readonly chunkY: number }[] {
  const chunks: { chunkX: number; chunkY: number }[] = [];
  for (let dy = 0; dy < view.chunksAcross; dy += 1) {
    for (let dx = 0; dx < view.chunksAcross; dx += 1) {
      chunks.push({ chunkX: view.fromChunkX + dx, chunkY: view.fromChunkY + dy });
    }
  }
  return chunks;
}

/**
 * Offset, in thumbnail pixels, of the top left corner of a chunk inside the window.
 *
 * `floorMod` and not the remainder operator: chunk coordinates are signed and the world
 * extends in both directions, and `%` of a negative number in JavaScript is negative, which
 * would place a chunk west of the origin outside the buffer.
 */
export function chunkOffset(
  view: MinimapWindow,
  chunkX: number,
  chunkY: number,
): { readonly x: number; readonly y: number } {
  return {
    x: (chunkX - view.fromChunkX) * view.chunkSize,
    y: (chunkY - view.fromChunkY) * view.chunkSize,
  };
}

/** The cell a point of the minimap, in a square of `sidePx` pixels, falls on. */
export function cellOfPoint(
  view: MinimapWindow,
  x: number,
  y: number,
  sidePx: number,
): { readonly cellX: number; readonly cellY: number } {
  const scale = view.sideCells / sidePx;
  return {
    cellX: view.originCellX + Math.floor(x * scale),
    cellY: view.originCellY + Math.floor(y * scale),
  };
}

export interface MinimapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The rectangle of the viewport, in minimap pixels, clipped to the window.
 *
 * Clipped and not hidden: at a wide zoom the visible rectangle is larger than the window,
 * and drawing nothing would leave the player without the one mark that says where they are.
 * A clipped rectangle touching the four edges says "you are looking at more than this",
 * which is true.
 */
export function viewportRect(
  view: MinimapWindow,
  camera: {
    readonly minCellX: number;
    readonly minCellY: number;
    readonly maxCellX: number;
    readonly maxCellY: number;
  },
  sidePx: number,
): MinimapRect {
  const scale = sidePx / view.sideCells;
  const left = clamp((camera.minCellX - view.originCellX) * scale, 0, sidePx);
  const top = clamp((camera.minCellY - view.originCellY) * scale, 0, sidePx);
  const right = clamp((camera.maxCellX + 1 - view.originCellX) * scale, 0, sidePx);
  const bottom = clamp((camera.maxCellY + 1 - view.originCellY) * scale, 0, sidePx);
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Whether a cell falls inside the window, for a caller that wants to skip work. */
export function windowContains(view: MinimapWindow, cellX: number, cellY: number): boolean {
  return (
    cellX >= view.originCellX &&
    cellY >= view.originCellY &&
    cellX < view.originCellX + view.sideCells &&
    cellY < view.originCellY + view.sideCells
  );
}

/** Local coordinate of a cell inside its chunk. Exported for the tests of the offsets. */
export function cellInChunk(
  cellX: number,
  cellY: number,
  chunkSize: number = CHUNK_SIZE,
): { readonly localX: number; readonly localY: number } {
  return { localX: floorMod(cellX, chunkSize), localY: floorMod(cellY, chunkSize) };
}
