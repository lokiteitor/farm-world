// Registration and login.
//
// Owner: workflow W3-A (backend skeleton). Module `auth`.
//
// Registration does four things in one transaction, and the order is the interesting part:
//
//   1. Locks the world row. It is step 1 of the canonical lock order (`lib/tx.ts`) and it is
//      needed for a reason that is easy to miss: the origin of a new player is derived from
//      its index among the players of the world, and two concurrent registrations that both
//      read the same count would be given the same reserved block. Locking the world makes the
//      count stable for the length of the transaction, which is the whole of the serialisation
//      the allocator needs; the allocator itself is pure and reads no other player's row
//      (`shared/world/spawn.ts`).
//   2. Creates the player with a balance of zero.
//   3. Credits the starting capital of GDD section 117 through the ledger, with the key
//      `starting-capital:<playerId>` and the kind `STARTING_CAPITAL`. Not a balance written
//      directly: the ledger is auditable precisely because the sum of its entries equals the
//      balance, and an opening balance with no entry would break that invariant on the first
//      player (plan section 5.3, `backend/prisma/seed.ts`).
//   4. Starts the settlement sweep chain of that player, so the periodic settlement of plan
//      section 6.6 exists from the first hour without a global cron.
//
// The password is hashed with argon2id, which is the default of the library. The cost
// parameters are the defaults as well, deliberately: they are the ones the maintainers tune for
// the current hardware, and inventing our own would be an unjustified guess.

import { hash, verify } from 'argon2';
import { type ServiceContext } from '../../lib/context.js';
import { type ClockReading } from '../../lib/gameClock.js';
import { startingCapitalKey } from '../../lib/ids.js';
import { startSettleSweepChain } from '../../lib/jobs.js';
import { credit } from '../../lib/ledger.js';
import { isUniqueViolation, lockPlayer, lockWorld } from '../../lib/tx.js';
import {
  ApiError,
  STARTING_CAPITAL,
  LedgerType,
  PlayerStatus,
  ValidationCode,
  assignSpawn,
  type PlayerId,
} from '../../shared/index.js';

/** What registration produces, before the tokens are issued. */
export interface RegisteredPlayer {
  readonly playerId: PlayerId;
  readonly reading: ClockReading;
  readonly spawnCellX: number;
  readonly spawnCellY: number;
}

/**
 * Creates an account, its player and its opening entry.
 *
 * The email is stored lowercased, and the uniqueness of the column is over the stored value, so
 * two registrations that differ only in case collide as they should. The check before the insert
 * exists to answer with `EMAIL_ALREADY_REGISTERED` instead of a unique violation; the unique
 * index is what actually guarantees it, and the violation is caught for the concurrent case.
 */
export async function registerPlayer(
  services: ServiceContext,
  input: { readonly email: string; readonly password: string; readonly displayName: string },
): Promise<RegisteredPlayer> {
  const email = input.email.trim().toLowerCase();
  // Hashing is deliberately outside the transaction: argon2 takes tens of milliseconds and
  // holding the world lock for that long would serialise every registration behind it.
  const passwordHash = await hash(input.password);

  return services.transaction(async (tx, outbox) => {
    const reading = await services.clock.read(tx);
    const world = reading.world;
    const worldLock = await lockWorld(tx, world.id);
    if (worldLock === null) {
      throw new ApiError(ValidationCode.NOT_FOUND, { entityKind: 'world' });
    }

    const existing = await tx.player.findUnique({ where: { email }, select: { id: true } });
    if (existing !== null) {
      throw new ApiError(ValidationCode.EMAIL_ALREADY_REGISTERED, { field: 'email' });
    }

    const playerIndex = await tx.player.count({ where: { worldId: world.id } });
    const spawn = assignSpawn(world.seed, playerIndex, { chunkSize: world.chunkSize });
    if (!spawn.meetsMinimum) {
      // Not a refusal: a player with an origin that is smaller than intended is far better
      // than a registration that fails, and the allocator says so rather than pretending.
      services.logger.warn(
        {
          playerIndex,
          contiguousGrassCells: spawn.contiguousGrassCells,
          chunksInspected: spawn.chunksInspected,
        },
        'the spawn allocator settled for a surface below the minimum',
      );
    }

    let created: { readonly id: string };
    try {
      created = await tx.player.create({
        data: {
          worldId: world.id,
          email,
          passwordHash,
          displayName: input.displayName.trim(),
          status: PlayerStatus.ACTIVE,
          balance: '0',
          startedAtGameMs: reading.gameNow,
          lastAccrualGameMs: reading.gameNow,
          lastLoginGameMs: reading.gameNow,
          lastSummaryGameMs: reading.gameNow,
          ledgerSeq: 0,
          eventSeq: 0,
          spawnCellX: spawn.originCell.cellX,
          spawnCellY: spawn.originCell.cellY,
          createdAtRealMs: reading.atRealMs,
        },
        select: { id: true },
      });
    } catch (error) {
      // The unique index on the email is what actually guarantees uniqueness; the check above only
      // exists so the common case answers with a domain code instead of a violation. A module never
      // reads a Prisma error code itself: `lib/tx.ts` translates it, because the ESLint zones keep
      // the generated client out of `src/modules` on purpose.
      if (isUniqueViolation(error)) {
        throw new ApiError(ValidationCode.EMAIL_ALREADY_REGISTERED, { field: 'email' });
      }
      throw error;
    }

    const playerId = created.id as PlayerId;
    const lock = await lockPlayer(tx, playerId);
    if (lock === null) {
      throw new ApiError(ValidationCode.NOT_FOUND, { entityKind: 'player' });
    }

    await credit(tx, lock, {
      type: LedgerType.STARTING_CAPITAL,
      amount: STARTING_CAPITAL,
      atGameMs: reading.gameNow,
      atRealMs: reading.atRealMs,
      idempotencyKey: startingCapitalKey(playerId),
      refType: 'WORLD',
      refId: world.id,
      meta: { gddSection: 117 },
    });
    services.metrics.ledgerEntries.inc({ type: LedgerType.STARTING_CAPITAL });

    await startSettleSweepChain({ tx, outbox, reading, lock });

    services.logger.info(
      {
        playerId,
        playerIndex,
        spawnChunk: `${spawn.chunk.chunkX}:${spawn.chunk.chunkY}`,
        spawnCell: `${spawn.originCell.cellX}:${spawn.originCell.cellY}`,
        withinReservedBlock: spawn.withinReservedBlock,
      },
      'player registered',
    );

    return {
      playerId,
      reading,
      spawnCellX: spawn.originCell.cellX,
      spawnCellY: spawn.originCell.cellY,
    };
  });
}

/** The player behind a set of credentials, or a 401. */
export async function authenticate(
  services: ServiceContext,
  input: { readonly email: string; readonly password: string },
): Promise<{ readonly playerId: PlayerId; readonly sessionCount: number }> {
  const email = input.email.trim().toLowerCase();
  const player = await services.prisma.player.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });
  if (player === null) {
    // The same code and the same message as a wrong password, so the reply does not say
    // whether the address is registered. The cost of the two paths differs, which is a known
    // and accepted limit of not hashing against a dummy value.
    throw new ApiError(ValidationCode.AUTH_INVALID_CREDENTIALS);
  }
  const matches = await verify(player.passwordHash, input.password);
  if (!matches) {
    throw new ApiError(ValidationCode.AUTH_INVALID_CREDENTIALS);
  }
  const sessionCount = await services.prisma.refreshToken.count({
    where: { playerId: player.id },
  });
  return { playerId: player.id as PlayerId, sessionCount };
}

/** Records the login instant of a player, in game time. */
export async function recordLogin(
  services: ServiceContext,
  playerId: PlayerId,
  reading: ClockReading,
): Promise<void> {
  await services.prisma.player.update({
    where: { id: playerId },
    data: { lastLoginGameMs: reading.gameNow },
  });
}
