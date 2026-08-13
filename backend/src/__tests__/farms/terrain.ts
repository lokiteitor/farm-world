// Finding real ground to build on, in a world whose seed is different on every run.
//
// Owner: workflow W4-B. Tests of the module `farms`.
//
// The harness gives each run its own `World` row with a random negative seed, which is what
// lets two agents run the suite at the same time (`docs/handoff/NOTES-w3a.md`). The price is
// that no test may assume a coordinate: a cell that is grass under one seed is water under
// the next. Every fixture here therefore searches the generated terrain for the shape it
// needs, with the same deterministic generator the client runs, and fails loudly rather than
// silently placing a building on water.
//
// The search assembles whole chunks into one grid instead of scanning chunk by chunk,
// because a garage is 6 x 8 cells and the odds of a rectangle that size lying entirely
// inside one 32 x 32 chunk are much worse than the odds of it existing at all.

import { terrainCacheOf } from '../../modules/world/generator.js';
import {
  TERRAIN_CODE,
  terrainFromCode,
  type CellCoord,
  type ChunkCoord,
  type TerrainType,
  type World,
} from '../../shared/index.js';
import { type Harness } from '../harness.js';

/** Chunks assembled into one grid per attempt. 4 x 4 chunks is 128 x 128 cells. */
const BLOCK_CHUNKS = 4;

/** Attempts before a search gives up, each one a different block of the band. */
const MAX_BLOCKS = 24;

interface TerrainBlock {
  readonly originCellX: number;
  readonly originCellY: number;
  readonly width: number;
  readonly height: number;
  readonly codes: Uint8Array;
}

/** Reads a square of chunks into one row major grid of terrain codes. */
async function readBlock(
  harness: Harness,
  world: World,
  chunkX: number,
  chunkY: number,
): Promise<TerrainBlock> {
  const cache = terrainCacheOf(harness.services);
  const chunks: ChunkCoord[] = [];
  for (let dy = 0; dy < BLOCK_CHUNKS; dy += 1) {
    for (let dx = 0; dx < BLOCK_CHUNKS; dx += 1) {
      chunks.push({ chunkX: chunkX + dx, chunkY: chunkY + dy });
    }
  }
  const size = world.chunkSize;
  const width = BLOCK_CHUNKS * size;
  const codes = new Uint8Array(width * width);
  for (const chunk of chunks) {
    const bytes = await cache.chunk(world, chunk);
    const offsetX = (chunk.chunkX - chunkX) * size;
    const offsetY = (chunk.chunkY - chunkY) * size;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        codes[(offsetY + y) * width + offsetX + x] = bytes[y * size + x] ?? 0;
      }
    }
  }
  return {
    originCellX: chunkX * size,
    originCellY: chunkY * size,
    width,
    height: width,
    codes,
  };
}

/**
 * The north west corner of a rectangle of the given size whose every cell is grass, which
 * is the one buildable terrain of `BUILDABLE_TERRAINS` (GDD section 8).
 *
 * `band` is a chunk row this file reserves for one test file, so two suites of the same run
 * never place buildings on the same ground.
 */
export async function findBuildableRectangle(
  harness: Harness,
  world: World,
  widthCells: number,
  heightCells: number,
  band: number,
): Promise<CellCoord> {
  for (let attempt = 0; attempt < MAX_BLOCKS; attempt += 1) {
    const block = await readBlock(harness, world, attempt * BLOCK_CHUNKS, band);
    for (let y = 0; y + heightCells <= block.height; y += 1) {
      for (let x = 0; x + widthCells <= block.width; x += 1) {
        if (isAllGrass(block, x, y, widthCells, heightCells)) {
          return {
            cellX: block.originCellX + x,
            cellY: block.originCellY + y,
          };
        }
      }
    }
  }
  throw new Error(
    `No hay ningun rectangulo de ${widthCells} x ${heightCells} celdas de pradera en la banda ${band}`,
  );
}

function isAllGrass(
  block: TerrainBlock,
  x: number,
  y: number,
  widthCells: number,
  heightCells: number,
): boolean {
  for (let dy = 0; dy < heightCells; dy += 1) {
    for (let dx = 0; dx < widthCells; dx += 1) {
      if (block.codes[(y + dy) * block.width + x + dx] !== TERRAIN_CODE.GRASS) {
        return false;
      }
    }
  }
  return true;
}

/**
 * A cell of one of the terrains the rules refuse, so that a rejection test asserts on real
 * generated ground rather than on a row written by hand.
 */
export async function findCellOfTerrain(
  harness: Harness,
  world: World,
  wanted: readonly TerrainType[],
  band: number,
): Promise<CellCoord> {
  for (let attempt = 0; attempt < MAX_BLOCKS; attempt += 1) {
    const block = await readBlock(harness, world, attempt * BLOCK_CHUNKS, band);
    for (let index = 0; index < block.codes.length; index += 1) {
      const code = block.codes[index];
      if (code === undefined) {
        continue;
      }
      if (wanted.includes(terrainFromCode(code))) {
        return {
          cellX: block.originCellX + (index % block.width),
          cellY: block.originCellY + Math.floor(index / block.width),
        };
      }
    }
  }
  throw new Error(`No hay ninguna celda de ${wanted.join(', ')} en la banda ${band}`);
}
