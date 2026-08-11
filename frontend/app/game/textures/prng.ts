// Deterministic pseudorandom source of the renderer.
//
// Owner: workflow W3-D (rendering core). There is no `Math.random` here, and that
// is not a stylistic preference. The variant of a terrain tile is a property of
// the cell, so two sessions, two tabs and the server itself have to agree on it;
// a single random draw would make a chunk look different every time it streamed
// back in, and the tile mosaic would visibly reshuffle while panning.
//
// The generator is the integer hash of the terrain generator, `hashGrid` from
// shared/world/terrain.ts, reused rather than reimplemented. Reusing it is what
// gives the property the brief asks for: the variant of a cell is derived from the
// same seed and the same generator version as its terrain, so a change of seed
// reshuffles both together and a persisted world keeps its appearance.
//
// The two uses are deliberately separated:
//
//   - Per cell decisions (tile variant, tree variant) fold in the world seed.
//   - Decisions inside a texture (noise of a tile, placement of a tuft) fold in
//     `ART_SEED`, a constant, because a texture is generated once at boot and must
//     not depend on which world happens to be open.

import { GENERATOR_VERSION } from '~/shared/config/world';
import { floorMod } from '~/shared/rules/geometry';
import { hashGrid } from '~/shared/world/terrain';

/**
 * Seed of everything drawn inside a texture. A constant, so the art is identical
 * in every world: the textures are generated at boot, before any world is known.
 */
export const ART_SEED = 0x0f_a12b3c;

/**
 * Salts that separate one hash stream from another. Two streams that share a salt
 * are correlated, which shows up as visible alignment between, say, the tile
 * variant and the tree variant of the same cell.
 */
export const HASH_SALT = {
  /** Which of the four variants of a terrain tile a cell draws. */
  TILE_VARIANT: 0x51_a3_c7_1d | 0,
  /** Which rotation variant of a tree sprite a cell draws. */
  TREE_VARIANT: 0x2f_9b_44_e7 | 0,
  /** Per pixel noise of a terrain tile. */
  TILE_NOISE: 0x7c_1e_53_af | 0,
  /** Placement of the larger decorative shapes of a terrain tile. */
  TILE_SHAPE: 0x13_67_9d_25 | 0,
} as const;

/**
 * Hash of a grid position as an unsigned 32 bit integer, with the seed and the
 * generator version of the terrain folded in.
 */
export function hashAt(seed: number, x: number, y: number, salt: number): number {
  return hashGrid(seed, GENERATOR_VERSION, x, y, salt);
}

/**
 * A hash as a fraction in `[0, 1)`. `2^32` and not `2^32 - 1`, so the result never
 * reaches 1 and `Math.floor(unit * count)` cannot produce `count`.
 */
export function unitOf(hash: number): number {
  return (hash >>> 0) / 4_294_967_296;
}

/**
 * A hash reduced to `[0, count)`.
 *
 * It goes through the Euclidean modulus of shared/rules/geometry.ts and not
 * through `%`. `hashGrid` already returns an unsigned value, so for it the two
 * agree; the Euclidean one is used because this function is also called with cell
 * coordinates, which are negative in three of the four quadrants of the world, and
 * `%` truncates towards zero there, which would pick variant `-1`.
 */
export function pickIndex(hash: number, count: number): number {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`pickIndex needs a positive count, got ${count}`);
  }
  return floorMod(hash, count);
}

/**
 * Variant of the terrain tile a cell draws, stable for a world.
 *
 * `variantCount` is a parameter and not the constant of the atlas so that the
 * function stays testable against any count and so that the world layer can ask
 * for the variant of a sprite set with a different cardinality.
 */
export function variantForCell(
  seed: number,
  cellX: number,
  cellY: number,
  variantCount: number,
  salt: number = HASH_SALT.TILE_VARIANT,
): number {
  return pickIndex(hashAt(seed, cellX, cellY, salt), variantCount);
}

/**
 * A sequential stream of fractions in `[0, 1)`, for drawing one texture.
 *
 * Deliberately not a stateless per pixel hash: a pixel writer needs several
 * unrelated draws per pixel (tone, offset, whether a tuft starts here) and one
 * counter is both faster and easier to read than three salts. The counter is part
 * of the hash input, so the stream is reproducible from its seed and salt alone,
 * which is what makes the atlas tests able to assert byte equality between two
 * runs.
 */
export interface HashStream {
  /** Next fraction in `[0, 1)`. */
  next(): number;
  /** Next integer in `[0, count)`. */
  nextIndex(count: number): number;
  /** Whether the next draw falls below `probability`. */
  chance(probability: number): boolean;
  /** Restarts the stream, so the same sequence can be replayed. */
  reset(): void;
}

/**
 * A stream anchored at a position, normally the tile slot of an atlas. Two tiles
 * of the same atlas therefore never share a sequence, and the same tile redrawn
 * produces the identical sequence.
 */
export function createHashStream(seed: number, x: number, y: number, salt: number): HashStream {
  let counter = 0;
  const draw = (): number => {
    counter += 1;
    return unitOf(hashAt(seed, x, y, (salt ^ Math.imul(counter, 0x9e37_79b1)) | 0));
  };
  return {
    next: draw,
    nextIndex: (count: number): number => {
      if (!Number.isInteger(count) || count <= 0) {
        throw new RangeError(`nextIndex needs a positive count, got ${count}`);
      }
      return Math.floor(draw() * count);
    },
    chance: (probability: number): boolean => draw() < probability,
    reset: (): void => {
      counter = 0;
    },
  };
}
