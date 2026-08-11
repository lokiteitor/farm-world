// Server to client events: the discriminated union and its payloads.
//
// Owner: workflow W2 (API contract).
//
// The discriminant is `GameEventType` from shared/domain, with no additions. That set
// is what the `GameEvent` table persists, what the replay ring returns and what the
// reducer of the client switches on, so building the union over anything else would
// create a second vocabulary for the same fact. The exhaustiveness test asserts the
// correspondence in both directions.
//
// Naming. The tags follow the convention `<ENTITY>_UPSERTED` and `<ENTITY>_REMOVED`
// rather than naming the action that caused the change. `UPSERTED` means "this is the
// current state of this entity, apply it whole": the client is a cache and never an
// authority, so a full replacement is both simpler and idempotent, which is what makes
// the arrival order of a REST reply and its WebSocket echo irrelevant. The brief of
// this agent listed the tags by action (`MONEY_CHANGED`, `LAND_PURCHASED`,
// `FIELD_CREATED`, `TASK_STARTED`, ...); the correspondence with the tags actually used
// is in shared/api/README.md and in docs/handoff/NOTES-W2c.md.
//
// Two tags are transport only and consume no sequence number: `CLOCK`, which is
// periodic and carries no domain change, and `HELLO`, which is declared in this module
// because it is not a `GameEvent` and never reaches the `GameEvent` table.

import { z } from 'zod';
import {
  buildingIdSchema,
  cellCoordSchema,
  clockDtoSchema,
  farmIdSchema,
  fieldIdSchema,
  forestPlotIdSchema,
  gameMsSchema,
  machineIdSchema,
  moneySchema,
  playerIdSchema,
  seqSchema,
  treeIdSchema,
  workerIdSchema,
} from '../api/schemas/common.js';
import { inventoryFarmSchema, ledgerEntryDtoSchema } from '../api/schemas/economy.js';
import { buildingDtoSchema, farmDtoSchema } from '../api/schemas/farms.js';
import { fieldDtoSchema } from '../api/schemas/fields.js';
import { forestPlotDtoSchema, treeDtoSchema } from '../api/schemas/forestry.js';
import { machineDtoSchema } from '../api/schemas/machinery.js';
import { noticeDtoSchema, playerDtoSchema } from '../api/schemas/state.js';
import { taskDtoSchema } from '../api/schemas/tasks.js';
import { workerCandidateDtoSchema, workerDtoSchema } from '../api/schemas/workers.js';
import { chunkCellPatchSchema } from '../api/schemas/world.js';
import { GameEventType } from '../domain/enums.js';

// ---------------------------------------------------------------------------
// The transport only tag
// ---------------------------------------------------------------------------

/**
 * Tags the WebSocket carries that are not `GameEvent` rows. Only one: the greeting.
 *
 * `HELLO` is the first frame of every connection and the first frame after every
 * reconnection, which is what makes reconnection and a sequence gap share one code path
 * (plan section 7): both end with the client comparing its own mark against the sequence
 * the server reports and deciding between applying, replaying or a full snapshot.
 */
export const WsTransportEventType = {
  HELLO: 'HELLO',
} as const;
export type WsTransportEventType = (typeof WsTransportEventType)[keyof typeof WsTransportEventType];

/** Every tag the server can send: the domain events plus the greeting. */
export const WsServerEventType = {
  ...GameEventType,
  ...WsTransportEventType,
} as const;
export type WsServerEventType = (typeof WsServerEventType)[keyof typeof WsServerEventType];
export const WS_SERVER_EVENT_TYPES: readonly WsServerEventType[] = Object.values(WsServerEventType);

/**
 * Tags that consume no sequence number. The server sends them with the last sequence it
 * assigned, so the client must not read them as an increment: it applies the payload and
 * leaves its own mark where it was.
 */
export const WS_TRANSPORT_ONLY_EVENT_TYPES: readonly WsServerEventType[] = [
  GameEventType.CLOCK,
  WsTransportEventType.HELLO,
];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * Greeting. It carries everything the client needs to decide what to do next:
 *
 *   - `seq` is the current sequence of the player. Equal to the client's mark means
 *     nothing was missed; above it means a gap, and the client replays from its own mark.
 *   - `oldestReplaySeq` is the oldest sequence the ring still holds. A gap that starts
 *     below it cannot be replayed, so the client goes straight to a full snapshot and
 *     invalidates the chunks it has loaded.
 *   - `contractVersion` is compared against the value the client was built with, and a
 *     mismatch forces a reload rather than a silent divergence.
 */
export const helloPayloadSchema = z.strictObject({
  playerId: playerIdSchema,
  seq: seqSchema,
  oldestReplaySeq: seqSchema,
  clock: clockDtoSchema,
  contractVersion: z.string().min(1).max(64),
  /** Heartbeat period the client should use, so the interval is not hard coded twice. */
  heartbeatIntervalRealMs: z.number().int().positive(),
});
export type HelloPayload = z.infer<typeof helloPayloadSchema>;

/** Periodic clock reading, so the client can correct its extrapolation (plan section 7). */
export const clockPayloadSchema = z.strictObject({
  clock: clockDtoSchema,
});
export type ClockPayload = z.infer<typeof clockPayloadSchema>;

/**
 * The player. This is the frame that reports a change of money, whatever caused it: a
 * purchase, a sale, a settlement of accruals or the overdraft interest. The amount is
 * not in the frame because the balance is: the client is a cache, and a full replacement
 * cannot drift the way a sequence of deltas can.
 */
export const playerUpsertedPayloadSchema = z.strictObject({
  player: playerDtoSchema,
});
export type PlayerUpsertedPayload = z.infer<typeof playerUpsertedPayloadSchema>;

/**
 * Ledger entries appended since the last frame. They accompany a change of money rather
 * than replace it: the balance travels in `PLAYER_UPSERTED` and the entries are what let
 * the interface say why it moved, which is the same question the return summary answers
 * over a longer interval.
 */
export const ledgerAppendedPayloadSchema = z.strictObject({
  entries: z.array(ledgerEntryDtoSchema).min(1),
  balance: moneySchema,
});
export type LedgerAppendedPayload = z.infer<typeof ledgerAppendedPayloadSchema>;

export const inventoryUpsertedPayloadSchema = z.strictObject({
  farms: z.array(inventoryFarmSchema).min(1),
});
export type InventoryUpsertedPayload = z.infer<typeof inventoryUpsertedPayloadSchema>;

/**
 * A chunk whose modification layer changed. This is the frame a land purchase produces,
 * and also the frame the creation of a field, the placing of a building and the clearing
 * of forest produce: they are all the same fact from the point of view of the renderer,
 * which is that some cells of a chunk are no longer what it has cached.
 *
 * `version` is the new version of the chunk. The client applies the frame only if the
 * version is the one after the one it holds, and otherwise reloads the chunk: the same
 * gap rule as the sequence, applied per chunk (plan section 9.5).
 */
export const chunkPatchedPayloadSchema = z.strictObject({
  chunkX: z.number().int().safe(),
  chunkY: z.number().int().safe(),
  version: z.number().int().nonnegative(),
  cells: z.array(chunkCellPatchSchema).min(1),
});
export type ChunkPatchedPayload = z.infer<typeof chunkPatchedPayloadSchema>;

export const farmUpsertedPayloadSchema = z.strictObject({
  farm: farmDtoSchema,
});
export type FarmUpsertedPayload = z.infer<typeof farmUpsertedPayloadSchema>;

export const buildingUpsertedPayloadSchema = z.strictObject({
  building: buildingDtoSchema,
});
export type BuildingUpsertedPayload = z.infer<typeof buildingUpsertedPayloadSchema>;

export const buildingRemovedPayloadSchema = z.strictObject({
  buildingId: buildingIdSchema,
  farmId: farmIdSchema,
  releasedCells: z.array(cellCoordSchema),
});
export type BuildingRemovedPayload = z.infer<typeof buildingRemovedPayloadSchema>;

/**
 * A field. It is the frame of a creation, of a change of state and of a change of a
 * projected attribute alike, which is why the payload is the whole entity.
 *
 * `cells` travels only when the geometry changed, and is null otherwise: a field of two
 * thousand cells would otherwise resend its whole geometry every time its weed level was
 * settled.
 */
export const fieldUpsertedPayloadSchema = z.strictObject({
  field: fieldDtoSchema,
  cells: z.array(cellCoordSchema).nullable(),
});
export type FieldUpsertedPayload = z.infer<typeof fieldUpsertedPayloadSchema>;

export const fieldRemovedPayloadSchema = z.strictObject({
  fieldId: fieldIdSchema,
});
export type FieldRemovedPayload = z.infer<typeof fieldRemovedPayloadSchema>;

export const machineUpsertedPayloadSchema = z.strictObject({
  machine: machineDtoSchema,
});
export type MachineUpsertedPayload = z.infer<typeof machineUpsertedPayloadSchema>;

export const machineRemovedPayloadSchema = z.strictObject({
  machineId: machineIdSchema,
  farmId: farmIdSchema,
});
export type MachineRemovedPayload = z.infer<typeof machineRemovedPayloadSchema>;

export const workerUpsertedPayloadSchema = z.strictObject({
  worker: workerDtoSchema,
});
export type WorkerUpsertedPayload = z.infer<typeof workerUpsertedPayloadSchema>;

export const workerRemovedPayloadSchema = z.strictObject({
  workerId: workerIdSchema,
  farmId: farmIdSchema,
});
export type WorkerRemovedPayload = z.infer<typeof workerRemovedPayloadSchema>;

/** The hiring pool, replaced whole (GDD section 102). */
export const workerPoolUpsertedPayloadSchema = z.strictObject({
  candidates: z.array(workerCandidateDtoSchema),
  nextRefreshAtGameMs: gameMsSchema.nullable(),
});
export type WorkerPoolUpsertedPayload = z.infer<typeof workerPoolUpsertedPayloadSchema>;

/**
 * A task. This one frame reports the start, the completion and the cancellation: the
 * three differ only in `status` and in whether `endedGameMs` is set, and splitting them
 * into three tags would force the reducer to reconstruct the entity from three partial
 * shapes.
 */
export const taskUpsertedPayloadSchema = z.strictObject({
  task: taskDtoSchema,
});
export type TaskUpsertedPayload = z.infer<typeof taskUpsertedPayloadSchema>;

export const forestPlotUpsertedPayloadSchema = z.strictObject({
  plot: forestPlotDtoSchema,
  cells: z.array(cellCoordSchema).nullable(),
});
export type ForestPlotUpsertedPayload = z.infer<typeof forestPlotUpsertedPayloadSchema>;

export const forestPlotRemovedPayloadSchema = z.strictObject({
  forestPlotId: forestPlotIdSchema,
});
export type ForestPlotRemovedPayload = z.infer<typeof forestPlotRemovedPayloadSchema>;

/**
 * Trees of one plot that changed. This is the frame a felling, a replanting and the
 * crossing of a growth stage produce.
 *
 * A tree stores only its planting instant, and its stage is derived from the clock (plan
 * section 2.2), so nothing is triggered when a tree grows: the server sends this frame
 * only when the milestone job of GDD section 131 materialises a stage worth reporting, or
 * when a task changed the trees. Between those, the client derives the stage itself with
 * the same shared rule, so a tree that matures while the player watches does so without
 * any traffic at all.
 */
export const treesUpsertedPayloadSchema = z.strictObject({
  forestPlotId: forestPlotIdSchema,
  trees: z.array(treeDtoSchema),
  /** Trees that left the plot. Empty for a pure stage change. */
  removedTreeIds: z.array(treeIdSchema),
  /** The plot with its counters recomputed, so the panel needs no second request. */
  plot: forestPlotDtoSchema,
});
export type TreesUpsertedPayload = z.infer<typeof treesUpsertedPayloadSchema>;

export const noticePayloadSchema = z.strictObject({
  notice: noticeDtoSchema,
});
export type NoticePayload = z.infer<typeof noticePayloadSchema>;

// ---------------------------------------------------------------------------
// The payload table
// ---------------------------------------------------------------------------

/**
 * Payload schema of every tag. Keyed by the union, so a tag added to
 * `GameEventType` without a payload here does not compile: that is the mechanism that
 * keeps the union exhaustive, and the test that walks `GAME_EVENT_TYPES` is the second
 * line of defence for the runtime.
 */
export const WS_EVENT_PAYLOAD_SCHEMAS: Readonly<Record<WsServerEventType, z.ZodType>> = {
  HELLO: helloPayloadSchema,
  CLOCK: clockPayloadSchema,
  PLAYER_UPSERTED: playerUpsertedPayloadSchema,
  LEDGER_APPENDED: ledgerAppendedPayloadSchema,
  INVENTORY_UPSERTED: inventoryUpsertedPayloadSchema,
  CHUNK_PATCHED: chunkPatchedPayloadSchema,
  FARM_UPSERTED: farmUpsertedPayloadSchema,
  BUILDING_UPSERTED: buildingUpsertedPayloadSchema,
  BUILDING_REMOVED: buildingRemovedPayloadSchema,
  FIELD_UPSERTED: fieldUpsertedPayloadSchema,
  FIELD_REMOVED: fieldRemovedPayloadSchema,
  MACHINE_UPSERTED: machineUpsertedPayloadSchema,
  MACHINE_REMOVED: machineRemovedPayloadSchema,
  WORKER_UPSERTED: workerUpsertedPayloadSchema,
  WORKER_REMOVED: workerRemovedPayloadSchema,
  WORKER_POOL_UPSERTED: workerPoolUpsertedPayloadSchema,
  TASK_UPSERTED: taskUpsertedPayloadSchema,
  FOREST_PLOT_UPSERTED: forestPlotUpsertedPayloadSchema,
  FOREST_PLOT_REMOVED: forestPlotRemovedPayloadSchema,
  TREES_UPSERTED: treesUpsertedPayloadSchema,
  NOTICE: noticePayloadSchema,
};

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------
//
// The members are written out rather than generated from the table above, because a
// generated `z.discriminatedUnion` loses the correlation between the tag and the payload
// at the type level, and that correlation is the whole point: it is what makes a reducer
// with a `switch` on `type` see the right payload type in each branch without a cast.

export const wsServerEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(WsTransportEventType.HELLO), payload: helloPayloadSchema }),
  z.strictObject({ type: z.literal(GameEventType.CLOCK), payload: clockPayloadSchema }),
  z.strictObject({
    type: z.literal(GameEventType.PLAYER_UPSERTED),
    payload: playerUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.LEDGER_APPENDED),
    payload: ledgerAppendedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.INVENTORY_UPSERTED),
    payload: inventoryUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.CHUNK_PATCHED),
    payload: chunkPatchedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.FARM_UPSERTED),
    payload: farmUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.BUILDING_UPSERTED),
    payload: buildingUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.BUILDING_REMOVED),
    payload: buildingRemovedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.FIELD_UPSERTED),
    payload: fieldUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.FIELD_REMOVED),
    payload: fieldRemovedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.MACHINE_UPSERTED),
    payload: machineUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.MACHINE_REMOVED),
    payload: machineRemovedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.WORKER_UPSERTED),
    payload: workerUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.WORKER_REMOVED),
    payload: workerRemovedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.WORKER_POOL_UPSERTED),
    payload: workerPoolUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.TASK_UPSERTED),
    payload: taskUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.FOREST_PLOT_UPSERTED),
    payload: forestPlotUpsertedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.FOREST_PLOT_REMOVED),
    payload: forestPlotRemovedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal(GameEventType.TREES_UPSERTED),
    payload: treesUpsertedPayloadSchema,
  }),
  z.strictObject({ type: z.literal(GameEventType.NOTICE), payload: noticePayloadSchema }),
]);
export type WsServerEvent = z.infer<typeof wsServerEventSchema>;

/** The payload of one tag, for a caller that already knows which tag it holds. */
export type WsEventPayload<TType extends WsServerEventType> = Extract<
  WsServerEvent,
  { type: TType }
>['payload'];
