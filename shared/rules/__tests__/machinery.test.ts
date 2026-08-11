import { describe, expect, it } from 'vitest';
import { MACHINE_CATALOGUE, MIN_CONDITION_TO_ASSIGN } from '../../config/machines.js';
import { MachineStatus, MachineType, ValidationCode } from '../../domain/enums.js';
import { Money } from '../../domain/money.js';
import { BP_ONE, bp } from '../../domain/units.js';
import {
  canAssignMachine,
  canRepairMachine,
  conditionAfterWork,
  conditionPointsToRestore,
  explainIncompatibility,
  isOperationCompatible,
  machineTypesForOperation,
  repairCost,
  repairDurationGameHours,
} from '../machinery.js';

// The compatibility table of GDD section 90 and the wear and repair of GDD section 93.

describe('conditionAfterWork (GDD section 93)', () => {
  it('applies the wear rate of the type per hour worked', () => {
    // The rates are invented (GDD section 93 never defines `wearRatePerHour`) and live in
    // the catalogue: 15 bp/h for the tractor and its implements, 25 for the combine, 30
    // for forestry machinery.
    expect(conditionAfterWork(BP_ONE, 100, MACHINE_CATALOGUE.TRACTOR)).toBe(8_500);
    expect(conditionAfterWork(BP_ONE, 100, MACHINE_CATALOGUE.HARVESTER)).toBe(7_500);
    expect(conditionAfterWork(BP_ONE, 100, MACHINE_CATALOGUE.HARVESTER_FORESTRY)).toBe(7_000);
  });

  it('takes a full tractor from new to nothing in about two agricultural cycles', () => {
    // 10 000 bp / 15 bp per hour = 666.67 hours worked, against the 325 hour cycle of GDD
    // section 118, of which about 131 hours are actually worked by the tractor.
    expect(conditionAfterWork(BP_ONE, 666, MACHINE_CATALOGUE.TRACTOR)).toBe(10);
    expect(conditionAfterWork(BP_ONE, 667, MACHINE_CATALOGUE.TRACTOR)).toBe(0);
    expect(conditionAfterWork(BP_ONE, 5_000, MACHINE_CATALOGUE.TRACTOR)).toBe(0);
  });

  it('applies prorated wear, which is what a cancelled task charges', () => {
    // Plan section 2.2: cancellation refunds nothing and applies the wear of the hours it
    // actually ran.
    expect(conditionAfterWork(BP_ONE, 35.014, MACHINE_CATALOGUE.TRACTOR)).toBe(9_475);
    expect(conditionAfterWork(BP_ONE, 0, MACHINE_CATALOGUE.TRACTOR)).toBe(BP_ONE);
    expect(conditionAfterWork(BP_ONE, -5, MACHINE_CATALOGUE.TRACTOR)).toBe(BP_ONE);
  });
});

describe('repair (GDD section 93)', () => {
  it('charges the missing points times the rate of the catalogue', () => {
    // `repairCost = (100 - condition) x repairCostPerPoint`, with the rate at 0.30 % of
    // the purchase price per point (invented, justified in the catalogue).
    expect(conditionPointsToRestore(bp(5_000))).toBe(50);
    expect(repairCost(bp(5_000), MACHINE_CATALOGUE.TRACTOR)).toBe(Money.fromUnits(2_700));
    expect(repairCost(BP_ONE, MACHINE_CATALOGUE.TRACTOR)).toBe(Money.ZERO);
    // A full repair from zero costs 30 % of a new machine.
    expect(repairCost(bp(0), MACHINE_CATALOGUE.TRACTOR)).toBe(Money.fromUnits(5_400));
    expect(repairCost(bp(0), MACHINE_CATALOGUE.HARVESTER)).toBe(Money.fromUnits(12_600));
  });

  it('derives the rate per point from the purchase price', () => {
    for (const type of Object.values(MachineType)) {
      const definition = MACHINE_CATALOGUE[type];
      const fromPrice = Money.mulBp(definition.purchasePrice, bp(30));
      expect(definition.repairCostPerConditionPoint).toBe(fromPrice);
    }
  });

  it('takes a quarter of a game hour per point restored', () => {
    // Invented duration: GDD section 93 gives repair no duration, and plan section 2.2
    // turns it into a scheduled event so that `IN_REPAIR` becomes a real state.
    expect(repairDurationGameHours(bp(0))).toBe(25);
    expect(repairDurationGameHours(bp(5_000))).toBe(12.5);
    expect(repairDurationGameHours(BP_ONE)).toBe(0);
  });

  it('requires a workshop, an idle machine and something to repair', () => {
    const worn = { type: MachineType.TRACTOR, conditionBp: bp(4_000), status: MachineStatus.IDLE };
    expect(canRepairMachine(worn, true)).toBeNull();
    expect(canRepairMachine(worn, false)).toBe(ValidationCode.WORKSHOP_REQUIRED);
    expect(canRepairMachine({ ...worn, conditionBp: BP_ONE }, true)).toBe(
      ValidationCode.MACHINE_CONDITION_ALREADY_FULL,
    );
    expect(canRepairMachine({ ...worn, status: MachineStatus.WORKING }, true)).toBe(
      ValidationCode.MACHINE_NOT_REPAIRABLE,
    );
    expect(canRepairMachine({ ...worn, status: MachineStatus.IN_REPAIR }, true)).toBe(
      ValidationCode.MACHINE_NOT_REPAIRABLE,
    );
  });
});

describe('canAssignMachine', () => {
  it('refuses a machine that is not idle', () => {
    for (const status of [MachineStatus.WORKING, MachineStatus.BROKEN, MachineStatus.IN_REPAIR]) {
      expect(canAssignMachine({ type: MachineType.TRACTOR, conditionBp: BP_ONE, status })).toBe(
        ValidationCode.MACHINE_NOT_IDLE,
      );
    }
  });

  it('refuses a machine below the condition floor, where the curve is clamped', () => {
    const idle = { type: MachineType.TRACTOR, status: MachineStatus.IDLE };
    expect(canAssignMachine({ ...idle, conditionBp: MIN_CONDITION_TO_ASSIGN })).toBeNull();
    expect(canAssignMachine({ ...idle, conditionBp: bp(999) })).toBe(
      ValidationCode.MACHINE_CONDITION_TOO_LOW,
    );
    expect(canAssignMachine({ ...idle, conditionBp: bp(0) })).toBe(
      ValidationCode.MACHINE_CONDITION_TOO_LOW,
    );
  });
});

describe('compatibility of operation and machinery (GDD section 90)', () => {
  const owned: readonly MachineType[] = [];

  it('accepts every row of the published table', () => {
    expect(
      isOperationCompatible({
        operation: 'PLOW',
        offeredMachineTypes: [MachineType.TRACTOR, MachineType.PLOW],
        ownedMachineTypes: owned,
      }),
    ).toBe(true);
    expect(
      isOperationCompatible({
        operation: 'CULTIVATE',
        offeredMachineTypes: [MachineType.TRACTOR, MachineType.CULTIVATOR],
        ownedMachineTypes: owned,
      }),
    ).toBe(true);
    expect(
      isOperationCompatible({
        operation: 'SEED',
        offeredMachineTypes: [MachineType.TRACTOR, MachineType.SEEDER],
        ownedMachineTypes: owned,
      }),
    ).toBe(true);
    expect(
      isOperationCompatible({
        operation: 'HARVEST',
        offeredMachineTypes: [MachineType.HARVESTER, MachineType.TRAILER],
        ownedMachineTypes: owned,
      }),
    ).toBe(true);
  });

  it('names the missing powered machine', () => {
    expect(
      explainIncompatibility({
        operation: 'PLOW',
        offeredMachineTypes: [MachineType.PLOW],
        ownedMachineTypes: owned,
      }),
    ).toEqual([ValidationCode.POWERED_MACHINE_REQUIRED]);
  });

  it('names the missing implement, and the trailer by its own code', () => {
    expect(
      explainIncompatibility({
        operation: 'PLOW',
        offeredMachineTypes: [MachineType.TRACTOR],
        ownedMachineTypes: owned,
      }),
    ).toEqual([ValidationCode.IMPLEMENT_REQUIRED]);
    expect(
      explainIncompatibility({
        operation: 'HARVEST',
        offeredMachineTypes: [MachineType.HARVESTER],
        ownedMachineTypes: owned,
      }),
    ).toEqual([ValidationCode.TRAILER_REQUIRED]);
  });

  it('refuses a tractor with the wrong implement for the operation', () => {
    // Plowing with a seeder: the seeder is not the implement the operation needs, and it
    // is also not allowed to be reserved by it.
    expect(
      explainIncompatibility({
        operation: 'PLOW',
        offeredMachineTypes: [MachineType.TRACTOR, MachineType.SEEDER],
        ownedMachineTypes: owned,
      }),
    ).toEqual([ValidationCode.IMPLEMENT_REQUIRED, ValidationCode.IMPLEMENT_NOT_ALLOWED]);
  });

  it('refuses reserving a machine the operation does not need', () => {
    expect(
      explainIncompatibility({
        operation: 'PLOW',
        offeredMachineTypes: [MachineType.TRACTOR, MachineType.PLOW, MachineType.TRAILER],
        ownedMachineTypes: owned,
      }),
    ).toEqual([ValidationCode.IMPLEMENT_NOT_ALLOWED]);
  });

  it('refuses towing an implement the powered machine cannot take', () => {
    // The combine can only take the trailer (GDD sections 88 and 89), so a plow behind a
    // combine is rejected even though both machines exist.
    expect(
      explainIncompatibility({
        operation: 'HARVEST',
        offeredMachineTypes: [MachineType.HARVESTER, MachineType.PLOW],
        ownedMachineTypes: owned,
      }),
    ).toEqual([ValidationCode.TRAILER_REQUIRED, ValidationCode.IMPLEMENT_NOT_ALLOWED]);
  });

  it('requires owning the forwarder to fell, without reserving it', () => {
    // GDD section 134 lists the forwarder as required machinery; plan section 2.2 keeps it
    // as an ownership requirement until transport is modelled.
    expect(
      explainIncompatibility({
        operation: 'FELL',
        offeredMachineTypes: [MachineType.HARVESTER_FORESTRY],
        ownedMachineTypes: [],
      }),
    ).toEqual([ValidationCode.FORWARDER_REQUIRED]);
    expect(
      isOperationCompatible({
        operation: 'FELL',
        offeredMachineTypes: [MachineType.HARVESTER_FORESTRY],
        ownedMachineTypes: [MachineType.FORWARDER],
      }),
    ).toBe(true);
  });

  it('does not reuse agricultural machinery for forestry', () => {
    // GDD section 134 is explicit that the catalogues are separate: expanding into
    // forestry is a new capital investment, not a new implement.
    expect(
      isOperationCompatible({
        operation: 'FELL',
        offeredMachineTypes: [MachineType.TRACTOR, MachineType.PLOW],
        ownedMachineTypes: [MachineType.FORWARDER],
      }),
    ).toBe(false);
  });

  it('reports an unsupported operation once and stops', () => {
    expect(
      explainIncompatibility(
        { operation: 'PLOW', offeredMachineTypes: [], ownedMachineTypes: [] },
        // An empty table stands in for an operation the catalogue does not describe.
        { requirements: {} as never },
      ),
    ).toEqual([ValidationCode.OPERATION_NOT_SUPPORTED]);
  });

  it('lists the machine types the interface has to offer for each operation', () => {
    expect(machineTypesForOperation('PLOW')).toEqual([MachineType.TRACTOR, MachineType.PLOW]);
    expect(machineTypesForOperation('HARVEST')).toEqual([
      MachineType.HARVESTER,
      MachineType.TRAILER,
    ]);
    expect(machineTypesForOperation('FELL')).toEqual([MachineType.HARVESTER_FORESTRY]);
  });
});
