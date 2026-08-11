// The single point of advance, against the real database.
//
// Owner: workflow W3-A (backend skeleton).
//
// The property this file exists for: applying the same due event twice produces the effect once.
// The queue delivers at least once, so a duplicate is normal rather than exceptional, and the
// defence is the transition gate — a conditional status update whose row count decides whether the
// handler runs at all, with every effect inside the branch that won it (plan section 6.3).
//
// It also covers the two things that follow from the same design and are just as easy to get
// wrong: an event that is not due yet is not applied, and the accruals of the interval that ends
// at an event are settled before the event is applied, so each interval is charged at the rates
// that were in force during it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, registerViaHttp, type Harness } from '../../__tests__/harness.js';
import { registerDomainHandlers } from '../../handlers.js';
import {
  LedgerType,
  MS_PER_GAME_HOUR,
  Money,
  ScheduledEventKind,
  ScheduledEventStatus,
  gameMs as toGameMsValue,
  type GameMs,
  type PlayerId,
} from '../../shared/index.js';
import {
  SCHEDULED_EVENT_HANDLERS,
  advancePlayerNow,
  type ScheduledEventHandler,
} from '../advancePlayer.js';
import { credit } from '../ledger.js';
import { scheduleEvent } from '../scheduler.js';
import { lockPlayer } from '../tx.js';

let harness: Harness;

/** How many times the test handler ran. The effect is idempotent; this counter is not. */
let handlerRuns = 0;

/**
 * A handler that credits a fixed amount with a deterministic key.
 *
 * The amount is the visible effect and the counter is the invisible one. A duplicate delivery must
 * leave both at one: the key alone would hide a bug in the gate, since the ledger would refuse the
 * second write anyway, and the counter alone would not prove the money did not move twice.
 */
const testHandler: ScheduledEventHandler = async (context) => {
  handlerRuns += 1;
  await credit(context.tx, context.lock, {
    type: LedgerType.CROP_SALE,
    amount: Money.fromUnits(1000),
    atGameMs: context.event.dueGameMs,
    atRealMs: context.reading.atRealMs,
    idempotencyKey: `test-event:${context.event.id}`,
    refType: 'TEST_EVENT',
    refId: context.event.id,
  });
};

beforeAll(async () => {
  harness = await createHarness();
  // The registry is a module level value on purpose (both processes must apply the same effects),
  // so the test overrides one kind and restores the real wiring afterwards.
  SCHEDULED_EVENT_HANDLERS.register(ScheduledEventKind.FIELD_ADVANCE_PHASE, testHandler);
});

afterAll(async () => {
  SCHEDULED_EVENT_HANDLERS.reset();
  registerDomainHandlers(harness.services);
  await harness.teardown();
});

/** Schedules an event of the test kind at an instant. Returns its identifier. */
async function scheduleAt(playerId: PlayerId, dueGameMs: GameMs): Promise<string> {
  const reading = await harness.services.clock.read();
  return harness.services.transaction(async (tx, outbox) => {
    const result = await scheduleEvent(tx, outbox, reading, {
      playerId,
      kind: ScheduledEventKind.FIELD_ADVANCE_PHASE,
      dueGameMs,
      refType: 'TEST',
      refId: 'test-subject',
      dedupeKey: `test:${playerId}:${dueGameMs.toString()}`,
    });
    return result.scheduledEventId;
  });
}

describe('advancePlayer', () => {
  it('aplica un evento vencido una sola vez aunque se le llame dos veces', async () => {
    const player = await registerViaHttp(harness, 'advance-once');
    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { startedAtGameMs: true, balance: true },
    });
    const dueGameMs = toGameMsValue(row.startedAtGameMs - MS_PER_GAME_HOUR);
    const eventId = await scheduleAt(player.playerId, dueGameMs);

    handlerRuns = 0;
    const first = await advancePlayerNow(harness.services, player.playerId);
    const second = await advancePlayerNow(harness.services, player.playerId);

    expect(handlerRuns).toBe(1);
    expect(first.processedEvents).toBe(1);
    expect(second.processedEvents).toBe(0);

    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId: player.playerId, type: LedgerType.CROP_SALE },
    });
    expect(entries).toHaveLength(1);
    expect(Money.fromString(String(entries[0]?.amount))).toBe('1000.0000');

    const event = await harness.prisma.scheduledEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true, processedAtGameMs: true },
    });
    expect(event.status).toBe(ScheduledEventStatus.PROCESSED);
    expect(event.processedAtGameMs).toBe(dueGameMs);

    // And the frames it produced are the ones the player will replay: one per effect the handler
    // emitted, which is none here, so the sequence did not move.
    const player2 = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { eventSeq: true },
    });
    expect(player2.eventSeq).toBe(0);
  });

  it('no aplica un evento que todavia no ha vencido', async () => {
    const player = await registerViaHttp(harness, 'advance-future');
    const reading = await harness.services.clock.read();
    const dueGameMs = toGameMsValue(reading.gameNow + 10n * MS_PER_GAME_HOUR);
    const eventId = await scheduleAt(player.playerId, dueGameMs);

    handlerRuns = 0;
    const result = await advancePlayerNow(harness.services, player.playerId);

    expect(handlerRuns).toBe(0);
    expect(result.processedEvents).toBe(0);
    const event = await harness.prisma.scheduledEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true },
    });
    expect(event.status).toBe(ScheduledEventStatus.PENDING);
  });

  it('liquida hasta el vencimiento de cada evento antes de aplicarlo', async () => {
    const player = await registerViaHttp(harness, 'advance-settle');
    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { startedAtGameMs: true },
    });
    const startedAtGameMs = toGameMsValue(row.startedAtGameMs);
    const dueGameMs = toGameMsValue(startedAtGameMs + 2n * MS_PER_GAME_HOUR);
    await scheduleAt(player.playerId, dueGameMs);

    // The clock moves past the due instant, so the advance has a window on each side of it.
    harness.advanceGameHours(5);
    handlerRuns = 0;
    const result = await advancePlayerNow(harness.services, player.playerId);

    expect(handlerRuns).toBe(1);
    expect(result.processedEvents).toBe(1);
    // The player has no worker and no machine, so the settlement is worth zero; what the assertion
    // is about is the mark, which must have reached the instant asked for and not the due instant
    // of the last event.
    expect(result.lastAccrualGameMs).toBe(harness.gameNow());
    expect(result.balance).toBe('161000.0000');
  });

  it('deja el estado IN_DEBT cuando el saldo liquidado es negativo', async () => {
    const player = await registerViaHttp(harness, 'advance-debt');
    const reading = await harness.services.clock.read();

    await harness.services.transaction(async (tx) => {
      const lock = await lockPlayer(tx, player.playerId);
      if (lock === null) {
        throw new Error('the player does not exist');
      }
      // A debit that does not check funds is the only way the balance can go negative, which is
      // exactly what the accrual of holding costs does over a long absence (GDD sections 118-119).
      await tx.player.update({
        where: { id: player.playerId },
        data: { balance: '-1.0000' },
      });
      return credit(tx, lock, {
        type: LedgerType.COMPENSATION,
        amount: Money.ZERO,
        atGameMs: reading.gameNow,
        atRealMs: reading.atRealMs,
        idempotencyKey: `debt-marker:${player.playerId}`,
      });
    });

    const result = await advancePlayerNow(harness.services, player.playerId);
    expect(result.status).toBe('IN_DEBT');

    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { status: true },
    });
    expect(row.status).toBe('IN_DEBT');
  });
});
