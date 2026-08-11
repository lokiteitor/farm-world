// Terrain tileset: four variants of each of the four terrain types.
//
// Owner: workflow W3-D (rendering core). It is the base layer of the near level of
// detail (plan section 9.3): one Phaser tilemap per chunk with two layers over a
// single generated tileset, the lower one being terrain with four variants chosen
// by a hash of the cell coordinate.
//
// Index layout, which is contract for the world layer of W4:
//
//   index = TERRAIN_CODE[terrain] x TERRAIN_VARIANTS + variant
//
// The row order is that of `TERRAIN_CODE` in shared/world/terrain.ts, that is the
// byte a generated chunk carries on the wire, so decoding a chunk into tile indices
// is a multiplication and an addition and never a lookup table that could disagree
// with the transport encoding. A test asserts the two orders match.
//
// The atlas is extruded, which plan section 9.3 requires: 16 px tiles inside 18 px
// cells with replicated borders, registered with margin 1 and spacing 2.

import { PALETTE, type TerrainShades } from './palette';
import {
  atlasSize,
  createPixelBuffer,
  extrudedGeometry,
  fillRect,
  setPixel,
  writeExtrudedTile,
  type PixelBuffer,
  type TilesetGeometry,
} from './pixels';
import { ART_SEED, createHashStream, HASH_SALT } from './prng';
import { CELL_PX } from '~/shared/config/world';
import { type TerrainType } from '~/shared/domain/enums';
import { TERRAIN_BY_CODE, TERRAIN_CODE } from '~/shared/world/terrain';

/** Side of a terrain tile: one cell at zoom 1 (plan section 2, ADR-0012). */
export const TERRAIN_TILE_PX = CELL_PX;

/**
 * Variants per terrain type. Four is the number plan section 9.3 fixes: enough
 * that a large expanse of grass does not read as a flat colour, few enough that the
 * atlas stays one small texture and the variant fits in two bits of a hash.
 */
export const TERRAIN_VARIANTS = 4;

/** Row order of the atlas, which is the order of the wire encoding. */
export const TERRAIN_ATLAS_ORDER: readonly TerrainType[] = TERRAIN_BY_CODE;

/** Geometry of the atlas: one row per terrain, one column per variant. */
export const TERRAIN_ATLAS_GEOMETRY: TilesetGeometry = extrudedGeometry(
  TERRAIN_TILE_PX,
  TERRAIN_VARIANTS,
  TERRAIN_ATLAS_ORDER.length,
);

/** Tiles in the atlas. */
export const TERRAIN_TILE_COUNT = TERRAIN_ATLAS_GEOMETRY.columns * TERRAIN_ATLAS_GEOMETRY.rows;

/** A tile of the atlas, as the pair the world layer thinks in. */
export interface TerrainTile {
  readonly terrain: TerrainType;
  readonly variant: number;
}

/** Index of the tile of a terrain and a variant. */
export function terrainTileIndex(terrain: TerrainType, variant: number): number {
  if (!Number.isInteger(variant) || variant < 0 || variant >= TERRAIN_VARIANTS) {
    throw new RangeError(`Terrain variant ${variant} is outside 0..${TERRAIN_VARIANTS - 1}`);
  }
  return TERRAIN_CODE[terrain] * TERRAIN_VARIANTS + variant;
}

/**
 * The terrain and variant of a tile index: the inverse of `terrainTileIndex`. The
 * pair of functions is round trip tested in both directions, because an atlas whose
 * index arithmetic is wrong in one direction only shows up as one wrong tile type
 * in one code path, which is exactly the kind of bug that survives a visual review.
 */
export function terrainTileFromIndex(index: number): TerrainTile {
  if (!Number.isInteger(index) || index < 0 || index >= TERRAIN_TILE_COUNT) {
    throw new RangeError(`Terrain tile index ${index} is outside 0..${TERRAIN_TILE_COUNT - 1}`);
  }
  const terrain = TERRAIN_ATLAS_ORDER[Math.floor(index / TERRAIN_VARIANTS)];
  if (terrain === undefined) {
    throw new RangeError(`Terrain tile index ${index} has no terrain row`);
  }
  return { terrain, variant: index % TERRAIN_VARIANTS };
}

// ---------------------------------------------------------------------------
// Tile painters
// ---------------------------------------------------------------------------

/**
 * Per pixel noise, common to the four terrain types: three tones with the base
 * dominant. It is what stops a field of grass from reading as a flat fill at zoom 1
 * without adding a second texture.
 */
function paintNoise(
  tile: PixelBuffer,
  shades: TerrainShades,
  variant: number,
  darkOdds: number,
): void {
  const stream = createHashStream(ART_SEED, variant, 0, HASH_SALT.TILE_NOISE);
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const draw = stream.next();
      const colour =
        draw < darkOdds ? shades.dark : draw < darkOdds * 2 ? shades.light : shades.base;
      setPixel(tile, x, y, colour);
    }
  }
}

/**
 * Grass (GDD section 9). Base noise plus a few two pixel tufts, kept inside the
 * tile so the replicated border is plain ground and no tuft is cut in half by the
 * extrusion.
 */
function paintGrass(tile: PixelBuffer, variant: number): void {
  const shades = PALETTE.terrain.GRASS;
  paintNoise(tile, shades, variant, 0.14);
  const stream = createHashStream(ART_SEED, variant, 1, HASH_SALT.TILE_SHAPE);
  const tufts = 4 + stream.nextIndex(3);
  for (let index = 0; index < tufts; index += 1) {
    const x = 1 + stream.nextIndex(TERRAIN_TILE_PX - 2);
    const y = 1 + stream.nextIndex(TERRAIN_TILE_PX - 3);
    setPixel(tile, x, y, shades.accent);
    setPixel(tile, x, y + 1, shades.accent);
  }
}

/**
 * Forest (GDD section 10). Dark ground with three or four canopy blobs, which is
 * what makes forest readable as an economic asset rather than as dark grass.
 */
function paintForest(tile: PixelBuffer, variant: number): void {
  const shades = PALETTE.terrain.FOREST;
  paintNoise(tile, shades, variant + 16, 0.18);
  const stream = createHashStream(ART_SEED, variant, 2, HASH_SALT.TILE_SHAPE);
  const crowns = 3 + stream.nextIndex(2);
  for (let index = 0; index < crowns; index += 1) {
    const centreX = 3 + stream.nextIndex(TERRAIN_TILE_PX - 6);
    const centreY = 3 + stream.nextIndex(TERRAIN_TILE_PX - 6);
    const radius = 2 + stream.nextIndex(2);
    for (let y = centreY - radius; y <= centreY + radius; y += 1) {
      for (let x = centreX - radius; x <= centreX + radius; x += 1) {
        const dx = x - centreX;
        const dy = y - centreY;
        if (dx * dx + dy * dy > radius * radius) {
          continue;
        }
        setPixel(tile, x, y, dy >= radius - 1 ? shades.dark : shades.accent);
      }
    }
  }
}

/**
 * Mountain (GDD section 11). Grey ground with angular rock facets: a permanent
 * barrier has to read as one at a glance, because it is what divides territories
 * and creates the bottlenecks of the world.
 */
function paintMountain(tile: PixelBuffer, variant: number): void {
  const shades = PALETTE.terrain.MOUNTAIN;
  paintNoise(tile, shades, variant + 32, 0.2);
  const stream = createHashStream(ART_SEED, variant, 3, HASH_SALT.TILE_SHAPE);
  const facets = 2 + stream.nextIndex(2);
  for (let index = 0; index < facets; index += 1) {
    const peakX = 3 + stream.nextIndex(TERRAIN_TILE_PX - 6);
    const peakY = 2 + stream.nextIndex(TERRAIN_TILE_PX - 8);
    const height = 4 + stream.nextIndex(4);
    for (let row = 0; row < height; row += 1) {
      const halfWidth = Math.ceil(row / 2);
      for (let x = peakX - halfWidth; x <= peakX + halfWidth; x += 1) {
        setPixel(tile, x, peakY + row, x <= peakX ? shades.accent : shades.dark);
      }
    }
  }
}

/**
 * Water (GDD section 12). Base tone with horizontal crests. Horizontal and not
 * random: a directional pattern reads as a surface, and the tile is the only cue
 * that a cell is impassable rather than merely unowned.
 */
function paintWater(tile: PixelBuffer, variant: number): void {
  const shades = PALETTE.terrain.WATER;
  paintNoise(tile, shades, variant + 48, 0.12);
  const stream = createHashStream(ART_SEED, variant, 4, HASH_SALT.TILE_SHAPE);
  const crests = 3 + stream.nextIndex(2);
  for (let index = 0; index < crests; index += 1) {
    const y = 1 + stream.nextIndex(TERRAIN_TILE_PX - 2);
    const x = 1 + stream.nextIndex(TERRAIN_TILE_PX - 6);
    const length = 3 + stream.nextIndex(3);
    for (let step = 0; step < length; step += 1) {
      setPixel(tile, x + step, y, shades.accent);
    }
  }
}

/** Paints one tile of the atlas into a fresh buffer. */
export function paintTerrainTile(terrain: TerrainType, variant: number): PixelBuffer {
  const tile = createPixelBuffer(TERRAIN_TILE_PX, TERRAIN_TILE_PX);
  // Opaque ground first: the terrain layer has nothing underneath it, so a
  // transparent pixel would show the canvas background and read as a hole.
  fillRect(tile, 0, 0, tile.width, tile.height, PALETTE.terrain[terrain].base);
  switch (terrain) {
    case 'GRASS':
      paintGrass(tile, variant);
      break;
    case 'FOREST':
      paintForest(tile, variant);
      break;
    case 'MOUNTAIN':
      paintMountain(tile, variant);
      break;
    case 'WATER':
      paintWater(tile, variant);
      break;
  }
  return tile;
}

/**
 * The whole atlas, extruded and ready to be registered with margin 1 and
 * spacing 2. Pure: the same call always produces the same bytes, which is what a
 * test asserts and what makes the art reproducible across sessions.
 */
export function buildTerrainAtlas(): PixelBuffer {
  const size = atlasSize(TERRAIN_ATLAS_GEOMETRY);
  const atlas = createPixelBuffer(size.width, size.height);
  for (const terrain of TERRAIN_ATLAS_ORDER) {
    for (let variant = 0; variant < TERRAIN_VARIANTS; variant += 1) {
      const index = terrainTileIndex(terrain, variant);
      writeExtrudedTile(atlas, paintTerrainTile(terrain, variant), TERRAIN_ATLAS_GEOMETRY, index);
    }
  }
  return atlas;
}
