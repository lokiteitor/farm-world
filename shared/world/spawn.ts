// Deterministic allocation of the origin of a new player.
//
// Owner: workflow W2 (world).
//
// The GDD never says where a new player starts, which plan section 2.2 lists as a gap
// and resolves with this allocator: given the seed of the world and the index of the
// player, it finds a chunk with at least `MIN_SPAWN_GRASS_CELLS` contiguous grass cells
// and returns a cell inside that surface. The figure comes from GDD section 117, which
// needs 330 cells to start; 400 leaves room for the first expansion without forcing the
// player to move.
//
// Separation between players. Each player index maps to a point of a lattice whose
// spacing is twice `SPAWN_MIN_DISTANCE_CHUNKS`, and the search is confined to a block of
// `SPAWN_MIN_DISTANCE_CHUNKS` chunks on a side anchored at that point. Two players are
// therefore never closer than `spacing - (block - 1)` chunks, which is more than the
// minimum separation, and the guarantee is structural rather than probabilistic: no
// shared state and no retries are involved, so two concurrent registrations cannot
// collide. If the reserved block holds no usable chunk, the search continues outside it
// and says so through `withinReservedBlock`, since a player with no land is worse than a
// player closer to a neighbour than intended.

import {
  CHUNK_SIZE,
  MIN_SPAWN_GRASS_CELLS,
  SPAWN_MIN_DISTANCE_CHUNKS,
  SPAWN_SEARCH_MAX_CHUNKS,
} from '../config/world.js';
import { type CellCoord, type ChunkCoord } from '../domain/entities.js';
import { boundedBreadthFirst, cellKey } from '../rules/geometry.js';
import { TERRAIN_CODE, generateChunkTerrain, type TerrainGeneratorOptions } from './terrain.js';

export interface SpawnConfig {
  readonly minGrassCells: number;
  /** Spacing of the lattice of reserved blocks, in chunks. */
  readonly latticeSpacingChunks: number;
  /** Side of the block reserved to one player, in chunks. */
  readonly blockChunks: number;
  /** Ceiling on the chunks the allocator inspects before it settles for the best found. */
  readonly maxChunksInspected: number;
}

export const DEFAULT_SPAWN_CONFIG: SpawnConfig = {
  minGrassCells: MIN_SPAWN_GRASS_CELLS,
  latticeSpacingChunks: 2 * SPAWN_MIN_DISTANCE_CHUNKS,
  blockChunks: SPAWN_MIN_DISTANCE_CHUNKS,
  maxChunksInspected: SPAWN_SEARCH_MAX_CHUNKS,
};

export interface SpawnAssignment {
  readonly chunk: ChunkCoord;
  /** Cell the camera opens on, inside the grass surface that was found. */
  readonly originCell: CellCoord;
  /** Size of the contiguous grass surface, capped at the minimum required. */
  readonly contiguousGrassCells: number;
  readonly meetsMinimum: boolean;
  /** False when the allocator had to leave the block reserved to this player. */
  readonly withinReservedBlock: boolean;
  readonly chunksInspected: number;
}

/**
 * Lattice point of a player index, enumerated as a square spiral around the origin so
 * that consecutive players are placed near each other in the world without ever sharing
 * a block. Index 0 sits at the origin of the world.
 */
export function spawnLatticePoint(playerIndex: number, spacingChunks: number): ChunkCoord {
  if (!Number.isInteger(playerIndex) || playerIndex < 0) {
    throw new RangeError(`The player index must be a non negative integer: ${playerIndex}`);
  }
  let ring = 0;
  let ringStart = 0;
  for (;;) {
    const ringSize = ring === 0 ? 1 : 8 * ring;
    if (playerIndex < ringStart + ringSize) {
      break;
    }
    ringStart += ringSize;
    ring += 1;
  }
  if (ring === 0) {
    return { chunkX: 0, chunkY: 0 };
  }
  const offset = playerIndex - ringStart;
  const side = Math.floor(offset / (2 * ring));
  const step = offset % (2 * ring);
  let chunkX: number;
  let chunkY: number;
  switch (side) {
    case 0:
      chunkX = ring;
      chunkY = -ring + step;
      break;
    case 1:
      chunkX = ring - step;
      chunkY = ring;
      break;
    case 2:
      chunkX = -ring;
      chunkY = ring - step;
      break;
    default:
      chunkX = -ring + step;
      chunkY = -ring;
      break;
  }
  return { chunkX: chunkX * spacingChunks, chunkY: chunkY * spacingChunks };
}

/** Offsets of a block, ordered from its centre outwards, computed once per size. */
const blockOrderCache = new Map<number, readonly (readonly [number, number])[]>();

function blockOrder(blockChunks: number): readonly (readonly [number, number])[] {
  const cached = blockOrderCache.get(blockChunks);
  if (cached !== undefined) {
    return cached;
  }
  const centre = (blockChunks - 1) / 2;
  const offsets: (readonly [number, number])[] = [];
  for (let offsetY = 0; offsetY < blockChunks; offsetY += 1) {
    for (let offsetX = 0; offsetX < blockChunks; offsetX += 1) {
      offsets.push([offsetX, offsetY]);
    }
  }
  offsets.sort((left, right) => {
    const leftDistance = Math.abs(left[0] - centre) + Math.abs(left[1] - centre);
    const rightDistance = Math.abs(right[0] - centre) + Math.abs(right[1] - centre);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return left[1] === right[1] ? left[0] - right[0] : left[1] - right[1];
  });
  blockOrderCache.set(blockChunks, offsets);
  return offsets;
}

/** Chunks of a square ring at a distance, in a deterministic order. */
function ringChunks(centre: ChunkCoord, distance: number): readonly ChunkCoord[] {
  const chunks: ChunkCoord[] = [];
  for (let chunkY = centre.chunkY - distance; chunkY <= centre.chunkY + distance; chunkY += 1) {
    for (let chunkX = centre.chunkX - distance; chunkX <= centre.chunkX + distance; chunkX += 1) {
      const onRing =
        Math.abs(chunkX - centre.chunkX) === distance ||
        Math.abs(chunkY - centre.chunkY) === distance;
      if (onRing) {
        chunks.push({ chunkX, chunkY });
      }
    }
  }
  return chunks;
}

interface GrassSurface {
  readonly cells: number;
  readonly originCell: CellCoord;
}

/** Running state of a search: how many chunks were inspected and the best surface so far. */
interface SpawnSearchState {
  inspected: number;
  best: { readonly chunk: ChunkCoord; readonly surface: GrassSurface } | null;
}

/**
 * Largest contiguous grass surface inside a chunk, capped at the requested size.
 *
 * The traversal is bounded, so a chunk that is entirely grass costs the cap and not
 * 1 024 cells, and the origin returned is the cell of the surface closest to its own
 * centre of mass, which keeps the camera from opening on a corner.
 */
export function largestGrassSurface(
  seed: number,
  chunk: ChunkCoord,
  minGrassCells: number,
  options: TerrainGeneratorOptions = {},
): GrassSurface | null {
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const cells = generateChunkTerrain(seed, chunk, options);
  const firstCellX = chunk.chunkX * chunkSize;
  const firstCellY = chunk.chunkY * chunkSize;
  const isGrass = (cellX: number, cellY: number): boolean => {
    const localX = cellX - firstCellX;
    const localY = cellY - firstCellY;
    if (localX < 0 || localY < 0 || localX >= chunkSize || localY >= chunkSize) {
      return false;
    }
    return cells[localY * chunkSize + localX] === TERRAIN_CODE.GRASS;
  };

  const seen = new Set<number>();
  let best: GrassSurface | null = null;
  for (let localY = 0; localY < chunkSize; localY += 1) {
    for (let localX = 0; localX < chunkSize; localX += 1) {
      if (cells[localY * chunkSize + localX] !== TERRAIN_CODE.GRASS) {
        continue;
      }
      const startX = firstCellX + localX;
      const startY = firstCellY + localY;
      if (seen.has(cellKey(startX, startY))) {
        continue;
      }
      const surface = boundedBreadthFirst(startX, startY, isGrass, minGrassCells);
      for (const cell of surface.cells) {
        seen.add(cellKey(cell.cellX, cell.cellY));
      }
      if (best !== null && surface.cells.length <= best.cells) {
        continue;
      }
      let sumX = 0;
      let sumY = 0;
      for (const cell of surface.cells) {
        sumX += cell.cellX;
        sumY += cell.cellY;
      }
      const centreX = sumX / surface.cells.length;
      const centreY = sumY / surface.cells.length;
      let origin = surface.cells[0] ?? { cellX: startX, cellY: startY };
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const cell of surface.cells) {
        const distance = Math.abs(cell.cellX - centreX) + Math.abs(cell.cellY - centreY);
        if (distance < bestDistance) {
          bestDistance = distance;
          origin = cell;
        }
      }
      best = { cells: surface.cells.length, originCell: origin };
      if (best.cells >= minGrassCells) {
        return best;
      }
    }
  }
  return best;
}

/**
 * Origin of a player: the chunk and the cell the world opens on.
 *
 * Deterministic in the seed and the player index alone, which is what lets the backend
 * assign an origin inside the registration transaction without reading any other
 * player's row.
 */
export function assignSpawn(
  seed: number,
  playerIndex: number,
  options: TerrainGeneratorOptions & { readonly spawn?: SpawnConfig } = {},
): SpawnAssignment {
  const spawn = options.spawn ?? DEFAULT_SPAWN_CONFIG;
  const anchor = spawnLatticePoint(playerIndex, spawn.latticeSpacingChunks);
  // The running state is held in an object rather than in two local variables because
  // the search updates it from a helper, and a variable written only inside a nested
  // function is not tracked by the control flow analysis of the compiler.
  const state: SpawnSearchState = { inspected: 0, best: null };

  const consider = (chunk: ChunkCoord): GrassSurface | null => {
    state.inspected += 1;
    const surface = largestGrassSurface(seed, chunk, spawn.minGrassCells, options);
    if (surface === null) {
      return null;
    }
    if (state.best === null || surface.cells > state.best.surface.cells) {
      state.best = { chunk, surface };
    }
    return surface;
  };

  for (const offset of blockOrder(spawn.blockChunks)) {
    const chunk: ChunkCoord = {
      chunkX: anchor.chunkX + offset[0],
      chunkY: anchor.chunkY + offset[1],
    };
    const surface = consider(chunk);
    if (surface !== null && surface.cells >= spawn.minGrassCells) {
      return {
        chunk,
        originCell: surface.originCell,
        contiguousGrassCells: surface.cells,
        meetsMinimum: true,
        withinReservedBlock: true,
        chunksInspected: state.inspected,
      };
    }
  }

  // The reserved block holds nothing usable, which the terrain distribution makes very
  // unlikely. Widen the search in rings around the block until the ceiling is reached.
  const centre: ChunkCoord = {
    chunkX: anchor.chunkX + Math.floor((spawn.blockChunks - 1) / 2),
    chunkY: anchor.chunkY + Math.floor((spawn.blockChunks - 1) / 2),
  };
  for (
    let distance = spawn.blockChunks;
    state.inspected < spawn.maxChunksInspected;
    distance += 1
  ) {
    for (const chunk of ringChunks(centre, distance)) {
      if (state.inspected >= spawn.maxChunksInspected) {
        break;
      }
      const surface = consider(chunk);
      if (surface !== null && surface.cells >= spawn.minGrassCells) {
        return {
          chunk,
          originCell: surface.originCell,
          contiguousGrassCells: surface.cells,
          meetsMinimum: true,
          withinReservedBlock: false,
          chunksInspected: state.inspected,
        };
      }
    }
  }

  const fallback = state.best;
  if (fallback === null) {
    // No grass at all within the ceiling. The origin is the centre of the anchor chunk,
    // so the caller still gets a total function and a usable camera position.
    const chunkSize = options.chunkSize ?? CHUNK_SIZE;
    return {
      chunk: anchor,
      originCell: {
        cellX: anchor.chunkX * chunkSize + Math.floor(chunkSize / 2),
        cellY: anchor.chunkY * chunkSize + Math.floor(chunkSize / 2),
      },
      contiguousGrassCells: 0,
      meetsMinimum: false,
      withinReservedBlock: true,
      chunksInspected: state.inspected,
    };
  }
  return {
    chunk: fallback.chunk,
    originCell: fallback.surface.originCell,
    contiguousGrassCells: fallback.surface.cells,
    meetsMinimum: false,
    withinReservedBlock: false,
    chunksInspected: state.inspected,
  };
}
