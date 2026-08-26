// The four wire conventions, exercised in both directions.
//
// Owner: workflow W2 (API contract).
//
// The point of these tests is narrow and load bearing: they prove that the two types the
// contract deliberately refuses to send as JSON numbers survive a round trip without
// loss, and that sending them as numbers is rejected rather than silently coerced. A
// contract that merely documented the convention would be broken by the first handler
// that returned `Number(balance)`.

import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOGUE } from '../../config/buildings.js';
import { WHEAT } from '../../config/crops/index.js';
import { STARTING_CAPITAL } from '../../config/economy.js';
import { PINE } from '../../config/forestry.js';
import { MACHINE_CATALOGUE } from '../../config/machines.js';
import { SALARY_FLOOR, SALARY_INTERCEPT } from '../../config/workers.js';
import { Money } from '../../domain/money.js';
import { MS_PER_GAME_HOUR, gameMs, realMs, type GameMs } from '../../domain/units.js';
import {
  bpSchema,
  fromWireGameMs,
  fromWireMoney,
  fromWireRealMs,
  gameMsDurationSchema,
  gameMsSchema,
  moneySchema,
  realMsSchema,
  storageUnitsSchema,
  toWireGameMs,
  toWireMoney,
  toWireRealMs,
} from '../schemas/common.js';

describe('money on the wire', () => {
  const samples = [
    Money.ZERO,
    STARTING_CAPITAL,
    Money.fromString('0.0001'),
    Money.fromString('-0.0001'),
    Money.fromString('-27625.5000'),
    Money.fromString('0.22'),
    Money.fromString('999999999999999999999999.9999'),
    SALARY_FLOOR,
    SALARY_INTERCEPT,
    WHEAT.sellPricePerLiter,
    PINE.sellPricePerM3,
  ];

  it('accepts every canonical amount and returns it unchanged', () => {
    for (const amount of samples) {
      const wire = toWireMoney(amount);
      const parsed = moneySchema.parse(wire);
      expect(parsed).toBe(wire);
      expect(fromWireMoney(parsed)).toBe(amount);
    }
  });

  it('accepts every price of every catalogue', () => {
    for (const definition of Object.values(MACHINE_CATALOGUE)) {
      for (const amount of [
        definition.purchasePrice,
        definition.maintenanceCostPerGameHour,
        definition.operatingCostPerGameHour,
        definition.repairCostPerConditionPoint,
      ]) {
        expect(moneySchema.safeParse(toWireMoney(amount)).success).toBe(true);
      }
    }
    for (const definition of Object.values(BUILDING_CATALOGUE)) {
      expect(moneySchema.safeParse(toWireMoney(definition.purchasePrice)).success).toBe(true);
    }
  });

  it('refuses an amount sent as a JSON number', () => {
    expect(moneySchema.safeParse(160_000).success).toBe(false);
    expect(moneySchema.safeParse(0.22).success).toBe(false);
  });

  it('refuses more precision than the stored scale, and other malformed spellings', () => {
    for (const bad of [
      '160000.00001',
      '',
      '.5',
      '5.',
      '1,5',
      '1e5',
      'NaN',
      'Infinity',
      '0x10',
      ' 160000.0000',
      '160000.0000 ',
      '--1',
    ]) {
      expect(moneySchema.safeParse(bad).success, `accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('accepts fewer decimals in a request than the canonical form has', () => {
    // A hand written client or a scripted test may send `12` or `12.5`; the parse
    // normalises it, and the round trip lands on the canonical four decimal form.
    expect(fromWireMoney(moneySchema.parse('12'))).toBe(Money.fromString('12.0000'));
    expect(fromWireMoney(moneySchema.parse('12.5'))).toBe(Money.fromString('12.5000'));
  });
});

describe('game instants on the wire', () => {
  const samples: GameMs[] = [
    gameMs(0n),
    gameMs(MS_PER_GAME_HOUR),
    // The 325 hour cycle of GDD section 118.
    gameMs(325n * MS_PER_GAME_HOUR),
    // The 720 hour boundary of the oldest pine (GDD section 133, plan section 2.2).
    gameMs(720n * MS_PER_GAME_HOUR),
    gameMs(9_223_372_036_854_775_807n / 2n),
  ];

  it('accepts every instant and returns it unchanged', () => {
    for (const instant of samples) {
      const wire = toWireGameMs(instant);
      const parsed = gameMsSchema.parse(wire);
      expect(parsed).toBe(wire);
      expect(fromWireGameMs(parsed)).toBe(instant);
    }
  });

  it('survives a value above the exactly representable range of a double', () => {
    // 2^53 milliseconds of game time is about 285 000 years; a client that received this
    // as a JSON number would lose the low digits without any error.
    const beyondDouble = gameMs(9_007_199_254_740_993n);
    const wire = toWireGameMs(beyondDouble);
    expect(fromWireGameMs(gameMsSchema.parse(wire))).toBe(beyondDouble);
    expect(BigInt(Number(wire))).not.toBe(beyondDouble);
  });

  it('refuses an instant sent as a JSON number', () => {
    expect(gameMsSchema.safeParse(3_600_000).success).toBe(false);
    expect(gameMsSchema.safeParse(0).success).toBe(false);
  });

  it('refuses a negative instant, a leading zero and a fractional millisecond', () => {
    for (const bad of ['-1', '007', '0.5', '', '1_000', '+1', ' 1', '1 ']) {
      expect(gameMsSchema.safeParse(bad).success, `accepted ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('applies the same form to a duration and to a real instant', () => {
    const duration = 96n * MS_PER_GAME_HOUR;
    expect(gameMsDurationSchema.parse(duration.toString())).toBe('345600000');
    const instant = realMs(1_700_000_000_000n);
    expect(fromWireRealMs(realMsSchema.parse(toWireRealMs(instant)))).toBe(instant);
  });
});

describe('percentages and quantities', () => {
  it('accepts basis points only as an integer inside the closed range', () => {
    for (const good of [0, 1, 5000, 9999, 10_000]) {
      expect(bpSchema.safeParse(good).success, `rejected ${good}`).toBe(true);
    }
    for (const bad of [-1, 10_001, 0.5, 1.0001, Number.NaN, '5000']) {
      expect(bpSchema.safeParse(bad).success, `accepted ${String(bad)}`).toBe(false);
    }
  });

  it('accepts a fungible quantity only as a non negative integer', () => {
    // Wheat is counted in litres and wood in cubic decimetres, both integers, so that a
    // lazy sum of thousands of rows does not depend on its order.
    expect(storageUnitsSchema.safeParse(500_000).success).toBe(true);
    expect(storageUnitsSchema.safeParse(0).success).toBe(true);
    expect(storageUnitsSchema.safeParse(1.5).success).toBe(false);
    expect(storageUnitsSchema.safeParse(-1).success).toBe(false);
  });
});
