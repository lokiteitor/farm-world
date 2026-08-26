// Decoding a chunk into tile indices and tints.
//
// Owner: workflow W4-D. Two rules of plan section 9.3 are asserted here rather than
// looked at: the growth progress travels as a tint and never as more tiles, and the
// terrain variant is a stable hash of the cell, so a chunk that streams back in does not
// reshuffle its mosaic.

import { describe, expect, it } from 'vitest';
import { cropTint, growthTint } from '../../textures/palette';
import { TERRAIN_VARIANTS, terrainTileFromIndex } from '../../textures/terrain-atlas';
import { UsageTile, usageTileIndex, usageTileIndexForCropState } from '../../textures/usage-atlas';
import {
  NO_USAGE_TILE,
  chunkTileData,
  terrainTileIndices,
  toRows,
  usageTileIndices,
} from '../tiles';
import { STRANGER, TERRAIN, VIEWER, idxOf, makeChunk, patch } from './fixtures';
import { CHUNK_SIZE, CropCycleState, CropId, LandUse, bp, cellKey } from '~/shared/index';

const CONTEXT = {
  viewerPlayerId: VIEWER,
  fieldState: () => undefined,
  pending: new Set<number>(),
};

describe('terrainTileIndices', () => {
  it('uses the generated terrain and a variant inside the atlas', () => {
    const chunk = makeChunk({ terrainCode: TERRAIN.WATER });
    const indices = terrainTileIndices(chunk, 7, CHUNK_SIZE);
    expect(indices).toHaveLength(CHUNK_SIZE * CHUNK_SIZE);
    for (const index of indices) {
      const tile = terrainTileFromIndex(index);
      expect(tile.terrain).toBe('WATER');
      expect(tile.variant).toBeGreaterThanOrEqual(0);
      expect(tile.variant).toBeLessThan(TERRAIN_VARIANTS);
    }
  });

  it('is stable for a seed and reshuffles for another one', () => {
    const chunk = makeChunk({ terrainCode: TERRAIN.GRASS });
    const first = terrainTileIndices(chunk, 7, CHUNK_SIZE);
    const again = terrainTileIndices(chunk, 7, CHUNK_SIZE);
    const other = terrainTileIndices(chunk, 8, CHUNK_SIZE);
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('lets the cleared forest override the generated terrain', () => {
    const chunk = makeChunk({
      terrainCode: TERRAIN.FOREST,
      patches: [patch({ idx: idxOf(3, 4), terrainOverride: 'GRASS' })],
    });
    const indices = terrainTileIndices(chunk, 7, CHUNK_SIZE);
    expect(terrainTileFromIndex(indices[idxOf(3, 4)] ?? 0).terrain).toBe('GRASS');
    expect(terrainTileFromIndex(indices[idxOf(3, 5)] ?? 0).terrain).toBe('FOREST');
  });

  it('offsets the variant by the absolute cell and not by the local one', () => {
    const origin = terrainTileIndices(makeChunk({}), 7, CHUNK_SIZE);
    const other = terrainTileIndices(makeChunk({ chunkX: 5, chunkY: -3 }), 7, CHUNK_SIZE);
    expect(other).not.toEqual(origin);
  });
});

describe('usageTileIndices', () => {
  it('leaves an untouched cell with no tile at all', () => {
    const { indices } = usageTileIndices(makeChunk({}), CHUNK_SIZE, CONTEXT);
    expect([...new Set(indices)]).toEqual([NO_USAGE_TILE]);
  });

  it('separates the land of the viewer from the land of a stranger', () => {
    const chunk = makeChunk({
      patches: [
        patch({ idx: idxOf(0, 0), ownerPlayerId: VIEWER, landUse: LandUse.OWNED }),
        patch({ idx: idxOf(1, 0), ownerPlayerId: STRANGER, landUse: LandUse.OWNED }),
      ],
    });
    const { indices } = usageTileIndices(chunk, CHUNK_SIZE, CONTEXT);
    expect(indices[idxOf(0, 0)]).toBe(usageTileIndex(UsageTile.OWNED));
    expect(indices[idxOf(1, 0)]).toBe(usageTileIndex(UsageTile.OWNED_FOREIGN));
  });

  it('draws a field whose state is not known yet as untouched land', () => {
    const chunk = makeChunk({
      patches: [
        patch({ idx: idxOf(2, 2), ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'f' }),
      ],
    });
    const { indices } = usageTileIndices(chunk, CHUNK_SIZE, CONTEXT);
    expect(indices[idxOf(2, 2)]).toBe(usageTileIndex(UsageTile.VIRGIN));
  });

  it('carries the growth progress as a tint and not as another tile', () => {
    const chunk = makeChunk({
      patches: [
        patch({ idx: idxOf(4, 4), ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'f' }),
        patch({ idx: idxOf(5, 4), ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'g' }),
      ],
    });
    const context = {
      ...CONTEXT,
      fieldState: (fieldId: string) =>
        fieldId === 'f'
          ? {
              cropCycleState: CropCycleState.GROWING,
              growthProgressBp: bp(2500),
              cropId: CropId.WHEAT,
            }
          : {
              cropCycleState: CropCycleState.READY_TO_HARVEST,
              growthProgressBp: bp(10_000),
              cropId: CropId.WHEAT,
            },
    };
    const { indices, tints } = usageTileIndices(chunk, CHUNK_SIZE, context);
    expect(indices[idxOf(4, 4)]).toBe(usageTileIndexForCropState(CropCycleState.GROWING));
    expect(indices[idxOf(5, 4)]).toBe(usageTileIndexForCropState(CropCycleState.READY_TO_HARVEST));
    // El trigo esta anclado al final de la rampa, asi que se sigue dibujando exactamente
    // como antes de que el catalogo creciera.
    expect(tints[idxOf(4, 4)]).toBe(growthTint(bp(2500)));
    // Fuera del crecimiento, el tinte es el color plano del cultivo.
    expect(tints[idxOf(5, 4)]).toBe(cropTint(CropId.WHEAT));
  });

  it('lets the pending decoration win over everything else', () => {
    const chunk = makeChunk({
      chunkX: 1,
      chunkY: 1,
      patches: [
        patch({ idx: idxOf(0, 0), ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'f' }),
      ],
    });
    const context = {
      ...CONTEXT,
      pending: new Set<number>([cellKey(CHUNK_SIZE, CHUNK_SIZE)]),
    };
    const { indices } = usageTileIndices(chunk, CHUNK_SIZE, context);
    expect(indices[idxOf(0, 0)]).toBe(usageTileIndex(UsageTile.PENDING));
  });

  it('marks a building footprint and a forest plot with their own tile', () => {
    const chunk = makeChunk({
      patches: [
        patch({
          idx: idxOf(7, 7),
          ownerPlayerId: VIEWER,
          landUse: LandUse.BUILDING,
          buildingId: 'b',
        }),
        patch({
          idx: idxOf(8, 7),
          ownerPlayerId: VIEWER,
          landUse: LandUse.FOREST_PLOT,
          forestPlotId: 'p',
        }),
      ],
    });
    const { indices } = usageTileIndices(chunk, CHUNK_SIZE, CONTEXT);
    expect(indices[idxOf(7, 7)]).toBe(usageTileIndex(UsageTile.FARM));
    expect(indices[idxOf(8, 7)]).toBe(usageTileIndex(UsageTile.FOREST_PLOT));
  });
});

describe('chunkTileData and toRows', () => {
  it('produces both layers and a tint per cell', () => {
    const data = chunkTileData(makeChunk({}), 3, CHUNK_SIZE, CONTEXT);
    expect(data.terrain).toHaveLength(CHUNK_SIZE * CHUNK_SIZE);
    expect(data.usage).toHaveLength(CHUNK_SIZE * CHUNK_SIZE);
    expect(data.usageTint).toHaveLength(CHUNK_SIZE * CHUNK_SIZE);
  });

  it('turns a flat array into rows without transposing it', () => {
    const flat = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    flat[idxOf(3, 1)] = 42;
    const rows = toRows(flat, CHUNK_SIZE);
    expect(rows).toHaveLength(CHUNK_SIZE);
    expect(rows[1]?.[3]).toBe(42);
    expect(rows[3]?.[1]).toBe(0);
  });
});
