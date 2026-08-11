import { describe, expect, it } from 'vitest';
import {
  CELLS_PER_CHUNK,
  GENERATOR_VERSION,
  TERRAIN_DISTRIBUTION_TARGET_BP,
  TERRAIN_NOISE,
  TERRAIN_THRESHOLDS_BP,
} from '../../config/world.js';
import { type ChunkCoord } from '../../domain/entities.js';
import { TERRAIN_TYPES, TerrainType } from '../../domain/enums.js';
import { bp } from '../../domain/units.js';
import { cellIndex, chunkOf } from '../../rules/geometry.js';
import {
  TERRAIN_BY_CODE,
  TERRAIN_CODE,
  classifyTerrain,
  countTerrain,
  generateChunkTerrain,
  hashGrid,
  sampleNoiseField,
  sampleNoiseFieldBp,
  terrainAt,
  terrainFromCode,
  unitHash,
} from '../terrain.js';

// Determinism of the generator, which is the fourth priority of plan section 8 and the
// assumption the whole procedural persistence model rests on (GDD sections 5, 7 and 58):
// the same seed and the same coordinates must rebuild the same terrain on the server and
// on the client, byte for byte.

/** A deterministic spread of chunks, including negative coordinates. */
function chunkAt(index: number, stride = 1): ChunkCoord {
  return {
    chunkX: ((index % 50) - 25) * stride,
    chunkY: (Math.floor(index / 50) - 20) * stride,
  };
}

describe('the integer hash', () => {
  it('is a 32 bit unsigned value and never uses ambient randomness', () => {
    let allIntegers = true;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < 1_000; index += 1) {
      const value = hashGrid(12_345, GENERATOR_VERSION, index, -index, 7);
      allIntegers = allIntegers && Number.isInteger(value);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    expect(allIntegers).toBe(true);
    expect(minimum).toBeGreaterThanOrEqual(0);
    expect(maximum).toBeLessThan(2 ** 32);
  });

  it('gives the same value for the same inputs and a different one for any change', () => {
    const base = hashGrid(1, 1, 2, 3, 4);
    expect(hashGrid(1, 1, 2, 3, 4)).toBe(base);
    expect(hashGrid(2, 1, 2, 3, 4)).not.toBe(base);
    expect(hashGrid(1, 2, 2, 3, 4)).not.toBe(base);
    expect(hashGrid(1, 1, 3, 3, 4)).not.toBe(base);
    expect(hashGrid(1, 1, 2, 4, 4)).not.toBe(base);
    expect(hashGrid(1, 1, 2, 3, 5)).not.toBe(base);
    // Transposing the coordinates must not collide either.
    expect(hashGrid(1, 1, 3, 2, 4)).not.toBe(base);
  });

  it('spreads uniformly enough for a value grid', () => {
    // Ten buckets over 100 000 samples: a hash that clumped would fail this long before it
    // produced visible artefacts in the terrain.
    const buckets = new Array<number>(10).fill(0);
    let minimum = 1;
    let maximum = 0;
    for (let index = 0; index < 100_000; index += 1) {
      const value = unitHash(99, GENERATOR_VERSION, index % 400, Math.floor(index / 400), 0);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      const bucket = Math.min(9, Math.floor(value * 10));
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    expect(minimum).toBeGreaterThanOrEqual(0);
    expect(maximum).toBeLessThan(1);
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9_000);
      expect(count).toBeLessThan(11_000);
    }
  });
});

describe('the noise fields', () => {
  it('stay inside the unit interval', () => {
    let minimum = 1;
    let maximum = 0;
    for (let index = 0; index < 5_000; index += 1) {
      const value = sampleNoiseField(7, GENERATOR_VERSION, TERRAIN_NOISE.elevation, index, -index);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    expect(minimum).toBeGreaterThanOrEqual(0);
    expect(maximum).toBeLessThanOrEqual(1);
  });

  it('are centred near the middle with the spread the thresholds assume', () => {
    // shared/config states the assumption: a bell shape centred at 5 000 basis points with
    // a spread of about 1 500. This measures it rather than trusting it, since the whole
    // classification depends on it.
    let sum = 0;
    let sumOfSquares = 0;
    let count = 0;
    for (let y = -100; y < 100; y += 1) {
      for (let x = -100; x < 100; x += 1) {
        const value = sampleNoiseField(4_242, GENERATOR_VERSION, TERRAIN_NOISE.elevation, x, y);
        sum += value;
        sumOfSquares += value * value;
        count += 1;
      }
    }
    const mean = sum / count;
    const deviation = Math.sqrt(sumOfSquares / count - mean * mean);
    expect(mean).toBeGreaterThan(0.42);
    expect(mean).toBeLessThan(0.58);
    expect(deviation).toBeGreaterThan(0.09);
    expect(deviation).toBeLessThan(0.18);
  });

  it('vary smoothly between neighbouring cells, which is what makes regions rather than noise', () => {
    let maximumStep = 0;
    for (let x = 0; x < 2_000; x += 1) {
      const here = sampleNoiseField(5, GENERATOR_VERSION, TERRAIN_NOISE.elevation, x, 0);
      const next = sampleNoiseField(5, GENERATOR_VERSION, TERRAIN_NOISE.elevation, x + 1, 0);
      maximumStep = Math.max(maximumStep, Math.abs(next - here));
    }
    // A single cell step never crosses more than a small part of the range; a white noise
    // field would routinely step by half of it.
    expect(maximumStep).toBeLessThan(0.15);
  });

  it('reports the value in basis points, which is the unit of the thresholds', () => {
    const value = sampleNoiseField(1, GENERATOR_VERSION, TERRAIN_NOISE.moisture, 10, 20);
    expect(sampleNoiseFieldBp(1, GENERATOR_VERSION, TERRAIN_NOISE.moisture, 10, 20)).toBe(
      Math.round(value * 10_000),
    );
  });
});

describe('classifyTerrain', () => {
  it('evaluates water, then mountain, then forest, then grass', () => {
    expect(classifyTerrain(bp(1_000), bp(9_000))).toBe(TerrainType.WATER);
    expect(classifyTerrain(bp(9_000), bp(9_000))).toBe(TerrainType.MOUNTAIN);
    expect(classifyTerrain(bp(5_000), bp(9_000))).toBe(TerrainType.FOREST);
    expect(classifyTerrain(bp(5_000), bp(1_000))).toBe(TerrainType.GRASS);
  });

  it('places the boundaries exactly where shared/config puts them', () => {
    const thresholds = TERRAIN_THRESHOLDS_BP;
    expect(classifyTerrain(thresholds.waterMaxElevationBp, bp(0))).toBe(TerrainType.WATER);
    expect(classifyTerrain(bp(thresholds.waterMaxElevationBp + 1), bp(0))).toBe(TerrainType.GRASS);
    expect(classifyTerrain(thresholds.mountainMinElevationBp, bp(0))).toBe(TerrainType.MOUNTAIN);
    expect(classifyTerrain(bp(thresholds.mountainMinElevationBp - 1), bp(0))).toBe(
      TerrainType.GRASS,
    );
    expect(classifyTerrain(bp(5_000), thresholds.forestMinMoistureBp)).toBe(TerrainType.FOREST);
    expect(classifyTerrain(bp(5_000), bp(thresholds.forestMinMoistureBp - 1))).toBe(
      TerrainType.GRASS,
    );
  });
});

describe('the byte encoding of a chunk', () => {
  it('is a total bijection with the terrain enum', () => {
    for (const terrain of TERRAIN_TYPES) {
      expect(terrainFromCode(TERRAIN_CODE[terrain])).toBe(terrain);
    }
    expect(TERRAIN_BY_CODE).toHaveLength(TERRAIN_TYPES.length);
    expect(() => terrainFromCode(9)).toThrow(RangeError);
  });
});

describe('generateChunkTerrain', () => {
  it('returns one byte per cell of the chunk', () => {
    const cells = generateChunkTerrain(1, { chunkX: 0, chunkY: 0 });
    expect(cells).toBeInstanceOf(Uint8Array);
    expect(cells).toHaveLength(CELLS_PER_CHUNK);
    expect(cells).toHaveLength(1_024);
  });

  it('is byte identical for the same seed and coordinates over a thousand chunks', () => {
    let differences = 0;
    for (let index = 0; index < 1_000; index += 1) {
      const chunk = chunkAt(index);
      const first = generateChunkTerrain(20_250_811, chunk);
      const second = generateChunkTerrain(20_250_811, chunk);
      for (let cell = 0; cell < CELLS_PER_CHUNK; cell += 1) {
        if (first[cell] !== second[cell]) {
          differences += 1;
        }
      }
    }
    expect(differences).toBe(0);
  });

  it('produces a different world for a different seed and for a different generator version', () => {
    const chunk = { chunkX: 3, chunkY: -4 };
    const base = generateChunkTerrain(1, chunk);
    expect(generateChunkTerrain(2, chunk)).not.toEqual(base);
    expect(generateChunkTerrain(1, chunk, { generatorVersion: GENERATOR_VERSION + 1 })).not.toEqual(
      base,
    );
  });

  it('agrees cell by cell with the single cell path', () => {
    // The two paths exist because generating a chunk precomputes the noise grid corners,
    // which is two orders of magnitude cheaper per cell. They must not diverge: the cell
    // inspector uses one and the renderer the other.
    for (const chunk of [
      { chunkX: 0, chunkY: 0 },
      { chunkX: -7, chunkY: 12 },
      { chunkX: 1_000, chunkY: -1_000 },
    ]) {
      const cells = generateChunkTerrain(31_337, chunk);
      let mismatches = 0;
      for (let index = 0; index < CELLS_PER_CHUNK; index += 1) {
        const cellX = chunk.chunkX * 32 + (index % 32);
        const cellY = chunk.chunkY * 32 + Math.floor(index / 32);
        if (terrainFromCode(cells[index] ?? 255) !== terrainAt(31_337, cellX, cellY)) {
          mismatches += 1;
        }
      }
      expect(mismatches).toBe(0);
    }
  });

  it('is continuous across a chunk boundary, since the terrain does not know about chunks', () => {
    const left = generateChunkTerrain(88, { chunkX: 0, chunkY: 0 });
    const right = generateChunkTerrain(88, { chunkX: 1, chunkY: 0 });
    for (let localY = 0; localY < 32; localY += 1) {
      // The last column of one chunk and the first of the next are neighbouring cells and
      // must be generated from the same field, which the single cell path confirms.
      expect(terrainFromCode(left[localY * 32 + 31] ?? 255)).toBe(terrainAt(88, 31, localY));
      expect(terrainFromCode(right[localY * 32] ?? 255)).toBe(terrainAt(88, 32, localY));
    }
  });

  it('agrees with the chunk arithmetic of shared/rules', () => {
    const cellX = 1_234;
    const cellY = -5_678;
    const chunk = chunkOf(cellX, cellY);
    const cells = generateChunkTerrain(500, chunk);
    expect(terrainFromCode(cells[cellIndex(cellX, cellY)] ?? 255)).toBe(
      terrainAt(500, cellX, cellY),
    );
  });

  it('generates a thousand chunks in well under two seconds', () => {
    // The only place in shared/ that reads a wall clock. It is a performance budget and not
    // a rule of the domain, which is why the zone rule that forbids `Date.now` is disabled
    // here by hand and nowhere else.
    /* eslint-disable no-restricted-properties */
    const started = Date.now();
    for (let index = 0; index < 1_000; index += 1) {
      generateChunkTerrain(4, chunkAt(index));
    }
    const elapsed = Date.now() - started;
    /* eslint-enable no-restricted-properties */
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('the distribution of terrain', () => {
  // Measured over a deterministic sample of twenty seeds and two hundred spread out chunks
  // each, that is four thousand chunks and 4 096 000 cells. The sample is fixed, so the
  // assertion is reproducible and not a statistical gamble; it estimates the distribution
  // of the generator rather than of one region, which varies far more.
  const SEEDS = [
    1,
    42,
    12_345,
    999_983,
    -7,
    2 ** 30,
    0x5f37_59df,
    77,
    314_159,
    8_675_309,
    555,
    90_210,
    -123_456,
    31_337,
    424_242,
    271_828,
    161_803,
    141_421,
    173_205,
    223_606,
  ];

  const totals: Record<TerrainType, number> = { GRASS: 0, FOREST: 0, MOUNTAIN: 0, WATER: 0 };
  let cells = 0;
  for (const seed of SEEDS) {
    for (let index = 0; index < 200; index += 1) {
      const counts = countTerrain(
        generateChunkTerrain(seed, {
          chunkX: (index % 20) * 7 - 70,
          chunkY: Math.floor(index / 20) * 11 - 55,
        }),
      );
      for (const terrain of TERRAIN_TYPES) {
        totals[terrain] += counts[terrain];
      }
      cells += CELLS_PER_CHUNK;
    }
  }
  const shareBp = (terrain: TerrainType): number => Math.round((totals[terrain] / cells) * 10_000);

  it('covers the whole sample with exactly the four terrains', () => {
    expect(cells).toBe(4_096_000);
    expect(TERRAIN_TYPES.reduce((sum, terrain) => sum + totals[terrain], 0)).toBe(cells);
  });

  it('produces a grass dominated world, which is what a farming game needs', () => {
    // The band of the brief: grass between 45 % and 65 %.
    expect(shareBp('GRASS')).toBe(5_908);
    expect(shareBp('GRASS')).toBeGreaterThanOrEqual(4_500);
    expect(shareBp('GRASS')).toBeLessThanOrEqual(6_500);
  });

  it('keeps water and mountain as barriers rather than as the landscape', () => {
    expect(shareBp('WATER')).toBe(997);
    expect(shareBp('WATER')).toBeLessThan(1_500);
    expect(shareBp('MOUNTAIN')).toBe(257);
    expect(shareBp('MOUNTAIN')).toBeLessThan(2_000);
  });

  it('leaves enough forest for the forestry system to be a real alternative', () => {
    expect(shareBp('FOREST')).toBe(2_837);
  });

  it('falls inside the admissible band that shared/config publishes', () => {
    for (const terrain of TERRAIN_TYPES) {
      const target = TERRAIN_DISTRIBUTION_TARGET_BP[terrain];
      expect(shareBp(terrain), `${terrain} below its band`).toBeGreaterThanOrEqual(target.minBp);
      expect(shareBp(terrain), `${terrain} above its band`).toBeLessThanOrEqual(target.maxBp);
    }
    // The mountain share is the tightest fit against its own band, at 257 basis points
    // against a floor of 200. A single region can legitimately fall below it, so the band is
    // an assertion about the aggregate; the handoff notes of this agent ask for the floor to
    // be relaxed rather than editing shared/config from here.
    expect(shareBp('MOUNTAIN')).toBeGreaterThan(TERRAIN_DISTRIBUTION_TARGET_BP.MOUNTAIN.minBp);
  });
});
