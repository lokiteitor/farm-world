// The single point where simulation effects are applied.
//
// Owner: workflow W3-A (backend skeleton). Frozen after W3.
//
// Invariant 3 of plan section 6.3. Every simulation effect is applied by
// `advancePlayer`, which locks the player row, processes the due events in order settling
// accruals before each one, settles up to the final instant and applies the debt policy.
// Three callers, and no fourth: the queue handler, the `withPlayerAdvanced` wrapper of
// every mutating endpoint, and the login.
//
// The consequence that shapes the whole system: if the simulation worker is down, the
// first request of a player repairs that player's world. BullMQ is a requirement of
// punctuality, not of correctness.
//
// Why accruals are settled before each event and not once at the end. A due event changes
// the rates: a task that completes stops charging its operating cost, a worker that is
// dismissed stops earning. Settling the window that ends at the event, then applying it,
// then continuing, charges each interval at the rates that were in force during it. One
// settlement at the end would charge the whole window at whichever rates happened to
// survive, which is the error the integral of overlaps exists to avoid.
//
// Idempotence. Each event is claimed with a conditional status update whose row count is
// the decision, and every effect lives inside the branch that claimed it, in the same
// transaction. BullMQ delivers at least once, so the same event arriving twice is normal;
// the second arrival claims nothing and applies nothing. The integration suite asserts
// exactly that.
//
// The handlers of each kind live in the module that owns the domain, and they register
// themselves through the registry below, so this file is never reopened to add a kind
// (plan section 11, rule 3).

import {
  Money,
  PlayerStatus,
  ScheduledEventKind,
  ScheduledEventStatus,
  gameMs as toGameMsValue,
  type GameMs,
  type PlayerId,
  type WsServerFrame,
} from '../shared/index.js';
import { settleAccruals } from './accrual.js';
import { type ServiceContext } from './context.js';
import { toMoney } from './dbMap.js';
import { appendEvents, type DomainEventDraft } from './events.js';
import { type ClockReading } from './gameClock.js';
import { type Outbox } from './outbox.js';
import { dueEventsOf } from './scheduler.js';
import { lockPlayer, type PlayerLock, type Tx } from './tx.js';

// ---------------------------------------------------------------------------
// The registry of handlers by kind
// ---------------------------------------------------------------------------

/** A due event, as a handler receives it. */
export interface DueEvent {
  readonly id: string;
  readonly kind: ScheduledEventKind;
  readonly dueGameMs: GameMs;
  readonly epoch: number;
  readonly refType: string | null;
  readonly refId: string | null;
}

/** What a handler of a due event may use. */
export interface ScheduledEventContext {
  readonly tx: Tx;
  readonly outbox: Outbox;
  readonly lock: PlayerLock;
  /** The clock reading of the whole advance, not a fresh one. */
  readonly reading: ClockReading;
  readonly event: DueEvent;
  readonly services: ServiceContext;
  /**
   * Records frames to publish. They are appended to the event log with the due instant of
   * the event as `atGameMs`, so a frame produced by a job that ran late is placed where it
   * happened and not where it was noticed.
   */
  emit(...drafts: readonly DomainEventDraft[]): void;
}

/**
 * The domain effect of a kind of due event. It runs inside the transaction of the advance
 * and after the event has been claimed, so it must not check the status again.
 */
export type ScheduledEventHandler = (context: ScheduledEventContext) => Promise<void>;

export interface ScheduledEventRegistry {
  register(kind: ScheduledEventKind, handler: ScheduledEventHandler): void;
  handlerFor(kind: ScheduledEventKind): ScheduledEventHandler | undefined;
  readonly missingKinds: readonly ScheduledEventKind[];
  reset(): void;
}

function createScheduledEventRegistry(): ScheduledEventRegistry {
  const handlers = new Map<ScheduledEventKind, ScheduledEventHandler>();
  return {
    register(kind, handler) {
      handlers.set(kind, handler);
    },
    handlerFor(kind) {
      return handlers.get(kind);
    },
    get missingKinds() {
      return Object.values(ScheduledEventKind).filter((kind) => !handlers.has(kind));
    },
    reset() {
      handlers.clear();
    },
  };
}

/**
 * The registry, as a module level value.
 *
 * A singleton and not a field of the service context, because a handler is a property of
 * the build and not of the process: both entry points must apply the same effects, and a
 * per context registry would let a request path and a job path diverge. `reset` exists for
 * the tests and for nothing else.
 */
export const SCHEDULED_EVENT_HANDLERS: ScheduledEventRegistry = createScheduledEventRegistry();

// ---------------------------------------------------------------------------
// The advance
// ---------------------------------------------------------------------------

/** Events one call applies at most, so a very late player is caught up in batches. */
export const MAX_EVENTS_PER_ADVANCE = 200;

export interface AdvanceResult {
  readonly processedEvents: number;
  readonly unhandledEvents: number;
  readonly lastAccrualGameMs: GameMs;
  readonly balance: Money;
  readonly status: PlayerStatus;
  /** True when the batch ceiling was reached and another call is needed. */
  readonly truncated: boolean;
  readonly frames: readonly WsServerFrame[];
}

/**
 * Advances a player to an instant.
 *
 * Preconditions: the player row is locked, and `reading` is the clock reading of the
 * request or job. `toGameMs` is normally `reading.gameNow`; the development route passes
 * an explicit instant, which is what makes the debt policy testable without waiting.
 */
export async function advancePlayer(
  services: ServiceContext,
  tx: Tx,
  outbox: Outbox,
  lock: PlayerLock,
  reading: ClockReading,
  toGameMs: GameMs,
  options: { readonly maxEvents?: number } = {},
): Promise<AdvanceResult> {
  const maxEvents = options.maxEvents ?? MAX_EVENTS_PER_ADVANCE;
  const due = await dueEventsOf(tx, lock.playerId, toGameMs, maxEvents + 1);
  const batch = due.slice(0, maxEvents);
  const truncated = due.length > maxEvents;

  const frames: WsServerFrame[] = [];
  let processedEvents = 0;
  let unhandledEvents = 0;

  for (const row of batch) {
    const event: DueEvent = {
      id: row.id,
      kind: row.kind,
      dueGameMs: toGameMsValue(row.dueGameMs),
      epoch: row.epoch,
      refType: row.refType,
      refId: row.refId,
    };

    // Everything the event costs up to the moment it happens, at the rates in force.
    await settleAccruals(tx, lock, event.dueGameMs, reading.atRealMs);

    // The transition gate. The row count is the decision, and every effect below lives
    // inside the branch that won it, which is what makes a duplicate delivery a no-op.
    const claimed = await tx.scheduledEvent.updateMany({
      where: { id: event.id, status: ScheduledEventStatus.PENDING },
      data: {
        status: ScheduledEventStatus.PROCESSED,
        processedAtGameMs: event.dueGameMs,
      },
    });
    if (claimed.count === 0) {
      continue;
    }

    const handler = SCHEDULED_EVENT_HANDLERS.handlerFor(event.kind);
    if (handler === undefined) {
      // The kind exists in the vocabulary and its module has not landed yet. The row is
      // left claimed so the advance cannot loop on it, and the gap is counted rather than
      // hidden: the metric is expected to be flat at zero once every workflow is in.
      unhandledEvents += 1;
      services.metrics.scheduledEventsUnhandled.inc({ kind: event.kind });
      services.logger.warn(
        { kind: event.kind, scheduledEventId: event.id, playerId: lock.playerId },
        'due event with no handler registered for its kind',
      );
      continue;
    }

    const drafts: DomainEventDraft[] = [];
    await handler({
      tx,
      outbox,
      lock,
      reading,
      event,
      services,
      emit(...emitted) {
        drafts.push(...emitted);
      },
    });
    if (drafts.length > 0) {
      const appended = await appendEvents(tx, lock, event.dueGameMs, drafts);
      frames.push(...appended.frames);
    }
    processedEvents += 1;
    services.metrics.scheduledEventsDue.inc({ kind: event.kind });
  }

  // The tail of the window: from the last event to the instant asked for.
  const settlement = await settleAccruals(tx, lock, toGameMs, reading.atRealMs);
  if (settlement.settled) {
    services.metrics.accrualSettlements.inc();
  }

  const status = await applyDebtPolicy(tx, lock);
  const player = await tx.player.findUniqueOrThrow({
    where: { id: lock.playerId },
    select: { balance: true, lastAccrualGameMs: true },
  });

  if (frames.length > 0) {
    outbox.publish(lock.playerId, frames);
  }

  return {
    processedEvents,
    unhandledEvents,
    lastAccrualGameMs: toGameMsValue(player.lastAccrualGameMs),
    balance: toMoney(player.balance),
    status,
    truncated,
    frames,
  };
}

/**
 * The debt policy of plan section 6.6, in its derived part: `IN_DEBT` follows the settled
 * balance and nothing else.
 *
 * What it blocks lives at the call sites of `charge`, which is the only path for
 * discretionary spending; selling and assigning tasks go through `credit` and through no
 * money at all, so they stay available, which they must: blocking them would produce a
 * permanent deadlock for a player whose only way out is to sell.
 *
 * `BANKRUPT` is never produced. Ending the game of somebody who was offline is not
 * acceptable in an asynchronous game, and the forced liquidation of the settlement sweep
 * is consequence enough.
 */
export async function applyDebtPolicy(tx: Tx, lock: PlayerLock): Promise<PlayerStatus> {
  const player = await tx.player.findUniqueOrThrow({
    where: { id: lock.playerId },
    select: { balance: true, status: true },
  });
  if (player.status === PlayerStatus.BANKRUPT) {
    return PlayerStatus.BANKRUPT;
  }
  const target = Money.isNegative(toMoney(player.balance))
    ? PlayerStatus.IN_DEBT
    : PlayerStatus.ACTIVE;
  if (target !== player.status) {
    await tx.player.update({ where: { id: lock.playerId }, data: { status: target } });
  }
  return target;
}

// ---------------------------------------------------------------------------
// The wrapper of a mutating endpoint
// ---------------------------------------------------------------------------

/** What a mutating handler receives. The only way a module writes domain state. */
export interface MutationContext {
  readonly tx: Tx;
  readonly outbox: Outbox;
  readonly lock: PlayerLock;
  readonly reading: ClockReading;
  readonly services: ServiceContext;
  /** The advance that ran before the body, for a handler that reports what it caught up. */
  readonly advance: AdvanceResult;
  /** Records frames. They are appended with the current game instant. */
  emit(...drafts: readonly DomainEventDraft[]): void;
}

/** The envelope of a mutating reply: the sequence, the instant and the result. */
export interface MutationOutcome<T> {
  readonly result: T;
  readonly seq: number;
  readonly atGameMs: GameMs;
}

/** The player of the request does not exist. Raised as an error, mapped to 404 above. */
export class PlayerNotFoundError extends Error {
  constructor(playerId: PlayerId) {
    super(`No existe el jugador ${playerId}`);
    this.name = 'PlayerNotFoundError';
  }
}

/**
 * Runs a mutating body with the player advanced, inside one transaction.
 *
 * The order is fixed and is the reason this wrapper exists: lock the player, advance to
 * the current game instant, run the body, append the frames it emitted, and let
 * `transaction` flush the outbox after the commit. So every affordability check inside the
 * body compares against a balance that is settled up to now, in the same transaction,
 * which is the requirement of plan section 6.2.
 *
 * Every mutating endpoint of workflows W4 to W6 goes through here.
 */
export async function withPlayerAdvanced<T>(
  services: ServiceContext,
  playerId: PlayerId,
  body: (context: MutationContext) => Promise<T>,
): Promise<MutationOutcome<T>> {
  return services.transaction(async (tx, outbox) => {
    const reading = await services.clock.read(tx);
    const lock = await lockPlayer(tx, playerId);
    if (lock === null) {
      throw new PlayerNotFoundError(playerId);
    }
    const advance = await advancePlayer(services, tx, outbox, lock, reading, reading.gameNow);

    const drafts: DomainEventDraft[] = [];
    const result = await body({
      tx,
      outbox,
      lock,
      reading,
      services,
      advance,
      emit(...emitted) {
        drafts.push(...emitted);
      },
    });

    const appended = await appendEvents(tx, lock, reading.gameNow, drafts);
    if (appended.frames.length > 0) {
      outbox.publish(playerId, appended.frames);
    }
    return { result, seq: appended.seq, atGameMs: reading.gameNow };
  });
}

/**
 * Advances a player and nothing else, which is what a read path and the login need. It is
 * a separate function and not `withPlayerAdvanced` with an empty body so that the
 * distinction is visible in a stack trace and in the log.
 */
export async function advancePlayerNow(
  services: ServiceContext,
  playerId: PlayerId,
  toGameMs?: GameMs,
): Promise<AdvanceResult> {
  return services.transaction(async (tx, outbox) => {
    const reading = await services.clock.read(tx);
    const lock = await lockPlayer(tx, playerId);
    if (lock === null) {
      throw new PlayerNotFoundError(playerId);
    }
    return advancePlayer(services, tx, outbox, lock, reading, toGameMs ?? reading.gameNow);
  });
}
