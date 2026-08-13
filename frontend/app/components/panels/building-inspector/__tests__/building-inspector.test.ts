// The building inspector against the simulated server.
//
// Owner: W4-F.
//
// The two refusals of a demolition are what this suite is really about. The server checks
// them before it writes anything, and both answer `BUILDING_NOT_EMPTY`: a garage with a
// machine inside, and a store whose capacity the farm is still using. A panel that offered
// the button anyway would send a request that cannot succeed, and a panel that refused for a
// different reason would tell the player something the server does not say.

import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BuildingInspectorPanel from '~/components/panels/building-inspector/BuildingInspectorPanel.vue';
import {
  labelOfMachineStatus,
  labelOfMachineType,
} from '~/components/panels/machinery/machineryPresentation';
import { formatMoney, formatQuantity } from '~/composables/useFormatting';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { createMockTransport } from '~/mock/index';
import { createMockServer, type MockServer } from '~/mock/server';
import { apiCall, apiOpenSession } from '~/net/api';
import { configureClientRuntime, resetClientRuntime } from '~/net/runtime';
import { resetSession } from '~/net/session';
import { resetHttpTransport, setHttpTransport } from '~/net/transport';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  STORAGE_RESOURCE_UNITS,
  VALIDATION_MESSAGES,
  ValidationCode,
  fromWireMoney,
  type BuildingDto,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useMachinesStore } from '~/stores/machines';
import { useSyncStore } from '~/stores/sync';

let server: MockServer;

async function bootstrap(): Promise<void> {
  await apiOpenSession('POST /api/auth/login', {
    email: 'dev@farm-world.local',
    password: 'farm-world-dev',
  });
  const snapshot = await apiCall('GET /api/state/snapshot');
  useSyncStore().applySnapshot(snapshot);
}

function buildingOf(type: BuildingType): BuildingDto {
  const found = useBuildingsStore().all.find((building) => building.type === type);
  if (found === undefined) {
    throw new Error(`El mundo de ejemplo no tiene ningun edificio de tipo ${type}.`);
  }
  return found;
}

function buttonWith(wrapper: VueWrapper, label: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(label));
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  setActivePinia(createPinia());
  resetSession();
  resetClientRuntime();
  configureClientRuntime({ validateReplies: true, requestTimeoutRealMs: 2_000 });
  server = createMockServer({ sessionOpen: false });
  setHttpTransport(createMockTransport(server));
  gameBridge().clear();
  useShellUi().reset();
});

afterEach(() => {
  resetHttpTransport();
  resetSession();
  resetClientRuntime();
  gameBridge().clear();
});

describe('el inspector de edificio', () => {
  it('sin edificio dice que no hay ninguno seleccionado', () => {
    const wrapper = mount(BuildingInspectorPanel);
    expect(wrapper.text()).toContain('Ningun edificio seleccionado');
    wrapper.unmount();
  });

  it('pinta tipo, capacidad de catalogo y valor de reventa', async () => {
    await bootstrap();
    const garage = buildingOf(BuildingType.GARAGE);

    const wrapper = mount(BuildingInspectorPanel, { props: { buildingId: garage.id } });
    const text = wrapper.text();

    expect(text).toContain('Garaje');
    expect(text).toContain(`${BUILDING_CATALOGUE.GARAGE.capacity} plazas`);
    expect(text).toContain('§96');
    expect(text).toContain(`(${garage.originCellX}, ${garage.originCellY})`);
    expect(text).toContain(formatMoney(fromWireMoney(garage.resaleValue)));
    wrapper.unmount();
  });

  it('muestra el contenido del silo como existencias de la granja', async () => {
    await bootstrap();
    const silo = buildingOf(BuildingType.SILO);
    const farmWheat = server.world.farm.wheat;
    const units = STORAGE_RESOURCE_UNITS.WHEAT_LITERS;

    const wrapper = mount(BuildingInspectorPanel, { props: { buildingId: silo.id } });
    const text = wrapper.text();

    expect(text).toContain('Contenido');
    expect(text).toContain(
      formatQuantity(farmWheat.storedUnits, units.displayDivisor, units.displayUnit),
    );
    expect(text).toContain('son de la granja');
    expect(text).toContain('§27');
    wrapper.unmount();
  });

  it('lista los ocupantes del garaje', async () => {
    await bootstrap();
    const garage = buildingOf(BuildingType.GARAGE);
    const parked = useMachinesStore().all.filter((machine) => machine.garageId === garage.id);
    expect(parked.length).toBeGreaterThan(0);

    const wrapper = mount(BuildingInspectorPanel, { props: { buildingId: garage.id } });
    const text = wrapper.text();

    expect(text).toContain('Ocupantes');
    expect(text).toContain(`${garage.occupancy} de ${garage.capacity} plazas`);
    // The label in Spanish and not the enum identifier: the occupant reads the same here and
    // in the machinery panel, which is what the shared table exists for
    // (docs/handoff/NOTES-w5f.md 3.1).
    for (const machine of parked) {
      expect(text).toContain(labelOfMachineType(machine.type));
      expect(text).toContain(labelOfMachineStatus(machine.status));
    }
    wrapper.unmount();
  });

  it('bloquea la demolicion de un edificio con ocupantes, con el codigo del contrato', async () => {
    await bootstrap();
    const garage = buildingOf(BuildingType.GARAGE);
    expect(garage.occupancy).toBeGreaterThan(0);

    const wrapper = mount(BuildingInspectorPanel, { props: { buildingId: garage.id } });

    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.BUILDING_NOT_EMPTY]);
    expect(buttonWith(wrapper, 'Retirar edificio')?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('bloquea la demolicion de un silo cuyas existencias no cabrian sin el', async () => {
    await bootstrap();
    const silo = buildingOf(BuildingType.SILO);
    expect(silo.occupancy).toBe(0);
    expect(server.world.farm.wheat.storedUnits).toBeGreaterThan(0);

    const wrapper = mount(BuildingInspectorPanel, { props: { buildingId: silo.id } });

    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.BUILDING_NOT_EMPTY]);
    expect(buttonWith(wrapper, 'Retirar edificio')?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('retira un edificio vacio y declara el reembolso', async () => {
    await bootstrap();
    const workshop = buildingOf(BuildingType.WORKSHOP);
    const buildings = useBuildingsStore();
    const before = buildings.count;
    const refund = fromWireMoney(workshop.resaleValue);

    const wrapper = mount(BuildingInspectorPanel, { props: { buildingId: workshop.id } });
    await buttonWith(wrapper, 'Retirar edificio')?.trigger('click');
    // The demolition is confirmed twice: it moves money and it cannot be undone.
    expect(wrapper.text()).toContain('Confirmar retirada');
    await buttonWith(wrapper, 'Confirmar retirada')?.trigger('click');
    await flush();

    expect(buildings.count).toBe(before - 1);
    expect(buildings.get(workshop.id)).toBeUndefined();
    expect(wrapper.text()).toContain('Edificio retirado');
    expect(wrapper.text()).toContain(formatMoney(refund));
    wrapper.unmount();
  });
});
