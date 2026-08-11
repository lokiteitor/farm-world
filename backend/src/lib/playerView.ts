// The read model of the player and of the clock.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Why this is in `lib` and not in a module of its own. The brief of this agent asked for a
// `player` module serving `GET /api/player/state`. That route does not exist in the frozen
// contract: `shared/api/routes.ts` declares no `player` area, and the two routes that
// return this read model are `GET /api/auth/me`, in the `auth` area, and
// `GET /api/state/snapshot`, in the `state` area, which belongs to the `session` module of
// workflow W6-B. On top of that, every route that moves money emits `PLAYER_UPSERTED`, so
// the same builder is needed by `land`, `farms`, `machinery`, `economy` and the
// development routes.
//
// The ESLint zones forbid an import between sibling modules (plan section 11, rule 4), so a
// read model shared by seven modules of four different workflows can only live in `lib`.
// Putting it in a module would force either a duplicate per module or a rule violation.
// The discrepancy is recorded in `docs/handoff/NOTES-w3a.md`.
//
// The two balances. `balance` is the settled balance, the one every affordability check
// uses inside its own transaction; `projectedBalance` is that same balance carried forward
// to `atGameMs` by the continuous costs, and it is what the top bar shows. A check against
// the projection would create money out of nothing under concurrency, which is why the two
// are named separately in the contract and are never merged (plan section 6.2).

import {
  GAME_HOURS_PER_GAME_DAY,
  MS_PER_GAME_HOUR,
  holdingRatePerGameHour,
  toWireGameMs,
  toWireMoney,
  toWireRealMs,
  type ClockDto,
  type GameMs,
  type HoldingRate,
  type LedgerEntry,
  type LedgerEntryDto,
  type Money,
  type PlayerDto,
  type PlayerId,
} from '../shared/index.js';
import { computeAccrual } from './accrual.js';
import { toMoney } from './dbMap.js';
import { type ClockReading } from './gameClock.js';
import { projectBalance } from './ledger.js';
import { type Db } from './tx.js';

/**
 * A ledger entry as the contract carries it. `idempotencyKey` deliberately does not travel:
 * it is an internal guarantee and no client has a use for it (shared/api/schemas/economy.ts).
 */
export function toLedgerEntryDto(entry: LedgerEntry): LedgerEntryDto {
  return {
    id: entry.id,
    seq: entry.seq,
    type: entry.type,
    amount: toWireMoney(entry.amount),
    balanceAfter: toWireMoney(entry.balanceAfter),
    atGameMs: toWireGameMs(entry.atGameMs),
    refType: entry.refType,
    refId: entry.refId,
    meta: entry.meta,
  };
}

/** The clock as every reply carries it, so the client can extrapolate on its own. */
export function toClockDto(reading: ClockReading): ClockDto {
  return {
    gameMs: toWireGameMs(reading.gameNow),
    realMs: toWireRealMs(reading.atRealMs),
    anchorGameMs: toWireGameMs(reading.world.anchorGameMs),
    anchorRealMs: toWireRealMs(reading.world.anchorRealMs),
    rateNum: reading.world.rateNum,
    rateDen: reading.world.rateDen,
    scheduleEpoch: reading.world.scheduleEpoch,
  };
}

/**
 * The day number the interface shows (GDD section 61, plan section 2.2).
 *
 * Derived from the player's own start and never from the world clock, because two players
 * who joined a week apart are on different days of their own game. The first hour is day
 * one, so the value is always positive, which the contract requires.
 */
export function dayNumberOf(startedAtGameMs: GameMs, gameNow: GameMs): number {
  const elapsed = gameNow > startedAtGameMs ? gameNow - startedAtGameMs : 0n;
  const dayMs = MS_PER_GAME_HOUR * BigInt(GAME_HOURS_PER_GAME_DAY);
  return Number(elapsed / dayMs) + 1;
}

/** The hourly burn rate of the holding at this instant (GDD section 107). */
export async function holdingRateOf(db: Db, playerId: PlayerId): Promise<HoldingRate> {
  const [workers, machines] = await Promise.all([
    db.worker.findMany({
      where: { playerId, terminatedGameMs: null },
      select: { salaryPerGameHour: true },
    }),
    db.machine.findMany({
      where: { playerId, disposedGameMs: null },
      select: { type: true, status: true },
    }),
  ]);
  return holdingRatePerGameHour({
    workers: workers.map((worker) => ({ salaryPerGameHour: toMoney(worker.salaryPerGameHour) })),
    machines: machines.map((machine) => ({ type: machine.type, status: machine.status })),
  });
}

/**
 * The player as the contract carries it.
 *
 * It writes nothing, on purpose: this is the read path, and the projection it computes is
 * the one plan section 6.2 keeps separate from settlement. A caller that needs the settled
 * value to compare against a price uses the column, inside its transaction, through
 * `charge`.
 */
export async function buildPlayerDto(
  db: Db,
  playerId: PlayerId,
  reading: ClockReading,
): Promise<PlayerDto> {
  const row = await db.player.findUniqueOrThrow({ where: { id: playerId } });
  const settled = toMoney(row.balance);
  const lastAccrualGameMs = row.lastAccrualGameMs as unknown as GameMs;

  const pending = await computeAccrual(
    db,
    playerId,
    { fromGameMs: lastAccrualGameMs, toGameMs: reading.gameNow },
    settled,
  );
  const holding = await holdingRateOf(db, playerId);

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    balance: toWireMoney(settled),
    projectedBalance: toWireMoney(projectBalance(settled, pending)),
    startedAtGameMs: toWireGameMs(row.startedAtGameMs as unknown as GameMs),
    dayNumber: dayNumberOf(row.startedAtGameMs as unknown as GameMs, reading.gameNow),
    lastAccrualGameMs: toWireGameMs(lastAccrualGameMs),
    lastLoginGameMs: toWireGameMs(row.lastLoginGameMs as unknown as GameMs),
    lastSummaryGameMs: toWireGameMs(row.lastSummaryGameMs as unknown as GameMs),
    ledgerSeq: row.ledgerSeq,
    eventSeq: row.eventSeq,
    holdingCostPerGameHour: toWireMoney(holding.totalPerGameHour),
    atGameMs: toWireGameMs(reading.gameNow),
  };
}

/**
 * The minimal snapshot of a player: the derived counters an interface needs before it has
 * loaded anything else. It is what the top bar of plan section 9.6 reads, and what the
 * `session` module of workflow W6-B composes its full snapshot from.
 */
export interface PlayerSnapshotCounters {
  readonly farmCount: number;
  readonly fieldCount: number;
  readonly machineCount: number;
  readonly workerCount: number;
  readonly activeTaskCount: number;
  readonly ownedCellCount: number;
  readonly holding: HoldingRate;
  readonly projectedBalance: Money;
}

/** The counters above, in one round trip per relation. */
export async function buildPlayerCounters(
  db: Db,
  playerId: PlayerId,
  reading: ClockReading,
): Promise<PlayerSnapshotCounters> {
  const player = await db.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { balance: true, lastAccrualGameMs: true },
  });
  const settled = toMoney(player.balance);
  const [farmCount, fieldCount, machineCount, workerCount, activeTaskCount, ownedCellCount] =
    await Promise.all([
      db.farm.count({ where: { playerId, disposedGameMs: null } }),
      db.field.count({ where: { playerId, disposedGameMs: null } }),
      db.machine.count({ where: { playerId, disposedGameMs: null } }),
      db.worker.count({ where: { playerId, terminatedGameMs: null } }),
      db.task.count({ where: { playerId, status: 'IN_PROGRESS' } }),
      db.worldCell.count({ where: { ownerPlayerId: playerId } }),
    ]);
  const pending = await computeAccrual(
    db,
    playerId,
    { fromGameMs: player.lastAccrualGameMs as unknown as GameMs, toGameMs: reading.gameNow },
    settled,
  );
  return {
    farmCount,
    fieldCount,
    machineCount,
    workerCount,
    activeTaskCount,
    ownedCellCount,
    holding: await holdingRateOf(db, playerId),
    projectedBalance: projectBalance(settled, pending),
  };
}
