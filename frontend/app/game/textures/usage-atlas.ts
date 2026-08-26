// Usage tileset: what a cell is, drawn on top of the terrain.
//
// Owner: workflow W3-D (rendering core). It is the upper layer of the near level of
// detail (plan section 9.3): ownership, the eight states of `cropCycleState`, the
// farm footprint, the forest plot and the cell awaiting confirmation. Everything
// else the world layer needs is a tint or an outline, not another tile.
//
// Legibility is a requirement and not polish. GDD section 60 asks for
// representation "sufficient for the player to read quickly", and the art is
// abstract, so each state is a pattern before it is a colour: wide furrows for
// plowed, fine furrows for cultivated, dots for seeded, green dots for
// germinating, vertical green strokes for growing (with the progress carried by a
// tint, see `growthTint`), gold with ears for ready, stubble for harvested.
//
// TELLING SIXTY TWO CROPS APART. Four of the eight states show no plant at all —
// virgin, plowed, cultivated and seeded are soil, and a seed does not read at
// sixteen pixels — so only the other four vary. They vary by *silhouette* and not
// by crop: seven looks, deliberately coarser than the ten families, because what
// the canvas has to convey at this size is the shape of the plant. Which crop it
// is comes from the tint, which already travels per cell.
//
// The arithmetic is why this is affordable. Sixty two crops times eight states
// would be 496 tiles; four states times six extra looks is 24, on top of the
// fifteen that already exist. The fifteen are kept exactly as they were and now
// stand for the spike look, so no tile is repainted and no existing index moves:
// the new ones are appended, which is what preserves the index contract this
// file's callers rely on.
//
// The tiles are translucent wherever the terrain has to stay visible, because a
// player has to be able to tell that a field sits on grass. Only the states that
// replace the surface, that is from plowed onwards, are opaque: a plowed field is
// soil, and showing grass through it would be wrong.

import { OWNERSHIP_EDGE_ALPHA, OWNERSHIP_WASH_ALPHA, PALETTE } from './palette';
import {
  atlasSize,
  blendPixel,
  createPixelBuffer,
  extrudedGeometry,
  fillRect,
  setPixel,
  writeExtrudedTile,
  type PixelBuffer,
  type TilesetGeometry,
} from './pixels';
import { TERRAIN_TILE_PX } from './terrain-atlas';
import { CROP_CYCLE_STATES, CROP_LOOKS, CropCycleState, CropLook } from '~/shared/domain/enums';

/** Side of a usage tile. The two atlases share their geometry by construction. */
export const USAGE_TILE_PX = TERRAIN_TILE_PX;

/**
 * Tiles of the usage atlas. `EMPTY` is first so index 0 is fully transparent,
 * which is the value a freshly allocated tilemap layer holds.
 */
export const UsageTile = {
  EMPTY: 'EMPTY',
  /** Owned by the player (GDD section 14). */
  OWNED: 'OWNED',
  /** Owned by somebody else: visible, and refused when purchase is attempted. */
  OWNED_FOREIGN: 'OWNED_FOREIGN',
  VIRGIN: 'VIRGIN',
  PLOWED: 'PLOWED',
  CULTIVATED: 'CULTIVATED',
  SEEDED: 'SEEDED',
  GERMINATING: 'GERMINATING',
  GROWING: 'GROWING',
  READY_TO_HARVEST: 'READY_TO_HARVEST',
  HARVESTED: 'HARVESTED',
  /** Footprint of a farm building (GDD sections 24 and 116). */
  FARM: 'FARM',
  /** Forest plot under management (GDD section 130). */
  FOREST_PLOT: 'FOREST_PLOT',
  /** Optimistic decoration only: awaiting the answer of the server (plan section 7). */
  PENDING: 'PENDING',
  /** Padding of the atlas, painted loud so an off by one is visible. */
  MISSING: 'MISSING',

  // The four states that show a plant, once per look other than `SPIKE`, which the
  // tiles above already are. Named `<LOOK>_<STATE>` and appended, never inserted.
  POD_GERMINATING: 'POD_GERMINATING',
  POD_GROWING: 'POD_GROWING',
  POD_READY_TO_HARVEST: 'POD_READY_TO_HARVEST',
  POD_HARVESTED: 'POD_HARVESTED',
  HEAD_GERMINATING: 'HEAD_GERMINATING',
  HEAD_GROWING: 'HEAD_GROWING',
  HEAD_READY_TO_HARVEST: 'HEAD_READY_TO_HARVEST',
  HEAD_HARVESTED: 'HEAD_HARVESTED',
  TUBER_GERMINATING: 'TUBER_GERMINATING',
  TUBER_GROWING: 'TUBER_GROWING',
  TUBER_READY_TO_HARVEST: 'TUBER_READY_TO_HARVEST',
  TUBER_HARVESTED: 'TUBER_HARVESTED',
  ROSETTE_GERMINATING: 'ROSETTE_GERMINATING',
  ROSETTE_GROWING: 'ROSETTE_GROWING',
  ROSETTE_READY_TO_HARVEST: 'ROSETTE_READY_TO_HARVEST',
  ROSETTE_HARVESTED: 'ROSETTE_HARVESTED',
  BUSH_GERMINATING: 'BUSH_GERMINATING',
  BUSH_GROWING: 'BUSH_GROWING',
  BUSH_READY_TO_HARVEST: 'BUSH_READY_TO_HARVEST',
  BUSH_HARVESTED: 'BUSH_HARVESTED',
  BLOOM_GERMINATING: 'BLOOM_GERMINATING',
  BLOOM_GROWING: 'BLOOM_GROWING',
  BLOOM_READY_TO_HARVEST: 'BLOOM_READY_TO_HARVEST',
  BLOOM_HARVESTED: 'BLOOM_HARVESTED',
} as const;
export type UsageTile = (typeof UsageTile)[keyof typeof UsageTile];

/**
 * Order of the tiles in the atlas. It is contract for the world layer of W4, which
 * addresses tiles by index, so the order is fixed here and read through
 * `usageTileIndex`.
 */
export const USAGE_TILE_ORDER: readonly UsageTile[] = [
  UsageTile.EMPTY,
  UsageTile.OWNED,
  UsageTile.OWNED_FOREIGN,
  UsageTile.VIRGIN,
  UsageTile.PLOWED,
  UsageTile.CULTIVATED,
  UsageTile.SEEDED,
  UsageTile.GERMINATING,
  UsageTile.GROWING,
  UsageTile.READY_TO_HARVEST,
  UsageTile.HARVESTED,
  UsageTile.FARM,
  UsageTile.FOREST_PLOT,
  UsageTile.PENDING,
  UsageTile.MISSING,
  // Appended, so every index above keeps the value it had.
  UsageTile.POD_GERMINATING,
  UsageTile.POD_GROWING,
  UsageTile.POD_READY_TO_HARVEST,
  UsageTile.POD_HARVESTED,
  UsageTile.HEAD_GERMINATING,
  UsageTile.HEAD_GROWING,
  UsageTile.HEAD_READY_TO_HARVEST,
  UsageTile.HEAD_HARVESTED,
  UsageTile.TUBER_GERMINATING,
  UsageTile.TUBER_GROWING,
  UsageTile.TUBER_READY_TO_HARVEST,
  UsageTile.TUBER_HARVESTED,
  UsageTile.ROSETTE_GERMINATING,
  UsageTile.ROSETTE_GROWING,
  UsageTile.ROSETTE_READY_TO_HARVEST,
  UsageTile.ROSETTE_HARVESTED,
  UsageTile.BUSH_GERMINATING,
  UsageTile.BUSH_GROWING,
  UsageTile.BUSH_READY_TO_HARVEST,
  UsageTile.BUSH_HARVESTED,
  UsageTile.BLOOM_GERMINATING,
  UsageTile.BLOOM_GROWING,
  UsageTile.BLOOM_READY_TO_HARVEST,
  UsageTile.BLOOM_HARVESTED,
];

/**
 * States that show a plant, and therefore vary with the look. The other four are
 * soil and keep one tile each.
 */
export const LOOK_VARIANT_STATES: readonly CropCycleState[] = [
  CropCycleState.GERMINATING,
  CropCycleState.GROWING,
  CropCycleState.READY_TO_HARVEST,
  CropCycleState.HARVESTED,
];

/**
 * Eight columns. It was four when the atlas held fifteen tiles; with thirty nine it
 * keeps the sheet closer to square, which is what a texture wants.
 */
export const USAGE_ATLAS_COLUMNS = 8;

/** Geometry of the atlas. The last slot is padding and is painted as `MISSING`. */
export const USAGE_ATLAS_GEOMETRY: TilesetGeometry = extrudedGeometry(
  USAGE_TILE_PX,
  USAGE_ATLAS_COLUMNS,
  Math.ceil(USAGE_TILE_ORDER.length / USAGE_ATLAS_COLUMNS),
);

/** Slots in the atlas, padding included. */
export const USAGE_TILE_COUNT = USAGE_ATLAS_GEOMETRY.columns * USAGE_ATLAS_GEOMETRY.rows;

/** Index of a usage tile. */
export function usageTileIndex(tile: UsageTile): number {
  const index = USAGE_TILE_ORDER.indexOf(tile);
  if (index < 0) {
    throw new RangeError(`Usage tile ${tile} is not in the atlas`);
  }
  return index;
}

/** The usage tile of a tile index, or `MISSING` for a padding slot. */
export function usageTileFromIndex(index: number): UsageTile {
  if (!Number.isInteger(index) || index < 0 || index >= USAGE_TILE_COUNT) {
    throw new RangeError(`Usage tile index ${index} is outside 0..${USAGE_TILE_COUNT - 1}`);
  }
  return USAGE_TILE_ORDER[index] ?? UsageTile.MISSING;
}

/**
 * The tile of a state of the crop cycle, drawn with the silhouette of a look.
 *
 * The four states that show soil answer with the tile that shares their name, whatever
 * the look; the four that show a plant answer with `<LOOK>_<STATE>`, and `SPIKE` answers
 * with the base tiles, which is what keeps the fifteen original ones in place.
 *
 * This is the single place that relies on the naming, so a state or a look added to the
 * domain fails here and not in a silent fallback.
 */
export function usageTileForCropState(
  state: CropCycleState,
  look: CropLook = CropLook.SPIKE,
): UsageTile {
  const varies = LOOK_VARIANT_STATES.includes(state);
  const name = varies && look !== CropLook.SPIKE ? `${look}_${state}` : state;
  const tile = USAGE_TILE_ORDER.find((candidate) => candidate === name);
  if (tile === undefined) {
    throw new RangeError(`Crop cycle state ${state} with look ${look} has no usage tile`);
  }
  return tile;
}

/** Index of the tile of a state of the crop cycle, for a look. */
export function usageTileIndexForCropState(
  state: CropCycleState,
  look: CropLook = CropLook.SPIKE,
): number {
  return usageTileIndex(usageTileForCropState(state, look));
}

// ---------------------------------------------------------------------------
// Tile painters
// ---------------------------------------------------------------------------

/** A one pixel border along the edge of the tile, which is how an area reads as owned. */
function paintEdge(tile: PixelBuffer, colour: number, alpha: number): void {
  const last = tile.width - 1;
  for (let step = 0; step < tile.width; step += 1) {
    blendPixel(tile, step, 0, colour, alpha);
    blendPixel(tile, step, 1, colour, Math.round(alpha * 0.7));
    blendPixel(tile, step, last, colour, alpha);
    blendPixel(tile, step, last - 1, colour, Math.round(alpha * 0.7));
    blendPixel(tile, 0, step, colour, alpha);
    blendPixel(tile, 1, step, colour, Math.round(alpha * 0.7));
    blendPixel(tile, last, step, colour, alpha);
    blendPixel(tile, last - 1, step, colour, Math.round(alpha * 0.7));
  }
}

/** Horizontal furrows every `period` rows, `thickness` rows each with 3D ridge shading. */
function paintFurrows(tile: PixelBuffer, colour: number, period: number, thickness: number): void {
  for (let y = 0; y < tile.height; y += 1) {
    if (y % period >= thickness) {
      continue;
    }
    for (let x = 0; x < tile.width; x += 1) {
      setPixel(tile, x, y, colour);
    }
  }
}

/** A regular lattice of seed dots with soil crumb accents. */
function paintDots(tile: PixelBuffer, colour: number, period: number, offset: number): void {
  for (let y = offset; y < tile.height - 2; y += period) {
    for (let x = offset; x < tile.width - 2; x += period) {
      setPixel(tile, x, y, colour);
      setPixel(tile, x + 1, y, colour);
      setPixel(tile, x, y + 1, colour);
    }
  }
}

/** Vertical strokes of a crop in growth, with leaves and highlights. */
function paintStalks(tile: PixelBuffer, colour: number, tipColour: number, period: number): void {
  for (let x = 2; x < tile.width - 2; x += period) {
    const height = Math.floor(x / period) % 2 === 0 ? 16 : 12;
    const top = tile.height - 3 - height;
    for (let y = top; y < tile.height - 3; y += 1) {
      setPixel(tile, x, y, y <= top + 1 ? tipColour : colour);
    }
    // Small side leaves
    setPixel(tile, x - 1, top + 4, tipColour);
    setPixel(tile, x + 1, top + 7, tipColour);
  }
}

/** Ears of wheat: full golden heads with side grains and bristles. */
function paintEars(tile: PixelBuffer, stalk: number, head: number): void {
  for (let x = 4; x < tile.width - 3; x += 7) {
    // Stalk
    for (let y = 10; y < tile.height - 3; y += 1) {
      setPixel(tile, x, y, stalk);
    }
    // Wheat ear / head
    for (let row = 4; row < 12; row += 1) {
      setPixel(tile, x, row, head);
      setPixel(tile, x - 1, row, row % 2 === 0 ? head : stalk);
      setPixel(tile, x + 1, row, row % 2 === 1 ? head : stalk);
    }
    // Awns / bristles at top
    setPixel(tile, x, 3, head);
    setPixel(tile, x - 1, 2, head);
    setPixel(tile, x + 1, 2, head);
  }
}

/** Stubble left after the harvest: short broken straw stems with soil texture. */
function paintStubble(tile: PixelBuffer, colour: number): void {
  for (let y = 3; y < tile.height - 2; y += 5) {
    for (let x = 2; x < tile.width - 2; x += 3) {
      if ((x + y) % 4 === 0) {
        continue;
      }
      setPixel(tile, x, y, colour);
      setPixel(tile, x, y + 1, colour);
      setPixel(tile, x + 1, y, colour);
    }
  }
}

/** A dashed border, which is what marks a cell as not yet confirmed. */
function paintDashedEdge(tile: PixelBuffer, colour: number, alpha: number): void {
  const last = tile.width - 1;
  for (let step = 0; step < tile.width; step += 1) {
    if (Math.floor(step / 3) % 2 === 1) {
      continue;
    }
    blendPixel(tile, step, 0, colour, alpha);
    blendPixel(tile, step, 1, colour, Math.round(alpha * 0.7));
    blendPixel(tile, step, last, colour, alpha);
    blendPixel(tile, step, last - 1, colour, Math.round(alpha * 0.7));
    blendPixel(tile, 0, step, colour, alpha);
    blendPixel(tile, 1, step, colour, Math.round(alpha * 0.7));
    blendPixel(tile, last, step, colour, alpha);
    blendPixel(tile, last - 1, step, colour, Math.round(alpha * 0.7));
  }
}

/** Diagonal hatching, used by the forest plot and by the magenta padding tile. */
function paintHatch(tile: PixelBuffer, colour: number, alpha: number, period: number): void {
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      if ((x + y) % period !== 0) {
        continue;
      }
      blendPixel(tile, x, y, colour, alpha);
    }
  }
}

// ---------------------------------------------------------------------------
// Silhouettes of the six looks other than the spike
// ---------------------------------------------------------------------------
//
// Each one draws the same four states as the spike does — a sprout, a plant in
// growth, the harvestable organ and what is left after cutting — with the shape
// that tells the family apart at sixteen pixels. They are deliberately simple:
// what carries the identity of the crop is the tint, and a silhouette that tried
// to be a portrait would only turn into noise.

/** Two paired sprouts per station, which is how a seedling reads before it has form. */
function paintSprouts(tile: PixelBuffer, colour: number, period: number): void {
  for (let x = 3; x < tile.width - 2; x += period) {
    const base = tile.height - 6;
    setPixel(tile, x, base, colour);
    setPixel(tile, x, base - 1, colour);
    setPixel(tile, x - 1, base - 2, colour);
    setPixel(tile, x + 1, base - 2, colour);
  }
}

/** Pulses: a low bush with pods hanging off its sides. */
function paintPods(tile: PixelBuffer, stem: number, pod: number, period: number): void {
  for (let x = 4; x < tile.width - 3; x += period) {
    const top = tile.height - 14;
    for (let y = top; y < tile.height - 3; y += 1) {
      setPixel(tile, x, y, stem);
    }
    for (const offset of [3, 6, 9]) {
      setPixel(tile, x - 2, top + offset, pod);
      setPixel(tile, x - 3, top + offset + 1, pod);
      setPixel(tile, x + 2, top + offset + 1, pod);
      setPixel(tile, x + 3, top + offset + 2, pod);
    }
  }
}

/** Oilseeds: one tall stem carrying a single round head. */
function paintOilHeads(tile: PixelBuffer, stem: number, head: number, period: number): void {
  for (let x = 5; x < tile.width - 4; x += period) {
    const crown = 6;
    for (let y = crown + 2; y < tile.height - 3; y += 1) {
      setPixel(tile, x, y, stem);
    }
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) <= 3) {
          setPixel(tile, x + dx, crown + dy, head);
        }
      }
    }
  }
}

/** Roots and bulbs: foliage over a mounded ridge, with the organ under the soil. */
function paintBulbs(tile: PixelBuffer, leaf: number, root: number, period: number): void {
  for (let x = 4; x < tile.width - 3; x += period) {
    const soil = tile.height - 8;
    // The mound, which is what says the crop is under the surface and not on it.
    for (let dx = -3; dx <= 3; dx += 1) {
      setPixel(tile, x + dx, soil, root);
      if (Math.abs(dx) <= 2) {
        setPixel(tile, x + dx, soil + 1, root);
      }
    }
    // The leaves above it.
    for (const dx of [-2, 0, 2]) {
      setPixel(tile, x + dx, soil - 2, leaf);
      setPixel(tile, x + dx, soil - 3, leaf);
    }
    setPixel(tile, x, soil - 4, leaf);
  }
}

/** Leafy crops: a rosette hugging the ground, drawn as a squat lozenge. */
function paintRosette(tile: PixelBuffer, leaf: number, heart: number, period: number): void {
  for (let y = 5; y < tile.height - 4; y += period) {
    for (let x = 5; x < tile.width - 4; x += period) {
      for (let dy = -3; dy <= 3; dy += 1) {
        const width = 3 - Math.abs(dy);
        for (let dx = -width; dx <= width; dx += 1) {
          setPixel(tile, x + dx, y + dy, leaf);
        }
      }
      setPixel(tile, x, y, heart);
    }
  }
}

/** Fruiting and industrial crops: a bush with fruit hanging in it. */
function paintFruits(tile: PixelBuffer, leaf: number, fruit: number, period: number): void {
  for (let y = 6; y < tile.height - 4; y += period) {
    for (let x = 6; x < tile.width - 5; x += period) {
      for (let dy = -3; dy <= 3; dy += 1) {
        const width = 4 - Math.abs(dy);
        for (let dx = -width; dx <= width; dx += 1) {
          setPixel(tile, x + dx, y + dy, leaf);
        }
      }
      setPixel(tile, x - 1, y, fruit);
      setPixel(tile, x, y, fruit);
      setPixel(tile, x, y + 1, fruit);
      setPixel(tile, x + 2, y - 1, fruit);
    }
  }
}

/** Flowers and herbs: slender stems with a blossom on top. */
function paintBlooms(tile: PixelBuffer, stem: number, petal: number, period: number): void {
  for (let x = 4; x < tile.width - 3; x += period) {
    const crown = 5 + ((x / period) % 2 === 0 ? 0 : 3);
    for (let y = crown + 2; y < tile.height - 3; y += 1) {
      setPixel(tile, x, y, stem);
    }
    setPixel(tile, x, crown, petal);
    setPixel(tile, x - 1, crown, petal);
    setPixel(tile, x + 1, crown, petal);
    setPixel(tile, x, crown - 1, petal);
    setPixel(tile, x, crown + 1, petal);
  }
}

/** Stubble left by a look, which is what the ground shows once the crop is cut. */
function paintLookStubble(tile: PixelBuffer, look: CropLook, colour: number): void {
  if (look === CropLook.TUBER) {
    // A lifted root leaves turned soil, not straw: broken ridges instead of stems.
    for (let y = 4; y < tile.height - 3; y += 6) {
      for (let x = 2; x < tile.width - 2; x += 1) {
        if ((x + y) % 5 !== 0) {
          setPixel(tile, x, y, colour);
        }
      }
    }
    return;
  }
  paintStubble(tile, colour);
}

/** Paints one of the four plant states of a look. */
function paintLookState(buffer: PixelBuffer, look: CropLook, state: CropCycleState): void {
  const crop = PALETTE.crop[state];
  const shades = PALETTE.cropLook[look];
  fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.soil);

  if (state === CropCycleState.HARVESTED) {
    paintLookStubble(buffer, look, crop.mark);
    return;
  }
  if (state === CropCycleState.GERMINATING) {
    paintFurrows(buffer, crop.markAlt, 8, 2);
    paintSprouts(buffer, shades.mark, 6);
    return;
  }
  // Growing and ready share the silhouette; ready is the one that carries the
  // harvestable organ, in the accent shade, and growing draws it in leaf.
  const organ = state === CropCycleState.READY_TO_HARVEST ? shades.accent : shades.markAlt;
  switch (look) {
    case CropLook.POD:
      paintPods(buffer, shades.mark, organ, 8);
      break;
    case CropLook.HEAD:
      paintOilHeads(buffer, shades.mark, organ, 10);
      break;
    case CropLook.TUBER:
      paintBulbs(buffer, shades.mark, organ, 8);
      break;
    case CropLook.ROSETTE:
      paintRosette(buffer, shades.mark, organ, 9);
      break;
    case CropLook.BUSH:
      paintFruits(buffer, shades.mark, organ, 11);
      break;
    case CropLook.BLOOM:
    default:
      paintBlooms(buffer, shades.mark, organ, 6);
      break;
  }
}

/** The look and state a variant tile stands for, or null when it is not one. */
function lookVariantOf(tile: UsageTile): { look: CropLook; state: CropCycleState } | null {
  for (const look of CROP_LOOKS) {
    if (look === CropLook.SPIKE) {
      continue;
    }
    for (const state of LOOK_VARIANT_STATES) {
      if (tile === `${look}_${state}`) {
        return { look, state };
      }
    }
  }
  return null;
}

/** Paints one tile of the usage atlas into a fresh buffer. */
export function paintUsageTile(tile: UsageTile): PixelBuffer {
  const buffer = createPixelBuffer(USAGE_TILE_PX, USAGE_TILE_PX);
  const crop = PALETTE.crop;

  const variant = lookVariantOf(tile);
  if (variant !== null) {
    paintLookState(buffer, variant.look, variant.state);
    return buffer;
  }

  switch (tile) {
    case UsageTile.EMPTY:
      break;

    case UsageTile.OWNED:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, PALETTE.use.OWNED, OWNERSHIP_WASH_ALPHA);
      paintEdge(buffer, PALETTE.use.OWNED, OWNERSHIP_EDGE_ALPHA);
      break;

    case UsageTile.OWNED_FOREIGN:
      fillRect(
        buffer,
        0,
        0,
        buffer.width,
        buffer.height,
        PALETTE.ownedForeign,
        OWNERSHIP_WASH_ALPHA,
      );
      paintHatch(buffer, PALETTE.ownedForeign, OWNERSHIP_EDGE_ALPHA, 6);
      break;

    // Virgin land inside a field is still grass (GDD section 13), so the tile is a
    // wash and not a soil: it says "this belongs to a field" without claiming the
    // surface has been worked.
    case UsageTile.VIRGIN:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.VIRGIN.soil, 90);
      paintDots(buffer, crop.VIRGIN.mark, 8, 3);
      break;

    case UsageTile.PLOWED:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.PLOWED.soil);
      paintFurrows(buffer, crop.PLOWED.mark, 8, 4);
      paintFurrows(buffer, crop.PLOWED.markAlt, 8, 2);
      break;

    case UsageTile.CULTIVATED:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.CULTIVATED.soil);
      paintFurrows(buffer, crop.CULTIVATED.mark, 4, 2);
      break;

    case UsageTile.SEEDED:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.SEEDED.soil);
      paintFurrows(buffer, crop.SEEDED.markAlt, 8, 2);
      paintDots(buffer, crop.SEEDED.mark, 6, 3);
      break;

    case UsageTile.GERMINATING:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.GERMINATING.soil);
      paintFurrows(buffer, crop.GERMINATING.markAlt, 8, 2);
      paintDots(buffer, crop.GERMINATING.mark, 6, 3);
      paintDots(buffer, crop.GERMINATING.mark, 6, 5);
      break;

    // The tile is drawn at full growth and the progress travels as a tint
    // (`growthTint`), which is what keeps one tile per state.
    case UsageTile.GROWING:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.GROWING.soil);
      paintStalks(buffer, crop.GROWING.mark, crop.GROWING.markAlt, 5);
      break;

    case UsageTile.READY_TO_HARVEST:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.READY_TO_HARVEST.soil);
      paintEars(buffer, crop.READY_TO_HARVEST.markAlt, crop.READY_TO_HARVEST.mark);
      break;

    case UsageTile.HARVESTED:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, crop.HARVESTED.soil);
      paintStubble(buffer, crop.HARVESTED.mark);
      break;

    // The footprint of a building is drawn under the building sprite, so it is a
    // wash: it is what makes the reserved area visible while the sprite is being
    // placed and while the placement is still pending.
    case UsageTile.FARM:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, PALETTE.use.BUILDING, 70);
      paintEdge(buffer, PALETTE.ui.outlineFarm, OWNERSHIP_EDGE_ALPHA);
      break;

    case UsageTile.FOREST_PLOT:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, PALETTE.use.FOREST_PLOT, 70);
      paintHatch(buffer, PALETTE.ui.outlineForestPlot, 150, 5);
      break;

    case UsageTile.PENDING:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, PALETTE.ui.pending, OWNERSHIP_WASH_ALPHA);
      paintDashedEdge(buffer, PALETTE.ui.pending, 220);
      break;

    case UsageTile.MISSING:
      fillRect(buffer, 0, 0, buffer.width, buffer.height, PALETTE.ui.missing, 255);
      paintHatch(buffer, 0x000000, 255, 3);
      break;
  }

  return buffer;
}

/** The whole usage atlas, extruded exactly like the terrain one. */
export function buildUsageAtlas(): PixelBuffer {
  const size = atlasSize(USAGE_ATLAS_GEOMETRY);
  const atlas = createPixelBuffer(size.width, size.height);
  for (let index = 0; index < USAGE_TILE_COUNT; index += 1) {
    writeExtrudedTile(
      atlas,
      paintUsageTile(usageTileFromIndex(index)),
      USAGE_ATLAS_GEOMETRY,
      index,
    );
  }
  return atlas;
}

/**
 * The eight states of the crop cycle, in the order of the domain. Exported so the
 * inspection route and the legend enumerate them from the vocabulary and not from a
 * list written by hand.
 */
export const CROP_STATES_IN_CYCLE_ORDER: readonly CropCycleState[] = CROP_CYCLE_STATES;
