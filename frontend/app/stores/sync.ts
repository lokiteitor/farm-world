// The reducer: the only way server state enters the client.
//
// Owner: W3-C. Consumed by net/ws.ts through the `net` store, and by every panel that
// sends a mutating request.
//
// There are exactly two entry points and there is deliberately no third
// (docs/handoff/NOTES-W2c.md, 2.1): `applyFrame` for a WebSocket frame, and
// `applyMutationReply` for the reply of a sequenced route. Both feed the same per slice
// appliers, which is what makes the arrival order of a reply and its own WebSocket echo
// irrelevant: every entity in the contract is a full replacement and not a delta, so
// applying the reply and then discarding the echo converges to the same state as the
// opposite order.
//
// The mark. `lastAppliedSeq` lives here and not in the `net` store, because it is a
// property of the reducer rather than of the connection: it says what has been applied,
// which is exactly the question a duplicate or a gap is decided against. The `net` store
// reads it and never writes it.
//
// The mutation reply is reduced by field name and not by a switch per endpoint. The
// result object of a mutating route carries the new state of every entity the mutation
// touched, under the same names the read models use, so a table from field name to slice
// applier covers all twenty two sequenced routes and covers a route added later for free.
// Every applier parses its value with the schema that describes it, which is both how an
// `unknown` becomes a typed row without a cast and how an ambiguous name cannot corrupt a
// slice: a value that does not match is ignored.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { z } from 'zod';
import { FrameVerdict, decideFrame, decideMutationReply } from '~/net/sequence';
import {
  buildingDtoSchema,
  chunkOf,
  farmDtoSchema,
  fieldDtoSchema,
  forestPlotDtoSchema,
  machineDtoSchema,
  playerDtoSchema,
  taskDtoSchema,
  treeDtoSchema,
  workerCandidateDtoSchema,
  workerDtoSchema,
  type CellCoordWire,
  type EventReplayReply,
  type SnapshotReply,
  type WsServerFrame,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useClockStore } from '~/stores/clock';
import { useFarmsStore } from '~/stores/farms';
import { useFieldsStore } from '~/stores/fields';
import { useForestryStore } from '~/stores/forestry';
import { useInventoryStore } from '~/stores/inventory';
import { useLaborPoolStore } from '~/stores/laborPool';
import { useMachinesStore } from '~/stores/machines';
import { useNoticesStore } from '~/stores/notices';
import { usePlayerStore } from '~/stores/player';
import { useTasksStore } from '~/stores/tasks';
import { useWorkersStore } from '~/stores/workers';
import { useWorldStore } from '~/stores/world';

/** What happened to a frame, so the caller can log or count it. */
export interface ApplyOutcome {
  readonly verdict: FrameVerdict;
  readonly seq: number;
}

const cellArraySchema = z.array(
  z.strictObject({ cellX: z.number().int(), cellY: z.number().int() }),
);
const poolSchema = z.strictObject({
  candidates: z.array(workerCandidateDtoSchema),
  nextRefreshAtGameMs: z.string().nullable(),
});

export const useSyncStore = defineStore('sync', () => {
  const buildings = useBuildingsStore();
  const clock = useClockStore();
  const farms = useFarmsStore();
  const fields = useFieldsStore();
  const forestry = useForestryStore();
  const inventory = useInventoryStore();
  const laborPool = useLaborPoolStore();
  const machines = useMachinesStore();
  const notices = useNoticesStore();
  const player = usePlayerStore();
  const tasks = useTasksStore();
  const workers = useWorkersStore();
  const world = useWorldStore();

  /** Sequence of the last domain frame applied. Zero means nothing yet. */
  const lastAppliedSeq = ref(0);
  const appliedCount = ref(0);
  const discardedCount = ref(0);
  const snapshotCount = ref(0);
  const replayCount = ref(0);
  /** Instant of the last applied frame, in real milliseconds on this machine. */
  const lastAppliedAtRealMs = ref<number | null>(null);

  const hasState = computed(() => player.dto !== null);

  function advanceMark(seq: number, atRealMs: number): void {
    if (seq > lastAppliedSeq.value) {
      lastAppliedSeq.value = seq;
    }
    appliedCount.value += 1;
    lastAppliedAtRealMs.value = atRealMs;
  }

  // -------------------------------------------------------------------------
  // Per slice appliers
  // -------------------------------------------------------------------------

  /**
   * Marks the chunks a set of cells belongs to as needing a reload.
   *
   * A mutating reply reports the cells it changed but not their new use, and the
   * authoritative update is the `CHUNK_PATCHED` frame that accompanies it. Rebuilding a
   * cell record from the reply would mean inventing the fields it does not carry, so the
   * reply is used only to invalidate: the streaming path reloads the chunk and the frame
   * fills it in, whichever arrives first.
   */
  function invalidateCellsOf(cells: readonly CellCoordWire[]): void {
    const seen = new Set<string>();
    for (const cell of cells) {
      const chunk = chunkOf(cell.cellX, cell.cellY, world.chunkSize);
      const key = `${chunk.chunkX}:${chunk.chunkY}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const held = world.getChunk(chunk.chunkX, chunk.chunkY);
      if (held !== undefined && held.version >= 0) {
        // One version behind is enough to make the streaming path ask again.
        held.stale = true;
      }
    }
    if (seen.size > 0) {
      world.revision += 1;
    }
  }

  /** Field name of a mutation result to the slice that owns it. */
  const RESULT_APPLIERS: Readonly<Record<string, (value: unknown, atRealMs: number) => void>> = {
    player: (value) => {
      const parsed = playerDtoSchema.safeParse(value);
      if (parsed.success) {
        player.applyPlayer(parsed.data);
      }
    },
    balanceAfter: (value) => {
      if (typeof value === 'string') {
        player.applyBalance(value);
      }
    },
    lastSummaryGameMs: (value) => {
      if (typeof value === 'string') {
        player.applyLastSummaryGameMs(value);
      }
    },
    farm: (value) => {
      const parsed = farmDtoSchema.safeParse(value);
      if (parsed.success) {
        farms.upsert(parsed.data);
      }
    },
    building: (value) => {
      const parsed = buildingDtoSchema.safeParse(value);
      if (parsed.success) {
        buildings.upsert(parsed.data);
      }
    },
    buildingId: (value) => {
      if (typeof value === 'string') {
        buildings.remove(value);
      }
    },
    field: (value) => {
      const parsed = fieldDtoSchema.safeParse(value);
      if (parsed.success) {
        fields.upsert(parsed.data);
      }
    },
    original: (value) => {
      const parsed = fieldDtoSchema.safeParse(value);
      if (parsed.success) {
        fields.upsert(parsed.data);
      }
    },
    created: (value) => {
      const parsed = fieldDtoSchema.safeParse(value);
      if (parsed.success) {
        fields.upsert(parsed.data);
      }
    },
    removedFieldIds: (value) => {
      const parsed = z.array(z.string()).safeParse(value);
      if (parsed.success) {
        for (const fieldId of parsed.data) {
          fields.remove(fieldId);
        }
      }
    },
    machine: (value) => {
      const parsed = machineDtoSchema.safeParse(value);
      if (parsed.success) {
        machines.upsert(parsed.data);
      }
    },
    machineId: (value) => {
      if (typeof value === 'string') {
        machines.remove(value);
      }
    },
    worker: (value) => {
      const parsed = workerDtoSchema.safeParse(value);
      if (parsed.success) {
        workers.upsert(parsed.data);
      }
    },
    workerId: (value) => {
      if (typeof value === 'string') {
        workers.remove(value);
      }
    },
    pool: (value) => {
      const parsed = poolSchema.safeParse(value);
      if (parsed.success) {
        laborPool.applyPool(parsed.data);
      }
    },
    task: (value) => {
      const parsed = taskDtoSchema.safeParse(value);
      if (parsed.success) {
        tasks.upsert(parsed.data);
      }
    },
    plot: (value) => {
      const parsed = forestPlotDtoSchema.safeParse(value);
      if (parsed.success) {
        forestry.upsert(parsed.data);
      }
    },
    trees: (value) => {
      const parsed = z.array(treeDtoSchema).safeParse(value);
      if (parsed.success && parsed.data.length > 0) {
        const first = parsed.data[0];
        if (first !== undefined) {
          forestry.applyTrees(first.forestPlotId, parsed.data, []);
        }
      }
    },
    purchasedCells: (value) => {
      const parsed = cellArraySchema.safeParse(value);
      if (parsed.success) {
        invalidateCellsOf(parsed.data);
      }
    },
    footprintCells: (value) => {
      const parsed = cellArraySchema.safeParse(value);
      if (parsed.success) {
        invalidateCellsOf(parsed.data);
      }
    },
    releasedCells: (value) => {
      const parsed = cellArraySchema.safeParse(value);
      if (parsed.success) {
        invalidateCellsOf(parsed.data);
      }
    },
    movedCells: (value) => {
      const parsed = cellArraySchema.safeParse(value);
      if (parsed.success) {
        invalidateCellsOf(parsed.data);
      }
    },
    cells: (value) => {
      const parsed = cellArraySchema.safeParse(value);
      if (parsed.success) {
        invalidateCellsOf(parsed.data);
      }
    },
  };

  // Three fields of the contract are deliberately absent from the table above, and each
  // absence is a reading of the contract rather than an omission.
  //
  // `usage`, of the reply of `POST /api/market/sell`, carries a storage usage without the
  // farm or the resource it belongs to, so it cannot be placed; the `INVENTORY_UPSERTED`
  // frame the same route emits carries the placement and is authoritative.
  //
  // Inventory and notices never appear in a mutation result at all: they travel only as
  // frames. Adding speculative appliers for them would put an untested path in the reducer.

  // -------------------------------------------------------------------------
  // Entry point 1: a WebSocket frame
  // -------------------------------------------------------------------------

  function reduceFrame(frame: WsServerFrame, atRealMs: number): void {
    switch (frame.type) {
      case 'HELLO':
        clock.applyClock(frame.payload.clock, atRealMs);
        break;
      case 'CLOCK':
        clock.applyClock(frame.payload.clock, atRealMs);
        break;
      case 'PLAYER_UPSERTED':
        player.applyPlayer(frame.payload.player);
        break;
      case 'LEDGER_APPENDED':
        player.appendLedger(frame.payload.entries);
        player.applyBalance(frame.payload.balance);
        break;
      case 'INVENTORY_UPSERTED':
        inventory.applyInventoryFarms(frame.payload.farms);
        break;
      case 'CHUNK_PATCHED':
        world.applyChunkPatch(frame.payload);
        break;
      case 'FARM_UPSERTED':
        farms.upsert(frame.payload.farm);
        break;
      case 'BUILDING_UPSERTED':
        buildings.upsert(frame.payload.building);
        break;
      case 'BUILDING_REMOVED':
        buildings.remove(frame.payload.buildingId);
        invalidateCellsOf(frame.payload.releasedCells);
        break;
      case 'FIELD_UPSERTED':
        fields.upsert(frame.payload.field);
        if (frame.payload.cells !== null) {
          fields.applyCells(frame.payload.field.id, frame.payload.cells);
          invalidateCellsOf(frame.payload.cells);
        }
        break;
      case 'FIELD_REMOVED':
        fields.remove(frame.payload.fieldId);
        break;
      case 'MACHINE_UPSERTED':
        machines.upsert(frame.payload.machine);
        break;
      case 'MACHINE_REMOVED':
        machines.remove(frame.payload.machineId);
        break;
      case 'WORKER_UPSERTED':
        workers.upsert(frame.payload.worker);
        break;
      case 'WORKER_REMOVED':
        workers.remove(frame.payload.workerId);
        break;
      case 'WORKER_POOL_UPSERTED':
        laborPool.applyPool(frame.payload);
        break;
      case 'TASK_UPSERTED':
        tasks.upsert(frame.payload.task);
        break;
      case 'FOREST_PLOT_UPSERTED':
        forestry.upsert(frame.payload.plot);
        if (frame.payload.cells !== null) {
          invalidateCellsOf(frame.payload.cells);
        }
        break;
      case 'FOREST_PLOT_REMOVED':
        forestry.remove(frame.payload.forestPlotId);
        break;
      case 'TREES_UPSERTED':
        forestry.upsert(frame.payload.plot);
        forestry.applyTrees(
          frame.payload.forestPlotId,
          frame.payload.trees,
          frame.payload.removedTreeIds,
        );
        break;
      case 'NOTICE':
        notices.applyNotice(frame.payload.notice, atRealMs);
        break;
    }
  }

  /**
   * Applies one frame, with the sequence rule.
   *
   * A gap is reported and not acted on here: closing it needs two REST calls and the
   * decision of which one belongs to the connection, so `net` owns it. What this function
   * guarantees is that a frame beyond the mark is never applied out of order.
   */
  function applyFrame(frame: WsServerFrame, atRealMs: number = Date.now()): ApplyOutcome {
    const verdict = decideFrame(lastAppliedSeq.value, frame);
    switch (verdict) {
      case FrameVerdict.APPLY:
        reduceFrame(frame, atRealMs);
        advanceMark(frame.seq, atRealMs);
        break;
      case FrameVerdict.APPLY_TRANSPORT:
        reduceFrame(frame, atRealMs);
        lastAppliedAtRealMs.value = atRealMs;
        break;
      case FrameVerdict.DISCARD:
        discardedCount.value += 1;
        break;
      case FrameVerdict.GAP:
        break;
    }
    return { verdict, seq: frame.seq };
  }

  // -------------------------------------------------------------------------
  // Entry point 2: the reply of a sequenced route
  // -------------------------------------------------------------------------

  /**
   * Applies the reply of a mutating route through the same appliers as a frame.
   *
   * `result` is walked by field name, so this function needs no knowledge of which route
   * produced it beyond the shape of the read models. An unknown field is ignored, which
   * is what lets a route be added to the contract without touching this file, and a field
   * whose value does not match its schema is ignored too, which is what keeps an
   * ambiguous name from writing into the wrong slice.
   */
  function applyMutationReply(
    reply: { readonly seq: number; readonly atGameMs: string; readonly result: unknown },
    atRealMs: number = Date.now(),
  ): ApplyOutcome {
    const verdict = decideMutationReply(lastAppliedSeq.value, reply.seq);
    if (verdict === FrameVerdict.DISCARD) {
      discardedCount.value += 1;
      return { verdict, seq: reply.seq };
    }
    if (typeof reply.result === 'object' && reply.result !== null) {
      for (const [field, value] of Object.entries(reply.result as Record<string, unknown>)) {
        RESULT_APPLIERS[field]?.(value, atRealMs);
      }
    }
    advanceMark(reply.seq, atRealMs);
    return { verdict, seq: reply.seq };
  }

  // -------------------------------------------------------------------------
  // The two rungs of the resynchronisation ladder
  // -------------------------------------------------------------------------

  /** Applies a page of the replay ring, in order. */
  function applyReplay(reply: EventReplayReply, atRealMs: number = Date.now()): void {
    replayCount.value += 1;
    for (const frame of reply.frames) {
      applyFrame(frame, atRealMs);
    }
    if (reply.truncated) {
      // The ring could not reach back to `since`. The caller escalates to a snapshot;
      // the mark is deliberately left where it was so that nothing is skipped.
      return;
    }
    if (reply.through > lastAppliedSeq.value) {
      lastAppliedSeq.value = reply.through;
    }
  }

  /**
   * Rebuilds everything from a full snapshot, and invalidates the grid.
   *
   * The snapshot carries every entity and says nothing about the chunks, because they are
   * streamed by coordinate and cached with the version in the key (plan sections 5.1 and
   * 9.5). What it does carry is the cells of every field and plot, which is what the
   * outline layer needs; the ownership layer has to be re-read, so the modification layer
   * of every loaded chunk is dropped.
   */
  function applySnapshot(reply: SnapshotReply, atRealMs: number = Date.now()): void {
    snapshotCount.value += 1;
    world.applyWorldInfo(reply.world);
    clock.applyClock(reply.world.clock, atRealMs);
    player.applyPlayer(reply.player);
    player.setWelcomeBackPending(reply.welcomeBackPending);
    farms.replaceAll(reply.farms);
    buildings.replaceAll(reply.buildings);
    fields.replaceAll(reply.fields);
    fields.replaceAllCells(reply.fieldCells);
    machines.replaceAll(reply.machines);
    workers.replaceAll(reply.workers);
    laborPool.applyPool(reply.laborPool);
    tasks.replaceAll(reply.tasks);
    forestry.replaceAll(reply.forestPlots);
    inventory.replaceAll(reply.inventory);
    notices.applyNotices(reply.notices, atRealMs);
    world.invalidateModifications();
    lastAppliedSeq.value = reply.seq;
    lastAppliedAtRealMs.value = atRealMs;
  }

  /** Drops every slice. Used on logout and by the tests. */
  function resetAll(): void {
    buildings.reset();
    clock.reset();
    farms.reset();
    fields.reset();
    forestry.reset();
    inventory.reset();
    laborPool.reset();
    machines.reset();
    notices.reset();
    player.reset();
    tasks.reset();
    workers.reset();
    world.reset();
    lastAppliedSeq.value = 0;
    appliedCount.value = 0;
    discardedCount.value = 0;
    snapshotCount.value = 0;
    replayCount.value = 0;
    lastAppliedAtRealMs.value = null;
  }

  return {
    lastAppliedSeq,
    appliedCount,
    discardedCount,
    snapshotCount,
    replayCount,
    lastAppliedAtRealMs,
    hasState,
    applyFrame,
    applyMutationReply,
    applyReplay,
    applySnapshot,
    resetAll,
  };
});
