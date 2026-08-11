// World area: the description of the world and the batch loading of chunks.
//
// Owner: workflow W2 (API contract).
//
// What travels and what does not. The terrain of a chunk is not in the reply: it is
// a pure function of the world seed and the coordinate (GDD sections 7 and 58), and
// the same deterministic generator lives in shared/world, so the client reproduces
// it locally instead of downloading it. Only the layer of modifications travels,
// which is exactly what carries a version (plan sections 5.1 and 9.5).
//
// Consequence for the client: a chunk is renderable as soon as the seed is known,
// and the reply only decides ownership, use and the cleared forest. Consequence for
// the cache: the version goes inside the Redis key, so modifying a cell changes the
// key and nothing has to be invalidated.

import { z } from 'zod';
import { LandUse, TerrainType } from '../../domain/enums.js';
import {
  buildingIdSchema,
  cellIndexSchema,
  chunkCoordSchema,
  clockDtoSchema,
  countSchema,
  fieldIdSchema,
  forestPlotIdSchema,
  gameMsSchema,
  MAX_CHUNKS_PER_REQUEST,
  playerIdSchema,
  worldIdSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// GET /api/world/info
// ---------------------------------------------------------------------------

/**
 * Everything the client needs before it can draw anything: the seed and the
 * generator version, which feed the local terrain generator; the scale, which the
 * renderer needs; and the clock anchor, from which every countdown extrapolates
 * without asking the server again (plan section 7).
 *
 * The scale constants are also in shared/config, which both sides import. They
 * travel anyway because they are the assertion that the server and the client agree:
 * a client built against another chunk size must find out on the first request and
 * not when a coordinate silently lands in the wrong chunk.
 */
export const worldInfoReplySchema = z.strictObject({
  worldId: worldIdSchema,
  seed: z.number().int(),
  generatorVersion: z.number().int().nonnegative(),
  chunkSize: z.number().int().positive(),
  cellSizeM: z.number().positive(),
  cellPx: z.number().int().positive(),
  maxSelectionCells: countSchema,
  /** Value of `SHARED_CONTRACT_VERSION` the server was built with (plan section 7). */
  contractVersion: z.string().min(1),
  clock: clockDtoSchema,
  /** Where a new player was placed, so the camera can start there (plan section 2). */
  spawnCellX: z.number().int().safe().nullable(),
  spawnCellY: z.number().int().safe().nullable(),
});
export type WorldInfoReply = z.infer<typeof worldInfoReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/world/chunks
// ---------------------------------------------------------------------------

/**
 * One requested chunk. `rev` is the version the client already holds; the server
 * answers `unchanged` when it matches, which is what makes revisiting a chunk free.
 * A client with no copy omits it.
 */
export const chunkRequestSchema = z.strictObject({
  chunkX: z.number().int().safe(),
  chunkY: z.number().int().safe(),
  rev: z.number().int().nonnegative().optional(),
});
export type ChunkRequest = z.infer<typeof chunkRequestSchema>;

export const chunkBatchBodySchema = z.strictObject({
  chunks: z.array(chunkRequestSchema).min(1).max(MAX_CHUNKS_PER_REQUEST),
});
export type ChunkBatchBody = z.infer<typeof chunkBatchBodySchema>;

/**
 * A modified cell of a chunk. Only modified cells appear (GDD section 58);
 * everything absent is unowned, unused, generated terrain.
 *
 * `terrainOverride` is the cleared forest of GDD section 10 and is null while the
 * generated terrain still holds. `hasStandingTree` is derived from the trees of the
 * plot, and it is here because the renderer needs it per cell while the tree
 * entities themselves belong to the forestry area.
 */
export const chunkCellPatchSchema = z.strictObject({
  idx: cellIndexSchema,
  terrainOverride: z.enum(TerrainType).nullable(),
  ownerPlayerId: playerIdSchema.nullable(),
  landUse: z.enum(LandUse),
  fieldId: fieldIdSchema.nullable(),
  forestPlotId: forestPlotIdSchema.nullable(),
  buildingId: buildingIdSchema.nullable(),
  hasStandingTree: z.boolean(),
});
export type ChunkCellPatch = z.infer<typeof chunkCellPatchSchema>;

/** A chunk the client did not have, or had at an older version. */
export const chunkStateSchema = z.strictObject({
  chunkX: z.number().int().safe(),
  chunkY: z.number().int().safe(),
  version: z.number().int().nonnegative(),
  unchanged: z.literal(false),
  cells: z.array(chunkCellPatchSchema),
});
export type ChunkState = z.infer<typeof chunkStateSchema>;

/** A chunk the client already holds at the current version. */
export const chunkUnchangedSchema = z.strictObject({
  chunkX: z.number().int().safe(),
  chunkY: z.number().int().safe(),
  version: z.number().int().nonnegative(),
  unchanged: z.literal(true),
});
export type ChunkUnchanged = z.infer<typeof chunkUnchangedSchema>;

export const chunkResultSchema = z.discriminatedUnion('unchanged', [
  chunkStateSchema,
  chunkUnchangedSchema,
]);
export type ChunkResult = z.infer<typeof chunkResultSchema>;

export const chunkBatchReplySchema = z.strictObject({
  chunks: z.array(chunkResultSchema),
  atGameMs: gameMsSchema,
});
export type ChunkBatchReply = z.infer<typeof chunkBatchReplySchema>;

/**
 * Payload of the live chunk update (plan section 7). It is the same shape as a
 * chunk that changed, so the streaming path of the renderer and the event path share
 * one decoder.
 */
export const chunkPatchEventSchema = z.strictObject({
  chunkX: z.number().int().safe(),
  chunkY: z.number().int().safe(),
  version: z.number().int().nonnegative(),
  cells: z.array(chunkCellPatchSchema),
});
export type ChunkPatchEvent = z.infer<typeof chunkPatchEventSchema>;

/** Chunk coordinate as it travels in a WebSocket subscription message. */
export const chunkSubscriptionSchema = chunkCoordSchema;
export type ChunkSubscription = z.infer<typeof chunkSubscriptionSchema>;
