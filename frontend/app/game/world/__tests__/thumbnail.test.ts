// The far level of detail thumbnail.
//
// Owner: workflow W4-D. Four kilobytes per chunk that have to say the same thing as the
// near level of detail, because the player crosses the threshold constantly and the
// minimap is fed from the very same bytes.

import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../textures/palette';
import { chunkThumbnailPixels, thumbnailColourOf } from '../thumbnail';
import { STRANGER, TERRAIN, VIEWER, idxOf, makeChunk, patch } from './fixtures';
import { CHUNK_SIZE, CropCycleState, CropId, LandUse, bp, cellKey } from '~/shared/index';

const CONTEXT = {
  viewerPlayerId: VIEWER,
  fieldState: () => undefined,
  pending: new Set<number>(),
};

/** The packed colour of a pixel of the buffer. */
function colourAt(pixels: Uint8ClampedArray, idx: number): number {
  const offset = idx * 4;
  return (
    (((pixels[offset] ?? 0) << 16) |
      ((pixels[offset + 1] ?? 0) << 8) |
      (pixels[offset + 2] ?? 0)) >>>
    0
  );
}

describe('chunkThumbnailPixels', () => {
  it('is one opaque pixel per cell', () => {
    const pixels = chunkThumbnailPixels(makeChunk({}), CHUNK_SIZE, CONTEXT);
    expect(pixels).toHaveLength(CHUNK_SIZE * CHUNK_SIZE * 4);
    for (let idx = 0; idx < CHUNK_SIZE * CHUNK_SIZE; idx += 1) {
      expect(pixels[idx * 4 + 3]).toBe(255);
    }
  });

  it('paints the generated terrain where nothing was modified', () => {
    const pixels = chunkThumbnailPixels(
      makeChunk({ terrainCode: TERRAIN.WATER }),
      CHUNK_SIZE,
      CONTEXT,
    );
    expect(colourAt(pixels, idxOf(9, 9))).toBe(PALETTE.terrain.WATER.base);
  });

  it('honours the cleared forest override', () => {
    const chunk = makeChunk({
      terrainCode: TERRAIN.FOREST,
      patches: [patch({ idx: idxOf(1, 1), terrainOverride: 'GRASS' })],
    });
    const pixels = chunkThumbnailPixels(chunk, CHUNK_SIZE, CONTEXT);
    expect(colourAt(pixels, idxOf(1, 1))).toBe(PALETTE.terrain.GRASS.base);
    expect(colourAt(pixels, idxOf(2, 1))).toBe(PALETTE.terrain.FOREST.base);
  });

  it('paints a field with the soil of its state', () => {
    const chunk = makeChunk({
      patches: [
        patch({ idx: idxOf(2, 2), ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'f' }),
      ],
    });
    const pixels = chunkThumbnailPixels(chunk, CHUNK_SIZE, {
      ...CONTEXT,
      fieldState: () => ({
        cropCycleState: CropCycleState.READY_TO_HARVEST,
        growthProgressBp: bp(10_000),
        cropId: CropId.WHEAT,
      }),
    });
    expect(colourAt(pixels, idxOf(2, 2))).toBe(PALETTE.crop.READY_TO_HARVEST.soil);
  });

  it('lets the pending decoration win, addressed by absolute cell', () => {
    const chunk = makeChunk({
      chunkX: -2,
      chunkY: 3,
      patches: [patch({ idx: idxOf(0, 0), ownerPlayerId: VIEWER, landUse: LandUse.OWNED })],
    });
    const pixels = chunkThumbnailPixels(chunk, CHUNK_SIZE, {
      ...CONTEXT,
      pending: new Set<number>([cellKey(-2 * CHUNK_SIZE, 3 * CHUNK_SIZE)]),
    });
    expect(colourAt(pixels, idxOf(0, 0))).toBe(PALETTE.ui.pending);
  });
});

describe('thumbnailColourOf', () => {
  const terrain = PALETTE.terrain.GRASS.base;

  it('washes owned land instead of replacing the terrain', () => {
    const own = thumbnailColourOf(terrain, LandUse.OWNED, VIEWER, null, false, CONTEXT);
    expect(own).not.toBe(terrain);
    expect(own).not.toBe(PALETTE.use.OWNED);
  });

  it('gives foreign land a tone of its own', () => {
    const own = thumbnailColourOf(terrain, LandUse.OWNED, VIEWER, null, false, CONTEXT);
    const foreign = thumbnailColourOf(terrain, LandUse.OWNED, STRANGER, null, false, CONTEXT);
    expect(foreign).not.toBe(own);
  });

  it('leaves unowned land as bare terrain', () => {
    expect(thumbnailColourOf(terrain, LandUse.NONE, null, null, false, CONTEXT)).toBe(terrain);
  });

  it('paints a building and a forest plot with their use colour', () => {
    expect(thumbnailColourOf(terrain, LandUse.BUILDING, VIEWER, null, false, CONTEXT)).toBe(
      PALETTE.use.BUILDING,
    );
    expect(thumbnailColourOf(terrain, LandUse.FOREST_PLOT, VIEWER, null, false, CONTEXT)).toBe(
      PALETTE.use.FOREST_PLOT,
    );
  });
});
