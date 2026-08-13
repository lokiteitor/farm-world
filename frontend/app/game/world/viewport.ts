// Which chunks are visible, which are loaded and which are dropped.
//
// Owner: workflow W4-D (world rendering). Pure arithmetic: no Phaser, no store, no
// clock. That is deliberate, because this is the part of the streamer that has a right
// answer and can therefore be asserted in Vitest instead of watched on screen.
//
// The whole of plan section 9.5 is here in three numbers. A prefetch ring of one chunk,
// so panning never shows an unloaded edge. An unload ring of three, so the two rings do
// not coincide: a camera sitting on a chunk border would otherwise cross the same
// boundary twice a second and load and drop the same chunk forever. And a ceiling of 32
// chunks per tick, ordered by distance to the camera, so a jump across the map fills the
// middle of the screen first and the corners last.

import { chunkKeyOf, parseChunkKey } from './source';
import { chunkOf } from '~/shared/index';

/** A rectangle of cells, inclusive on both ends. */
export interface CellRect {
  readonly minCellX: number;
  readonly minCellY: number;
  readonly maxCellX: number;
  readonly maxCellY: number;
}

/** A rectangle of chunks, inclusive on both ends. */
export interface ChunkRect {
  readonly minChunkX: number;
  readonly minChunkY: number;
  readonly maxChunkX: number;
  readonly maxChunkY: number;
}

/** A chunk coordinate. The lightest possible shape; the streamer moves many of them. */
export interface ChunkPoint {
  readonly chunkX: number;
  readonly chunkY: number;
}

/** Chunks a rectangle of cells covers. */
export function chunkRectOfCells(rect: CellRect, chunkSize: number): ChunkRect {
  const first = chunkOf(rect.minCellX, rect.minCellY, chunkSize);
  const last = chunkOf(rect.maxCellX, rect.maxCellY, chunkSize);
  return {
    minChunkX: first.chunkX,
    minChunkY: first.chunkY,
    maxChunkX: last.chunkX,
    maxChunkY: last.chunkY,
  };
}

/** The same rectangle grown by a ring of chunks on every side. */
export function expandChunkRect(rect: ChunkRect, ring: number): ChunkRect {
  return {
    minChunkX: rect.minChunkX - ring,
    minChunkY: rect.minChunkY - ring,
    maxChunkX: rect.maxChunkX + ring,
    maxChunkY: rect.maxChunkY + ring,
  };
}

export function chunkRectContains(rect: ChunkRect, chunkX: number, chunkY: number): boolean {
  return (
    chunkX >= rect.minChunkX &&
    chunkX <= rect.maxChunkX &&
    chunkY >= rect.minChunkY &&
    chunkY <= rect.maxChunkY
  );
}

/** Chunks in a rectangle. */
export function chunkRectCount(rect: ChunkRect): number {
  return (
    Math.max(0, rect.maxChunkX - rect.minChunkX + 1) *
    Math.max(0, rect.maxChunkY - rect.minChunkY + 1)
  );
}

/** Every chunk of a rectangle, row major. */
export function chunksOfRect(rect: ChunkRect): readonly ChunkPoint[] {
  const chunks: ChunkPoint[] = [];
  for (let chunkY = rect.minChunkY; chunkY <= rect.maxChunkY; chunkY += 1) {
    for (let chunkX = rect.minChunkX; chunkX <= rect.maxChunkX; chunkX += 1) {
      chunks.push({ chunkX, chunkY });
    }
  }
  return chunks;
}

/** What the streamer should do this tick. */
export interface StreamingPlan {
  /** Chunks to load, nearest to the camera first, capped by the per tick ceiling. */
  readonly load: readonly ChunkPoint[];
  /** Keys of loaded chunks outside the unload ring. */
  readonly unload: readonly string[];
  /** Chunks that must stay: the visible rectangle plus the prefetch ring. */
  readonly keep: ReadonlySet<string>;
  /** The visible rectangle, so the caller does not recompute it. */
  readonly visible: ChunkRect;
  /** How many candidates were left out by the per tick ceiling. */
  readonly deferred: number;
}

export interface StreamingPlanOptions {
  /** Visible rectangle of cells, as the camera reports it. */
  readonly view: CellRect;
  readonly chunkSize: number;
  /** Keys of the chunks the client currently holds. */
  readonly loaded: Iterable<string>;
  readonly prefetchRing: number;
  readonly unloadRing: number;
  readonly maxLoadsPerTick: number;
}

/**
 * The set difference of plan section 9.5, with its hysteresis.
 *
 * Two rings and not one is the entire point: the load set is the visible rectangle plus
 * `prefetchRing`, the survival set is the visible rectangle plus `unloadRing`, and a
 * chunk between the two rings is neither loaded nor dropped. Without the gap, a camera
 * that oscillates by one pixel across a chunk boundary loads and unloads the same chunk
 * on alternate ticks, which is visible as a stutter and expensive as a rebuild.
 */
export function planStreaming(options: StreamingPlanOptions): StreamingPlan {
  const visible = chunkRectOfCells(options.view, options.chunkSize);
  const wanted = expandChunkRect(visible, Math.max(0, options.prefetchRing));
  const survives = expandChunkRect(visible, Math.max(0, options.unloadRing));

  const held = new Set<string>();
  for (const key of options.loaded) {
    held.add(key);
  }

  const centreChunkX = (visible.minChunkX + visible.maxChunkX) / 2;
  const centreChunkY = (visible.minChunkY + visible.maxChunkY) / 2;

  const keep = new Set<string>();
  const candidates: { point: ChunkPoint; distance: number }[] = [];
  for (const point of chunksOfRect(wanted)) {
    const key = chunkKeyOf(point.chunkX, point.chunkY);
    keep.add(key);
    if (held.has(key)) {
      continue;
    }
    const dx = point.chunkX - centreChunkX;
    const dy = point.chunkY - centreChunkY;
    candidates.push({ point, distance: dx * dx + dy * dy });
  }
  // Nearest first, with the row major order of `chunksOfRect` breaking ties, so two
  // runs of the same camera produce the same request order and the bench is repeatable.
  candidates.sort((left, right) => left.distance - right.distance);

  const ceiling = Math.max(0, options.maxLoadsPerTick);
  const load = candidates.slice(0, ceiling).map((candidate) => candidate.point);

  const unload: string[] = [];
  for (const key of held) {
    const point = parseChunkKey(key);
    if (point === null) {
      // Not a chunk key: drop it rather than keep an entry nobody can address.
      unload.push(key);
      continue;
    }
    if (!chunkRectContains(survives, point.chunkX, point.chunkY)) {
      unload.push(key);
    }
  }

  return {
    load,
    unload,
    keep,
    visible,
    deferred: Math.max(0, candidates.length - load.length),
  };
}
