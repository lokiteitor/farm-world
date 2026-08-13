// Constants of the world renderer.
//
// Owner: workflow W4-D (world rendering). Every number the scene, the streamer and
// the camera obey is declared here, with the clause of the plan that fixes it, so
// that a budget can be argued about in one place instead of being spread over five
// modules as literals.
//
// The load case is what decides the design (plan section 9.3, ADR-0012): at zoom 1
// about 8 100 cells are visible and at zoom 0.25 about 130 000, where one quad per
// cell is not possible. Hence two levels of detail over the same data structure, and
// hence every constant below.

import { CELL_PX, CHUNK_SIZE } from '~/shared/config/world';

/** The two levels of detail of plan section 9.3. */
export const LevelOfDetail = {
  /** One Phaser tilemap per chunk, two layers over the single generated tileset. */
  NEAR: 'NEAR',
  /** One 32 x 32 thumbnail per chunk, one pixel per cell, drawn as a single quad. */
  FAR: 'FAR',
} as const;
export type LevelOfDetail = (typeof LevelOfDetail)[keyof typeof LevelOfDetail];

/**
 * Zoom at or above which the near level of detail is used (plan section 9.3).
 *
 * Below it a cell is under 6.4 px, where a 16 px tile carries no readable pattern
 * and the tilemap is paying for detail nobody can see.
 */
export const NEAR_LOD_MIN_ZOOM = 0.4;

/**
 * The discrete zoom steps (plan section 9.5). Discrete and not continuous because a
 * continuous wheel zoom at nearest filtering shimmers, and because the level of
 * detail has to change at a value the player can return to exactly.
 *
 * No step sits on `NEAR_LOD_MIN_ZOOM`: 0.35 is far and 0.5 is near, so crossing the
 * threshold is always a real change of step and never a coin toss on a float
 * comparison.
 */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.35, 0.5, 0.7, 1, 1.4, 2, 2.8];

/** Zoom the camera opens at. One screen pixel per texture pixel. */
export const DEFAULT_ZOOM = 1;

/** Smallest and largest step, derived so the two facts cannot disagree. */
export const MIN_ZOOM = ZOOM_STEPS[0] ?? 0.25;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 2.8;

/**
 * Chunks loaded beyond the visible rectangle (plan section 9.5). One ring, so a pan
 * of a whole chunk never shows an unloaded edge.
 */
export const PREFETCH_RING_CHUNKS = 1;

/**
 * Chunks kept beyond the visible rectangle before unloading (plan section 9.5).
 * Three and not one: the difference between the two rings is the hysteresis that
 * stops the load/unload flapping of a camera that sits on a chunk border.
 */
export const UNLOAD_RING_CHUNKS = 3;

/** Chunks loaded per tick, ordered by distance to the camera (plan section 9.5). */
export const MAX_CHUNK_LOADS_PER_TICK = 32;

/**
 * Visible chunks that build the half of a new level of detail per tick.
 *
 * Smaller than the load ceiling, and deliberately so: a load is a few tile objects and
 * a hash of a chunk, while building the far half is a canvas texture and a GPU upload,
 * which measured about 1.9 ms per chunk on the machine of this workflow. Thirty two of
 * them in one tick is a 60 ms stutter; twelve keeps the tick inside its budget and costs
 * two extra ticks, that is a fifth of a second, to finish a threshold crossing.
 */
export const MAX_LEVEL_UPGRADES_PER_TICK = 12;

/** Decoded chunks kept in the cache (plan section 9.5), so going back is instant. */
export const CHUNK_CACHE_CAPACITY = 256;

/** Milliseconds between two streaming ticks. Sixty frames per second is not needed. */
export const STREAM_TICK_MS = 100;

/** Side of the far level of detail thumbnail: one pixel per cell (plan section 9.3). */
export const THUMBNAIL_PX = CHUNK_SIZE;

/** Side of a chunk in world pixels at zoom 1. */
export const CHUNK_PX = CHUNK_SIZE * CELL_PX;

/**
 * Soft bound of the camera scroll, in world pixels.
 *
 * There is no hard world limit (GDD section 5, plan section 9.5): the world is
 * virtually infinite. What this bounds is numerical drift, because a float scroll of
 * 10^12 loses sub pixel precision and the tilemaps start to shear. Two million cells
 * is 20 000 km with the 10 m cell of ADR-0012, far beyond where the spawn allocator
 * places anybody, and well inside the 2^25 cell key limit of shared/rules/geometry.
 */
export const SOFT_SCROLL_BOUND_PX = 2_000_000 * CELL_PX;

/** Cells per second a held arrow key pans, at zoom 1. */
export const KEY_PAN_CELLS_PER_SECOND = 40;

/** Duration of the zoom transition, in real milliseconds (plan section 9.5). */
export const ZOOM_TRANSITION_MS = 110;

/** Duration of the camera flight of "back to the farm". */
export const CAMERA_FLIGHT_MS = 320;

/** Depth order inside the world scene. One number per layer, never a magic literal. */
export const DEPTH = {
  /** Far level of detail: one image per chunk. */
  THUMBNAIL: 0,
  /** Near level of detail: terrain tilemap layers. */
  TERRAIN: 10,
  /** Near level of detail: land use tilemap layers. */
  USAGE: 20,
  /** One `TileSprite` for the whole viewport (plan section 9.3). */
  GRID: 30,
  /** One `Graphics` with every outline of the visible set (plan section 9.3). */
  OUTLINES: 40,
} as const;

/**
 * The performance budget of plan section 9.3, as the measurement route asserts it.
 *
 * The plan states "about 110 draw calls and 8 000 quads at zoom 1". The two ceilings
 * below are the operational form of that sentence for the two cases the brief of this
 * workflow fixes, and they are deliberately a little above the plan figure so the
 * budget measures the design and not the width of the window it was measured in.
 */
export const RENDER_BUDGET = {
  /** Frames per second under which either case is a failure. */
  minFps: 55,
  /** Zoom 1 with 50 chunks loaded. */
  near: { zoom: 1, chunks: 50, maxDrawCalls: 130 },
  /** Zoom 0.25 with 200 chunks loaded. */
  far: { zoom: 0.25, chunks: 200, maxDrawCalls: 220 },
  /** Building one chunk, both representations included. */
  maxChunkBuildMs: 4,
  /**
   * One streaming tick: up to 32 loads, the level of detail of what became visible, the
   * drops and the outline rebuild. It is a frame of work, so the ceiling is a frame of
   * a 30 frames per second floor rather than of the 60 the renderer targets: a tick
   * happens ten times a second and a longer one is a visible stutter.
   */
  maxTickMs: 33,
  /** Applying a patch of 250 cells to a built chunk. */
  patchCells: 250,
  maxPatchMs: 2,
  /** Chunks the memory sweep walks before the heap is compared. */
  memorySweepChunks: 10_000,
} as const;
