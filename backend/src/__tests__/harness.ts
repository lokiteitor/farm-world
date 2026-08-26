// The harness of the integration suite: an isolated world on the real PostgreSQL and Redis.
//
// Owner: workflow W3-A (backend skeleton).
//
// Isolation without a database of its own. The suite runs against the PostgreSQL and the Redis
// that `make up` leaves running, and it may not create a schema or apply a migration, which is
// what the parallel execution rules of the plan forbid to an agent (`docs/ownership.md`, rule 5).
// What it does instead is stronger than a shared schema and cheaper than a container:
//
//   - Its own `World` row, with a random negative seed. `World.seed` is unique, so two runs and
//     the seeded development world cannot collide, and every player of the run belongs to it.
//   - Its own Redis key prefix and its own BullMQ prefix, both carrying the identifier of the run,
//     so the ring, the tickets, the channels and the queue of one run are invisible to another.
//   - A teardown that deletes exactly what it created: the players, which cascade into the ledger,
//     the outbox and the event log, then the world and its time segments, then the Redis keys of
//     the prefix.
//
// So two agents can run their suites at the same time on one machine, which is what plan section
// 10 asks for, and neither of them touches the development data.
//
// The clock is injected. `now()` returns a fixed real instant that the test moves by hand, so a
// window of six game hours is exactly six game hours and no assertion depends on how long the
// suite took to run.

import { randomUUID } from 'node:crypto';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { buildApp } from '../app.js';
import { type PrismaClient } from '../generated/prisma/client.js';
import { registerDomainHandlers } from '../handlers.js';
import { createServiceContext, type ServiceContext } from '../lib/context.js';
import { createDomainQueue, type DomainQueue } from '../lib/queue.js';
import { loadConfig, loadRepositoryEnvFile, type AppConfig } from '../plugins/config.js';
import { createMetrics } from '../plugins/metrics.js';
import { createPrismaClient } from '../plugins/prisma.js';
import {
  closeRedisConnections,
  createRedisConnections,
  type RedisConnections,
} from '../plugins/redis.js';
import {
  CHUNK_SIZE,
  GENERATOR_VERSION,
  INITIAL_ANCHOR_GAME_MS,
  MS_PER_GAME_HOUR,
  gameMs as toGameMsValue,
  realMs as toRealMsValue,
  type GameMs,
  type PlayerId,
  type RealMs,
  type StockItem,
  type StorageResource,
  type WorldId,
} from '../shared/index.js';

/** Multiplier of the test world: one game hour per real hour, so real time is irrelevant. */
const TEST_RATE = { rateNum: 1, rateDen: 1 } as const;

/** The real instant the fixed clock starts at. Any value works; a round one reads better. */
const BASE_REAL_MS = 1_800_000_000_000n;

export interface Harness {
  readonly config: AppConfig;
  readonly prisma: PrismaClient;
  readonly redis: RedisConnections;
  readonly queue: DomainQueue;
  readonly services: ServiceContext;
  readonly app: FastifyInstance;
  readonly worldId: WorldId;
  readonly worldSeed: number;
  readonly runId: string;
  /** The instant the injected clock reports. Moved with `advanceRealMs`. */
  nowRealMs(): RealMs;
  /** Moves the injected clock forward by whole game hours. */
  advanceGameHours(hours: number): void;
  /** The game instant the injected clock currently maps to. */
  gameNow(): GameMs;
  /** Registers a player id so the teardown deletes it. */
  track(playerId: PlayerId): void;
  /** An email that cannot collide with another run or with the development player. */
  email(label: string): string;
  teardown(): Promise<void>;
}

/** Builds the harness. One per test file, in `beforeAll`. */
export async function createHarness(): Promise<Harness> {
  loadRepositoryEnvFile();
  const runId = randomUUID().slice(0, 8);
  // A negative seed keeps the run away from the development world of `.env` and from any world a
  // human would seed by hand.
  const worldSeed = -(1_000_000 + Math.floor(Math.random() * 1_000_000));

  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    WORLD_SEED: String(worldSeed),
    // The suite exercises the development routes, which is the only way to reach a retiming and a
    // forced balance (plan section 12).
    DEV_ENDPOINTS: 'true',
    GAME_RATE_NUM: String(TEST_RATE.rateNum),
    GAME_RATE_DEN: String(TEST_RATE.rateDen),
    // Silent by default, because a suite that prints one line per request buries the failure
    // that matters. `TEST_LOG_LEVEL=debug` brings it back when something has to be diagnosed.
    LOG_LEVEL: process.env['TEST_LOG_LEVEL'] ?? 'silent',
  });

  const logger = pino({ level: config.logLevel });
  const metrics = createMetrics('server');
  const prisma = createPrismaClient(config, logger);
  const redis = createRedisConnections(config, logger);
  const queue = createDomainQueue(config, logger, { prefix: `farm-world-test:${runId}:bull` });

  let offsetRealMs = 0n;
  const now = (): RealMs => toRealMsValue(BASE_REAL_MS + offsetRealMs);

  const world = await prisma.world.create({
    data: {
      seed: worldSeed,
      generatorVersion: GENERATOR_VERSION,
      chunkSize: CHUNK_SIZE,
      anchorRealMs: BASE_REAL_MS,
      anchorGameMs: INITIAL_ANCHOR_GAME_MS,
      rateNum: TEST_RATE.rateNum,
      rateDen: TEST_RATE.rateDen,
      scheduleEpoch: 0,
      createdAtRealMs: BASE_REAL_MS,
    },
    select: { id: true },
  });

  const services = createServiceContext({
    role: 'server',
    config,
    logger,
    prisma,
    redis,
    queue,
    metrics,
    keyPrefix: `farm-world-test:${runId}`,
    now,
  });
  registerDomainHandlers(services);

  const app = await buildApp({ services, startedAtRealMs: BASE_REAL_MS });
  const tracked = new Set<string>();

  return {
    config,
    prisma,
    redis,
    queue,
    services,
    app,
    worldId: world.id as WorldId,
    worldSeed,
    runId,
    nowRealMs: now,
    advanceGameHours(hours: number): void {
      // The test rate is one to one, so a game hour is a real hour of the injected clock.
      offsetRealMs += BigInt(hours) * MS_PER_GAME_HOUR;
    },
    gameNow(): GameMs {
      return toGameMsValue(INITIAL_ANCHOR_GAME_MS + offsetRealMs);
    },
    track(playerId: PlayerId): void {
      tracked.add(playerId);
    },
    email(label: string): string {
      return `w3a-${runId}-${label}@test.invalid`;
    },
    async teardown(): Promise<void> {
      await app.close();
      // The players cascade into the ledger, the outbox, the event log and the idempotency
      // records, which is why nothing else has to be deleted by hand.
      for (const playerId of tracked) {
        await prisma.player.deleteMany({ where: { id: playerId } });
      }
      await prisma.player.deleteMany({ where: { worldId: world.id } });
      await prisma.worldTimeSegment.deleteMany({ where: { worldId: world.id } });
      await prisma.world.deleteMany({ where: { id: world.id } });
      const keys = await redis.commands.keys(`farm-world-test:${runId}*`);
      if (keys.length > 0) {
        await redis.commands.del(...keys);
      }
      await queue.close();
      await closeRedisConnections(redis);
      await prisma.$disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Creates a player through the HTTP surface, which is the path the client uses. */
export async function registerViaHttp(
  harness: Harness,
  label: string,
): Promise<{
  readonly playerId: PlayerId;
  readonly accessToken: string;
  readonly refreshCookie: string;
  readonly body: Record<string, unknown>;
}> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: harness.email(label),
      password: 'contrasena-de-prueba',
      displayName: `Prueba ${label}`,
    },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Registration failed with ${response.statusCode}: ${response.body}`);
  }
  const body = response.json<Record<string, unknown>>();
  const playerId = body['playerId'] as PlayerId;
  harness.track(playerId);
  const setCookie = response.headers['set-cookie'];
  const refreshCookie = Array.isArray(setCookie) ? (setCookie[0] ?? '') : (setCookie ?? '');
  return {
    playerId,
    accessToken: body['accessToken'] as string,
    refreshCookie: String(refreshCookie).split(';')[0] ?? '',
    body,
  };
}

/** The header a request of an authenticated route carries. */
export function bearer(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

/**
 * A farm with a worker home and, optionally, a garage. The minimum needed for the accrual
 * fixtures: a worker requires a farm and a home (GDD section 108), and a machine requires a farm.
 */
export async function createFarmFixture(
  harness: Harness,
  playerId: PlayerId,
  atGameMs: GameMs,
): Promise<{ readonly farmId: string; readonly homeId: string; readonly garageId: string }> {
  const farm = await harness.prisma.farm.create({
    data: { playerId, name: 'Granja de prueba', createdAtGameMs: atGameMs },
    select: { id: true },
  });
  const home = await harness.prisma.building.create({
    data: {
      farmId: farm.id,
      playerId,
      type: 'WORKER_HOME',
      originCellX: 0,
      originCellY: 0,
      widthCells: 2,
      heightCells: 2,
      purchasePrice: '0',
      capacityMachines: 0,
      capacityWorkers: 8,
      capacityStorageUnits: 0,
      storageResource: null,
      builtAtGameMs: atGameMs,
    },
    select: { id: true },
  });
  const garage = await harness.prisma.building.create({
    data: {
      farmId: farm.id,
      playerId,
      type: 'GARAGE',
      originCellX: 4,
      originCellY: 0,
      widthCells: 2,
      heightCells: 2,
      purchasePrice: '0',
      capacityMachines: 4,
      capacityWorkers: 0,
      capacityStorageUnits: 0,
      storageResource: null,
      builtAtGameMs: atGameMs,
    },
    select: { id: true },
  });
  return { farmId: farm.id, homeId: home.id, garageId: garage.id };
}

/**
 * Pone existencias en una granja, en la pila del bien que se indique.
 *
 * Escribe sobre `farm_stock` y deja que el trigger `farm_stock_storage_totals` lleve el
 * total a `farm_storage`, que es como escribe el propio servidor: una prueba que tocase el
 * agregado a mano estaria comprobando un estado que la aplicacion no puede producir.
 *
 * Existe aqui y no repetido en cada fichero de fixtures porque antes eran diez sitios
 * escribiendo columnas de la granja, y el siguiente cambio del almacen tendria que
 * encontrarlos todos otra vez.
 */
export async function seedStock(
  harness: Harness,
  farmId: string,
  item: StockItem,
  units: number,
  reservedUnits = 0,
): Promise<void> {
  await harness.prisma.farmStock.upsert({
    where: { farmId_item: { farmId, item } },
    create: { farmId, item, storedUnits: units, reservedUnits },
    update: { storedUnits: units, reservedUnits },
  });
}

/** Vacia las existencias de las granjas de unos jugadores. Para el desmontaje. */
export async function clearStock(harness: Harness, playerIds: readonly PlayerId[]): Promise<void> {
  await harness.prisma.farmStock.deleteMany({
    where: { farm: { playerId: { in: [...playerIds] } } },
  });
}

/** Las existencias de una pila, como la base de datos las tiene. */
export async function readStock(
  harness: Harness,
  farmId: string,
  item: StockItem,
): Promise<{ storedUnits: number; reservedUnits: number }> {
  const row = await harness.prisma.farmStock.findUnique({
    where: { farmId_item: { farmId, item } },
    select: { storedUnits: true, reservedUnits: true },
  });
  return row ?? { storedUnits: 0, reservedUnits: 0 };
}

/** La ocupacion de una categoria, que es lo que lleva la capacidad y el CHECK. */
export async function readStorage(
  harness: Harness,
  farmId: string,
  category: StorageResource,
): Promise<{ storedUnits: number; reservedUnits: number; capacityUnits: number }> {
  const row = await harness.prisma.farmStorage.findUnique({
    where: { farmId_category: { farmId, category } },
    select: { storedUnits: true, reservedUnits: true, capacityUnits: true },
  });
  return row ?? { storedUnits: 0, reservedUnits: 0, capacityUnits: 0 };
}
