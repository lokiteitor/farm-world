// The machinery panel: the catalogue, the holding and the reason a purchase is blocked.
//
// Owner: W5-F.
//
// The three refusal orders are asserted on `machineryPresentation.ts` directly, because they
// are pure and a table is the wrong place to read an order of evaluation from. What is
// asserted on the component is what only the component can be wrong about: that a machine is
// named in Spanish rather than by its enum identifier, that every amount goes through
// `useFormatting`, and that the block of GDD section 96 disappears exactly when a garage
// place is freed, which is the one interaction of this panel that spans two requests.
//
// The suite runs against the simulated server through the real client and the real reducer
// (`cell-inspector/__tests__/harness.ts`), so the replies are validated against the Zod
// schemas of the contract on the way in.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import MachineryPanel from '~/components/panels/machinery/MachineryPanel.vue';
import {
  MACHINE_STATUS_LABELS,
  MACHINE_TYPE_LABELS,
  conditionTone,
  garageOccupancy,
  purchaseBlockingCode,
  repairBlockingCode,
  sellBlockingCode,
} from '~/components/panels/machinery/machineryPresentation';
import { formatMoney } from '~/composables/useFormatting';
import { useShellUi } from '~/composables/useShellUi';
import { MOCK_FARM_ID } from '~/mock/world';
import {
  CONDITION_WARNING_THRESHOLD,
  BuildingType,
  MACHINE_CATALOGUE,
  MACHINE_TYPES,
  MIN_CONDITION_TO_ASSIGN,
  MachineStatus,
  MachineType,
  Money,
  VALIDATION_MESSAGES,
  ValidationCode,
  bp,
  fromWireMoney,
  type MachineDto,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useMachinesStore } from '~/stores/machines';

function machine(overrides: Partial<MachineDto> = {}): MachineDto {
  return {
    id: 'machine-x',
    farmId: 'farm-1',
    garageId: 'building-garage',
    type: MachineType.TRACTOR,
    conditionBp: bp(5_000),
    conditionUpdatedAtGameMs: '0',
    status: MachineStatus.IDLE,
    currentTaskId: null,
    repairEndsAtGameMs: null,
    purchasePrice: '18000.0000',
    acquiredGameMs: '0',
    resaleValue: '9000.0000',
    repairCost: '2700.0000',
    repairDurationGameHours: 12.5,
    assignable: true,
    ...overrides,
  };
}

describe('las tres negativas de la maquinaria', () => {
  const rich = Money.fromUnits(500_000);

  it('sin plaza de garaje la compra se niega antes que nada (§96)', () => {
    expect(
      purchaseBlockingCode({
        freeGarageSlots: 0,
        settledBalance: rich,
        price: MACHINE_CATALOGUE.TRACTOR.purchasePrice,
      }),
    ).toBe(ValidationCode.GARAGE_CAPACITY_EXCEEDED);
  });

  it('con plaza y saldo negativo, el gasto discrecional queda bloqueado', () => {
    expect(
      purchaseBlockingCode({
        freeGarageSlots: 1,
        settledBalance: Money.fromUnits(-1),
        price: MACHINE_CATALOGUE.PLOW.purchasePrice,
      }),
    ).toBe(ValidationCode.SPENDING_BLOCKED_IN_DEBT);
  });

  it('con plaza y saldo corto, el motivo es el importe', () => {
    expect(
      purchaseBlockingCode({
        freeGarageSlots: 1,
        settledBalance: Money.fromUnits(100),
        price: MACHINE_CATALOGUE.HARVESTER.purchasePrice,
      }),
    ).toBe(ValidationCode.INSUFFICIENT_FUNDS);
    expect(
      purchaseBlockingCode({
        freeGarageSlots: 1,
        settledBalance: rich,
        price: MACHINE_CATALOGUE.HARVESTER.purchasePrice,
      }),
    ).toBeNull();
  });

  it('una maquina reservada por una tarea no se vende', () => {
    expect(sellBlockingCode(machine())).toBeNull();
    expect(sellBlockingCode(machine({ status: MachineStatus.WORKING }))).toBe(
      ValidationCode.MACHINE_NOT_IDLE,
    );
    expect(sellBlockingCode(machine({ currentTaskId: 'task-1' }))).toBe(
      ValidationCode.MACHINE_NOT_IDLE,
    );
  });

  it('la falta de taller responde antes que el estado de la maquina (§29 y §93)', () => {
    expect(
      repairBlockingCode({
        machine: machine({ conditionBp: bp(10_000) }),
        hasWorkshop: false,
        settledBalance: Money.fromUnits(1_000_000),
      }),
    ).toBe(ValidationCode.WORKSHOP_REQUIRED);
    expect(
      repairBlockingCode({
        machine: machine({ conditionBp: bp(10_000) }),
        hasWorkshop: true,
        settledBalance: Money.fromUnits(1_000_000),
      }),
    ).toBe(ValidationCode.MACHINE_CONDITION_ALREADY_FULL);
    expect(
      repairBlockingCode({
        machine: machine(),
        hasWorkshop: true,
        settledBalance: Money.fromUnits(10),
      }),
    ).toBe(ValidationCode.INSUFFICIENT_FUNDS);
    expect(
      repairBlockingCode({
        machine: machine(),
        hasWorkshop: true,
        settledBalance: Money.fromUnits(10_000),
      }),
    ).toBeNull();
  });

  it('el tono de la condicion sale de los dos umbrales del catalogo (§93)', () => {
    expect(conditionTone(MIN_CONDITION_TO_ASSIGN - 1)).toBe('danger');
    expect(conditionTone(CONDITION_WARNING_THRESHOLD - 1)).toBe('warning');
    expect(conditionTone(CONDITION_WARNING_THRESHOLD)).toBe('neutral');
  });

  it('los ocho tipos y los cuatro estados tienen etiqueta en castellano', () => {
    for (const type of MACHINE_TYPES) {
      expect(MACHINE_TYPE_LABELS[type]).not.toBe(type);
      expect(MACHINE_TYPE_LABELS[type].length).toBeGreaterThan(2);
    }
    for (const status of Object.values(MachineStatus)) {
      expect(MACHINE_STATUS_LABELS[status]).not.toBe(status);
    }
  });
});

describe('el panel de maquinaria', () => {
  beforeEach(async () => {
    await bootMockClient();
  });

  afterEach(() => {
    teardownMockClient();
  });

  /** Free garage places as the panel counts them: capacity of the garages minus machines. */
  function freeSlots(): number {
    return garageOccupancy(
      useBuildingsStore().ofType(MOCK_FARM_ID, BuildingType.GARAGE),
      useMachinesStore().ofFarm(MOCK_FARM_ID),
    ).free;
  }

  it('pinta el parque con nombre, estado y condicion en castellano', async () => {
    const machines = useMachinesStore();
    const wrapper = mount(MachineryPanel);
    await settle();

    const text = wrapper.text();
    expect(machines.count).toBe(4);
    for (const owned of machines.all) {
      expect(text).toContain(MACHINE_TYPE_LABELS[owned.type]);
      expect(text).toContain(MACHINE_STATUS_LABELS[owned.status]);
      expect(text).toContain(formatMoney(fromWireMoney(owned.resaleValue)));
    }
    // The enum identifier must not reach the player: it is what NOTES-w4f 2.4 records.
    expect(text).not.toContain('HARVESTER');
    wrapper.unmount();
  });

  it('el garaje lleno bloquea toda compra con el motivo de la seccion 96', async () => {
    const wrapper = mount(MachineryPanel);
    await settle();
    expect(freeSlots()).toBe(0);
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.GARAGE_CAPACITY_EXCEEDED]);
    const buy = wrapper
      .findAll('button')
      .filter((button) => button.text().startsWith('Comprar por'));
    expect(buy.length).toBe(MACHINE_TYPES.length);
    expect(buy.every((button) => button.attributes('disabled') !== undefined)).toBe(true);
    wrapper.unmount();
  });

  it('la maquina de la tarea en curso no se vende y lo dice', async () => {
    const wrapper = mount(MachineryPanel);
    await settle();
    const sell = wrapper.findAll('button').filter((button) => button.text() === 'Vender');
    // Two of the four machines of the sample world are reserved by the ploughing task.
    expect(sell.filter((button) => button.attributes('disabled') !== undefined)).toHaveLength(2);
    expect(
      sell.some(
        (button) =>
          button.attributes('title') === VALIDATION_MESSAGES[ValidationCode.MACHINE_NOT_IDLE],
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it('vender libera la plaza y desbloquea la compra que cabe en el saldo', async () => {
    const machines = useMachinesStore();
    const wrapper = mount(MachineryPanel);
    await settle();

    const seeder = machines.all.find((owned) => owned.type === MachineType.SEEDER);
    expect(seeder).toBeDefined();
    const rowIndex = machines.all.findIndex((owned) => owned.id === seeder?.id);
    const sellButtons = wrapper.findAll('button').filter((button) => button.text() === 'Vender');
    await sellButtons[rowIndex]?.trigger('click');
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('Confirmar venta'));
    await confirm?.trigger('click');
    await settle();

    expect(machines.count).toBe(3);
    expect(freeSlots()).toBe(1);

    // With one place free the block moves on to the money, which is the next check of the
    // server: the cultivator fits in the balance of the sample world and the combine does not.
    const cultivator = wrapper
      .findAll('button')
      .find((button) =>
        button.text().includes(formatMoney(MACHINE_CATALOGUE.CULTIVATOR.purchasePrice)),
      );
    expect(cultivator?.attributes('disabled')).toBeUndefined();
    const harvester = wrapper
      .findAll('button')
      .find((button) =>
        button.text().includes(formatMoney(MACHINE_CATALOGUE.HARVESTER.purchasePrice)),
      );
    expect(harvester?.attributes('disabled')).toBeDefined();
    expect(harvester?.attributes('title')).toBe(
      VALIDATION_MESSAGES[ValidationCode.INSUFFICIENT_FUNDS],
    );

    await cultivator?.trigger('click');
    await settle();
    expect(machines.count).toBe(4);
    expect(machines.all.some((owned) => owned.type === MachineType.CULTIVATOR)).toBe(true);
    wrapper.unmount();
  });

  it('ofrece la entrada a la guia de arranque, que su pestana no alcanza', async () => {
    const wrapper = mount(MachineryPanel);
    await settle();
    const button = wrapper.findAll('button').find((entry) => entry.text() === 'Guia de arranque');
    await button?.trigger('click');
    expect(useShellUi().sidePanel.value?.panelId).toBe('starting-guide');
    wrapper.unmount();
  });

  it('reparar cobra el coste de la formula de la seccion 93 y deja la maquina en el taller', async () => {
    const machines = useMachinesStore();
    const wrapper = mount(MachineryPanel);
    await settle();

    const combine = machines.all.find((owned) => owned.type === MachineType.HARVESTER);
    expect(combine).toBeDefined();
    const cost = fromWireMoney(combine?.repairCost ?? '0');
    expect(wrapper.text()).toContain(formatMoney(cost));

    const rowIndex = machines.all.findIndex((owned) => owned.id === combine?.id);
    const repairButtons = wrapper.findAll('button').filter((button) => button.text() === 'Reparar');
    await repairButtons[rowIndex]?.trigger('click');
    await settle();

    const repaired = machines.get(combine?.id ?? '');
    expect(repaired?.status).toBe(MachineStatus.IN_REPAIR);
    expect(repaired?.conditionBp).toBe(10_000);
    expect(wrapper.text()).toContain(MACHINE_STATUS_LABELS.IN_REPAIR);
    expect(wrapper.text()).toContain('En taller');
    wrapper.unmount();
  });
});
