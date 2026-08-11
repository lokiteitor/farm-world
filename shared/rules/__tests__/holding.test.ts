import { describe, expect, it } from 'vitest';
import { MACHINE_CATALOGUE } from '../../config/machines.js';
import { MachineStatus, MachineType } from '../../domain/enums.js';
import { Money } from '../../domain/money.js';
import { bp, gameMs } from '../../domain/units.js';
import {
  DEFAULT_ACCRUAL_CONFIG,
  accrueContinuousCosts,
  holdingRatePerGameHour,
  integralToMoney,
  type AccrualSources,
} from '../holding.js';

// The hourly rate of GDD section 107 and the accrual integral of GDD sections 107 and
// 124. The algebraic laws are in properties.test.ts; these are the concrete amounts.

const at = (hours: number): ReturnType<typeof gameMs> =>
  gameMs(BigInt(Math.round(hours * 3_600_000)));

const FLEET: readonly MachineType[] = [
  MachineType.TRACTOR,
  MachineType.PLOW,
  MachineType.SEEDER,
  MachineType.HARVESTER,
  MachineType.TRAILER,
];

describe('holdingRatePerGameHour (GDD section 107)', () => {
  it('adds every salary, every maintenance cost and the operation of what is working', () => {
    const rate = holdingRatePerGameHour({
      workers: [
        { salaryPerGameHour: Money.fromUnits(15) },
        { salaryPerGameHour: Money.fromString('22.75') },
      ],
      machines: FLEET.map((type) => ({
        type,
        status: type === MachineType.TRACTOR ? MachineStatus.WORKING : MachineStatus.IDLE,
      })),
    });
    expect(rate.wagesPerGameHour).toBe(Money.fromString('37.75'));
    // Only the tractor and the combine have maintenance in the catalogue of GDD section
    // 89; the implements declare none.
    expect(rate.maintenancePerGameHour).toBe(Money.fromUnits(37));
    // Operation is only paid by the machine that is working (GDD sections 94 and 107).
    expect(rate.operatingPerGameHour).toBe(Money.fromUnits(22));
    expect(rate.totalPerGameHour).toBe(Money.fromString('96.75'));
  });

  it('is maintenance only for an idle fleet, which is the point of GDD section 94', () => {
    const rate = holdingRatePerGameHour({
      workers: [],
      machines: FLEET.map((type) => ({ type, status: MachineStatus.IDLE })),
    });
    expect(rate.operatingPerGameHour).toBe(Money.ZERO);
    expect(rate.totalPerGameHour).toBe(Money.fromUnits(37));
  });

  it('is zero for an empty holding', () => {
    const rate = holdingRatePerGameHour({ workers: [], machines: [] });
    expect(rate.totalPerGameHour).toBe(Money.ZERO);
  });
});

describe('accrueContinuousCosts (GDD sections 107 and 124)', () => {
  const oneWorker: AccrualSources = {
    workers: [
      { salaryPerGameHour: Money.fromUnits(15), hiredGameMs: at(0), terminatedGameMs: null },
    ],
    machines: [],
    tasks: [],
    openingBalance: Money.ZERO,
  };

  it('charges a whole salary over a whole window', () => {
    const accrual = accrueContinuousCosts(oneWorker, { fromGameMs: at(0), toGameMs: at(100) });
    expect(accrual.wages).toBe(Money.fromUnits(1_500));
    expect(accrual.total).toBe(Money.fromUnits(1_500));
    expect(accrual.windowGameHours).toBe(100);
  });

  it('prorates a worker hired halfway through the window', () => {
    const sources: AccrualSources = {
      ...oneWorker,
      workers: [
        { salaryPerGameHour: Money.fromUnits(15), hiredGameMs: at(50), terminatedGameMs: null },
      ],
    };
    expect(accrueContinuousCosts(sources, { fromGameMs: at(0), toGameMs: at(100) }).wages).toBe(
      Money.fromUnits(750),
    );
  });

  it('stops charging a worker who was dismissed (GDD section 109)', () => {
    const sources: AccrualSources = {
      ...oneWorker,
      workers: [
        { salaryPerGameHour: Money.fromUnits(15), hiredGameMs: at(0), terminatedGameMs: at(40) },
      ],
    };
    expect(accrueContinuousCosts(sources, { fromGameMs: at(0), toGameMs: at(100) }).wages).toBe(
      Money.fromUnits(600),
    );
    // And nothing at all once the window starts after the dismissal, which is what makes
    // out of order processing harmless.
    expect(accrueContinuousCosts(sources, { fromGameMs: at(60), toGameMs: at(100) }).wages).toBe(
      Money.ZERO,
    );
  });

  it('charges maintenance from acquisition to disposal only', () => {
    const sources: AccrualSources = {
      workers: [],
      machines: [
        { type: MachineType.HARVESTER, acquiredGameMs: at(20), disposedGameMs: at(70) },
        { type: MachineType.TRACTOR, acquiredGameMs: at(0), disposedGameMs: null },
      ],
      tasks: [],
      openingBalance: Money.ZERO,
    };
    // Combine: 25 x 50 h = 1 250. Tractor: 12 x 100 h = 1 200.
    const accrual = accrueContinuousCosts(sources, { fromGameMs: at(0), toGameMs: at(100) });
    expect(accrual.maintenance).toBe(Money.fromUnits(2_450));
  });

  it('charges operation over the interval of the task, per machine it reserves', () => {
    const sources: AccrualSources = {
      workers: [],
      machines: [],
      tasks: [
        {
          machineTypes: [MachineType.TRACTOR, MachineType.PLOW],
          startGameMs: at(0),
          scheduledEndGameMs: at(70),
          endedGameMs: null,
        },
      ],
      openingBalance: Money.ZERO,
    };
    // The tractor pays 22 per hour and the plow nothing (GDD section 89): 22 x 70 = 1 540.
    expect(accrueContinuousCosts(sources, { fromGameMs: at(0), toGameMs: at(100) }).operating).toBe(
      Money.fromUnits(1_540),
    );
  });

  it('stops the operating integral at the real end of a cancelled task', () => {
    // Plan section 2.2: cancellation refunds nothing, but the integral must stop where the
    // work stopped, which is why the task row keeps both instants.
    const cancelled: AccrualSources = {
      workers: [],
      machines: [],
      tasks: [
        {
          machineTypes: [MachineType.HARVESTER],
          startGameMs: at(0),
          scheduledEndGameMs: at(98),
          endedGameMs: at(30),
        },
      ],
      openingBalance: Money.ZERO,
    };
    // 60 per hour for 30 hours instead of 98.
    expect(
      accrueContinuousCosts(cancelled, { fromGameMs: at(0), toGameMs: at(100) }).operating,
    ).toBe(Money.fromUnits(1_800));
  });

  it('charges no overdraft interest at the default rate of zero', () => {
    const sources: AccrualSources = {
      ...oneWorker,
      openingBalance: Money.fromUnits(-50_000),
    };
    expect(accrueContinuousCosts(sources, { fromGameMs: at(0), toGameMs: at(100) }).interest).toBe(
      Money.ZERO,
    );
  });

  it('charges overdraft interest on the negative part only, once a rate is configured', () => {
    const config = { ...DEFAULT_ACCRUAL_CONFIG, overdraftInterestBpPerGameHour: bp(10) };
    const indebted: AccrualSources = {
      workers: [],
      machines: [],
      tasks: [],
      openingBalance: Money.fromUnits(-10_000),
    };
    // 0.1 % per game hour of 10 000 over 100 hours: 10 x 100 = 1 000.
    expect(
      accrueContinuousCosts(indebted, { fromGameMs: at(0), toGameMs: at(100) }, config).interest,
    ).toBe(Money.fromUnits(1_000));
    // A positive balance earns nothing and is never charged.
    expect(
      accrueContinuousCosts(
        { ...indebted, openingBalance: Money.fromUnits(10_000) },
        { fromGameMs: at(0), toGameMs: at(100) },
        config,
      ).interest,
    ).toBe(Money.ZERO);
  });

  it('keeps sub-millisecond precision in the integral rather than rounding per source', () => {
    // A rate of one ten-thousandth per game hour over one game hour: the exact integral is
    // one scaled unit, which a per source rounding to cents would lose entirely.
    const tiny: AccrualSources = {
      workers: [
        {
          salaryPerGameHour: Money.fromScaled(1n),
          hiredGameMs: at(0),
          terminatedGameMs: null,
        },
      ],
      machines: [],
      tasks: [],
      openingBalance: Money.ZERO,
    };
    expect(accrueContinuousCosts(tiny, { fromGameMs: at(0), toGameMs: at(1) }).wages).toBe(
      Money.fromString('0.0001'),
    );
    expect(integralToMoney(3_600_000n)).toBe(Money.fromString('0.0001'));
  });

  it('reproduces the whole first cycle of GDD section 118 from its sources', () => {
    // The same timeline the balance calculator builds, assembled by hand here so the two
    // are cross checked: plow 0 to 70.028, seed to 131.302, growth to 227.302, harvest to
    // 325.342.
    const sources: AccrualSources = {
      workers: [
        { salaryPerGameHour: Money.fromUnits(15), hiredGameMs: at(0), terminatedGameMs: null },
      ],
      machines: FLEET.map((type) => ({ type, acquiredGameMs: at(0), disposedGameMs: null })),
      tasks: [
        {
          machineTypes: [MachineType.TRACTOR, MachineType.PLOW],
          startGameMs: at(0),
          scheduledEndGameMs: at(70.028011),
          endedGameMs: null,
        },
        {
          machineTypes: [MachineType.TRACTOR, MachineType.SEEDER],
          startGameMs: at(70.028011),
          scheduledEndGameMs: at(131.302515),
          endedGameMs: null,
        },
        {
          machineTypes: [MachineType.HARVESTER, MachineType.TRAILER],
          startGameMs: at(227.302515),
          scheduledEndGameMs: at(325.341721),
          endedGameMs: null,
        },
      ],
      openingBalance: Money.ZERO,
    };
    const accrual = accrueContinuousCosts(sources, {
      fromGameMs: at(0),
      toGameMs: at(325.341721),
    });
    // Compared with a tolerance of a thousandth of a currency unit, because the phase
    // boundaries here are typed as decimal hours and rounded to whole milliseconds one at
    // a time, while the calculator accumulates them; the difference is the rounding of a
    // couple of milliseconds and not a difference in the integral.
    const near = (actual: Money, expected: string): void => {
      const difference = Money.toScaled(actual) - Money.toScaled(Money.fromString(expected));
      expect(difference <= 10n && difference >= -10n).toBe(true);
    };
    near(accrual.wages, '4880.1258');
    near(accrual.maintenance, '12037.6437');
    near(accrual.operating, '8771.0084');
  });

  it('agrees with the hourly rate when nothing changes over the window', () => {
    const machines = FLEET.map((type) => ({ type, acquiredGameMs: at(0), disposedGameMs: null }));
    const rate = holdingRatePerGameHour({
      workers: [{ salaryPerGameHour: Money.fromUnits(15) }],
      machines: FLEET.map((type) => ({ type, status: MachineStatus.IDLE })),
    });
    const accrual = accrueContinuousCosts(
      {
        workers: [
          { salaryPerGameHour: Money.fromUnits(15), hiredGameMs: at(0), terminatedGameMs: null },
        ],
        machines,
        tasks: [],
        openingBalance: Money.ZERO,
      },
      { fromGameMs: at(0), toGameMs: at(10) },
    );
    expect(accrual.total).toBe(Money.mulHours(rate.totalPerGameHour, accrual.windowGameHours));
  });

  it('uses the catalogue that is injected, so a test can pin the rates', () => {
    const catalogue = {
      ...MACHINE_CATALOGUE,
      TRACTOR: { ...MACHINE_CATALOGUE.TRACTOR, maintenanceCostPerGameHour: Money.fromUnits(100) },
    };
    const accrual = accrueContinuousCosts(
      {
        workers: [],
        machines: [{ type: MachineType.TRACTOR, acquiredGameMs: at(0), disposedGameMs: null }],
        tasks: [],
        openingBalance: Money.ZERO,
      },
      { fromGameMs: at(0), toGameMs: at(10) },
      { ...DEFAULT_ACCRUAL_CONFIG, catalogue },
    );
    expect(accrual.maintenance).toBe(Money.fromUnits(1_000));
  });
});
