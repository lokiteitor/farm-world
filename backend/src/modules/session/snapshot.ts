// `GET /api/state/snapshot`: the complete state of a player at one sequence.
//
// Owner: workflow W6-B. Module `session`.
//
// The third and most expensive rung of the resynchronisation ladder of ADR-0019. The client
// reaches it when the replay ring no longer holds the first frame it is missing, and what it
// gets back has to be a complete replacement of every slice of its store, because the frames
// it lost are gone for good and there is nothing left to reconcile against.
//
// Two properties the composition has to hold, and both shape the code below.
//
// 1. It is consistent at one sequence and at one game instant. `seq` is the sequence the
//    snapshot is consistent at, and the client sets its mark to it and discards every frame at
//    or below. The whole composition therefore runs inside a single transaction and reads
//    `Player.eventSeq` inside it, so a frame written while the snapshot was being built is
//    either already inside it or carries a higher sequence. Reading the sequence outside the
//    transaction would produce the one failure this design exists to avoid: a client that
//    believes it caught up while a change is missing for good.
//
// 2. It carries no chunk. The grid is streamed by coordinate and cached with the version in
//    the key (ADR-0022), so putting it here would download the whole holding to rebuild
//    something the renderer already has. What does travel are the cells of every field and
//    every plot, which is what the outline layer needs and what no chunk request answers
//    without knowing which chunks to ask for.
//
// Where each entity comes from. Seven of the eleven read models belong to modules of earlier
// phases and are imported, which is what keeps the snapshot and the listing routes from
// disagreeing: `farms`, `fields`, `machinery`, `workers` and `economy` publish exactly the
// builders their own routes use (ADR-0006). The two that belong to siblings of this phase are
// built in `readModel.ts` of this module, for the reason recorded there. `world/info` is the
// one shape that is restated rather than imported, because `modules/world` composes it inline
// in its route and exports no builder; the mirror is `backend/src/modules/world/routes.ts` and
// the divergence would be caught by the reply schema of either route.

import { type ClockReading } from '../../lib/gameClock.js';
import { buildPlayerDto, toClockDto } from '../../lib/playerView.js';
import { type Tx } from '../../lib/tx.js';
import {
  CELL_PX,
  CELL_SIZE_M,
  MAX_SELECTION_CELLS,
  SHARED_CONTRACT_VERSION,
  noticeDtoSchema,
  toWireGameMs,
  type GameMs,
  type NoticeDto,
  type PlayerId,
  type SnapshotReply,
  type WorldInfoReply,
} from '../../shared/index.js';
import { buildInventoryFarms } from '../economy/index.js';
import { buildFarmsReply } from '../farms/readModel.js';
import { buildFieldDto, fieldCells, loadPlayerFields } from '../fields/index.js';
import { loadMachines, toMachineDto } from '../machinery/index.js';
import { buildPoolReply, loadPlayerWorkers, toWorkerDto } from '../workers/index.js';
import { loadActiveTaskDtos, loadForestPlotDtos, forestPlotCells } from './readModel.js';
import { welcomeBackPending } from './welcomeBack.js';

/**
 * Notices the snapshot carries.
 *
 * A notice is a message and not an entity, so there is no "current set" of them to replace:
 * what the client needs after a resynchronisation is the recent ones it may not have seen. The
 * ceiling is what bounds this part of the payload; older notices are history and belong to the
 * return summary, which reports the ones of its own interval.
 */
export const MAX_SNAPSHOT_NOTICES = 50;

/**
 * The description of the world, as `GET /api/world/info` answers it.
 *
 * Restated and not imported: `modules/world` builds it inside its route handler and exports no
 * builder, and a snapshot without the seed and the anchor is a snapshot the renderer cannot
 * use. Every field comes from the persisted row or from `shared/config`, never from a literal,
 * so the two compositions can only disagree by omission, which the reply schema rejects.
 */
export async function buildWorldInfo(
  tx: Tx,
  playerId: PlayerId,
  reading: ClockReading,
): Promise<WorldInfoReply> {
  const world = reading.world;
  const player = await tx.player.findUnique({
    where: { id: playerId },
    select: { spawnCellX: true, spawnCellY: true },
  });
  return {
    worldId: world.id,
    seed: world.seed,
    generatorVersion: world.generatorVersion,
    chunkSize: world.chunkSize,
    cellSizeM: CELL_SIZE_M,
    cellPx: CELL_PX,
    maxSelectionCells: MAX_SELECTION_CELLS,
    contractVersion: SHARED_CONTRACT_VERSION,
    clock: toClockDto(reading),
    spawnCellX: player?.spawnCellX ?? null,
    spawnCellY: player?.spawnCellY ?? null,
  };
}

/**
 * The recent notices of a player, oldest first.
 *
 * They are read from the authoritative event log and not from a table of their own, because a
 * notice is exactly a `NOTICE` frame and storing it twice would be a second source of truth.
 * A payload that does not validate is skipped rather than reported: the log is append only and
 * a frame that failed to parse is a frame this build no longer understands, which must not
 * take the whole snapshot down.
 */
export async function loadRecentNotices(
  tx: Tx,
  playerId: PlayerId,
  limit: number = MAX_SNAPSHOT_NOTICES,
): Promise<readonly NoticeDto[]> {
  const rows = await tx.gameEvent.findMany({
    where: { playerId, type: 'NOTICE' },
    orderBy: { seq: 'desc' },
    take: limit,
    select: { payload: true },
  });
  const notices: NoticeDto[] = [];
  for (const row of [...rows].reverse()) {
    const payload = row.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      continue;
    }
    const parsed = noticeDtoSchema.safeParse((payload as Record<string, unknown>)['notice']);
    if (parsed.success) {
      notices.push(parsed.data);
    }
  }
  return notices;
}

/**
 * Composes the whole snapshot inside one transaction.
 *
 * The order of the reads is not arbitrary: the sequence is taken first, so everything read
 * afterwards is at least as new as the sequence reported. Under `READ COMMITTED` a snapshot
 * built this way can only be ahead of its sequence, never behind, and being ahead is safe
 * because every entity is a complete replacement and the frames in between are discarded as
 * duplicates.
 */
export async function buildSnapshot(
  tx: Tx,
  playerId: PlayerId,
  reading: ClockReading,
): Promise<SnapshotReply> {
  const atGameMs: GameMs = reading.gameNow;
  const player = await tx.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { eventSeq: true, lastSummaryGameMs: true },
  });

  const [world, playerDto, farms, fields, machines, workers, laborPool] = await Promise.all([
    buildWorldInfo(tx, playerId, reading),
    buildPlayerDto(tx, playerId, reading),
    buildFarmsReply(tx, playerId),
    loadPlayerFields(tx, playerId),
    loadMachines(tx, playerId),
    loadPlayerWorkers(tx, playerId),
    buildPoolReply(tx, playerId),
  ]);

  const [tasks, forestPlots, inventory, notices, pending] = await Promise.all([
    loadActiveTaskDtos(tx, playerId, atGameMs),
    loadForestPlotDtos(tx, playerId, atGameMs),
    buildInventoryFarms(tx, playerId),
    loadRecentNotices(tx, playerId),
    welcomeBackPending(tx, playerId, atGameMs),
  ]);

  // One statement per field and per plot, which is the shape the cell table indexes: the
  // foreign key lives on the cell (ADR-0025), so a single `in` query would return one flat
  // list that has to be regrouped anyway, and a holding with twenty fields is twenty small
  // indexed reads.
  const fieldCellRows = await Promise.all(
    fields.map(async (field) => ({
      fieldId: field.id as string,
      cells: [...(await fieldCells(tx, field.id))],
    })),
  );
  const plotCellRows = await Promise.all(
    forestPlots.map(async (plot) => ({
      forestPlotId: plot.id,
      cells: [...(await forestPlotCells(tx, plot.id))],
    })),
  );

  return {
    seq: player.eventSeq,
    atGameMs: toWireGameMs(atGameMs),
    world,
    player: playerDto,
    farms: [...farms.farms],
    buildings: [...farms.buildings],
    fields: fields.map((field) => buildFieldDto(field, atGameMs)),
    fieldCells: fieldCellRows,
    machines: machines.map(toMachineDto),
    workers: workers.map(toWorkerDto),
    laborPool: {
      candidates: [...laborPool.candidates],
      nextRefreshAtGameMs: laborPool.nextRefreshAtGameMs,
    },
    tasks: [...tasks],
    forestPlots: [...forestPlots],
    forestPlotCells: plotCellRows,
    inventory: [...inventory],
    notices: [...notices],
    welcomeBackPending: pending,
  };
}
