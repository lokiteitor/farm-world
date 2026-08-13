// The streamer, driven with a fake renderer.
//
// Owner: workflow W4-D. Every Phaser object of the world layer is behind the
// `ChunkRenderer` interface, so the sequencing of plan section 9.5 is exercised here
// without a canvas: what is loaded, what is asked for, what is dropped, what is evicted
// and what is asked for again after a version gap.

import { describe, expect, it, vi } from 'vitest';
import { LevelOfDetail } from '../config';
import {
  chunkKeyOf,
  createStaticWorldSource,
  type ChunkFetchRequest,
  type WorldSource,
} from '../source';
import { ChunkStreamer, type ChunkRenderer } from '../streamer';
import { CHUNK_SIZE } from '~/shared/index';

/** A renderer that records what it was told to do and draws nothing. */
function fakeRenderer(key: string): ChunkRenderer & { destroyed: boolean; applied: number } {
  return {
    key,
    version: -1,
    destroyed: false,
    applied: 0,
    apply(chunk) {
      this.version = chunk.version;
      this.applied += 1;
    },
    setLevelOfDetail: () => undefined,
    hasLevel: () => true,
    ensureLevel: () => undefined,
    setCulled: () => undefined,
    quads: () => ({ terrain: 0, usage: 0, thumbnail: 1 }),
    destroy() {
      this.destroyed = true;
    },
  };
}

function viewOf(chunks: number): {
  minCellX: number;
  minCellY: number;
  maxCellX: number;
  maxCellY: number;
} {
  return {
    minCellX: 0,
    minCellY: 0,
    maxCellX: CHUNK_SIZE * chunks - 1,
    maxCellY: CHUNK_SIZE - 1,
  };
}

describe('ChunkStreamer', () => {
  it('creates a view for every chunk of the visible rectangle and its ring', () => {
    const source = createStaticWorldSource();
    const streamer = new ChunkStreamer(
      { source, createView: (chunk) => fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY)) },
      LevelOfDetail.NEAR,
    );
    const stats = streamer.tick(viewOf(1));
    // One visible chunk plus a ring of one is three by three.
    expect(stats.loaded).toBe(9);
    expect(stats.liveChunks).toBe(9);
    expect(stats.visibleChunks).toBe(1);
  });

  it('asks for the modification layer of every new chunk, once', async () => {
    const requests: ChunkFetchRequest[][] = [];
    const source: WorldSource = {
      ...createStaticWorldSource(),
      fetch: (batch) => {
        requests.push([...batch]);
        return Promise.resolve();
      },
    };
    const streamer = new ChunkStreamer(
      { source, createView: (chunk) => fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY)) },
      LevelOfDetail.NEAR,
    );
    streamer.tick(viewOf(1));
    await vi.waitFor(() => {
      expect(streamer.requestsInFlight).toBe(0);
    });
    expect(requests.flat()).toHaveLength(9);

    streamer.tick(viewOf(1));
    await vi.waitFor(() => {
      expect(streamer.requestsInFlight).toBe(0);
    });
    // Nothing new to ask for: the second tick loads nothing and asks for nothing.
    expect(requests.flat()).toHaveLength(9);
  });

  it('asks again when a batch failed, and stops asking once it succeeded', async () => {
    let attempts = 0;
    const errors: unknown[] = [];
    const source: WorldSource = {
      ...createStaticWorldSource(),
      fetch: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve();
      },
    };
    const streamer = new ChunkStreamer(
      {
        source,
        createView: (chunk) => fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY)),
        onFetchError: (error) => errors.push(error),
      },
      LevelOfDetail.NEAR,
    );
    streamer.tick(viewOf(1));
    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    streamer.tick(viewOf(1));
    await vi.waitFor(() => {
      expect(streamer.requestsInFlight).toBe(0);
    });
    expect(attempts).toBe(2);
    streamer.tick(viewOf(1));
    expect(attempts).toBe(2);
  });

  it('never loads more than the per tick ceiling', () => {
    const source = createStaticWorldSource();
    const streamer = new ChunkStreamer(
      {
        source,
        createView: (chunk) => fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY)),
        maxLoadsPerTick: 4,
      },
      LevelOfDetail.FAR,
    );
    const stats = streamer.tick(viewOf(10));
    expect(stats.loaded).toBe(4);
    expect(stats.deferred).toBeGreaterThan(0);
  });

  it('destroys a view that left the unload ring and forgets its decoded chunk', () => {
    const source = createStaticWorldSource();
    const made = new Map<string, ReturnType<typeof fakeRenderer>>();
    const streamer = new ChunkStreamer(
      {
        source,
        createView: (chunk) => {
          const view = fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY));
          made.set(view.key, view);
          return view;
        },
      },
      LevelOfDetail.NEAR,
    );
    streamer.tick(viewOf(1));
    expect(source.chunk(0, 0)).toBeDefined();

    // The camera jumps twenty chunks away: everything behind leaves the unload ring.
    streamer.tick({
      minCellX: CHUNK_SIZE * 20,
      minCellY: 0,
      maxCellX: CHUNK_SIZE * 21 - 1,
      maxCellY: CHUNK_SIZE - 1,
    });
    expect(made.get(chunkKeyOf(0, 0))?.destroyed).toBe(true);
    expect(source.chunk(0, 0)).toBeUndefined();
  });

  it('evicts down to the capacity, and never what the camera needs', () => {
    const source = createStaticWorldSource();
    const streamer = new ChunkStreamer(
      {
        source,
        createView: (chunk) => fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY)),
        capacity: 6,
        // Wide enough that nothing is unloaded by distance, so what happens next is
        // eviction and only eviction.
        unloadRing: 40,
      },
      LevelOfDetail.FAR,
    );

    const first = streamer.tick(viewOf(1));
    // Nine chunks are needed and the cache holds six. Nothing is evicted, because a
    // chunk the camera needs is never a victim: the capacity yields, not the picture.
    expect(first.evicted).toBe(0);
    expect(first.liveChunks).toBe(9);

    // The camera moves three chunks to the right. The nine it now needs are protected,
    // the nine it left are not, and the cache falls back towards its capacity.
    const second = streamer.tick({
      minCellX: CHUNK_SIZE * 3,
      minCellY: 0,
      maxCellX: CHUNK_SIZE * 4 - 1,
      maxCellY: CHUNK_SIZE - 1,
    });
    expect(second.evicted).toBe(9);
    expect(second.liveChunks).toBe(9);
  });

  it('repaints a chunk whose version changed and nothing else', () => {
    const chunks = new Map<string, { version: number }>();
    const base = createStaticWorldSource();
    const source: WorldSource = {
      ...base,
      chunk: (chunkX, chunkY) => {
        const held = base.chunk(chunkX, chunkY);
        if (held === undefined) {
          return undefined;
        }
        const bump = chunks.get(chunkKeyOf(chunkX, chunkY))?.version ?? 0;
        return { ...held, version: held.version + bump };
      },
      revision: () => base.revision() + chunks.size,
    };
    const made = new Map<string, ReturnType<typeof fakeRenderer>>();
    const streamer = new ChunkStreamer(
      {
        source,
        createView: (chunk) => {
          const view = fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY));
          view.version = chunk.version;
          made.set(view.key, view);
          return view;
        },
      },
      LevelOfDetail.NEAR,
    );
    streamer.tick(viewOf(1));
    const before = made.get(chunkKeyOf(0, 0))?.applied ?? 0;

    chunks.set(chunkKeyOf(0, 0), { version: 1 });
    streamer.tick(viewOf(1));
    expect((made.get(chunkKeyOf(0, 0))?.applied ?? 0) - before).toBe(1);
    expect(made.get(chunkKeyOf(1, 0))?.applied).toBe(0);
  });

  it('asks for a stale chunk again, and without a version', async () => {
    const batches: ChunkFetchRequest[][] = [];
    const base = createStaticWorldSource();
    let stale: readonly string[] = [];
    const source: WorldSource = {
      ...base,
      staleKeys: () => stale,
      fetch: (batch) => {
        batches.push([...batch]);
        return Promise.resolve();
      },
    };
    const streamer = new ChunkStreamer(
      { source, createView: (chunk) => fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY)) },
      LevelOfDetail.NEAR,
    );
    streamer.tick(viewOf(1));
    await vi.waitFor(() => {
      expect(streamer.requestsInFlight).toBe(0);
    });
    batches.length = 0;

    stale = [chunkKeyOf(0, 0)];
    streamer.tick(viewOf(1));
    expect(batches.flat()).toEqual([{ chunkX: 0, chunkY: 0, rev: undefined }]);
  });

  it('drops everything on destroy', () => {
    const source = createStaticWorldSource();
    const made: ReturnType<typeof fakeRenderer>[] = [];
    const streamer = new ChunkStreamer(
      {
        source,
        createView: (chunk) => {
          const view = fakeRenderer(chunkKeyOf(chunk.chunkX, chunk.chunkY));
          made.push(view);
          return view;
        },
      },
      LevelOfDetail.NEAR,
    );
    streamer.tick(viewOf(1));
    streamer.destroy();
    expect(made.every((view) => view.destroyed)).toBe(true);
    expect(streamer.liveCount).toBe(0);
  });
});
