// Extraction of the outlines.
//
// Owner: workflow W4-D. Two properties carry the design: a field that spans two chunks
// has no seam where the chunks meet, and two adjacent fields keep the border between
// them. The first is why the extraction is at scene level and not per chunk; the second
// is why the grouping is by subject and not by family.

import { describe, expect, it } from 'vitest';
import { OutlineKind, collectOutlineGroups, countSegments } from '../outlines';
import { STRANGER, VIEWER, idxOf, makeChunk, patch, rect } from './fixtures';
import { CHUNK_SIZE, LandUse } from '~/shared/index';

describe('collectOutlineGroups', () => {
  it('produces nothing for an empty set', () => {
    expect(collectOutlineGroups([], CHUNK_SIZE, VIEWER)).toEqual([]);
  });

  it('outlines the land of the viewer and not the land of anybody else', () => {
    const chunk = makeChunk({
      patches: [
        ...rect(0, 0, 1, 1, (idx) => patch({ idx, ownerPlayerId: VIEWER, landUse: LandUse.OWNED })),
        ...rect(5, 5, 6, 6, (idx) =>
          patch({ idx, ownerPlayerId: STRANGER, landUse: LandUse.OWNED }),
        ),
      ],
    });
    const groups = collectOutlineGroups([chunk], CHUNK_SIZE, VIEWER);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe(OutlineKind.OWNED);
    // A two by two square has eight boundary edges.
    expect(groups[0]?.segments).toHaveLength(8);
  });

  it('keeps the border between two adjacent fields', () => {
    const chunk = makeChunk({
      patches: [
        ...rect(0, 0, 1, 1, (idx) =>
          patch({ idx, ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'field-a' }),
        ),
        ...rect(2, 0, 3, 1, (idx) =>
          patch({ idx, ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'field-b' }),
        ),
      ],
    });
    const groups = collectOutlineGroups([chunk], CHUNK_SIZE, VIEWER);
    const fields = groups.filter((group) => group.kind === OutlineKind.FIELD);
    expect(fields.map((group) => group.subjectId)).toEqual(['field-a', 'field-b']);
    // Eight edges each: the shared edge belongs to both outlines and is drawn twice,
    // which is what makes the boundary between two fields visible.
    expect(fields[0]?.segments).toHaveLength(8);
    expect(fields[1]?.segments).toHaveLength(8);
    // The ownership outline sees the four cells as one block: ten edges around a 4 x 1
    // rectangle... which is a 4 by 2 block, so twelve.
    const owned = groups.find((group) => group.kind === OutlineKind.OWNED);
    expect(owned?.segments).toHaveLength(12);
  });

  it('draws no seam where a field crosses a chunk boundary', () => {
    const cellsOfLeft = rect(CHUNK_SIZE - 1, 0, CHUNK_SIZE - 1, 1, (idx) =>
      patch({ idx, ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'field-a' }),
    );
    const cellsOfRight = rect(0, 0, 0, 1, (idx) =>
      patch({ idx, ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'field-a' }),
    );
    const left = makeChunk({ chunkX: 0, patches: cellsOfLeft });
    const right = makeChunk({ chunkX: 1, patches: cellsOfRight });

    const together = collectOutlineGroups([left, right], CHUNK_SIZE, VIEWER).filter(
      (group) => group.kind === OutlineKind.FIELD,
    );
    expect(together).toHaveLength(1);
    // A 2 by 2 square: eight edges, and none of them on the chunk boundary.
    expect(together[0]?.segments).toHaveLength(8);
    const onBoundary = (together[0]?.segments ?? []).filter(
      (segment) => segment.fromCornerX === CHUNK_SIZE && segment.toCornerX === CHUNK_SIZE,
    );
    expect(onBoundary).toEqual([]);

    // Extracted chunk by chunk instead, the same field would show four edges along the
    // boundary, which is the seam this design exists to avoid.
    const perChunk =
      countSegments(collectOutlineGroups([left], CHUNK_SIZE, VIEWER)) +
      countSegments(collectOutlineGroups([right], CHUNK_SIZE, VIEWER));
    expect(perChunk).toBeGreaterThan(
      countSegments(collectOutlineGroups([left, right], CHUNK_SIZE, VIEWER)),
    );
  });

  it('groups a building footprint and a forest plot by their own identifier', () => {
    const chunk = makeChunk({
      patches: [
        ...rect(0, 0, 1, 1, (idx) =>
          patch({
            idx,
            ownerPlayerId: VIEWER,
            landUse: LandUse.BUILDING,
            buildingId: 'building-1',
          }),
        ),
        ...rect(4, 4, 5, 5, (idx) =>
          patch({
            idx,
            ownerPlayerId: VIEWER,
            landUse: LandUse.FOREST_PLOT,
            forestPlotId: 'plot-1',
          }),
        ),
      ],
    });
    const groups = collectOutlineGroups([chunk], CHUNK_SIZE, VIEWER);
    expect(groups.map((group) => group.kind)).toEqual([
      OutlineKind.OWNED,
      OutlineKind.FARM,
      OutlineKind.FOREST_PLOT,
    ]);
  });

  it('is deterministic: the same set produces the same geometry in the same order', () => {
    const chunk = makeChunk({
      patches: [
        ...rect(3, 3, 6, 6, (idx) =>
          patch({ idx, ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'zeta' }),
        ),
        ...rect(8, 3, 9, 4, (idx) =>
          patch({ idx, ownerPlayerId: VIEWER, landUse: LandUse.FIELD, fieldId: 'alpha' }),
        ),
      ],
    });
    const first = collectOutlineGroups([chunk], CHUNK_SIZE, VIEWER);
    const second = collectOutlineGroups([chunk], CHUNK_SIZE, VIEWER);
    expect(second).toEqual(first);
    expect(
      first.filter((group) => group.kind === OutlineKind.FIELD).map((g) => g.subjectId),
    ).toEqual(['alpha', 'zeta']);
  });

  it('places the segments in absolute world corners, not local ones', () => {
    const chunk = makeChunk({
      chunkX: 2,
      chunkY: -1,
      patches: [patch({ idx: idxOf(0, 0), ownerPlayerId: VIEWER, landUse: LandUse.OWNED })],
    });
    const groups = collectOutlineGroups([chunk], CHUNK_SIZE, VIEWER);
    const north = groups[0]?.segments[0];
    expect(north?.fromCornerX).toBe(2 * CHUNK_SIZE);
    expect(north?.fromCornerY).toBe(-CHUNK_SIZE);
  });
});
