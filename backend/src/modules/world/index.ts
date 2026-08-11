// Module `world`: the deterministic generator, its cache, the cell repository, the origin
// allocator and the two routes of the `world` area.
//
// Owner: workflow W3-B. Replaces the scaffolding workflow W3-A left with the definitive path
// and signature (plan section 11, rule 3): `src/app.ts` and the route registry were not
// touched, only the body of this module.
//
// The shape of the module, and why it is split the way it is:
//
//   - `generator.ts` wraps the pure generator of `shared/world/terrain.ts` in a cache whose
//     key carries the seed, the generator version and the coordinate. Terrain is immutable
//     for those three, so an entry can never become wrong and nothing is ever invalidated.
//   - `cellRepo.ts` is the overlay of modifications: batch reads in one statement per stage,
//     claiming by conditional update with a row count, the chunk version counter taken in
//     ascending order of identifier, and the overlay cached in Redis with the version inside
//     the key.
//   - `spawn.ts` turns the pure origin allocator into an operation: the player index under
//     the world lock, the check against the persisted origins, and the write.
//   - `service.ts` is the internal API the land, farms, fields and forestry modules consume:
//     effective terrain, ownership and use, and claiming.
//   - `routes.ts` is the HTTP surface, which is deliberately thin.
//
// The terrain never travels in a reply. It is a pure function of the seed and the coordinate
// and the client runs the very same code, so the batch route carries only the overlay and the
// version (GDD sections 7 and 58, ADR-0010, `docs/handoff/NOTES-W2c.md` item 1.5).

export { registerWorldRoutes } from './routes.js';

export {
  TERRAIN_CACHE_TTL_REAL_MS,
  TERRAIN_MEMORY_CAPACITY,
  chunkFromKey,
  chunkKey,
  createTerrainCache,
  dedupeChunks,
  terrainCacheOf,
  worldKeyPrefix,
  type TerrainCache,
  type TerrainCacheStats,
} from './generator.js';

export {
  MAX_CELLS_PER_WRITE,
  OVERLAY_CACHE_TTL_REAL_MS,
  TooManyCellsError,
  addressCells,
  cellRepositoryOf,
  createCellRepository,
  type AssignCellUseInput,
  type AssignCellUseOutcome,
  type CellRepoStats,
  type CellRepository,
  type CellRow,
  type ChunkOverlay,
  type ChunkStateRequest,
  type ChunkStateResult,
  type ClaimCellsInput,
  type ClaimCellsOutcome,
} from './cellRepo.js';

export {
  SPAWN_MAX_INDEX_ATTEMPTS,
  SPAWN_MIN_GRASS_CELLS,
  allocateSpawn,
  assignAndPersistSpawn,
  nearestOriginDistance,
  originDistanceChunks,
  persistSpawn,
  persistedOrigins,
  type AllocateSpawnOptions,
  type SpawnAllocation,
} from './spawn.js';

export {
  assertCellsAvailable,
  assignCellUse,
  bumpChunkVersions,
  chunkPatchesFor,
  chunksOfCells,
  claimCells,
  effectiveTerrain,
  loadEffectiveTerrain,
  loadSelectionCells,
  ownershipOf,
  standingTreeCells,
  validateCellSelection,
} from './service.js';
