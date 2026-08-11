import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  MIN_SPAWN_GRASS_CELLS,
  SPAWN_MIN_DISTANCE_CHUNKS,
} from '../../config/world.js';
import { TerrainType } from '../../domain/enums.js';
import { chunkOf } from '../../rules/geometry.js';
import {
  DEFAULT_SPAWN_CONFIG,
  assignSpawn,
  largestGrassSurface,
  spawnLatticePoint,
} from '../spawn.js';
import { terrainAt } from '../terrain.js';

// The origin allocator. The GDD never says where a new player starts, which plan section
// 2.2 lists as a gap; this suite is what makes the resolution trustworthy, since a player
// who starts on a lake or in a mountain range has no game at all.

describe('spawnLatticePoint', () => {
  it('places the first player at the origin of the world', () => {
    expect(spawnLatticePoint(0, 16)).toEqual({ chunkX: 0, chunkY: 0 });
  });

  it('enumerates a square spiral, so consecutive players are near each other', () => {
    const points = Array.from({ length: 25 }, (_unused, index) => spawnLatticePoint(index, 1));
    // The first ring is the eight neighbours of the origin, in one lap and with no repeats.
    const keys = new Set(points.map((point) => `${point.chunkX}:${point.chunkY}`));
    expect(keys.size).toBe(25);
    for (let index = 1; index <= 8; index += 1) {
      const point = points[index];
      expect(Math.max(Math.abs(point?.chunkX ?? 0), Math.abs(point?.chunkY ?? 0))).toBe(1);
    }
    for (let index = 9; index <= 24; index += 1) {
      const point = points[index];
      expect(Math.max(Math.abs(point?.chunkX ?? 0), Math.abs(point?.chunkY ?? 0))).toBe(2);
    }
  });

  it('scales the lattice by the spacing, which is what reserves a block per player', () => {
    expect(spawnLatticePoint(1, 16)).toEqual({ chunkX: 16, chunkY: -16 });
    expect(DEFAULT_SPAWN_CONFIG.latticeSpacingChunks).toBe(2 * SPAWN_MIN_DISTANCE_CHUNKS);
    expect(DEFAULT_SPAWN_CONFIG.blockChunks).toBe(SPAWN_MIN_DISTANCE_CHUNKS);
  });

  it('rejects a negative or fractional player index', () => {
    expect(() => spawnLatticePoint(-1, 16)).toThrow(RangeError);
    expect(() => spawnLatticePoint(1.5, 16)).toThrow(RangeError);
  });
});

describe('largestGrassSurface', () => {
  it('returns a surface whose cells are all grass and all inside the chunk', () => {
    const chunk = { chunkX: 0, chunkY: 0 };
    const surface = largestGrassSurface(12_345, chunk, MIN_SPAWN_GRASS_CELLS);
    expect(surface).not.toBeNull();
    if (surface === null) {
      return;
    }
    expect(terrainAt(12_345, surface.originCell.cellX, surface.originCell.cellY)).toBe(
      TerrainType.GRASS,
    );
    expect(chunkOf(surface.originCell.cellX, surface.originCell.cellY)).toEqual(chunk);
  });

  it('caps the traversal at the size asked for rather than walking the whole chunk', () => {
    const surface = largestGrassSurface(12_345, { chunkX: 0, chunkY: 0 }, 10);
    expect(surface?.cells).toBeLessThanOrEqual(10);
  });
});

describe('assignSpawn', () => {
  it('finds a valid origin for two hundred different seeds', () => {
    // The requirement of the brief: an origin with at least 400 contiguous grass cells,
    // which is the 330 the setup of GDD section 117 needs plus room for the first
    // expansion.
    let inspected = 0;
    for (let index = 0; index < 200; index += 1) {
      const seed = 7_919 * (index + 1);
      const spawn = assignSpawn(seed, 0);
      expect(spawn.meetsMinimum, `seed ${seed} found no origin`).toBe(true);
      expect(spawn.withinReservedBlock).toBe(true);
      expect(spawn.contiguousGrassCells).toBeGreaterThanOrEqual(MIN_SPAWN_GRASS_CELLS);
      expect(terrainAt(seed, spawn.originCell.cellX, spawn.originCell.cellY)).toBe(
        TerrainType.GRASS,
      );
      expect(chunkOf(spawn.originCell.cellX, spawn.originCell.cellY)).toEqual(spawn.chunk);
      inspected += spawn.chunksInspected;
    }
    // It finds one in the first handful of chunks of the reserved block, which is what keeps
    // registration cheap: a search that walked the whole ceiling would cost seconds.
    expect(inspected / 200).toBeLessThan(8);
  });

  it('finds a valid origin for the first fifty player indices of one world', () => {
    for (let playerIndex = 0; playerIndex < 50; playerIndex += 1) {
      const spawn = assignSpawn(20_250_811, playerIndex);
      expect(spawn.meetsMinimum, `player ${playerIndex} found no origin`).toBe(true);
      expect(spawn.withinReservedBlock).toBe(true);
    }
  });

  it('is deterministic in the seed and the player index alone', () => {
    for (const playerIndex of [0, 1, 7, 33]) {
      const first = assignSpawn(4_242, playerIndex);
      const second = assignSpawn(4_242, playerIndex);
      expect(second).toEqual(first);
    }
    expect(assignSpawn(4_242, 0)).not.toEqual(assignSpawn(4_243, 0));
    expect(assignSpawn(4_242, 0)).not.toEqual(assignSpawn(4_242, 1));
  });

  it('keeps two players at least the minimum separation apart', () => {
    const spawns = Array.from({ length: 30 }, (_unused, index) => assignSpawn(555, index));
    for (let left = 0; left < spawns.length; left += 1) {
      for (let right = left + 1; right < spawns.length; right += 1) {
        const a = spawns[left];
        const b = spawns[right];
        if (a === undefined || b === undefined) {
          continue;
        }
        const distance = Math.max(
          Math.abs(a.chunk.chunkX - b.chunk.chunkX),
          Math.abs(a.chunk.chunkY - b.chunk.chunkY),
        );
        expect(distance, `players ${left} and ${right} are too close`).toBeGreaterThanOrEqual(
          SPAWN_MIN_DISTANCE_CHUNKS,
        );
      }
    }
  });

  it('honours an injected configuration, so a test can lower the requirement', () => {
    const spawn = assignSpawn(1, 0, {
      spawn: { ...DEFAULT_SPAWN_CONFIG, minGrassCells: 10 },
    });
    expect(spawn.meetsMinimum).toBe(true);
    expect(spawn.contiguousGrassCells).toBeGreaterThanOrEqual(10);
  });

  it('stays total when nothing can satisfy the requirement', () => {
    // A requirement larger than a chunk can never be met, since the traversal is confined to
    // one chunk. The allocator still returns a usable origin and says the minimum was not
    // reached, instead of failing during a registration.
    const spawn = assignSpawn(1, 0, {
      spawn: {
        ...DEFAULT_SPAWN_CONFIG,
        minGrassCells: CHUNK_SIZE * CHUNK_SIZE + 1,
        maxChunksInspected: 80,
      },
    });
    expect(spawn.meetsMinimum).toBe(false);
    expect(spawn.chunksInspected).toBeGreaterThan(0);
    expect(Number.isInteger(spawn.originCell.cellX)).toBe(true);
    expect(Number.isInteger(spawn.originCell.cellY)).toBe(true);
  });
});
