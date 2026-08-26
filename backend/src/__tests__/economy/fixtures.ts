// Fixtures shared by the suites of the `economy` module.
//
// Owner: workflow W5-C. Module `economy`.
//
// Not a suite: it holds no `it`, and `backend/vitest.int.config.ts` only collects
// `*.int.test.ts`, so it is never executed on its own.
//
// Two things it does that are worth stating. The stock and the assets are written straight
// through Prisma rather than through the routes that would normally create them: harvesting
// belongs to `modules/tasks` (W6-A) and buying a machine to `modules/machinery` (W5-A), and
// neither exists while this module is written, so a fixture that went through them would be a
// fixture that could not run. Everything that is being tested — the price, the withdrawal,
// the ledger and the liquidation — is still exercised through the real path.
//
// And the arithmetic is kept exact on purpose: the fixture worker earns zero and the fixture
// machines are the implements, whose maintenance is zero in the catalogue (GDD section 89).
// So a window of game time costs nothing, and an assertion about a balance is an assertion
// about the operation under test and not about how many game hours the suite happened to
// take.

import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { advancePlayerNow } from '../../lib/advancePlayer.js';
import { terrainCacheOf } from '../../modules/world/generator.js';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  MACHINE_CATALOGUE,
  MachineStatus,
  Money,
  TERRAIN_CODE,
  TerrainType,
  WorkerStatus,
  gameMs as toGameMsValue,
  worldFromChunk,
  type CellCoord,
  type GameMs,
  type MachineType,
  type PlayerId,
  type World,
  type StockItem,
} from '../../shared/index.js';
import { bearer, registerViaHttp, seedStock, type Harness } from '../harness.js';

/** A player with a farm, its stores and whatever assets the case needs. */
export interface EconomyPlayer {
  readonly playerId: PlayerId;
  readonly accessToken: string;
  readonly farmId: string;
  readonly startedAtGameMs: GameMs;
}

/** Cell band of this module, so its fixtures cannot collide with another suite. */
const BUILDING_ORIGIN = { x: 900_000, y: 900_000 } as const;

/**
 * Registers a player and gives it a farm with a silo and a wood store.
 *
 * The capacities are not written here: the trigger `buildings_farm_storage_capacity`
 * recomputes them from the live storage buildings of the farm, which is the division of
 * labour of ADR-0018, and reading the farm back is what proves it happened.
 */
export async function createEconomyPlayer(
  harness: Harness,
  label: string,
  options: { readonly withWoodStorage?: boolean; readonly withWorkerHome?: boolean } = {},
): Promise<EconomyPlayer> {
  const player = await registerViaHttp(harness, label);
  const row = await harness.prisma.player.findUniqueOrThrow({
    where: { id: player.playerId },
    select: { startedAtGameMs: true },
  });
  const startedAtGameMs = toGameMsValue(row.startedAtGameMs);

  const farm = await harness.prisma.farm.create({
    data: { playerId: player.playerId, name: `Granja ${label}`, createdAtGameMs: startedAtGameMs },
    select: { id: true },
  });

  await createStorageBuilding(
    harness,
    player.playerId,
    farm.id,
    BuildingType.SILO,
    startedAtGameMs,
    0,
  );
  if (options.withWoodStorage === true) {
    await createStorageBuilding(
      harness,
      player.playerId,
      farm.id,
      BuildingType.WOOD_STORAGE,
      startedAtGameMs,
      1,
    );
  }
  if (options.withWorkerHome === true) {
    const definition = BUILDING_CATALOGUE.WORKER_HOME;
    await harness.prisma.building.create({
      data: {
        farmId: farm.id,
        playerId: player.playerId,
        type: BuildingType.WORKER_HOME,
        originCellX: BUILDING_ORIGIN.x + 2 * 20,
        originCellY: BUILDING_ORIGIN.y,
        widthCells: definition.widthCells,
        heightCells: definition.heightCells,
        purchasePrice: Money.toString(definition.purchasePrice),
        capacityMachines: 0,
        capacityWorkers: definition.capacity ?? 0,
        capacityStorageUnits: 0,
        storageResource: null,
        builtAtGameMs: startedAtGameMs,
      },
      select: { id: true },
    });
  }

  return {
    playerId: player.playerId,
    accessToken: player.accessToken,
    farmId: farm.id,
    startedAtGameMs,
  };
}

/** A silo or a wood store, at its catalogue price and capacity (GDD sections 116 and 136). */
async function createStorageBuilding(
  harness: Harness,
  playerId: PlayerId,
  farmId: string,
  type: typeof BuildingType.SILO | typeof BuildingType.WOOD_STORAGE,
  atGameMs: GameMs,
  slot: number,
): Promise<string> {
  const definition = BUILDING_CATALOGUE[type];
  const building = await harness.prisma.building.create({
    data: {
      farmId,
      playerId,
      type,
      originCellX: BUILDING_ORIGIN.x + slot * 20,
      originCellY: BUILDING_ORIGIN.y,
      widthCells: definition.widthCells,
      heightCells: definition.heightCells,
      purchasePrice: Money.toString(definition.purchasePrice),
      capacityMachines: 0,
      capacityWorkers: 0,
      capacityStorageUnits: definition.capacity ?? 0,
      storageResource: definition.capacityResource,
      builtAtGameMs: atGameMs,
    },
    select: { id: true },
  });
  return building.id;
}

/** Puts stock into a store without going through a harvest, which W6-A owns. */
export async function depositStock(
  harness: Harness,
  farmId: string,
  item: StockItem,
  units: number,
): Promise<void> {
  await seedStock(harness, farmId, item, units);
}

/** An idle machine of a type, at its catalogue price and full condition. */
export async function createMachine(
  harness: Harness,
  player: EconomyPlayer,
  type: MachineType,
): Promise<string> {
  const machine = await harness.prisma.machine.create({
    data: {
      playerId: player.playerId,
      farmId: player.farmId,
      type,
      conditionBp: 10_000,
      conditionUpdatedAtGameMs: player.startedAtGameMs,
      status: MachineStatus.IDLE,
      purchasePrice: Money.toString(MACHINE_CATALOGUE[type].purchasePrice),
      acquiredGameMs: player.startedAtGameMs,
    },
    select: { id: true },
  });
  return machine.id;
}

/** An idle worker earning nothing, so a window of game time costs nothing. */
export async function createFreeWorker(
  harness: Harness,
  player: EconomyPlayer,
  name: string,
): Promise<string> {
  const home = await harness.prisma.building.findFirstOrThrow({
    where: { farmId: player.farmId, type: BuildingType.WORKER_HOME, disposedGameMs: null },
    select: { id: true },
  });
  const worker = await harness.prisma.worker.create({
    data: {
      playerId: player.playerId,
      farmId: player.farmId,
      homeId: home.id,
      name,
      skillBp: 5_000,
      salaryPerGameHour: Money.toString(Money.ZERO),
      status: WorkerStatus.IDLE,
      hiredGameMs: player.startedAtGameMs,
    },
    select: { id: true },
  });
  return worker.id;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** A GET of an authenticated route, with its status and its parsed body. */
export async function getJson(
  harness: Harness,
  accessToken: string,
  url: string,
): Promise<{ readonly statusCode: number; readonly body: Record<string, unknown> }> {
  const response = await harness.app.inject({ method: 'GET', url, headers: bearer(accessToken) });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/** `POST /api/market/sell`, with the idempotency key the contract requires. */
export async function postSell(
  harness: Harness,
  accessToken: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{ readonly statusCode: number; readonly body: Record<string, unknown> }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/market/sell',
    headers: { ...bearer(accessToken), 'idempotency-key': idempotencyKey },
    payload,
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/** Moves the balance with the development route, which is the only way to force one. */
export async function grant(
  harness: Harness,
  accessToken: string,
  amount: string,
  reason: string,
): Promise<Record<string, unknown>> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/dev/grant',
    headers: { ...bearer(accessToken), 'idempotency-key': `grant-${reason}` },
    payload: { amount, reason },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Record<string, unknown>>();
}

/** The settled balance of a player, read from the column. */
export async function balanceOf(harness: Harness, playerId: PlayerId): Promise<Money> {
  const row = await harness.prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { balance: true },
  });
  return Money.fromString(row.balance.toFixed(4));
}

/** The code of an error reply, or undefined when the body is not one. */
export function errorCode(body: Record<string, unknown>): string | undefined {
  const error = body['error'];
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : undefined;
}

/**
 * Grass cells of a chunk band, found by running the same deterministic generator the world
 * module runs.
 *
 * The world of the harness carries a random negative seed, so no coordinate has a known
 * terrain and a hard coded one would pass or fail depending on the run. The helper is a copy
 * of the one the `land` suite uses and not an import of it: a test directory belongs to the
 * agent of its module, and coupling two suites through a fixture would make one of them fail
 * when the other is rewritten.
 */
export async function findGrassCells(
  harness: Harness,
  world: World,
  count: number,
  chunkY: number,
): Promise<readonly CellCoord[]> {
  const cache = terrainCacheOf(harness.services);
  const wanted = TERRAIN_CODE[TerrainType.GRASS];
  const found: CellCoord[] = [];
  for (let offset = 0; offset < 64 && found.length < count; offset += 1) {
    const chunk = { chunkX: offset, chunkY };
    const bytes = await cache.chunk(world, chunk);
    for (let index = 0; index < bytes.length && found.length < count; index += 1) {
      if (bytes[index] === wanted) {
        found.push(worldFromChunk(chunk, index, world.chunkSize));
      }
    }
  }
  if (found.length < count) {
    throw new Error(`El generador no produjo ${count} celdas de pradera en chunkY=${chunkY}.`);
  }
  return found;
}

/** `POST /api/land/purchase`, which is the canonical discretionary purchase of the contract. */
export async function postPurchase(
  harness: Harness,
  accessToken: string,
  cells: readonly CellCoord[],
): Promise<{ readonly statusCode: number; readonly body: Record<string, unknown> }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/land/purchase',
    headers: { ...bearer(accessToken), 'idempotency-key': `economy-land-${randomUUID()}` },
    payload: { cells, allowPartial: false },
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/**
 * Removes every cell and chunk of the world.
 *
 * `WorldCell.ownerPlayerId` is `onDelete: Restrict`, so the teardown of the harness cannot
 * delete a player that owns land: the cells and their chunks have to go first.
 */
export async function clearGrid(harness: Harness, world: World): Promise<void> {
  await harness.prisma.worldCell.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.chunk.deleteMany({ where: { worldId: world.id } });
}

/**
 * Advances the injected clock and makes the player catch up.
 *
 * It calls `advancePlayerNow` and not an HTTP route on purpose. The applier is the same one
 * every request path uses (plan section 6.3), so the sweep is applied exactly as it would be
 * in production, and the access token of the harness lives fifteen real minutes while these
 * cases move the injected clock by hours: routing the catch up through HTTP would fail with
 * an expired session for a reason that has nothing to do with what is being tested.
 */
export async function advanceAndCatchUp(
  harness: Harness,
  playerId: PlayerId,
  gameHours: number,
): Promise<void> {
  harness.advanceGameHours(gameHours);
  await advancePlayerNow(harness.services, playerId);
}
