// The ledger against the real database: the atomic charge and the funds check.
//
// Owner: workflow W3-A (backend skeleton).
//
// What is worth testing here is not that a subtraction works. It is that the three defences of
// plan section 6.3 hold against the database itself:
//
//   1. The charge is a conditional update whose row count is the decision, so two concurrent
//      purchases cannot both succeed against the same balance.
//   2. The idempotency key is unique per player, so the same fact written twice is written once.
//   3. `balanceAfter` equals the running sum of the entries, which is what makes the ledger
//      auditable and what the smoke test of plan section 10 asserts over the whole run.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, registerViaHttp, type Harness } from '../../__tests__/harness.js';
import { LedgerType, Money, type PlayerId } from '../../shared/index.js';
import { auditBalance, charge, credit, accrue, LedgerUsageError } from '../ledger.js';
import { lockPlayer } from '../tx.js';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

/** Runs a body with the player locked, which every write of the ledger requires. */
async function withLockedPlayer<T>(
  playerId: PlayerId,
  body: (arguments_: {
    readonly tx: Parameters<Parameters<Harness['services']['transaction']>[0]>[0];
    readonly lock: NonNullable<Awaited<ReturnType<typeof lockPlayer>>>;
  }) => Promise<T>,
): Promise<T> {
  return harness.services.transaction(async (tx) => {
    const lock = await lockPlayer(tx, playerId);
    if (lock === null) {
      throw new Error('the player does not exist');
    }
    return body({ tx, lock });
  });
}

describe('el cobro', () => {
  it('descuenta y escribe un asiento con el saldo resultante', async () => {
    const player = await registerViaHttp(harness, 'charge-ok');
    const reading = await harness.services.clock.read();

    const result = await withLockedPlayer(player.playerId, ({ tx, lock }) =>
      charge(tx, lock, {
        type: LedgerType.LAND_PURCHASE,
        amount: Money.fromUnits(12_000),
        atGameMs: reading.gameNow,
        atRealMs: reading.atRealMs,
        idempotencyKey: `test-charge:${player.playerId}`,
        refType: 'TEST',
        refId: null,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.replayed).toBe(false);
    expect(result.balanceAfter).toBe('148000.0000');
    // The amount of the entry is signed: negative is an outflow for the player.
    expect(result.entry.amount).toBe('-12000.0000');
    expect(result.entry.seq).toBe(2);

    const audit = await withLockedPlayer(player.playerId, ({ tx }) =>
      auditBalance(tx, player.playerId),
    );
    expect(audit.ok).toBe(true);
    expect(audit.storedBalance).toBe('148000.0000');
    expect(audit.entryCount).toBe(2);
  });

  it('rechaza el cobro que el saldo no cubre y no escribe nada', async () => {
    const player = await registerViaHttp(harness, 'charge-poor');
    const reading = await harness.services.clock.read();

    const result = await withLockedPlayer(player.playerId, ({ tx, lock }) =>
      charge(tx, lock, {
        type: LedgerType.MACHINE_PURCHASE,
        amount: Money.fromUnits(160_001),
        atGameMs: reading.gameNow,
        atRealMs: reading.atRealMs,
        idempotencyKey: `test-charge-poor:${player.playerId}`,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('INSUFFICIENT_FUNDS');
    expect(result.available).toBe('160000.0000');
    expect(result.required).toBe('160001.0000');

    const entries = await harness.prisma.ledgerEntry.count({
      where: { playerId: player.playerId },
    });
    // Only the opening entry: the refusal wrote nothing, not even a zero.
    expect(entries).toBe(1);
    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { balance: true, ledgerSeq: true },
    });
    expect(String(row.balance)).toBe('160000');
    expect(row.ledgerSeq).toBe(1);
  });

  it('reproduce el asiento cuando la clave ya se uso, sin volver a descontar', async () => {
    const player = await registerViaHttp(harness, 'charge-twice');
    const reading = await harness.services.clock.read();
    const write = {
      type: LedgerType.MACHINE_REPAIR,
      amount: Money.fromUnits(500),
      atGameMs: reading.gameNow,
      atRealMs: reading.atRealMs,
      idempotencyKey: `test-charge-twice:${player.playerId}`,
    };

    const first = await withLockedPlayer(player.playerId, ({ tx, lock }) =>
      charge(tx, lock, write),
    );
    const second = await withLockedPlayer(player.playerId, ({ tx, lock }) =>
      charge(tx, lock, write),
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.balanceAfter).toBe('159500.0000');

    const entries = await harness.prisma.ledgerEntry.count({
      where: { playerId: player.playerId, type: LedgerType.MACHINE_REPAIR },
    });
    expect(entries).toBe(1);
  });

  it('serializa dos cobros concurrentes: solo uno cabe en el saldo', async () => {
    const player = await registerViaHttp(harness, 'charge-race');
    const reading = await harness.services.clock.read();
    const amount = Money.fromUnits(100_000);

    // Both transactions take the player lock, so PostgreSQL serialises them, and the conditional
    // update of the second one then compares against the balance the first one committed.
    const [left, right] = await Promise.all([
      withLockedPlayer(player.playerId, ({ tx, lock }) =>
        charge(tx, lock, {
          type: LedgerType.LAND_PURCHASE,
          amount,
          atGameMs: reading.gameNow,
          atRealMs: reading.atRealMs,
          idempotencyKey: `race-left:${player.playerId}`,
        }),
      ),
      withLockedPlayer(player.playerId, ({ tx, lock }) =>
        charge(tx, lock, {
          type: LedgerType.LAND_PURCHASE,
          amount,
          atGameMs: reading.gameNow,
          atRealMs: reading.atRealMs,
          idempotencyKey: `race-right:${player.playerId}`,
        }),
      ),
    ]);

    const succeeded = [left, right].filter((result) => result.ok);
    const refused = [left, right].filter((result) => !result.ok);
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);

    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { balance: true },
    });
    expect(Money.fromString(String(row.balance))).toBe('60000.0000');
  });
});

describe('el abono y el devengo', () => {
  it('abona sin comprobar fondos, que es la unica via de salida de la deuda', async () => {
    const player = await registerViaHttp(harness, 'credit');
    const reading = await harness.services.clock.read();

    // First take the balance negative the only way the design allows: an accrual.
    await withLockedPlayer(player.playerId, ({ tx, lock }) =>
      accrue(tx, lock, {
        type: LedgerType.WORKER_WAGES,
        amount: Money.fromUnits(200_000),
        atGameMs: reading.gameNow,
        atRealMs: reading.atRealMs,
        idempotencyKey: `credit-wages:${player.playerId}`,
      }),
    );

    const sold = await withLockedPlayer(player.playerId, ({ tx, lock }) =>
      credit(tx, lock, {
        type: LedgerType.CROP_SALE,
        amount: Money.fromUnits(50_000),
        atGameMs: reading.gameNow,
        atRealMs: reading.atRealMs,
        idempotencyKey: `credit-sale:${player.playerId}`,
      }),
    );
    expect(sold.balanceAfter).toBe('10000.0000');

    const audit = await withLockedPlayer(player.playerId, ({ tx }) =>
      auditBalance(tx, player.playerId),
    );
    expect(audit.ok).toBe(true);
    expect(audit.entryCount).toBe(3);
  });

  it('rechaza un devengo de un tipo que no es continuo', async () => {
    const player = await registerViaHttp(harness, 'accrue-wrong');
    const reading = await harness.services.clock.read();

    await expect(
      withLockedPlayer(player.playerId, ({ tx, lock }) =>
        accrue(tx, lock, {
          type: LedgerType.LAND_PURCHASE,
          amount: Money.fromUnits(1),
          atGameMs: reading.gameNow,
          atRealMs: reading.atRealMs,
          idempotencyKey: `accrue-wrong:${player.playerId}`,
        }),
      ),
    ).rejects.toThrow(LedgerUsageError);
  });
});
