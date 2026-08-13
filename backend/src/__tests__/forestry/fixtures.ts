// Fixtures of the `forestry` suite.
//
// Owner: workflow W6-C. Tests of the module `forestry`.
//
// The world of the harness carries a random negative seed, so no coordinate has a known
// terrain: a test that hard coded one would pass or fail depending on the run. Every cell used
// here is therefore found by running the same deterministic generator the module runs, which is
// also the honest way to test it — the assertions then hold for any seed.
//
// Two kinds of plot are needed and they are built differently on purpose:
//
//   - A generated plot, created over freshly bought forest, which is what the natural forest of
//     GDD section 130 produces. It is what the determinism case and the "deleting and recreating
//     does not resurrect" case are about.
//   - A controlled plot, created over cells whose `naturalTreeConsumed` mark was set first, so
//     the generator produces nothing and the test places every tree with the exact planting
//     instant it needs. Without it, "the volume of a batch is the sum of the derived volumes"
//     would be asserted against whatever ages a random seed happened to draw, and the case that
//     needs a tree to cross a stage boundary in the middle of a felling would be a coin toss.
//
// The farm, its buildings, its worker and its machinery are inserted directly rather than bought
// through their routes, which is what the `machinery` and `economy` suites already do: none of
// them is what these cases are testing, and going through the placement routes would make every
// case depend on finding buildable terrain for the seed of the run.

import { randomUUID } from 'node:crypto';
import { terrainCacheOf } from '../../modules/world/generator.js';
import {
  BuildingType,
  MACHINE_CATALOGUE,
  MachineStatus,
  Money,
  TERRAIN_CODE,
  TreeSpecies,
  TreeStatus,
  WorkerStatus,
  gameHours,
  gameHoursToGameMs,
  type CellCoord,
  type GameMs,
  type MachineType,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, type Harness } from '../harness.js';

/** Chunks a rectangle search walks before it gives up. A chunk holds 1 024 cells. */
const MAX_CHUNKS_SCANNED = 48;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/**
 * The north west corner of a rectangle of `width` x `height` cells that is entirely forest.
 *
 * A plot needs a contiguous selection (GDD section 129, `FOREST_PLOT` of
 * `shared/rules/selection.ts`), so a scatter of forest cells is not enough. The search walks a
 * chunk row eastwards, which keeps two bands of the same run from ever contending for a cell.
 */
export async function findForestRectangle(
  harness: Harness,
  world: World,
  width: number,
  height: number,
  band: number,
): Promise<CellCoord> {
  const cache = terrainCacheOf(harness.services);
  const size = world.chunkSize;
  for (let offset = 0; offset < MAX_CHUNKS_SCANNED; offset += 1) {
    // Two chunks side by side, so a rectangle that straddles a chunk boundary is still found.
    const west = await cache.chunk(world, { chunkX: offset, chunkY: band });
    const east = await cache.chunk(world, { chunkX: offset + 1, chunkY: band });
    const codeAt = (x: number, y: number): number =>
      (x < size ? west[y * size + x] : east[y * size + (x - size)]) ?? 255;
    for (let y = 0; y + height <= size; y += 1) {
      for (let x = 0; x + width <= 2 * size; x += 1) {
        let ok = true;
        for (let dy = 0; dy < height && ok; dy += 1) {
          for (let dx = 0; dx < width && ok; dx += 1) {
            ok = codeAt(x + dx, y + dy) === TERRAIN_CODE.FOREST;
          }
        }
        if (ok) {
          return { cellX: offset * size + x, cellY: band * size + y };
        }
      }
    }
  }
  throw new Error(
    `El generador no produjo ningun rectangulo de ${width} x ${height} celdas de bosque en la banda ${band}`,
  );
}

/** The cells of a rectangle, in row major order. */
export function rectangleCells(
  origin: CellCoord,
  width: number,
  height: number,
): readonly CellCoord[] {
  const cells: CellCoord[] = [];
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      cells.push({ cellX: origin.cellX + dx, cellY: origin.cellY + dy });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export interface HttpResult {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
}

async function inject(
  harness: Harness,
  method: 'GET' | 'POST',
  url: string,
  accessToken: string,
  payload?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...bearer(accessToken) };
  if (idempotencyKey !== undefined) {
    headers['idempotency-key'] = idempotencyKey;
  }
  const response =
    payload === undefined
      ? await harness.app.inject({ method, url, headers })
      : await harness.app.inject({ method, url, headers, payload });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export async function get(harness: Harness, accessToken: string, url: string): Promise<HttpResult> {
  return inject(harness, 'GET', url, accessToken);
}

export async function post(
  harness: Harness,
  accessToken: string,
  url: string,
  payload: Record<string, unknown>,
): Promise<HttpResult> {
  return inject(harness, 'POST', url, accessToken, payload);
}

/** `POST /api/land/purchase`, with the header the contract demands of a money moving route. */
export async function buyLand(
  harness: Harness,
  accessToken: string,
  cells: readonly CellCoord[],
): Promise<HttpResult> {
  return inject(
    harness,
    'POST',
    '/api/land/purchase',
    accessToken,
    { cells: [...cells], allowPartial: false },
    `forestry-land-${randomUUID()}`,
  );
}

/** The `code` of an error reply, or null when the reply is not one. */
export function errorCode(body: Record<string, unknown>): string | null {
  const error = body['error'];
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
}

/** The `result` of a mutating reply. */
export function mutationResult(body: Record<string, unknown>): Record<string, unknown> {
  return (body['result'] ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Farm, worker and machinery
// ---------------------------------------------------------------------------

export interface ForestryFarm {
  readonly farmId: string;
  readonly garageId: string;
  readonly homeId: string;
  readonly woodStoreId: string;
  readonly workerId: string;
  readonly machines: Readonly<Record<string, string>>;
}

/** Skill of every worker of the suite, so a duration is a figure and not a coincidence. */
export const WORKER_SKILL_BP = 5_000;

/**
 * A farm with a garage, a worker home, a wood store of the capacity asked for, one idle worker
 * and the machinery listed.
 *
 * The capacity of the store is a parameter and not the 500 m3 of the catalogue, because the case
 * that has to see a full store needs the capacity to be exactly the volume the felling reserved.
 * The trigger of the initial migration sums the capacity of the buildings into the farm, so
 * writing it on the building is the only way to set it.
 */
export async function createForestryFarm(
  harness: Harness,
  playerId: PlayerId,
  band: number,
  woodCapacityDm3: number,
  machineTypes: readonly MachineType[],
): Promise<ForestryFarm> {
  const atGameMs = harness.gameNow();
  const farm = await harness.prisma.farm.create({
    data: { playerId, name: `Granja forestal ${band}`, createdAtGameMs: atGameMs },
    select: { id: true },
  });
  const building = async (
    type: BuildingType,
    columns: {
      capacityMachines?: number;
      capacityWorkers?: number;
      capacityStorageUnits?: number;
      storageResource?: 'WOOD_M3' | 'WHEAT_LITERS' | null;
    },
    originCellX: number,
  ): Promise<string> => {
    const row = await harness.prisma.building.create({
      data: {
        farmId: farm.id,
        playerId,
        type,
        originCellX,
        originCellY: band,
        widthCells: 4,
        heightCells: 4,
        purchasePrice: '0',
        capacityMachines: columns.capacityMachines ?? 0,
        capacityWorkers: columns.capacityWorkers ?? 0,
        capacityStorageUnits: columns.capacityStorageUnits ?? 0,
        storageResource: columns.storageResource ?? null,
        builtAtGameMs: atGameMs,
      },
      select: { id: true },
    });
    return row.id;
  };

  const garageId = await building(BuildingType.GARAGE, { capacityMachines: 8 }, 0);
  const homeId = await building(BuildingType.WORKER_HOME, { capacityWorkers: 4 }, 8);
  const woodStoreId = await building(
    BuildingType.WOOD_STORAGE,
    { capacityStorageUnits: woodCapacityDm3, storageResource: 'WOOD_M3' },
    16,
  );

  const worker = await harness.prisma.worker.create({
    data: {
      playerId,
      farmId: farm.id,
      homeId,
      name: `Operario ${band}`,
      skillBp: WORKER_SKILL_BP,
      salaryPerGameHour: Money.toString(Money.fromUnits(20)),
      status: WorkerStatus.IDLE,
      completedTaskCount: 0,
      hiredGameMs: atGameMs,
    },
    select: { id: true },
  });

  const machines: Record<string, string> = {};
  for (const type of machineTypes) {
    const row = await harness.prisma.machine.create({
      data: {
        playerId,
        farmId: farm.id,
        garageId,
        type,
        conditionBp: 10_000,
        conditionUpdatedAtGameMs: atGameMs,
        status: MachineStatus.IDLE,
        purchasePrice: Money.toString(MACHINE_CATALOGUE[type].purchasePrice),
        acquiredGameMs: atGameMs,
      },
      select: { id: true },
    });
    machines[type] = row.id;
  }

  return { farmId: farm.id, garageId, homeId, woodStoreId, workerId: worker.id, machines };
}

// ---------------------------------------------------------------------------
// Controlled trees
// ---------------------------------------------------------------------------

/** Marks cells as already generated, so creating a plot over them produces no tree at all. */
export async function consumeNaturalTrees(
  harness: Harness,
  world: World,
  cells: readonly CellCoord[],
): Promise<void> {
  await harness.prisma.worldCell.updateMany({
    where: {
      worldId: world.id,
      OR: cells.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    },
    data: { naturalTreeConsumed: true },
  });
}

/**
 * Plants a tree of a chosen age, which is the only way to fix its derived stage.
 *
 * `naturallyGenerated` is true because these trees stand in for the wild forest the generator
 * would have drawn: it is what lets a later case tell them apart from the saplings a replanting
 * creates, which GDD section 130 marks as not generated.
 */
export async function plantTreeAged(
  harness: Harness,
  world: World,
  playerId: PlayerId,
  forestPlotId: string,
  cell: CellCoord,
  ageGameHours: number,
  atGameMs: GameMs,
): Promise<string> {
  const row = await harness.prisma.tree.create({
    data: {
      forestPlotId,
      playerId,
      worldId: world.id,
      cellX: cell.cellX,
      cellY: cell.cellY,
      species: TreeSpecies.PINE,
      plantedAtGameMs: atGameMs - gameHoursToGameMs(gameHours(ageGameHours)),
      status: TreeStatus.STANDING,
      naturallyGenerated: true,
    },
    select: { id: true },
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Removes everything the suite inserts, in the order the foreign keys demand.
 *
 * `world_cells.ownerPlayerId`, `world_cells.forestPlotId` and `trees.forestPlotId` are all
 * `onDelete: Restrict`, so the grid has to go before the plots and the plots before the player
 * the harness deletes.
 */
export async function cleanUp(
  harness: Harness,
  world: World,
  playerIds: readonly PlayerId[],
): Promise<void> {
  for (const playerId of playerIds) {
    // The stock has to go before the buildings that grant its capacity: `farms_stock_check`
    // compares the two in the same row, so demolishing a full store would violate it.
    await harness.prisma.farm.updateMany({
      where: { playerId },
      data: { storedWheatLiters: 0, reservedWheatLiters: 0, storedWoodDm3: 0, reservedWoodDm3: 0 },
    });
    await harness.prisma.scheduledEvent.deleteMany({ where: { playerId } });
    await harness.prisma.forestPlot.updateMany({
      where: { playerId },
      data: { currentTaskId: null },
    });
    await harness.prisma.machine.updateMany({ where: { playerId }, data: { currentTaskId: null } });
    await harness.prisma.worker.updateMany({ where: { playerId }, data: { currentTaskId: null } });
    await harness.prisma.taskMachine.deleteMany({ where: { task: { playerId } } });
    await harness.prisma.task.deleteMany({ where: { playerId } });
    await harness.prisma.tree.deleteMany({ where: { playerId } });
  }
  await harness.prisma.worldCell.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.chunk.deleteMany({ where: { worldId: world.id } });
  for (const playerId of playerIds) {
    await harness.prisma.forestPlot.deleteMany({ where: { playerId } });
    await harness.prisma.field.deleteMany({ where: { playerId } });
    await harness.prisma.machine.deleteMany({ where: { playerId } });
    await harness.prisma.worker.deleteMany({ where: { playerId } });
    await harness.prisma.building.deleteMany({ where: { playerId } });
    await harness.prisma.farm.deleteMany({ where: { playerId } });
  }
}
