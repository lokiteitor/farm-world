// Seed of the initial data.
//
// Owner: workflow W2 (data schema). Frozen after W2.
//
// It writes two things and nothing else:
//
//   1. The row of the world, with the seed of the environment, the generator
//      version and the chunk size of shared/config, and the anchor of its clock.
//   2. Behind an explicit development flag, a test player with the starting
//      capital of GDD section 117.
//
// No catalogue is seeded. Crops, machinery, buildings, species and prices are
// constants in `shared/config/` versioned with the code, not rows (plan section
// 5.2): a catalogue in the database would have to be migrated to be retuned, and
// three consumers (backend, frontend and the balance calculator) would read three
// possibly different versions of the same balance number.
//
// The script is idempotent, which matters because two routes reach it: `make seed`
// through `npm run seed`, and `prisma migrate reset`, which runs the command
// declared in `migrations.seed` of backend/prisma.config.ts. Running it twice
// leaves the database exactly as running it once, and it never overwrites what is
// already there: re-seeding a world in use would move its clock anchor, and
// re-seeding a player would erase the progress of whoever was using it.
//
// `Date.now()` appears here on purpose. It is forbidden inside the domain, where
// the clock is read once per request and injected (plan section 6.1), but the seed
// is the point where the world clock is anchored to wall-clock time for the first
// time, so somebody has to read the real clock, and this is that somebody.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  CHUNK_SIZE,
  DEFAULT_GAME_RATE,
  GENERATOR_VERSION,
  INITIAL_ANCHOR_GAME_MS,
  LedgerType,
  Money,
  PlayerStatus,
  STARTING_CAPITAL,
  floorDiv,
} from '../src/shared/index.js';

// The repository keeps a single `.env` at its root, shared by host tooling and the
// compose files. Two routes reach this script and only one of them has already
// loaded it: `prisma migrate reset` runs through prisma.config.ts, which loads it and
// passes it down to the child process, while `make seed` runs `tsx prisma/seed.ts`
// directly and would find no DATABASE_URL at all. It is loaded here with the same
// mechanism and for the same reason as in prisma.config.ts: `process.loadEnvFile` is
// built into Node 22 and, like `--env-file`, never overwrites a variable that is
// already set, which is what makes it safe in CI and inside the containers, where the
// environment arrives from outside and there is no file.
const repositoryEnvFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (existsSync(repositoryEnvFile)) {
  process.loadEnvFile(repositoryEnvFile);
}

/** Development player, created only when this variable is exactly `true`. */
const DEV_PLAYER_FLAG = 'SEED_DEV_PLAYER';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`The environment variable ${name} is required. See .env.example.`);
  }
  return value;
}

function integerEnv(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    if (fallback === undefined) {
      throw new Error(`The environment variable ${name} is required. See .env.example.`);
    }
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`The environment variable ${name} must be an integer: ${raw}`);
  }
  return value;
}

function report(message: string): void {
  console.log(`seed: ${message}`);
}

/**
 * Prisma 7 requires a driver adapter to construct a client: the query engine
 * binary is gone and there is no `datasourceUrl` option any more.
 */
function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Current game instant of a world, with the exact conversion of plan section 6.1.
 * `floorDiv` and not the native division, which truncates towards zero and would
 * break monotonicity for a real instant before the anchor.
 */
function gameMsNow(world: {
  anchorGameMs: bigint;
  anchorRealMs: bigint;
  rateNum: number;
  rateDen: number;
}): bigint {
  const elapsedRealMs = BigInt(Date.now()) - world.anchorRealMs;
  if (elapsedRealMs <= 0n || world.rateNum === 0) {
    return world.anchorGameMs;
  }
  return (
    world.anchorGameMs + floorDiv(elapsedRealMs * BigInt(world.rateNum), BigInt(world.rateDen))
  );
}

async function upsertWorld(
  prisma: PrismaClient,
  seed: number,
  rateNum: number,
  rateDen: number,
): Promise<{
  id: string;
  anchorGameMs: bigint;
  anchorRealMs: bigint;
  rateNum: number;
  rateDen: number;
}> {
  const existing = await prisma.world.findUnique({ where: { seed } });

  if (existing !== null) {
    // The generator version and the chunk size are persisted precisely so that a
    // mismatch is caught instead of silently reinterpreting stored coordinates
    // (plan section 5.1). The seed refuses rather than repairing: repairing would
    // mean rewriting the terrain under land that is already owned.
    if (existing.generatorVersion !== GENERATOR_VERSION) {
      throw new Error(
        `The persisted world was generated with version ${existing.generatorVersion} and ` +
          `shared/config declares ${GENERATOR_VERSION}. A world in use cannot change ` +
          'generator version.',
      );
    }
    if (existing.chunkSize !== CHUNK_SIZE) {
      throw new Error(
        `The persisted world has a chunk size of ${existing.chunkSize} and shared/config ` +
          `declares ${CHUNK_SIZE}. Every stored coordinate depends on it.`,
      );
    }
    if (existing.rateNum !== rateNum || existing.rateDen !== rateDen) {
      // Not an error and not repaired here: changing the multiplier is a domain
      // operation that freezes the past, re-anchors and increments the epoch, and
      // a database trigger rejects any change that does not (plan section 6.1).
      report(
        `the world keeps its rate ${existing.rateNum}/${existing.rateDen}; the environment ` +
          `asks for ${rateNum}/${rateDen}, which is a retime and not a seed`,
      );
    }
    report(`world ${existing.id} already present, seed ${seed}, left untouched`);
    return existing;
  }

  const nowRealMs = BigInt(Date.now());
  const created = await prisma.world.create({
    data: {
      seed,
      generatorVersion: GENERATOR_VERSION,
      chunkSize: CHUNK_SIZE,
      anchorRealMs: nowRealMs,
      anchorGameMs: INITIAL_ANCHOR_GAME_MS,
      rateNum,
      rateDen,
      scheduleEpoch: 0,
      createdAtRealMs: nowRealMs,
    },
  });
  report(
    `world ${created.id} created: seed ${seed}, generator ${GENERATOR_VERSION}, chunk ` +
      `${CHUNK_SIZE}, rate ${rateNum}/${rateDen}, anchor ${INITIAL_ANCHOR_GAME_MS} gameMs`,
  );
  return created;
}

async function ensureDevPlayer(
  prisma: PrismaClient,
  world: {
    id: string;
    anchorGameMs: bigint;
    anchorRealMs: bigint;
    rateNum: number;
    rateDen: number;
  },
): Promise<void> {
  const email = (process.env['SEED_DEV_PLAYER_EMAIL'] ?? 'dev@farm-world.local').toLowerCase();
  const password = process.env['SEED_DEV_PLAYER_PASSWORD'] ?? 'farm-world-dev';

  const existing = await prisma.player.findUnique({ where: { email } });
  if (existing !== null) {
    report(`development player ${email} already present, left untouched`);
    return;
  }

  const passwordHash = await hash(password);
  const startedAtGameMs = gameMsNow(world);
  const nowRealMs = BigInt(Date.now());

  // The starting capital is written as a ledger entry and not only as a balance.
  // The ledger is auditable precisely because the sum of its entries equals the
  // balance (plan section 5.3), and the smoke test of plan section 10 asserts
  // exactly that, so an opening balance with no entry would break the invariant on
  // the first player.
  //
  // The kind is `STARTING_CAPITAL`, added to `LedgerType` and to the PostgreSQL
  // enum by the W2.5 patching window (docs/handoff/NOTES-w2d.md, item 3). The
  // registration path of the authentication module must use the same kind and the
  // same idempotency key, `starting-capital:<playerId>`.
  const capital = Money.toString(STARTING_CAPITAL);

  await prisma.$transaction(async (tx) => {
    const player = await tx.player.create({
      data: {
        worldId: world.id,
        email,
        passwordHash,
        displayName: 'Desarrollo',
        status: PlayerStatus.ACTIVE,
        balance: capital,
        startedAtGameMs,
        lastAccrualGameMs: startedAtGameMs,
        lastLoginGameMs: startedAtGameMs,
        lastSummaryGameMs: startedAtGameMs,
        ledgerSeq: 1,
        eventSeq: 0,
        createdAtRealMs: nowRealMs,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        playerId: player.id,
        seq: 1,
        type: LedgerType.STARTING_CAPITAL,
        amount: capital,
        balanceAfter: capital,
        atGameMs: startedAtGameMs,
        refType: 'WORLD',
        refId: world.id,
        meta: { gddSection: 117 },
        idempotencyKey: `starting-capital:${player.id}`,
        createdAtRealMs: nowRealMs,
      },
    });

    report(
      `development player ${email} created with ${capital} of starting capital ` +
        '(GDD section 117), no land, no farm and no machinery',
    );
  });
}

async function main(): Promise<void> {
  const databaseUrl = requiredEnv('DATABASE_URL');
  const seed = integerEnv('WORLD_SEED');
  const rateNum = integerEnv('GAME_RATE_NUM', DEFAULT_GAME_RATE.rateNum);
  const rateDen = integerEnv('GAME_RATE_DEN', DEFAULT_GAME_RATE.rateDen);

  const prisma = createPrismaClient(databaseUrl);
  try {
    const world = await upsertWorld(prisma, seed, rateNum, rateDen);

    // Two guards, not one: the flag says what is wanted and `NODE_ENV` says where
    // it is wanted. A test account with 160 000 of capital and a known password is
    // a credential, and a credential must not be creatable in production by
    // setting one variable.
    if (process.env[DEV_PLAYER_FLAG] !== 'true') {
      report(`development player not requested (${DEV_PLAYER_FLAG} is not "true")`);
    } else if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        `${DEV_PLAYER_FLAG} is not honoured with NODE_ENV=production: the development ` +
          'player has a known password.',
      );
    } else {
      await ensureDevPlayer(prisma, world);
    }
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error('seed: failed');
  console.error(error);
  process.exitCode = 1;
}
