// Choosing where the holding goes, with the shared generator and the shared rules.
//
// Owner: workflow W7-B. `scripts/smoke/**`.
//
// The scenario never hard codes a coordinate. It reproduces the terrain locally with
// `generateChunkTerrain` of `shared/world`, which is the same function the server and the
// renderer run (GDD sections 7 and 58), asks the server for the modification layer of the same
// chunks through `POST /api/world/chunks`, and then looks for the surfaces the steps need:
//
//   - one block of grassland for the farm buildings;
//   - one block of exactly 250 cells for the field, straddling a chunk border, which is what
//     GDD section 18 asks a field to be able to do;
//   - one block of forest for the plot of the forestry steps.
//
// A cell that appears in the modification layer is treated as unavailable whatever it says.
// That is deliberately blunter than the shared selection rules, which the server applies
// anyway: the scenario is looking for untouched ground, and "somebody has already done
// something here" is the only question it needs answered.
//
// The search returns the candidate closest to the origin the spawn allocator gave the player,
// so the holding is compact and the choice is reproducible from the seed alone.

import {
  CHUNK_SIZE,
  chunkOf,
  generateChunkTerrain,
  TERRAIN_CODE,
  type CellCoord,
  type ChunkCoord,
  type ChunkResult,
  type TerrainType,
} from '../../shared/index.js';

/** A rectangle of cells, as the scenario places one. */
export interface CellRect {
  readonly cellX: number;
  readonly cellY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

/** Every cell of a rectangle, row major, which is the order a selection travels in. */
export function rectCells(rect: CellRect): CellCoord[] {
  const cells: CellCoord[] = [];
  for (let offsetY = 0; offsetY < rect.heightCells; offsetY += 1) {
    for (let offsetX = 0; offsetX < rect.widthCells; offsetX += 1) {
      cells.push({ cellX: rect.cellX + offsetX, cellY: rect.cellY + offsetY });
    }
  }
  return cells;
}

/** Chunks a rectangle touches, which is what GDD section 18 is about for a field. */
export function chunksOfRect(rect: CellRect): readonly string[] {
  const seen = new Set<string>();
  for (const cell of rectCells(rect)) {
    const chunk = chunkOf(cell.cellX, cell.cellY);
    seen.add(`${String(chunk.chunkX)},${String(chunk.chunkY)}`);
  }
  return [...seen];
}

/**
 * The window of the world the scenario looks at: a square of chunks around the origin of the
 * player. Seven on a side is 49 chunks, below the ceiling of a single batch request
 * (`MAX_CHUNKS_PER_REQUEST`), and 224 cells on a side, which is wide enough that a field of
 * 250 cells and five building footprints fit without the search having to widen.
 */
export const WINDOW_CHUNKS_RADIUS = 3;

export class SiteFinder {
  private readonly originCellX: number;
  private readonly originCellY: number;
  private readonly widthCells: number;
  private readonly heightCells: number;
  private readonly terrain: Uint8Array;
  private readonly blocked: Uint8Array;

  constructor(
    seed: number,
    private readonly spawn: CellCoord,
  ) {
    const centre = chunkOf(spawn.cellX, spawn.cellY);
    const side = WINDOW_CHUNKS_RADIUS * 2 + 1;
    this.originCellX = (centre.chunkX - WINDOW_CHUNKS_RADIUS) * CHUNK_SIZE;
    this.originCellY = (centre.chunkY - WINDOW_CHUNKS_RADIUS) * CHUNK_SIZE;
    this.widthCells = side * CHUNK_SIZE;
    this.heightCells = side * CHUNK_SIZE;
    this.terrain = new Uint8Array(this.widthCells * this.heightCells);
    this.blocked = new Uint8Array(this.widthCells * this.heightCells);

    for (const chunk of this.windowChunks()) {
      const cells = generateChunkTerrain(seed, chunk);
      const firstCellX = chunk.chunkX * CHUNK_SIZE;
      const firstCellY = chunk.chunkY * CHUNK_SIZE;
      for (let localY = 0; localY < CHUNK_SIZE; localY += 1) {
        for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
          const code = cells[localY * CHUNK_SIZE + localX];
          this.terrain[this.indexOf(firstCellX + localX, firstCellY + localY)] = code ?? 0;
        }
      }
    }
  }

  /** The chunks of the window, in a stable order, as the batch request asks for them. */
  windowChunks(): readonly ChunkCoord[] {
    const centre = chunkOf(this.spawn.cellX, this.spawn.cellY);
    const chunks: ChunkCoord[] = [];
    for (let offsetY = -WINDOW_CHUNKS_RADIUS; offsetY <= WINDOW_CHUNKS_RADIUS; offsetY += 1) {
      for (let offsetX = -WINDOW_CHUNKS_RADIUS; offsetX <= WINDOW_CHUNKS_RADIUS; offsetX += 1) {
        chunks.push({ chunkX: centre.chunkX + offsetX, chunkY: centre.chunkY + offsetY });
      }
    }
    return chunks;
  }

  /** Marks every cell the server reports as modified, whatever the modification says. */
  blockModifiedCells(results: readonly ChunkResult[]): number {
    let blockedCount = 0;
    for (const chunk of results) {
      if (chunk.unchanged) {
        continue;
      }
      const firstCellX = chunk.chunkX * CHUNK_SIZE;
      const firstCellY = chunk.chunkY * CHUNK_SIZE;
      for (const cell of chunk.cells) {
        const cellX = firstCellX + (cell.idx % CHUNK_SIZE);
        const cellY = firstCellY + Math.floor(cell.idx / CHUNK_SIZE);
        const index = this.indexOf(cellX, cellY);
        if (index >= 0 && this.blocked[index] === 0) {
          this.blocked[index] = 1;
          blockedCount += 1;
        }
      }
    }
    return blockedCount;
  }

  /** Reserves the cells of a rectangle so a later search cannot pick them again. */
  reserve(rect: CellRect): void {
    for (const cell of rectCells(rect)) {
      const index = this.indexOf(cell.cellX, cell.cellY);
      if (index >= 0) {
        this.blocked[index] = 1;
      }
    }
  }

  /**
   * The rectangle of the requested shape and terrain nearest to the origin of the player, or
   * null when the window holds none. `spanningChunks` demands that the rectangle touch more
   * than one chunk, which is the requirement of GDD section 18 for the field.
   */
  findRect(
    widthCells: number,
    heightCells: number,
    terrain: TerrainType,
    options: { readonly spanningChunks?: boolean } = {},
  ): CellRect | null {
    const wanted = TERRAIN_CODE[terrain];
    let best: CellRect | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let localY = 0; localY + heightCells <= this.heightCells; localY += 1) {
      for (let localX = 0; localX + widthCells <= this.widthCells; localX += 1) {
        const rect: CellRect = {
          cellX: this.originCellX + localX,
          cellY: this.originCellY + localY,
          widthCells,
          heightCells,
        };
        // A rectangle is inside one chunk exactly when its two opposite corners are, so the
        // test costs two divisions instead of one per cell.
        if (options.spanningChunks === true) {
          const northWest = chunkOf(rect.cellX, rect.cellY);
          const southEast = chunkOf(rect.cellX + widthCells - 1, rect.cellY + heightCells - 1);
          if (northWest.chunkX === southEast.chunkX && northWest.chunkY === southEast.chunkY) {
            continue;
          }
        }
        const centreX = rect.cellX + (widthCells - 1) / 2;
        const centreY = rect.cellY + (heightCells - 1) / 2;
        const distance =
          Math.abs(centreX - this.spawn.cellX) + Math.abs(centreY - this.spawn.cellY);
        if (distance >= bestDistance) {
          continue;
        }
        if (!this.isClear(localX, localY, widthCells, heightCells, wanted)) {
          continue;
        }
        best = rect;
        bestDistance = distance;
      }
    }
    return best;
  }

  private isClear(
    localX: number,
    localY: number,
    widthCells: number,
    heightCells: number,
    wanted: number,
  ): boolean {
    for (let offsetY = 0; offsetY < heightCells; offsetY += 1) {
      const row = (localY + offsetY) * this.widthCells;
      for (let offsetX = 0; offsetX < widthCells; offsetX += 1) {
        const index = row + localX + offsetX;
        if (this.terrain[index] !== wanted || this.blocked[index] === 1) {
          return false;
        }
      }
    }
    return true;
  }

  private indexOf(cellX: number, cellY: number): number {
    const localX = cellX - this.originCellX;
    const localY = cellY - this.originCellY;
    if (localX < 0 || localY < 0 || localX >= this.widthCells || localY >= this.heightCells) {
      return -1;
    }
    return localY * this.widthCells + localX;
  }
}
