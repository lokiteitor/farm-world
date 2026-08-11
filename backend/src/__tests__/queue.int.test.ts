// The outbox and the queue, end to end with a real BullMQ consumer.
//
// Owner: workflow W3-A (backend skeleton).
//
// This is the one test that exercises the whole chain of plan section 6.4 with every piece real: the
// row is inserted inside the domain transaction, the alarm clock is created after the commit, BullMQ
// delivers it, the generic handler advances the player and the per kind handler applies the effect.
//
// It also covers the property the design is built around: losing the contents of Redis loses
// nothing. The alarm clock is deleted behind the queue's back, which is what a `FLUSHALL` or an
// eviction looks like, and the reconciliation sweep then re-enqueues the row, because the
// authoritative list of what must happen never lived in Redis.

import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerDomainHandlers } from '../handlers.js';
import { SCHEDULED_EVENT_HANDLERS, type ScheduledEventHandler } from '../lib/advancePlayer.js';
import { credit } from '../lib/ledger.js';
import { createQueueWorker } from '../lib/queue.js';
import { cancelScheduledEvent, reconcile, scheduleEvent } from '../lib/scheduler.js';
import {
  LedgerType,
  MS_PER_GAME_HOUR,
  Money,
  ScheduledEventKind,
  ScheduledEventStatus,
  gameMs as toGameMsValue,
  type GameMs,
  type PlayerId,
} from '../shared/index.js';
import { createHarness, registerViaHttp, type Harness } from './harness.js';

let harness: Harness;
let consumer: ReturnType<typeof createQueueWorker>;

/** The effect the queue is supposed to cause. Credits once, keyed by the event. */
const testHandler: ScheduledEventHandler = async (context) => {
  await credit(context.tx, context.lock, {
    type: LedgerType.CROP_SALE,
    amount: Money.fromUnits(7),
    atGameMs: context.event.dueGameMs,
    atRealMs: context.reading.atRealMs,
    idempotencyKey: `queue-event:${context.event.id}`,
    refType: 'TEST_EVENT',
    refId: context.event.id,
  });
};

beforeAll(async () => {
  harness = await createHarness();
  SCHEDULED_EVENT_HANDLERS.register(ScheduledEventKind.FIELD_ADVANCE_PHASE, testHandler);
  consumer = createQueueWorker({
    config: harness.config,
    registry: harness.services.jobs,
    logger: pino({ level: 'silent' }),
    prefix: harness.queue.prefix,
    concurrency: 2,
  });
  await consumer.worker.waitUntilReady();
});

afterAll(async () => {
  await consumer.close();
  SCHEDULED_EVENT_HANDLERS.reset();
  registerDomainHandlers(harness.services);
  await harness.teardown();
});

/** Waits for a condition, polling. The queue is asynchronous by definition. */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await condition()) {
      return;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error('the condition was not met within the timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Schedules an event of the test kind, which also records its alarm clock. */
async function schedule(playerId: PlayerId, dueGameMs: GameMs): Promise<string> {
  const reading = await harness.services.clock.read();
  return harness.services.transaction(async (tx, outbox) => {
    const result = await scheduleEvent(tx, outbox, reading, {
      playerId,
      kind: ScheduledEventKind.FIELD_ADVANCE_PHASE,
      dueGameMs,
      refType: 'TEST',
      refId: `subject-${dueGameMs.toString()}`,
      dedupeKey: `queue:${playerId}:${dueGameMs.toString()}`,
    });
    return result.scheduledEventId;
  });
}

/** The status of an outbox row. */
async function statusOf(eventId: string): Promise<string> {
  const row = await harness.prisma.scheduledEvent.findUniqueOrThrow({
    where: { id: eventId },
    select: { status: true },
  });
  return row.status;
}

describe('la cola de dominio', () => {
  it('encola tras el commit y el consumidor aplica el efecto', async () => {
    const player = await registerViaHttp(harness, 'queue-apply');
    const reading = await harness.services.clock.read();
    const dueGameMs = toGameMsValue(reading.gameNow - MS_PER_GAME_HOUR);

    const eventId = await schedule(player.playerId, dueGameMs);

    // The alarm clock exists and carries the epoch in its identifier, and the row records it.
    const enqueued = await harness.prisma.scheduledEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { jobId: true, enqueuedAtRealMs: true },
    });
    expect(enqueued.jobId).toBe(`evt:${eventId}:${reading.world.scheduleEpoch}`);
    expect(enqueued.enqueuedAtRealMs).not.toBeNull();

    await waitFor(async () => (await statusOf(eventId)) === ScheduledEventStatus.PROCESSED);

    const entries = await harness.prisma.ledgerEntry.findMany({
      where: { playerId: player.playerId, type: LedgerType.CROP_SALE },
    });
    expect(entries).toHaveLength(1);
    expect(Money.fromString(String(entries[0]?.amount))).toBe('7.0000');
  });

  it('no pierde nada si el despertador desaparece de Redis', async () => {
    const player = await registerViaHttp(harness, 'queue-lost');
    const reading = await harness.services.clock.read();
    const dueGameMs = toGameMsValue(reading.gameNow - 2n * MS_PER_GAME_HOUR);
    const eventId = await schedule(player.playerId, dueGameMs);

    const row = await harness.prisma.scheduledEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { jobId: true },
    });
    // Simulates the loss of Redis for this one job: the row stays pending in PostgreSQL, which is
    // the authoritative list.
    await harness.queue.remove(row.jobId ?? '');
    await harness.prisma.scheduledEvent.updateMany({
      where: { id: eventId },
      data: { enqueuedAtRealMs: null, jobId: null },
    });

    const swept = await reconcile(harness.services.schedulerDeps, 'manual');
    expect(swept.enqueuedEvents).toBeGreaterThanOrEqual(1);

    await waitFor(async () => (await statusOf(eventId)) === ScheduledEventStatus.PROCESSED);
    const entries = await harness.prisma.ledgerEntry.count({
      where: { playerId: player.playerId, type: LedgerType.CROP_SALE },
    });
    expect(entries).toBe(1);
  });

  it('deduplica el mismo hecho mientras sigue pendiente', async () => {
    const player = await registerViaHttp(harness, 'queue-dedupe');
    const reading = await harness.services.clock.read();
    // Far in the future, so the sweep does not process it while the assertion runs.
    const dueGameMs = toGameMsValue(reading.gameNow + 5n * MS_PER_GAME_HOUR);

    const first = await schedule(player.playerId, dueGameMs);
    const second = await schedule(player.playerId, dueGameMs);
    expect(second).toBe(first);

    const rows = await harness.prisma.scheduledEvent.count({
      where: {
        playerId: player.playerId,
        kind: ScheduledEventKind.FIELD_ADVANCE_PHASE,
        status: ScheduledEventStatus.PENDING,
      },
    });
    expect(rows).toBe(1);
  });

  it('cancela un evento pendiente y retira su despertador', async () => {
    const player = await registerViaHttp(harness, 'queue-cancel');
    const reading = await harness.services.clock.read();
    const dueGameMs = toGameMsValue(reading.gameNow + 4n * MS_PER_GAME_HOUR);
    const eventId = await schedule(player.playerId, dueGameMs);

    const cancelled = await harness.services.transaction(async (tx, outbox) =>
      cancelScheduledEvent(tx, outbox, eventId),
    );
    expect(cancelled).toBe(true);
    expect(await statusOf(eventId)).toBe(ScheduledEventStatus.CANCELED);

    // Cancelling twice is a no-op rather than a rewrite of history.
    const again = await harness.services.transaction(async (tx, outbox) =>
      cancelScheduledEvent(tx, outbox, eventId),
    );
    expect(again).toBe(false);
  });
});
