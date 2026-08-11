// The terrain generator and its cache, against the real Redis.
//
// Owner: workflow W3-B. Module `world`.
//
// What this file is for. The terrain never travels in a reply: the client runs the very same
// generator and reproduces the bytes locally (ADR-0010). That design only holds if the server
// and the pure function agree byte for byte and if the cache is transparent, so those are the
// two properties asserted here, together with the measurement the plan asks for: a thousand
// chunks under two seconds.
//
// The cache is asserted through its counters rather than by reading Redis, because a hit and
// a miss are exactly what a counter can distinguish and a key inspection cannot: a value read
// from Redis and a value regenerated are the same bytes by construction.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClockReading } from '../../lib/gameClock.js';
import { createTerrainCache, terrainCacheOf } from '../../modules/world/generator.js';
import {
  CELLS_PER_CHUNK,
  TERRAIN_CODE,
  TERRAIN_NOISE,
  cellKey,
  generateChunkTerrain,
  sampleNoiseField,
  terrainFromCode,
  type ChunkCoord,
  type World,
} from '../../shared/index.js';
import { createHarness, type Harness } from '../harness.js';

let harness: Harness;
let reading: ClockReading;
let world: World;

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
});

afterAll(async () => {
  await harness.teardown();
});

/** The options the cache passes to the pure generator, taken from the persisted world row. */
function generatorOptions(): { generatorVersion: number; chunkSize: number } {
  return { generatorVersion: world.generatorVersion, chunkSize: world.chunkSize };
}

describe('el generador determinista', () => {
  it('produce los mismos bytes que la funcion pura de shared/world', async () => {
    const cache = terrainCacheOf(harness.services);
    cache.clearMemory();
    const chunk: ChunkCoord = { chunkX: 3, chunkY: -7 };
    const fromCache = await cache.chunk(world, chunk);
    const fromPure = generateChunkTerrain(world.seed, chunk, generatorOptions());
    expect(fromCache.byteLength).toBe(CELLS_PER_CHUNK);
    expect([...fromCache]).toEqual([...fromPure]);
  });

  it('reproduce byte a byte la misma semilla y las mismas coordenadas', () => {
    // Determinism over a surface and not over one chunk: a hash that collided on a single
    // coordinate would still pass a one chunk comparison.
    for (let chunkY = -2; chunkY <= 2; chunkY += 1) {
      for (let chunkX = -2; chunkX <= 2; chunkX += 1) {
        const first = generateChunkTerrain(world.seed, { chunkX, chunkY }, generatorOptions());
        const second = generateChunkTerrain(world.seed, { chunkX, chunkY }, generatorOptions());
        expect([...second]).toEqual([...first]);
      }
    }
  });

  it('produce mundos distintos para semillas distintas', () => {
    // The seed enters the hash, so the two noise fields differ at every cell. That is the
    // strong statement and it holds for any pair of seeds.
    const hereField = sampleNoiseField(
      world.seed,
      world.generatorVersion,
      TERRAIN_NOISE.elevation,
      0,
      0,
    );
    const thereField = sampleNoiseField(
      world.seed + 1,
      world.generatorVersion,
      TERRAIN_NOISE.elevation,
      0,
      0,
    );
    expect(thereField).not.toBe(hereField);

    // The classification is a coarser statement and is asserted over a surface rather than
    // over one chunk: the noise has a period of 96 cells, so a single chunk can legitimately
    // come out entirely grass in both worlds.
    let differing = 0;
    for (let chunkY = 0; chunkY < 10; chunkY += 1) {
      for (let chunkX = 0; chunkX < 10; chunkX += 1) {
        const here = generateChunkTerrain(world.seed, { chunkX, chunkY }, generatorOptions());
        const there = generateChunkTerrain(world.seed + 1, { chunkX, chunkY }, generatorOptions());
        for (let index = 0; index < here.length; index += 1) {
          if (here[index] !== there[index]) {
            differing += 1;
          }
        }
      }
    }
    expect(differing).toBeGreaterThan(0);
  });

  it('solo emite codigos de terreno del contrato', async () => {
    const cache = terrainCacheOf(harness.services);
    const bytes = await cache.chunk(world, { chunkX: 11, chunkY: 5 });
    const codes = new Set(bytes);
    for (const code of codes) {
      expect(Object.values(TERRAIN_CODE)).toContain(code);
      expect(() => terrainFromCode(code)).not.toThrow();
    }
  });

  it('genera 1.000 chunks por debajo de 2 segundos', () => {
    const startedAt = performance.now();
    for (let index = 0; index < 1000; index += 1) {
      generateChunkTerrain(
        world.seed,
        { chunkX: index % 40, chunkY: Math.floor(index / 40) },
        generatorOptions(),
      );
    }
    const elapsedMs = performance.now() - startedAt;
    // The budget of plan section 8. ADR-0010 measured 135 ms, so the margin is an order of
    // magnitude and a failure here means a real regression and not a slow machine.
    expect(elapsedMs).toBeLessThan(2000);
  });
});

describe('la cache de terreno', () => {
  it('lleva la semilla, la version del generador y la coordenada en la clave', () => {
    const cache = terrainCacheOf(harness.services);
    const key = cache.redisKey(world, { chunkX: 4, chunkY: -9 });
    expect(key).toContain(`:${world.seed}:`);
    expect(key).toContain(`:${world.generatorVersion}:`);
    expect(key.endsWith(':4:-9')).toBe(true);
    expect(key.startsWith(cache.keyPrefix)).toBe(true);
  });

  it('mide fallo, acierto de proceso y acierto de Redis por separado', async () => {
    const cache = terrainCacheOf(harness.services);
    const chunk: ChunkCoord = { chunkX: 21, chunkY: 34 };
    // A key nobody has written yet, so the first read is unambiguously a miss.
    await harness.redis.commands.del(cache.redisKey(world, chunk));
    cache.clearMemory();
    cache.resetStats();

    await cache.chunk(world, chunk);
    expect(cache.stats()).toMatchObject({
      misses: 1,
      generated: 1,
      memoryHits: 0,
      redisHits: 0,
      redisReads: 1,
      redisWrites: 1,
      redisFailures: 0,
    });

    cache.resetStats();
    await cache.chunk(world, chunk);
    expect(cache.stats()).toMatchObject({
      memoryHits: 1,
      misses: 0,
      generated: 0,
      redisReads: 0,
      redisWrites: 0,
    });

    cache.resetStats();
    cache.clearMemory();
    await cache.chunk(world, chunk);
    expect(cache.stats()).toMatchObject({
      redisHits: 1,
      misses: 0,
      generated: 0,
      redisReads: 1,
      redisWrites: 0,
    });
  });

  it('sirve por Redis a un proceso que no genero el chunk, con los mismos bytes', async () => {
    const chunk: ChunkCoord = { chunkX: -13, chunkY: 8 };
    const writer = terrainCacheOf(harness.services);
    writer.clearMemory();
    const expected = await writer.chunk(world, chunk);

    // A second cache with an empty process map, which is what a second replica of the backend
    // is: it must reach the same bytes without generating them.
    const reader = createTerrainCache({
      redis: harness.redis.commands,
      keys: harness.services.keys,
      logger: harness.services.logger,
    });
    reader.resetStats();
    const actual = await reader.chunk(world, chunk);
    expect([...actual]).toEqual([...expected]);
    expect(reader.stats()).toMatchObject({ redisHits: 1, generated: 0 });
  });

  it('resuelve un lote con una sola ida y vuelta a Redis, no una por chunk', async () => {
    const cache = terrainCacheOf(harness.services);
    const chunks: ChunkCoord[] = [];
    for (let index = 0; index < 32; index += 1) {
      chunks.push({ chunkX: 100 + index, chunkY: 77 });
    }
    for (const chunk of chunks) {
      await harness.redis.commands.del(cache.redisKey(world, chunk));
    }
    cache.clearMemory();
    cache.resetStats();

    const loaded = await cache.chunks(world, chunks);
    expect(loaded.size).toBe(chunks.length);
    expect(cache.stats()).toMatchObject({ misses: 32, redisReads: 1, redisWrites: 1 });
  });

  it('trata una entrada de longitud incorrecta como fallo y la reescribe', async () => {
    const cache = terrainCacheOf(harness.services);
    const chunk: ChunkCoord = { chunkX: 55, chunkY: 55 };
    cache.clearMemory();
    await harness.redis.commands.set(cache.redisKey(world, chunk), Buffer.from([1, 2, 3]));
    cache.resetStats();

    const bytes = await cache.chunk(world, chunk);
    expect(bytes.byteLength).toBe(CELLS_PER_CHUNK);
    expect(cache.stats()).toMatchObject({ misses: 1, generated: 1, redisWrites: 1 });
    expect([...bytes]).toEqual([...generateChunkTerrain(world.seed, chunk, generatorOptions())]);
  });

  it('devuelve el terreno generado de un conjunto de celdas sueltas', async () => {
    const cache = terrainCacheOf(harness.services);
    const cells = [
      { cellX: 0, cellY: 0 },
      { cellX: 31, cellY: 31 },
      { cellX: -1, cellY: -1 },
      { cellX: 64, cellY: 3 },
    ];
    const terrain = await cache.terrainOfCells(world, cells);
    expect(terrain.size).toBe(cells.length);
    for (const cell of cells) {
      const chunkX = Math.floor(cell.cellX / world.chunkSize);
      const chunkY = Math.floor(cell.cellY / world.chunkSize);
      const bytes = generateChunkTerrain(world.seed, { chunkX, chunkY }, generatorOptions());
      const localX = cell.cellX - chunkX * world.chunkSize;
      const localY = cell.cellY - chunkY * world.chunkSize;
      const code = bytes[localY * world.chunkSize + localX] ?? 0;
      expect(terrain.get(cellKey(cell.cellX, cell.cellY))).toBe(terrainFromCode(code));
    }
  });
});
