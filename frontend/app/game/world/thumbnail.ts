// The far level of detail: one 32 x 32 thumbnail per chunk, one pixel per cell.
//
// Owner: workflow W4-D (world rendering). Pure: it produces RGBA bytes and knows
// nothing about Phaser, so the colour rules are asserted byte for byte in Vitest, the
// same way W3-D asserts the atlases.
//
// Plan section 9.3 fixes the shape: at zoom 0.25 there are about 130 000 visible cells
// and a quad per cell is impossible, so a chunk becomes four kilobytes written once and
// drawn as a single scaled quad with nearest filtering. The same thumbnail feeds the
// minimap: there is no second data path, which is what stops the minimap and the world
// from disagreeing about what a region looks like.
//
// The colour rule is a reduction of the near level of detail and not a separate palette.
// A cell is its terrain, except where the modification layer says otherwise, and then it
// is the colour the near view uses for the same thing. Deriving a second palette would
// be a way to have the two levels of detail disagree at exactly the moment the player
// crosses the threshold.

import { PALETTE, OWNERSHIP_WASH_ALPHA, cropTint } from '../textures/palette';
import { type FieldRenderState, type WorldChunkView } from './source';
import { CropCycleState, LandUse, cellKey, terrainFromCode } from '~/shared/index';

/** Bytes per pixel of the thumbnail buffer. */
const CHANNELS = 4;

/** What the thumbnail needs beyond the chunk itself. Same contract as the usage layer. */
export interface ThumbnailContext {
  readonly viewerPlayerId: string | null;
  readonly fieldState: (fieldId: string) => FieldRenderState | undefined;
  readonly pending: ReadonlySet<number>;
}

/** Source over: `over` at `alpha` out of 255, on top of an opaque `under`. */
function blend(under: number, over: number, alpha: number): number {
  const ratio = alpha / 255;
  const red = Math.round(((over >>> 16) & 0xff) * ratio + ((under >>> 16) & 0xff) * (1 - ratio));
  const green = Math.round(((over >>> 8) & 0xff) * ratio + ((under >>> 8) & 0xff) * (1 - ratio));
  const blue = Math.round((over & 0xff) * ratio + (under & 0xff) * (1 - ratio));
  return (red << 16) | (green << 8) | blue;
}

/**
 * Colour of one cell of the thumbnail.
 *
 * The precedence is the precedence of the usage layer: pending first, because it is a
 * statement about the answer of the server and not about the ground; then use; then
 * ownership as a wash over the terrain; and the bare terrain when nothing applies.
 */
export function thumbnailColourOf(
  terrainColour: number,
  landUse: LandUse | null,
  ownerPlayerId: string | null,
  fieldId: string | null,
  isPending: boolean,
  context: ThumbnailContext,
): number {
  if (isPending) {
    return PALETTE.ui.pending;
  }
  if (landUse === LandUse.FIELD) {
    const state = fieldId === null ? undefined : context.fieldState(fieldId);
    if (state === undefined) {
      return PALETTE.crop.VIRGIN.soil;
    }
    const soil = PALETTE.crop[state.cropCycleState].soil;
    // The crop tint is mixed in wherever there is a plant, so the minimap tells sixty two
    // crops apart too. Soil states keep their own colour: at one pixel per cell, tinting
    // bare ground by what is going to be sown on it would be a promise, not a reading.
    return PLANT_STATES.includes(state.cropCycleState)
      ? multiplyColour(soil, cropTint(state.cropId))
      : soil;
  }
  if (landUse === LandUse.BUILDING) {
    return PALETTE.use.BUILDING;
  }
  if (landUse === LandUse.FOREST_PLOT) {
    return PALETTE.use.FOREST_PLOT;
  }
  if (ownerPlayerId === null) {
    return terrainColour;
  }
  // The wash and not the flat colour: at one pixel per cell, painting owned land
  // opaque would erase the terrain of the whole property, and terrain is what tells
  // the player where the next field can go.
  return blend(
    terrainColour,
    ownerPlayerId === context.viewerPlayerId ? PALETTE.use.OWNED : PALETTE.ownedForeign,
    OWNERSHIP_WASH_ALPHA * 2,
  );
}

/**
 * The thumbnail of a chunk: `chunkSize x chunkSize` RGBA pixels, fully opaque.
 *
 * Opaque on purpose. The thumbnail is the whole picture at this level of detail, so a
 * transparent pixel would show the canvas background and read as a hole in the world
 * rather than as a cell of any kind.
 */
/**
 * States that show a plant, and therefore take the tint of the crop.
 *
 * The same four the usage atlas varies its silhouette over, for the same reason.
 */
const PLANT_STATES: readonly CropCycleState[] = [
  CropCycleState.GERMINATING,
  CropCycleState.GROWING,
  CropCycleState.READY_TO_HARVEST,
  CropCycleState.HARVESTED,
];

/** Two colours multiplied channel by channel, which is what a tint does to a texture. */
function multiplyColour(base: number, tint: number): number {
  const channel = (shift: number): number =>
    Math.round((((base >> shift) & 0xff) * ((tint >> shift) & 0xff)) / 255);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function chunkThumbnailPixels(
  chunk: WorldChunkView,
  chunkSize: number,
  context: ThumbnailContext,
  into?: Uint8ClampedArray,
): Uint8ClampedArray {
  const cells = chunkSize * chunkSize;
  // The buffer is reused when the caller owns one. A repaint runs on every live patch,
  // and allocating four kilobytes each time is four kilobytes of garbage per patch per
  // chunk for a value that is written in full anyway.
  const pixels =
    into !== undefined && into.length === cells * CHANNELS
      ? into
      : new Uint8ClampedArray(cells * CHANNELS);
  const hasPending = context.pending.size > 0;
  const originCellX = chunk.chunkX * chunkSize;
  const originCellY = chunk.chunkY * chunkSize;

  for (let idx = 0; idx < cells; idx += 1) {
    const patch = chunk.patches.get(idx);
    const terrain = patch?.terrainOverride ?? terrainFromCode(chunk.terrain[idx] ?? 0);
    let isPending = false;
    if (hasPending) {
      const localX = idx % chunkSize;
      const localY = (idx - localX) / chunkSize;
      isPending = context.pending.has(cellKey(originCellX + localX, originCellY + localY));
    }
    const colour = thumbnailColourOf(
      PALETTE.terrain[terrain].base,
      patch?.landUse ?? null,
      patch?.ownerPlayerId ?? null,
      patch?.fieldId ?? null,
      isPending,
      context,
    );
    const offset = idx * CHANNELS;
    pixels[offset] = (colour >>> 16) & 0xff;
    pixels[offset + 1] = (colour >>> 8) & 0xff;
    pixels[offset + 2] = colour & 0xff;
    pixels[offset + 3] = 255;
  }
  return pixels;
}
