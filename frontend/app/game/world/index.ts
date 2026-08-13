// Public surface of the world renderer.
//
// Owner: workflow W4-D (world rendering). One entry point, so a page that mounts the
// canvas writes two lines and does not have to know that the world is three scenes, a
// streamer and a camera:
//
// ```ts
// const world = createWorldScenes({ source });
// const handle = createGame({ host, bridge, worldScenes: world.scenes });
// ```
//
// The scenes are instances and not classes, exactly as the boot scenes of W3-D are, so
// their dependencies arrive through the constructor instead of being fetched from a
// global or from the untyped scene registry.

import type Phaser from 'phaser';
import { OverlayScene } from '../overlay/OverlayScene';
import { WorldScene, type WorldSceneOptions, type WorldStats } from './WorldScene';
import type { GameBridge } from '~/composables/useGameBridge';

export type WorldScenesOptions = WorldSceneOptions;

/** What the caller keeps: the scenes to register and the handles to read. */
export interface WorldScenes {
  readonly scenes: readonly Phaser.Types.Scenes.SceneType[];
  readonly world: WorldScene;
  readonly overlay: OverlayScene;
  /** The current counters, or null before the scene has been created. */
  stats(): WorldStats | null;
}

export function createWorldScenes(options: WorldScenesOptions): WorldScenes {
  const world = new WorldScene(options);
  // The overlay resolves the world lazily: both are constructed here, but the overlay
  // must read the camera the world creates in its own `create`, which has not run yet.
  const overlay = new OverlayScene({ world: () => world });
  return {
    scenes: [world, overlay],
    world,
    overlay,
    stats: () => (world.isReady ? world.stats() : null),
  };
}

export {
  DEFAULT_RENDER_PREFERENCES,
  WorldScene,
  type WorldSceneOptions,
  type WorldStats,
} from './WorldScene';
export { WorldCamera, type CameraGoto } from './camera';
export { ChunkView, type ChunkQuadCount, type ChunkViewDeps } from './chunkView';
export {
  CHUNK_CACHE_CAPACITY,
  DEPTH,
  LevelOfDetail,
  MAX_CHUNK_LOADS_PER_TICK,
  NEAR_LOD_MIN_ZOOM,
  PREFETCH_RING_CHUNKS,
  RENDER_BUDGET,
  STREAM_TICK_MS,
  UNLOAD_RING_CHUNKS,
  ZOOM_STEPS,
} from './config';
export {
  formatBenchReport,
  runWorldBench,
  type BenchCaseResult,
  type BenchMemory,
  type BenchReport,
  type BenchTiming,
} from './bench';
export { attachDrawCallProbe, type DrawCallProbe } from './drawCalls';
export { createLruIndex, type LruIndex } from './lru';
export {
  OUTLINE_COLOUR,
  OUTLINE_WIDTH,
  OutlineKind,
  collectOutlineGroups,
  countSegments,
  type OutlineGroup,
} from './outlines';
export {
  benchPatchesOf,
  cellKeyOfChunkIndex,
  chunkKeyOf,
  createStaticWorldSource,
  createStoreWorldSource,
  parseChunkKey,
  type ChunkFetchRequest,
  type FieldRenderState,
  type StaticWorldSourceOptions,
  type StoreWorldSourceDeps,
  type WorldChunkView,
  type WorldSource,
  type WorldStoreLike,
} from './source';
export { ChunkStreamer, type ChunkRenderer, type StreamTickStats } from './streamer';
export { chunkThumbnailPixels, thumbnailColourOf, type ThumbnailContext } from './thumbnail';
export {
  NO_TINT,
  NO_USAGE_TILE,
  chunkTileData,
  terrainTileIndices,
  toRows,
  usageTileIndices,
  type ChunkTileData,
  type UsageContext,
} from './tiles';
export {
  chunkRectContains,
  chunkRectCount,
  chunkRectOfCells,
  chunksOfRect,
  expandChunkRect,
  planStreaming,
  type CellRect,
  type ChunkPoint,
  type ChunkRect,
  type StreamingPlan,
} from './viewport';
export {
  anchoredScroll,
  cellOfScreen,
  clampZoom,
  levelOfDetail,
  screenPointOfWorld,
  scrollCenteredOnCell,
  snapZoom,
  softClampScroll,
  stepZoom,
  visibleCellRect,
  worldPointOfScreen,
  type ScrollPoint,
  type ViewportSize,
  type WorldPoint,
} from './zoom';

export type { GameBridge };
