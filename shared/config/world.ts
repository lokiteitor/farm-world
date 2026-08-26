// Scale of the world and parameters of the terrain generator.
//
// Owner: workflow W2 (vocabulary). Read by shared/world, by the backend world
// module and by the renderer.

import { type TerrainType } from '../domain/enums.js';
import { bp, type Bp } from '../domain/units.js';

/** Cells on the side of a chunk (GDD section 6). */
export const CHUNK_SIZE = 32;

/** Cells in a chunk. Derived, kept as a constant because it is used everywhere. */
export const CELLS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

/**
 * Side of a cell in metres. The GDD leaves the scale open; plan section 2 fixes it
 * at 10 m, which makes the 250 cells of GDD section 117 amount to 2.5 ha and the
 * 90 L per cell of GDD section 119 amount to 9 000 L/ha of wheat, a realistic
 * figure. A chunk is therefore 320 m on a side.
 */
export const CELL_SIZE_M = 10;

/** Side of a cell in pixels at zoom 1 (plan section 2). */
export const CELL_PX = 32;

/**
 * Shared ceiling on the size of a selection (plan section 2, resolution of GDD
 * sections 17 and 19). The client applies it while dragging and the server applies
 * it again with the same shared function, so the green highlight and the rejection
 * cannot disagree.
 */
export const MAX_SELECTION_CELLS = 2000;

/**
 * Version of the generator. Persisted on the world and checked at startup: without
 * it, tuning the noise parameters could turn a cell that is already part of a
 * field into water (plan section 5.1). Any change to `TERRAIN_NOISE` or to
 * `TERRAIN_THRESHOLDS_BP` requires incrementing it.
 */
export const GENERATOR_VERSION = 1;

/** Parameters of one fractal noise field. */
export interface NoiseFieldParams {
  /** Number of octaves summed. */
  readonly octaves: number;
  /** Period of the first octave, in cells. */
  readonly periodCells: number;
  /** Frequency ratio between consecutive octaves. */
  readonly lacunarity: number;
  /** Amplitude ratio between consecutive octaves, in basis points. */
  readonly persistenceBp: Bp;
  /**
   * Value mixed into the world seed so that two fields with the same seed are
   * independent. Not a balance number: it only has to be stable.
   */
  readonly seedSalt: number;
}

/**
 * Two independent noise fields. The GDD does not specify the generator, so these
 * values are invented; they are justified by the shape they produce rather than by
 * balance: an elevation period of 96 cells is 960 m, which gives lakes and ranges
 * a few chunks across, and a shorter moisture period breaks the forest into
 * patches instead of continents.
 */
export const TERRAIN_NOISE: Readonly<Record<'elevation' | 'moisture', NoiseFieldParams>> = {
  elevation: {
    octaves: 4,
    periodCells: 96,
    lacunarity: 2,
    persistenceBp: bp(5000),
    seedSalt: 0x00a5_1f3b,
  },
  moisture: {
    octaves: 3,
    periodCells: 64,
    lacunarity: 2,
    persistenceBp: bp(4500),
    seedSalt: 0x00c4_9e17,
  },
};

/**
 * Classification thresholds over the two normalised fields, in basis points.
 * Evaluated in this order: water, mountain, forest, and grass as the remainder.
 *
 * Invented values (the GDD gives no distribution). They assume the bell shaped
 * distribution of summed octave noise, centred at 5 000 with a spread of about
 * 1 500 basis points, and aim at a grass dominated world, which is what a farming
 * game needs: roughly 12 % water, 4 % mountain, 25 % forest and 59 % grass.
 */
export const TERRAIN_THRESHOLDS_BP = {
  /** Elevation at or below this value is water (GDD section 12). */
  waterMaxElevationBp: bp(3200),
  /** Elevation at or above this value is mountain (GDD section 11). */
  mountainMinElevationBp: bp(7600),
  /** Of what is left, moisture at or above this value is forest (GDD section 10). */
  forestMinMoistureBp: bp(5800),
} as const;

/**
 * Admissible band for the terrain distribution, checked by the generator test of
 * plan section 8 over a large sample. It is an assertion about the shape of the
 * world, not a balance number: a world with 40 % water or 2 % grass would be
 * unplayable regardless of the rest of the tuning.
 *
 * The mountain floor is 100 and not 200 basis points. Measured over 20 seeds and
 * 4 096 000 cells the real generator produces 257 basis points of mountain, the
 * tightest of the four fits, and over a single 30 by 30 chunk window the share swings
 * between 88 and 308: the band is a valid statement about the aggregate of the
 * generator and never about one region. With the floor at 100 it still detects the
 * failure that matters, which is a world with no natural barriers, without being
 * fragile (docs/handoff/NOTES-W2b.md, item 1.3, applied by the W2.5 patching window).
 *
 * `TERRAIN_NOISE`, `TERRAIN_THRESHOLDS_BP` and `GENERATOR_VERSION` are untouched:
 * the measured distribution matches the target of the header, so the shape of the
 * field needs no change and no persisted world is invalidated.
 */
export const TERRAIN_DISTRIBUTION_TARGET_BP: Readonly<
  Record<TerrainType, { readonly minBp: Bp; readonly maxBp: Bp }>
> = {
  GRASS: { minBp: bp(4000), maxBp: bp(7500) },
  FOREST: { minBp: bp(1200), maxBp: bp(3500) },
  MOUNTAIN: { minBp: bp(100), maxBp: bp(1500) },
  WATER: { minBp: bp(400), maxBp: bp(2200) },
};

/**
 * Contiguous grass cells that the deterministic spawn allocator must find before
 * it accepts an origin for a new player (plan section 2). It is sized from GDD
 * section 117: 330 cells are needed to start, so 400 leaves room for the first
 * expansion without forcing the player to move.
 */
export const MIN_SPAWN_GRASS_CELLS = 400;

/**
 * Chunks the allocator inspects before giving up, and minimum separation between
 * the origins of two players. Both are invented: the GDD does not say where a new
 * player starts. The separation of 8 chunks is 2.56 km, enough that two players
 * never see each other's land in the MVP, where there is no direct interaction.
 */
export const SPAWN_SEARCH_MAX_CHUNKS = 4096;
export const SPAWN_MIN_DISTANCE_CHUNKS = 8;
