// Fixtures shared by the suites of the `session` module.
//
// Owner: workflow W6-B. Module `session`.
//
// Not a suite: it holds no `it`, and `backend/vitest.int.config.ts` only collects
// `*.int.test.ts`, so it is never executed on its own.
//
// Three things it does that are worth stating.
//
// The assets are written straight through Prisma rather than through the routes that would
// normally create them. Assigning a task belongs to `modules/tasks` (W6-A) and creating a forest
// plot to `modules/forestry` (W6-C), and both are siblings of this phase that do not exist while
// this module is written, so a fixture that went through them would be a fixture that could not
// run. What is being tested — the interval, the aggregation, the mark and the replay — is still
// exercised through the real path, and so is everything the accrual engine does with the rows.
//
// The access token has to be reissued after moving the clock. `verifyAccessToken` is checked
// against the injected clock (`plugins/auth.ts`), so an absence of four hundred game hours
// expires the session exactly as four hundred real hours would. `signIn` is therefore not a
// convenience: reissuing the token is what a returning player's browser does, and it is also
// the reload that must not erase the summary, because the login mark and the summary mark are
// different columns.
//
// And the arithmetic is kept exact. Every interval of these fixtures falls on a whole game hour,
// so every settlement of `lib/accrual.ts` is an exact multiple of a per hour rate and an
// assertion about a total is an assertion about the summary and not about rounding.

import { expect } from 'vitest';
import { advancePlayerNow } from '../../lib/advancePlayer.js';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  CHUNK_SIZE,
  CropCycleState,
  LandUse,
  MACHINE_CATALOGUE,
  MachineStatus,
  Money,
  TaskOperation,
  TaskStatus,
  TerrainType,
  TreeSpecies,
  TreeStatus,
  WorkerStatus,
  gameMs as toGameMsValue,
  type CropId,
  type GameMs,
  type MachineType,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, registerViaHttp, type Harness } from '../harness.js';

/** Password every fixture player registers with, so `signIn` can reissue a token. */
export const FIXTURE_PASSWORD = 'contrasena-de-prueba';

/** Cell band of this module, so its fixtures cannot collide with another suite. */
export const CELL_BAND_ORIGIN = { x: 960_000, y: 960_000 } as const;

export interface SessionPlayer {
  readonly playerId: PlayerId;
  readonly email: string;
  readonly accessToken: string;
  readonly farmId: string;
  readonly siloId: string;
  readonly homeId: string;
  readonly garageId: string;
  readonly startedAtGameMs: GameMs;
}

/**
 * Registers a player and gives it a farm with a silo, a garage and a worker home.
 *
 * The capacities of the farm are not written here: the trigger over the storage buildings
 * recomputes them, which is the division of labour of ADR-0018.
 */
export async function createSessionPlayer(harness: Harness, label: string): Promise<SessionPlayer> {
  const registered = await registerViaHttp(harness, label);
  const row = await harness.prisma.player.findUniqueOrThrow({
    where: { id: registered.playerId },
    select: { startedAtGameMs: true, email: true },
  });
  const startedAtGameMs = toGameMsValue(row.startedAtGameMs);

  const farm = await harness.prisma.farm.create({
    data: {
      playerId: registered.playerId,
      name: `Granja ${label}`,
      createdAtGameMs: startedAtGameMs,
    },
    select: { id: true },
  });

  const silo = await createBuilding(
    harness,
    registered.playerId,
    farm.id,
    'SILO',
    startedAtGameMs,
    0,
  );
  const garage = await createBuilding(
    harness,
    registered.playerId,
    farm.id,
    'GARAGE',
    startedAtGameMs,
    1,
  );
  const home = await createBuilding(
    harness,
    registered.playerId,
    farm.id,
    'WORKER_HOME',
    startedAtGameMs,
    2,
  );
  return {
    playerId: registered.playerId,
    email: row.email,
    accessToken: registered.accessToken,
    farmId: farm.id,
    siloId: silo,
    homeId: home,
    garageId: garage,
    startedAtGameMs,
  };
}

/** A building at its catalogue capacity, placed in the band of this suite. */
async function createBuilding(
  harness: Harness,
  playerId: PlayerId,
  farmId: string,
  type: 'SILO' | 'GARAGE' | 'WORKER_HOME',
  atGameMs: GameMs,
  slot: number,
): Promise<string> {
  const definition = BUILDING_CATALOGUE[BuildingType[type]];
  const capacity = definition.capacity ?? 0;
  const building = await harness.prisma.building.create({
    data: {
      farmId,
      playerId,
      type: BuildingType[type],
      originCellX: CELL_BAND_ORIGIN.x + slot * 20,
      originCellY: CELL_BAND_ORIGIN.y,
      widthCells: definition.widthCells,
      heightCells: definition.heightCells,
      purchasePrice: Money.toString(definition.purchasePrice),
      capacityMachines: definition.capacityKind === 'MACHINES' ? capacity : 0,
      capacityWorkers: definition.capacityKind === 'WORKERS' ? capacity : 0,
      capacityStorageUnits: definition.capacityKind === 'STORAGE' ? capacity : 0,
      storageResource: definition.capacityKind === 'STORAGE' ? definition.capacityResource : null,
      builtAtGameMs: atGameMs,
    },
    select: { id: true },
  });
  return building.id;
}

/** A worker earning a fixed salary per game hour, hired at the start of the player. */
export async function createWorker(
  harness: Harness,
  player: SessionPlayer,
  name: string,
  salaryPerGameHour: Money,
): Promise<string> {
  const worker = await harness.prisma.worker.create({
    data: {
      playerId: player.playerId,
      farmId: player.farmId,
      homeId: player.homeId,
      name,
      skillBp: 5_000,
      salaryPerGameHour: Money.toString(salaryPerGameHour),
      status: WorkerStatus.IDLE,
      hiredGameMs: player.startedAtGameMs,
    },
    select: { id: true },
  });
  return worker.id;
}

/** An idle machine of a type, acquired at the start of the player and at full condition. */
export async function createMachine(
  harness: Harness,
  player: SessionPlayer,
  type: MachineType,
): Promise<string> {
  const machine = await harness.prisma.machine.create({
    data: {
      playerId: player.playerId,
      farmId: player.farmId,
      garageId: player.garageId,
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

/**
 * A task that already ran, with its interval written by hand.
 *
 * This is the one fixture that would normally come from `modules/tasks`. What matters to the
 * accrual engine and to the summary is only the interval and the machines, which is exactly what
 * `TaskCostSource` of `shared/rules/holding.ts` reads.
 */
export async function createClosedTask(
  harness: Harness,
  player: SessionPlayer,
  input: {
    readonly workerId: string;
    readonly machineIds: readonly string[];
    readonly startGameMs: GameMs;
    readonly endGameMs: GameMs;
    readonly status?: TaskStatus;
    readonly targetFieldId?: string;
    readonly reservedStorageUnits?: number;
  },
): Promise<string> {
  const status = input.status ?? TaskStatus.COMPLETED;
  const task = await harness.prisma.task.create({
    data: {
      playerId: player.playerId,
      workerId: input.workerId,
      operation: TaskOperation.PLOW,
      status,
      ...(input.targetFieldId === undefined ? {} : { targetFieldId: input.targetFieldId }),
      unitsAtStart: 250,
      effectiveWorkSpeedMilli: 1_000,
      ...(input.reservedStorageUnits === undefined
        ? {}
        : { reservedStorageUnits: input.reservedStorageUnits }),
      startGameMs: input.startGameMs,
      scheduledEndGameMs: input.endGameMs,
      endedGameMs: input.endGameMs,
      cancelable: false,
      machines: {
        create: input.machineIds.map((machineId, index) => ({
          machineId,
          role: index === 0 ? 'POWERED' : 'IMPLEMENT',
        })),
      },
    },
    select: { id: true },
  });
  return task.id;
}

/** A task still in flight, which is what the snapshot has to carry. */
export async function createRunningTask(
  harness: Harness,
  player: SessionPlayer,
  input: {
    readonly workerId: string;
    readonly machineIds: readonly string[];
    readonly startGameMs: GameMs;
    readonly scheduledEndGameMs: GameMs;
    readonly targetFieldId?: string;
  },
): Promise<string> {
  const task = await harness.prisma.task.create({
    data: {
      playerId: player.playerId,
      workerId: input.workerId,
      operation: TaskOperation.PLOW,
      status: TaskStatus.IN_PROGRESS,
      ...(input.targetFieldId === undefined ? {} : { targetFieldId: input.targetFieldId }),
      unitsAtStart: 250,
      effectiveWorkSpeedMilli: 1_000,
      startGameMs: input.startGameMs,
      scheduledEndGameMs: input.scheduledEndGameMs,
      cancelable: true,
      machines: {
        create: input.machineIds.map((machineId, index) => ({
          machineId,
          role: index === 0 ? 'POWERED' : 'IMPLEMENT',
        })),
      },
    },
    select: { id: true },
  });
  return task.id;
}

/**
 * A field with a growth timeline, and optionally with its cells.
 *
 * The cells are written only where a case needs them, because they are what makes the snapshot
 * big and only the size measurement cares. A field with `cellCount` and no cell row is still a
 * complete field for every projection: the geometry lives on the cell and the arithmetic lives
 * on the count (ADR-0025).
 */
export async function createField(
  harness: Harness,
  player: SessionPlayer,
  input: {
    readonly name: string;
    readonly cellCount: number;
    readonly cropId?: CropId;
    readonly cropCycleState?: CropCycleState;
    readonly seededAtGameMs?: GameMs;
  },
): Promise<string> {
  const at = player.startedAtGameMs;
  const field = await harness.prisma.field.create({
    data: {
      playerId: player.playerId,
      farmId: player.farmId,
      name: input.name,
      cellCount: input.cellCount,
      ...(input.cropId === undefined ? {} : { cropId: input.cropId }),
      cropCycleState: input.cropCycleState ?? CropCycleState.VIRGIN,
      fertilityUpdatedAtGameMs: at,
      weedLevelUpdatedAtGameMs: at,
      fertilizationUpdatedAtGameMs: at,
      stateEnteredAtGameMs: input.seededAtGameMs ?? at,
      ...(input.seededAtGameMs === undefined ? {} : { seededAtGameMs: input.seededAtGameMs }),
      createdAtGameMs: at,
    },
    select: { id: true },
  });
  return field.id;
}

/**
 * A forest plot with `treeCount` standing pines, planted a given age ago.
 *
 * The trees carry no cell row on purpose: `Tree` addresses its cell by absolute coordinates and
 * not by a foreign key, precisely because a tree can stand on a generated forest cell that was
 * never modified (schema.prisma, `Tree`).
 */
export async function createForestPlot(
  harness: Harness,
  world: World,
  player: SessionPlayer,
  input: {
    readonly name: string;
    readonly cellCount: number;
    readonly treeCount: number;
    readonly plantedAtGameMs: GameMs;
  },
): Promise<string> {
  const plot = await harness.prisma.forestPlot.create({
    data: {
      playerId: player.playerId,
      farmId: player.farmId,
      name: input.name,
      cellCount: input.cellCount,
      createdAtGameMs: player.startedAtGameMs,
    },
    select: { id: true },
  });
  if (input.treeCount > 0) {
    await harness.prisma.tree.createMany({
      data: Array.from({ length: input.treeCount }, (_unused, index) => ({
        forestPlotId: plot.id,
        playerId: player.playerId,
        worldId: world.id,
        cellX: CELL_BAND_ORIGIN.x + index,
        cellY: CELL_BAND_ORIGIN.y + 100,
        species: TreeSpecies.PINE,
        plantedAtGameMs: input.plantedAtGameMs,
        status: TreeStatus.STANDING,
        naturallyGenerated: true,
      })),
    });
  }
  return plot.id;
}

/**
 * Writes `count` cells belonging to a field, in the band of this suite.
 *
 * The chunk row has to exist first, because the cell reaches the world through it; the cells are
 * inserted in one statement per chunk, which is what keeps a five thousand cell fixture from
 * taking longer than the case it feeds.
 */
export async function attachCells(
  harness: Harness,
  world: World,
  player: SessionPlayer,
  fieldId: string,
  firstCellIndex: number,
  count: number,
): Promise<void> {
  const rows: {
    worldId: string;
    chunkX: number;
    chunkY: number;
    idx: number;
    cellX: number;
    cellY: number;
    generatedTerrain: TerrainType;
    ownerPlayerId: string;
    landUse: LandUse;
    fieldId: string;
    updatedAtRealMs: bigint;
  }[] = [];
  const baseChunkX = Math.floor(CELL_BAND_ORIGIN.x / CHUNK_SIZE);
  const baseChunkY = Math.floor(CELL_BAND_ORIGIN.y / CHUNK_SIZE);
  const chunks = new Set<string>();

  for (let offset = 0; offset < count; offset += 1) {
    const linear = firstCellIndex + offset;
    const chunkOffset = Math.floor(linear / (CHUNK_SIZE * CHUNK_SIZE));
    const idx = linear % (CHUNK_SIZE * CHUNK_SIZE);
    const chunkX = baseChunkX + chunkOffset;
    const chunkY = baseChunkY;
    chunks.add(`${chunkX}:${chunkY}`);
    rows.push({
      worldId: world.id,
      chunkX,
      chunkY,
      idx,
      cellX: chunkX * CHUNK_SIZE + (idx % CHUNK_SIZE),
      cellY: chunkY * CHUNK_SIZE + Math.floor(idx / CHUNK_SIZE),
      generatedTerrain: TerrainType.GRASS,
      ownerPlayerId: player.playerId,
      landUse: LandUse.FIELD,
      fieldId,
      updatedAtRealMs: harness.nowRealMs() as bigint,
    });
  }

  for (const key of chunks) {
    const parts = key.split(':');
    const chunkX = Number(parts[0]);
    const chunkY = Number(parts[1]);
    await harness.prisma.chunk.upsert({
      where: { worldId_chunkX_chunkY: { worldId: world.id, chunkX, chunkY } },
      update: {},
      create: {
        worldId: world.id,
        chunkX,
        chunkY,
        version: 1,
        updatedAtRealMs: harness.nowRealMs() as bigint,
      },
    });
  }
  await harness.prisma.worldCell.createMany({ data: rows, skipDuplicates: true });
}

/**
 * Removes everything the teardown of the harness cannot remove on its own.
 *
 * The harness deletes the players and lets the cascade do the rest, which works for every row
 * whose foreign key is `onDelete: Cascade`. Four are not, on purpose (schema.prisma): a cell
 * restricts its owner, its field and its plot, so that land is never lost silently; a
 * `task_machines` row restricts its machine, so that the audit of a past task survives the sale
 * of the machine it used; and a tree restricts its plot. So they are removed here, in the order
 * the constraints impose, and the cascade takes it from there.
 *
 * It is called by every suite of this module because every suite of this module creates at least
 * one of them.
 */
export async function clearDomain(harness: Harness, world: World): Promise<void> {
  const players = await harness.prisma.player.findMany({
    where: { worldId: world.id },
    select: { id: true },
  });
  const playerIds = players.map((player) => player.id);
  await harness.prisma.worldCell.deleteMany({ where: { worldId: world.id } });
  await harness.prisma.chunk.deleteMany({ where: { worldId: world.id } });
  if (playerIds.length === 0) {
    return;
  }
  await harness.prisma.taskMachine.deleteMany({
    where: { task: { playerId: { in: playerIds } } },
  });
  await harness.prisma.task.deleteMany({ where: { playerId: { in: playerIds } } });
  await harness.prisma.tree.deleteMany({ where: { playerId: { in: playerIds } } });
  await harness.prisma.forestPlot.deleteMany({ where: { playerId: { in: playerIds } } });
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

/** The raw body of a GET, so a case can measure the size of a reply on the wire. */
export async function getRaw(
  harness: Harness,
  accessToken: string,
  url: string,
): Promise<{ readonly statusCode: number; readonly body: string }> {
  const response = await harness.app.inject({ method: 'GET', url, headers: bearer(accessToken) });
  return { statusCode: response.statusCode, body: response.body };
}

/** A POST of an authenticated route. */
export async function postJson(
  harness: Harness,
  accessToken: string,
  url: string,
  payload: Record<string, unknown>,
): Promise<{ readonly statusCode: number; readonly body: Record<string, unknown> }> {
  const response = await harness.app.inject({
    method: 'POST',
    url,
    headers: bearer(accessToken),
    payload,
  });
  return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/**
 * Signs in again and returns a fresh access token, which is what a returning browser does.
 *
 * It is also the reload the summary has to survive: `POST /api/auth/login` moves
 * `lastLoginGameMs` and never `lastSummaryGameMs` (`modules/auth/service.ts`).
 */
export async function signIn(harness: Harness, email: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: FIXTURE_PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ accessToken: string }>().accessToken;
}

/**
 * Moves the injected clock and makes the player catch up.
 *
 * It calls `advancePlayerNow` and not an HTTP route on purpose: the applier is the same one
 * every request path uses (plan section 6.3), and the access token of the harness would have
 * expired against the very clock the case is moving.
 */
export async function advanceAndCatchUp(
  harness: Harness,
  playerId: PlayerId,
  gameHours: number,
): Promise<void> {
  harness.advanceGameHours(gameHours);
  await advancePlayerNow(harness.services, playerId);
}

/** The settled balance of a player, read from the column. */
export async function balanceOf(harness: Harness, playerId: PlayerId): Promise<Money> {
  const row = await harness.prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { balance: true },
  });
  return Money.fromString(row.balance.toFixed(4));
}

/** The summary mark of a player, read from the column. */
export async function summaryMarkOf(harness: Harness, playerId: PlayerId): Promise<bigint> {
  const row = await harness.prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { lastSummaryGameMs: true },
  });
  return row.lastSummaryGameMs;
}
