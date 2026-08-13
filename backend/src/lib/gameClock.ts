// The game clock: read once per request or job, propagated as context.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Invariant 1 of plan section 6.1. The arithmetic itself lives in
// `shared/rules/clock.ts` and is pure; what lives here is everything that touches the
// database or the host clock:
//
//   - Reading the anchor of the world exactly once per request or job and propagating
//     the resulting instant as context. No domain code calls `Date.now`, and the
//     ESLint zone of `backend/src/modules` enforces it; this module and the rest of
//     `lib` are the documented exception, and even here the real clock is injected so
//     that the tests do not depend on the host.
//   - `retimeWorld`, which is a domain operation and not a configuration update: it
//     freezes the past under the previous multiplier, re-anchors, increments
//     `scheduleEpoch` and records the segment. A database trigger rejects any change
//     of rate that does not do all three (`farm_world_guard_world_retime`).
//   - The start-up check, which aborts when the persisted generator version or chunk
//     size no longer match the constants of `shared/config`, and re-anchors when the
//     configured multiplier differs from the persisted one.
//   - Protection against a backwards jump of the host clock. The anchor is a linear
//     function of real time, so if the host steps back, `gameMsAt` steps back with it
//     and a due guard would fire twice for the same event. The service therefore never
//     returns a value below the highest it has already returned for that world.
//
// Why the anchor is not cached. A stale anchor gives a wrong game instant after a
// retiming, and "wrong" here means either an event that fires early or a clock that
// appears to rewind. The read is a single primary key select, so the correct thing is
// also the cheap thing. What is cached is the identifier of the world, which is
// immutable for a seed.

import { type PrismaClient } from '../generated/prisma/client.js';
import {
  CHUNK_SIZE,
  GENERATOR_VERSION,
  gameMsAt,
  isPaused,
  realMs,
  realMsFor,
  reanchor,
  type ClockRate,
  type GameMs,
  type RealMs,
  type Reanchoring,
  type World,
  type WorldId,
} from '../shared/index.js';
import { toWorld } from './dbMap.js';
import { lockWorld, withPlainTransaction, type Db, type Tx } from './tx.js';

/** The source of real time. Injected so that a test can fix it. */
export type NowFn = () => RealMs;

/** The real clock of the host. The only reader of `Date.now` in the backend. */
export const systemNow: NowFn = () => realMs(BigInt(Date.now()));

/** A logger with the two levels this module uses. */
export interface ClockLogger {
  warn(object: Record<string, unknown>, message: string): void;
  info(object: Record<string, unknown>, message: string): void;
}

/**
 * One reading of the clock: the world, the real instant it was read at and the game
 * instant that follows. Everything downstream takes this and never reads a clock again,
 * which is what makes a request internally consistent even if it lasts a second.
 */
export interface ClockReading {
  readonly world: World;
  readonly atRealMs: RealMs;
  readonly gameNow: GameMs;
  /** True when `rateNum` is zero, which is a paused world (plan section 6.1). */
  readonly paused: boolean;
}

/** Result of a retiming, with what the caller needs in order to reschedule. */
export interface RetimeResult {
  readonly reading: ClockReading;
  readonly previousRate: ClockRate;
  readonly reanchoring: Reanchoring;
  /** Sequence of the `WorldTimeSegment` row that froze the past. */
  readonly segmentSeq: number;
}

/** What the start-up check found and did. */
export interface StartupCheck {
  readonly reading: ClockReading;
  /** True when the configured multiplier differed and the clock was re-anchored. */
  readonly retimed: boolean;
  /** True when it differed and the re-anchoring was not authorised, so nothing changed. */
  readonly rateMismatchIgnored: boolean;
}

/** How the start-up check treats a multiplier that differs from the persisted one. */
export interface StartupOptions {
  /**
   * Whether the process is authorised to re-anchor the world from its own configuration.
   *
   * False by default, and that default is the decision of point 3 of ADR-0007: changing the
   * multiplier is a domain operation, `retimeWorld`, and not a configuration update. With it
   * true on every boot, a `POST /api/dev/retime` did not survive a restart and two processes
   * with different environments — the server and the worker, deployed apart — took the world
   * from each other on every start, silently and without an operator asking for it.
   */
  readonly applyRateFromConfig: boolean;
}

/** A mismatch between the persisted world and the constants of `shared/config`. */
export class WorldConstantsMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldConstantsMismatchError';
  }
}

/** The world row was not found for the configured seed. */
export class WorldNotSeededError extends Error {
  constructor(seed: number) {
    super(
      `No existe el mundo de la semilla ${seed}. Ejecutar 'make migrate && make seed' antes de arrancar.`,
    );
    this.name = 'WorldNotSeededError';
  }
}

export class GameClockService {
  private readonly prisma: PrismaClient;
  private readonly seed: number;
  private readonly now: NowFn;
  private readonly logger: ClockLogger;

  /** Immutable for a seed, so it is resolved once and reused as a primary key. */
  private worldId: WorldId | null = null;

  /**
   * Highest game instant already handed out, per world. The floor that makes the
   * service monotone even if the host clock steps back. It is per process, which is
   * the honest scope: it protects the process that observed the jump, and a second
   * process reads the same anchor and reaches the same value anyway unless its own
   * host clock also jumped.
   */
  private readonly highWaterMark = new Map<string, bigint>();

  constructor(options: {
    readonly prisma: PrismaClient;
    readonly worldSeed: number;
    readonly logger: ClockLogger;
    readonly now?: NowFn;
  }) {
    this.prisma = options.prisma;
    this.seed = options.worldSeed;
    this.logger = options.logger;
    this.now = options.now ?? systemNow;
  }

  /** The identifier of the world of this deployment, resolved from the seed once. */
  async resolveWorldId(db: Db = this.prisma): Promise<WorldId> {
    if (this.worldId !== null) {
      return this.worldId;
    }
    const row = await db.world.findUnique({ where: { seed: this.seed }, select: { id: true } });
    if (row === null) {
      throw new WorldNotSeededError(this.seed);
    }
    this.worldId = row.id as WorldId;
    return this.worldId;
  }

  /**
   * Reads the clock. One select of the world row, then pure arithmetic.
   *
   * `db` is a parameter so that a caller already inside a transaction reads the anchor
   * of that transaction, which matters for a retiming: the code that reschedules the
   * horizon must see the new anchor and not the one that was committed before it.
   */
  async read(db: Db = this.prisma): Promise<ClockReading> {
    const row = await db.world.findUnique({ where: { seed: this.seed } });
    if (row === null) {
      throw new WorldNotSeededError(this.seed);
    }
    const world = toWorld(row);
    this.worldId = world.id;
    return this.readingOf(world, this.now());
  }

  /** A reading at a given real instant, for a caller that already has one. */
  readingOf(world: World, atRealMs: RealMs): ClockReading {
    const computed = gameMsAt(world, atRealMs);
    const gameNow = this.guardMonotonic(world.id, computed);
    return { world, atRealMs, gameNow, paused: isPaused(world) };
  }

  /**
   * The real instant a game instant is reached at, or null when the world is paused
   * and it therefore never is. Used by the scheduler to turn a due instant into a delay.
   */
  realInstantFor(world: World, targetGameMs: GameMs): RealMs | null {
    return realMsFor(world, targetGameMs);
  }

  /** The real clock, for the callers that legitimately need it: tokens and traces. */
  nowRealMs(): RealMs {
    return this.now();
  }

  /**
   * Changes the multiplier of the world (plan section 6.1).
   *
   * The transaction locks the world row first, which is step 1 of the canonical lock
   * order, then writes the frozen segment and the new anchor. The caller is responsible
   * for rescheduling the jobs of the horizon afterwards, because the queue is not
   * reachable from inside a transaction (`lib/outbox.ts`); `POST /api/dev/retime` does
   * exactly that.
   *
   * The anchor is forced to advance by at least one millisecond of real time. The
   * database trigger requires it, and requiring it is what makes "an update that did not
   * re-anchor" impossible to express: two retimings inside the same millisecond would
   * otherwise leave the second one anchored where the first was.
   */
  async retimeWorld(nextRate: ClockRate): Promise<RetimeResult> {
    const worldId = await this.resolveWorldId();
    return withPlainTransaction(this.prisma, async (tx) => {
      const lock = await lockWorld(tx, worldId);
      if (lock === null) {
        throw new WorldNotSeededError(this.seed);
      }
      const row = await tx.world.findUniqueOrThrow({ where: { id: worldId } });
      const world = toWorld(row);
      const observed = this.now();
      const atRealMs = observed > world.anchorRealMs ? observed : realMs(world.anchorRealMs + 1n);
      const reanchoring = reanchor(world, atRealMs, nextRate);

      const aggregate = await tx.worldTimeSegment.aggregate({
        where: { worldId },
        _max: { seq: true },
      });
      const segmentSeq = (aggregate._max.seq ?? -1) + 1;

      await tx.worldTimeSegment.create({
        data: {
          worldId,
          seq: segmentSeq,
          fromGameMs: reanchoring.frozen.fromGameMs,
          toGameMs: reanchoring.frozen.toGameMs,
          fromRealMs: reanchoring.frozen.fromRealMs,
          toRealMs: reanchoring.frozen.toRealMs,
          rateNum: reanchoring.frozen.rateNum,
          rateDen: reanchoring.frozen.rateDen,
        },
      });

      const updated = await tx.world.update({
        where: { id: worldId },
        data: {
          anchorGameMs: reanchoring.anchor.anchorGameMs,
          anchorRealMs: reanchoring.anchor.anchorRealMs,
          rateNum: reanchoring.anchor.rateNum,
          rateDen: reanchoring.anchor.rateDen,
          scheduleEpoch: reanchoring.anchor.scheduleEpoch,
        },
      });

      this.logger.info(
        {
          from: `${world.rateNum}/${world.rateDen}`,
          to: `${nextRate.rateNum}/${nextRate.rateDen}`,
          anchorGameMs: reanchoring.anchor.anchorGameMs.toString(),
          scheduleEpoch: reanchoring.anchor.scheduleEpoch,
          segmentSeq,
        },
        'world retimed',
      );

      return {
        reading: this.readingOf(toWorld(updated), atRealMs),
        previousRate: { rateNum: world.rateNum, rateDen: world.rateDen },
        reanchoring,
        segmentSeq,
      };
    });
  }

  /**
   * The start-up check.
   *
   * The generator version and the chunk size are a hard stop and never repaired:
   * repairing would mean reinterpreting coordinates that already carry owned land, and
   * turning a cell that is part of a field into water is worse than refusing to boot
   * (plan section 5.1).
   *
   * The multiplier is neither repaired nor a stop: the persisted world wins and the
   * difference is reported at warning level, because the multiplier is the state of a
   * running world and the configuration is only what a world is created with. Re-anchoring
   * from the configuration happens exactly when the operator asks for it, which is
   * `applyRateFromConfig`; the caller reschedules the horizon afterwards.
   */
  async verifyOnStartup(
    configuredRate: ClockRate,
    options: StartupOptions = { applyRateFromConfig: false },
  ): Promise<StartupCheck> {
    const reading = await this.read();
    const world = reading.world;

    if (world.generatorVersion !== GENERATOR_VERSION) {
      throw new WorldConstantsMismatchError(
        `El mundo persistido se genero con la version ${world.generatorVersion} y shared/config ` +
          `declara ${GENERATOR_VERSION}. Un mundo en uso no puede cambiar de version de generador.`,
      );
    }
    if (world.chunkSize !== CHUNK_SIZE) {
      throw new WorldConstantsMismatchError(
        `El mundo persistido tiene un tamano de chunk de ${world.chunkSize} y shared/config ` +
          `declara ${CHUNK_SIZE}. Toda coordenada guardada depende de el.`,
      );
    }

    const sameRate =
      world.rateNum === configuredRate.rateNum && world.rateDen === configuredRate.rateDen;
    if (sameRate) {
      return { reading, retimed: false, rateMismatchIgnored: false };
    }

    const rates = {
      persisted: `${world.rateNum}/${world.rateDen}`,
      configured: `${configuredRate.rateNum}/${configuredRate.rateDen}`,
    };
    if (!options.applyRateFromConfig) {
      this.logger.warn(
        rates,
        'configured game rate differs from the persisted one: the world keeps its own, ' +
          'because changing the multiplier is a domain operation (ADR-0007). Set ' +
          'GAME_RATE_APPLY_ON_BOOT=true to re-anchor from the configuration',
      );
      return { reading, retimed: false, rateMismatchIgnored: true };
    }

    this.logger.info(rates, 'configured game rate differs from the persisted one: re-anchoring');
    const retime = await this.retimeWorld(configuredRate);
    return { reading: retime.reading, retimed: true, rateMismatchIgnored: false };
  }

  /** Never hands out a value below the highest already handed out for this world. */
  private guardMonotonic(worldId: WorldId, candidate: GameMs): GameMs {
    const previous = this.highWaterMark.get(worldId);
    if (previous !== undefined && candidate < previous) {
      this.logger.warn(
        {
          worldId,
          candidateGameMs: candidate.toString(),
          heldGameMs: previous.toString(),
        },
        'the host clock stepped back: holding the game clock at its previous value',
      );
      return previous as GameMs;
    }
    this.highWaterMark.set(worldId, candidate);
    return candidate;
  }
}

/**
 * The clock of a transaction that has already read the world row. Used by the paths
 * that lock the world and then need the reading of that very transaction.
 */
export function readingInTransaction(service: GameClockService, tx: Tx): Promise<ClockReading> {
  return service.read(tx);
}

/** Whether a game instant has been reached, which is the due guard of every handler. */
export function isDue(dueGameMs: GameMs, gameNow: GameMs): boolean {
  return gameNow >= dueGameMs;
}
