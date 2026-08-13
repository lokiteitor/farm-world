// The visible rectangle and the load/unload set difference.
//
// Owner: workflow W4-D. This is the half of the streamer that has a right answer, and
// the hysteresis is the property worth pinning down: a camera that sits on a chunk
// border must not load and drop the same chunk on alternate ticks.

import { describe, expect, it } from 'vitest';
import { chunkKeyOf } from '../source';
import {
  chunkRectContains,
  chunkRectCount,
  chunkRectOfCells,
  chunksOfRect,
  expandChunkRect,
  planStreaming,
} from '../viewport';
import { CHUNK_SIZE } from '~/shared/index';

const RINGS = { prefetchRing: 1, unloadRing: 3, maxLoadsPerTick: 32 } as const;

describe('chunkRectOfCells', () => {
  it('maps a rectangle of cells onto the chunks it covers', () => {
    const rect = chunkRectOfCells(
      { minCellX: 0, minCellY: 0, maxCellX: CHUNK_SIZE - 1, maxCellY: CHUNK_SIZE - 1 },
      CHUNK_SIZE,
    );
    expect(rect).toEqual({ minChunkX: 0, minChunkY: 0, maxChunkX: 0, maxChunkY: 0 });
  });

  it('uses the floor division, so a negative cell lands in the chunk before the origin', () => {
    const rect = chunkRectOfCells(
      { minCellX: -1, minCellY: -1, maxCellX: 0, maxCellY: 0 },
      CHUNK_SIZE,
    );
    expect(rect).toEqual({ minChunkX: -1, minChunkY: -1, maxChunkX: 0, maxChunkY: 0 });
  });

  it('counts and enumerates the same chunks', () => {
    const rect = expandChunkRect({ minChunkX: 0, minChunkY: 0, maxChunkX: 1, maxChunkY: 1 }, 2);
    expect(chunkRectCount(rect)).toBe(6 * 6);
    expect(chunksOfRect(rect)).toHaveLength(36);
    expect(chunkRectContains(rect, -2, -2)).toBe(true);
    expect(chunkRectContains(rect, -3, 0)).toBe(false);
  });
});

describe('planStreaming', () => {
  /** A view of exactly one chunk, at the chunk of coordinates (0, 0). */
  const oneChunkView = {
    minCellX: 0,
    minCellY: 0,
    maxCellX: CHUNK_SIZE - 1,
    maxCellY: CHUNK_SIZE - 1,
  };

  it('loads the visible chunk and one ring around it', () => {
    const plan = planStreaming({ view: oneChunkView, chunkSize: CHUNK_SIZE, loaded: [], ...RINGS });
    expect(plan.load).toHaveLength(9);
    expect(plan.keep.size).toBe(9);
    expect(plan.unload).toEqual([]);
    expect(plan.deferred).toBe(0);
  });

  it('orders the load by distance to the camera, nearest first', () => {
    const plan = planStreaming({ view: oneChunkView, chunkSize: CHUNK_SIZE, loaded: [], ...RINGS });
    expect(plan.load[0]).toEqual({ chunkX: 0, chunkY: 0 });
    const last = plan.load[plan.load.length - 1];
    expect(Math.abs(last?.chunkX ?? 0) + Math.abs(last?.chunkY ?? 0)).toBe(2);
  });

  it('never asks for more than the per tick ceiling and reports what it deferred', () => {
    const wide = {
      minCellX: 0,
      minCellY: 0,
      maxCellX: CHUNK_SIZE * 10 - 1,
      maxCellY: CHUNK_SIZE * 10 - 1,
    };
    const plan = planStreaming({ view: wide, chunkSize: CHUNK_SIZE, loaded: [], ...RINGS });
    expect(plan.load).toHaveLength(32);
    // Twelve by twelve chunks are wanted and thirty two are asked for this tick.
    expect(plan.deferred).toBe(12 * 12 - 32);
  });

  it('keeps a chunk that left the prefetch ring but is inside the unload ring', () => {
    // The chunk two to the right is outside the prefetch ring (1) and inside the
    // unload ring (3): it is neither loaded again nor dropped, which is the hysteresis.
    const held = [chunkKeyOf(2, 0)];
    const plan = planStreaming({
      view: oneChunkView,
      chunkSize: CHUNK_SIZE,
      loaded: held,
      ...RINGS,
    });
    expect(plan.unload).toEqual([]);
    expect(plan.load.some((point) => point.chunkX === 2 && point.chunkY === 0)).toBe(false);
  });

  it('drops a chunk outside the unload ring', () => {
    const plan = planStreaming({
      view: oneChunkView,
      chunkSize: CHUNK_SIZE,
      loaded: [chunkKeyOf(4, 0), chunkKeyOf(0, 0)],
      ...RINGS,
    });
    expect(plan.unload).toEqual([chunkKeyOf(4, 0)]);
  });

  it('does not flap when the camera crosses a chunk border back and forth', () => {
    // Two views one cell apart across the boundary between chunk 0 and chunk 1.
    const left = { minCellX: CHUNK_SIZE - 2, minCellY: 0, maxCellX: CHUNK_SIZE - 1, maxCellY: 1 };
    const right = { minCellX: CHUNK_SIZE, minCellY: 0, maxCellX: CHUNK_SIZE + 1, maxCellY: 1 };

    const loaded = new Set<string>();
    const apply = (view: typeof left): void => {
      const plan = planStreaming({ view, chunkSize: CHUNK_SIZE, loaded, ...RINGS });
      for (const key of plan.unload) {
        loaded.delete(key);
      }
      for (const point of plan.load) {
        loaded.add(chunkKeyOf(point.chunkX, point.chunkY));
      }
    };

    apply(left);
    const afterFirst = new Set(loaded);
    for (let round = 0; round < 6; round += 1) {
      apply(round % 2 === 0 ? right : left);
    }
    // Nothing was ever dropped: every chunk of the first view stays loaded across six
    // crossings, which is exactly what the two rings are for.
    for (const key of afterFirst) {
      expect(loaded.has(key)).toBe(true);
    }
  });

  it('discards a key that is not a chunk key instead of keeping it forever', () => {
    const plan = planStreaming({
      view: oneChunkView,
      chunkSize: CHUNK_SIZE,
      loaded: ['not-a-key'],
      ...RINGS,
    });
    expect(plan.unload).toEqual(['not-a-key']);
  });
});
