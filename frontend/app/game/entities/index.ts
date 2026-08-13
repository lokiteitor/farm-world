// Public surface of the entity layer.
//
// Owner: workflow W5-D (canvas entities). One entry point, so the page that mounts the
// canvas writes four lines and does not have to know that the layer is a planner, a
// serpentine, a pool and a depth sort:
//
// ```ts
// const scenes = createWorldScenes({ source, bridge });
// const handle = createGame({ host, worldScenes: scenes.scenes });
// const entities = createEntityLayer({
//   world: scenes.world,
//   overlay: scenes.overlay,
//   source: createStoreEntitySource({
//     buildings: () => buildings.all,
//     machines: () => machines.all,
//     workers: () => workers.all,
//     tasks: () => tasks.active,
//     trees: () => Object.values(forestry.treesByPlotId).flatMap((byId) => Object.values(byId)),
//     fieldCells: (fieldId) => fields.cellsOf(fieldId),
//     nowGameMs: () => clock.displayGameMs,
//     revision: () => sync.lastAppliedSeq,
//   }),
// });
// ```
//
// The source is bound outside the canvas on purpose: `frontend/app/game` may not import
// `frontend/app/stores` (zone rule of `eslint.config.js`), which is the mechanical half
// of the pillar of plan section 9.
//
// The layer registers one `Layer` on the world scene and a handful of anchored items on
// the overlay scene of W4-D. It reads `WorldScene.worldCameraHandle` for the zoom and the
// visible rectangle and touches nothing else of either.

export {
  EntityLayer,
  createEntityLayer,
  type EntityLayerDeps,
  type EntityLayerStats,
} from './EntityLayer';
export {
  DEPTH_KIND_STEP,
  DEPTH_RESORT_EPSILON_PX,
  ENTITY_KIND_RANK,
  ENTITY_LAYER_DEPTH,
  ENTITY_RING_CHUNKS,
  ENTITY_TICK_MS,
  EntityKind,
  IMPLEMENT_TRAIL_PX,
  LABEL_MIN_ZOOM,
  MAX_POOLED_SPRITES_PER_KEY,
  MAX_SPRITES_PER_CHUNK_GROUP,
  MAX_TREES_DRAWN,
  PARKED_HEADING_RAD,
  PROGRESS_BAR_OFFSET_PX,
  TREE_MIN_ZOOM,
  WORKER_ESCORT_OFFSET_PX,
} from './config';
export { depthKeyOf, orderByDepth, type DepthSubject } from './depth';
export {
  ordinalOf,
  parkedMachineSpot,
  parkingGrid,
  restingWorkerSpot,
  type FootprintRect,
  type IdleSpot,
  type ParkingGrid,
} from './idle';
export {
  createTaskPathCache,
  planEntities,
  taskPath,
  taskPoses,
  type EntityPlan,
  type OverlayPlacement,
  type PlanInput,
  type RoutePose,
  type SpritePlacement,
  type TaskPathCache,
  type TaskPoses,
} from './plan';
export { ChunkEntityGroup, SpritePool, groupKeyOf, type PoolHandlers } from './pool';
export {
  EMPTY_ENTITY_SOURCE,
  type EntityBuilding,
  type EntityCell,
  type EntityHit,
  type EntityMachine,
  type EntitySource,
  type EntityTask,
  type EntityTree,
  type EntityWorker,
} from './port';
export {
  pathCursor,
  pathSeed,
  poseAt,
  serpentinePath,
  serpentineShape,
  taskProgressRatio,
  travelledCells,
  type PathCell,
  type PathCursor,
  type PathPose,
  type SerpentineShape,
  type TaskWindow,
} from './serpentine';
export {
  createStaticEntitySource,
  createStoreEntitySource,
  type BuildingRowLike,
  type MachineRowLike,
  type StaticEntitySource,
  type StaticEntitySourceOptions,
  type StoreEntitySourceDeps,
  type TaskRowLike,
  type TreeRowLike,
  type WorkerRowLike,
} from './source';
