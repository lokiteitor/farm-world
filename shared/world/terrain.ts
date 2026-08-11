// Deterministic terrain generator.
//
// Owner: workflow W2 (world). The same code runs on the server and on the client, so
// the two must agree byte for byte: the client decodes a chunk it generated itself and
// only receives the overlay of player modifications (GDD sections 7 and 58, plan
// section 5.1).
//
// Construction, in three layers:
//
//   1. An integer hash of (seed, generatorVersion, x, y, salt) with a 32 bit avalanche
//      finaliser. There is no `Math.random` anywhere: the eslint zone rules of the
//      repository forbid it inside shared/, precisely because a single random draw
//      would make the world unreproducible and the whole procedural persistence model
//      collapse.
//   2. Fractal value noise: several octaves of a value grid, bilinearly interpolated
//      with a quintic ease so that the field has no visible grid creases, summed with
//      a decaying amplitude and normalised into 0..1.
//   3. Classification of two independent fields, elevation and moisture, against the
//      thresholds of shared/config: water, then mountain, then forest, and grass as the
//      remainder.
//
// Why the corner values are precomputed per chunk. A naive implementation hashes four
// corners per cell per octave, that is about 28 700 hashes for a chunk of 1 024 cells
// over seven octaves. Since the shortest octave period is twelve cells, a chunk only
// ever touches a handful of grid corners per octave, so precomputing the corner grid
// brings it down to about a hundred hashes per chunk. The single cell path and the
// chunk path share the same bilinear function and accumulate the octaves in the same
// order, so their results are bit identical, which a test asserts.

import {
  CELLS_PER_CHUNK,
  CHUNK_SIZE,
  GENERATOR_VERSION,
  TERRAIN_NOISE,
  TERRAIN_THRESHOLDS_BP,
  type NoiseFieldParams,
} from '../config/world.js';
import { type ChunkCoord } from '../domain/entities.js';
import { TerrainType } from '../domain/enums.js';
import { bpToRatio, clampBp, type Bp } from '../domain/units.js';

// ---------------------------------------------------------------------------
// Wire encoding of a generated chunk
// ---------------------------------------------------------------------------

/**
 * Terrain as a byte. A generated chunk travels and is cached as 1 024 bytes, which is
 * also what the far level of detail of the renderer draws as a 32 x 32 thumbnail (plan
 * section 9.3). The mapping is part of the shared contract: changing a value changes
 * every cached chunk, so it requires incrementing `GENERATOR_VERSION`.
 */
export const TERRAIN_CODE: Readonly<Record<TerrainType, number>> = {
  GRASS: 0,
  FOREST: 1,
  MOUNTAIN: 2,
  WATER: 3,
};

/** Inverse of `TERRAIN_CODE`, indexed by the byte. */
export const TERRAIN_BY_CODE: readonly TerrainType[] = [
  TerrainType.GRASS,
  TerrainType.FOREST,
  TerrainType.MOUNTAIN,
  TerrainType.WATER,
];

/** Terrain for a byte of a generated chunk. */
export function terrainFromCode(code: number): TerrainType {
  const terrain = TERRAIN_BY_CODE[code];
  if (terrain === undefined) {
    throw new RangeError(`Unknown terrain code: ${code}`);
  }
  return terrain;
}

// ---------------------------------------------------------------------------
// Integer hash
// ---------------------------------------------------------------------------

/**
 * 32 bit avalanche finaliser. Two multiplications and three xor-shifts, which is the
 * classic low bias mixer; `Math.imul` keeps the multiplication inside int32 on every
 * engine, which is what makes the result identical in Node and in a browser.
 */
function mix32(value: number): number {
  let hash = value | 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Odd constants used to fold each component into the hash. */
const FOLD_VERSION = 0x9e37_79b1 | 0;
const FOLD_X = 0x85eb_ca6b | 0;
const FOLD_Y = 0xc2b2_ae35 | 0;

/**
 * Deterministic 32 bit hash of a grid position. Every input is folded in and mixed, so
 * that neighbouring coordinates and consecutive seeds produce unrelated values.
 */
export function hashGrid(
  seed: number,
  generatorVersion: number,
  gridX: number,
  gridY: number,
  salt: number,
): number {
  let hash = mix32((seed | 0) ^ Math.imul(generatorVersion | 0, FOLD_VERSION));
  hash = mix32(hash ^ Math.imul(gridX | 0, FOLD_X));
  hash = mix32(hash ^ Math.imul(gridY | 0, FOLD_Y));
  return mix32(hash ^ (salt | 0));
}

/** The same hash as a fraction in 0..1, which is the value of one noise grid corner. */
export function unitHash(
  seed: number,
  generatorVersion: number,
  gridX: number,
  gridY: number,
  salt: number,
): number {
  return hashGrid(seed, generatorVersion, gridX, gridY, salt) / 4_294_967_296;
}

// ---------------------------------------------------------------------------
// Fractal value noise
// ---------------------------------------------------------------------------

/**
 * Quintic ease, `6t^5 - 15t^4 + 10t^3`. Its first and second derivatives vanish at
 * both ends, so the interpolated field has no visible creases along the grid lines,
 * which a plain smoothstep leaves behind on large flat areas.
 */
function ease(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bilinear interpolation of one octave at a grid position. */
function sampleOctave(
  corner: (gridX: number, gridY: number) => number,
  gridX: number,
  gridY: number,
): number {
  const baseX = Math.floor(gridX);
  const baseY = Math.floor(gridY);
  const easeX = ease(gridX - baseX);
  const easeY = ease(gridY - baseY);
  const topLeft = corner(baseX, baseY);
  const topRight = corner(baseX + 1, baseY);
  const bottomLeft = corner(baseX, baseY + 1);
  const bottomRight = corner(baseX + 1, baseY + 1);
  const top = topLeft + (topRight - topLeft) * easeX;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * easeX;
  return top + (bottom - top) * easeY;
}

/** Frequencies and amplitudes of the octaves of a field, computed once per field. */
interface OctaveWeights {
  /** Grid units per cell for each octave. */
  readonly frequencies: readonly number[];
  readonly amplitudes: readonly number[];
  readonly amplitudeTotal: number;
  readonly salts: readonly number[];
}

/**
 * Octave weights of a noise field.
 *
 * The frequencies and amplitudes are built by repeated multiplication rather than with
 * an exponentiation, so the sequence is the same sequence of floating point values on
 * every engine and the generator stays reproducible.
 */
function octaveWeights(params: NoiseFieldParams): OctaveWeights {
  const octaves = Math.max(1, Math.floor(params.octaves));
  const persistence = bpToRatio(params.persistenceBp);
  const frequencies: number[] = [];
  const amplitudes: number[] = [];
  const salts: number[] = [];
  let frequency = 1 / params.periodCells;
  let amplitude = 1;
  let amplitudeTotal = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    frequencies.push(frequency);
    amplitudes.push(amplitude);
    salts.push((params.seedSalt + Math.imul(octave + 1, FOLD_VERSION)) | 0);
    amplitudeTotal += amplitude;
    frequency *= params.lacunarity;
    amplitude *= persistence;
  }
  return { frequencies, amplitudes, amplitudeTotal, salts };
}

/**
 * Value of a noise field at one cell, normalised into 0..1.
 *
 * The mean of the field is 0.5 and its spread is roughly 1 400 basis points, which is
 * the bell shape the thresholds of shared/config assume.
 */
export function sampleNoiseField(
  seed: number,
  generatorVersion: number,
  params: NoiseFieldParams,
  cellX: number,
  cellY: number,
): number {
  const weights = octaveWeights(params);
  let total = 0;
  for (let octave = 0; octave < weights.frequencies.length; octave += 1) {
    const frequency = weights.frequencies[octave] ?? 0;
    const amplitude = weights.amplitudes[octave] ?? 0;
    const salt = weights.salts[octave] ?? 0;
    total +=
      amplitude *
      sampleOctave(
        (gridX, gridY) => unitHash(seed, generatorVersion, gridX, gridY, salt),
        cellX * frequency,
        cellY * frequency,
      );
  }
  return total / weights.amplitudeTotal;
}

/** The same value in basis points, which is the form the thresholds are stated in. */
export function sampleNoiseFieldBp(
  seed: number,
  generatorVersion: number,
  params: NoiseFieldParams,
  cellX: number,
  cellY: number,
): Bp {
  return clampBp(sampleNoiseField(seed, generatorVersion, params, cellX, cellY) * 10_000);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Thresholds over the two fields (GDD sections 8, 10, 11 and 12). */
export interface TerrainThresholds {
  readonly waterMaxElevationBp: Bp;
  readonly mountainMinElevationBp: Bp;
  readonly forestMinMoistureBp: Bp;
}

/** Everything the generator needs beyond the seed, injected so the tests can fix it. */
export interface TerrainGeneratorOptions {
  readonly generatorVersion?: number;
  readonly noise?: Readonly<Record<'elevation' | 'moisture', NoiseFieldParams>>;
  readonly thresholds?: TerrainThresholds;
  readonly chunkSize?: number;
}

/**
 * Terrain from the two field values, in the order the thresholds are evaluated: water
 * first, then mountain, then forest, and grass as the remainder.
 *
 * Water and mountain are decided by elevation alone, which is what makes them read as
 * lakes and ranges; forest is decided by moisture over what is left, which breaks it
 * into patches rather than continents.
 */
export function classifyTerrain(
  elevationBp: Bp,
  moistureBp: Bp,
  thresholds: TerrainThresholds = TERRAIN_THRESHOLDS_BP,
): TerrainType {
  if (elevationBp <= thresholds.waterMaxElevationBp) {
    return TerrainType.WATER;
  }
  if (elevationBp >= thresholds.mountainMinElevationBp) {
    return TerrainType.MOUNTAIN;
  }
  if (moistureBp >= thresholds.forestMinMoistureBp) {
    return TerrainType.FOREST;
  }
  return TerrainType.GRASS;
}

/**
 * Terrain of one cell. This is the spot check path, used by the cell inspector and by
 * the tests; a whole chunk goes through `generateChunkTerrain`, which is two orders of
 * magnitude cheaper per cell and produces identical bytes.
 */
export function terrainAt(
  seed: number,
  cellX: number,
  cellY: number,
  options: TerrainGeneratorOptions = {},
): TerrainType {
  const generatorVersion = options.generatorVersion ?? GENERATOR_VERSION;
  const noise = options.noise ?? TERRAIN_NOISE;
  const elevation = sampleNoiseFieldBp(seed, generatorVersion, noise.elevation, cellX, cellY);
  const moisture = sampleNoiseFieldBp(seed, generatorVersion, noise.moisture, cellX, cellY);
  return classifyTerrain(elevation, moisture, options.thresholds ?? TERRAIN_THRESHOLDS_BP);
}

// ---------------------------------------------------------------------------
// Chunk generation
// ---------------------------------------------------------------------------

/** Precomputed corner values of one octave over the footprint of a chunk. */
interface CornerGrid {
  readonly values: Float64Array;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
}

function buildCornerGrid(
  seed: number,
  generatorVersion: number,
  salt: number,
  frequency: number,
  firstCellX: number,
  firstCellY: number,
  chunkSize: number,
): CornerGrid {
  const originX = Math.floor(firstCellX * frequency);
  const originY = Math.floor(firstCellY * frequency);
  const lastX = Math.floor((firstCellX + chunkSize - 1) * frequency) + 1;
  const lastY = Math.floor((firstCellY + chunkSize - 1) * frequency) + 1;
  const width = lastX - originX + 1;
  const height = lastY - originY + 1;
  const values = new Float64Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      values[row * width + column] = unitHash(
        seed,
        generatorVersion,
        originX + column,
        originY + row,
        salt,
      );
    }
  }
  return { values, originX, originY, width };
}

function fieldValues(
  seed: number,
  generatorVersion: number,
  params: NoiseFieldParams,
  chunk: ChunkCoord,
  chunkSize: number,
): Float64Array {
  const weights = octaveWeights(params);
  const firstCellX = chunk.chunkX * chunkSize;
  const firstCellY = chunk.chunkY * chunkSize;
  const result = new Float64Array(chunkSize * chunkSize);
  for (let octave = 0; octave < weights.frequencies.length; octave += 1) {
    const frequency = weights.frequencies[octave] ?? 0;
    const amplitude = weights.amplitudes[octave] ?? 0;
    const salt = weights.salts[octave] ?? 0;
    const grid = buildCornerGrid(
      seed,
      generatorVersion,
      salt,
      frequency,
      firstCellX,
      firstCellY,
      chunkSize,
    );
    const corner = (gridX: number, gridY: number): number =>
      grid.values[(gridY - grid.originY) * grid.width + (gridX - grid.originX)] ?? 0;
    for (let localY = 0; localY < chunkSize; localY += 1) {
      const cellY = (firstCellY + localY) * frequency;
      for (let localX = 0; localX < chunkSize; localX += 1) {
        const index = localY * chunkSize + localX;
        result[index] =
          (result[index] ?? 0) +
          amplitude * sampleOctave(corner, (firstCellX + localX) * frequency, cellY);
      }
    }
  }
  for (let index = 0; index < result.length; index += 1) {
    result[index] = (result[index] ?? 0) / weights.amplitudeTotal;
  }
  return result;
}

/**
 * Terrain of a whole chunk, as one byte per cell in row major order.
 *
 * The returned array is exactly `chunkSize x chunkSize` bytes, 1 024 with the chunk of
 * GDD section 6, which is the unit the cache in Redis stores with the chunk version
 * inside the key and the unit the renderer turns into a thumbnail.
 */
export function generateChunkTerrain(
  seed: number,
  chunk: ChunkCoord,
  options: TerrainGeneratorOptions = {},
): Uint8Array {
  const generatorVersion = options.generatorVersion ?? GENERATOR_VERSION;
  const noise = options.noise ?? TERRAIN_NOISE;
  const thresholds = options.thresholds ?? TERRAIN_THRESHOLDS_BP;
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const elevation = fieldValues(seed, generatorVersion, noise.elevation, chunk, chunkSize);
  const moisture = fieldValues(seed, generatorVersion, noise.moisture, chunk, chunkSize);
  const cells = new Uint8Array(chunkSize === CHUNK_SIZE ? CELLS_PER_CHUNK : chunkSize * chunkSize);
  for (let index = 0; index < cells.length; index += 1) {
    const terrain = classifyTerrain(
      clampBp((elevation[index] ?? 0) * 10_000),
      clampBp((moisture[index] ?? 0) * 10_000),
      thresholds,
    );
    cells[index] = TERRAIN_CODE[terrain];
  }
  return cells;
}

/** Count of each terrain in a generated chunk, which the distribution test aggregates. */
export function countTerrain(cells: Uint8Array): Record<TerrainType, number> {
  const counts: Record<TerrainType, number> = { GRASS: 0, FOREST: 0, MOUNTAIN: 0, WATER: 0 };
  for (const code of cells) {
    counts[terrainFromCode(code)] += 1;
  }
  return counts;
}
