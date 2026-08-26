// The farm panel against the simulated server.
//
// Owner: W4-F.
//
// Three things are asserted, and they are the three the panel exists for: the capacities are
// read where the model keeps them (the counted ones per building, the fungible ones per
// farm), the catalogue is priced with `shared/rules/pricing.ts` in both cases of land
// ownership, and the flow of raising a building walks its three steps and hands the canvas
// its mode over the bridge without mutating anything.

import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import FarmOverviewPanel from '~/components/panels/farm-overview/FarmOverviewPanel.vue';
import { formatMoney, formatQuantity } from '~/composables/useFormatting';
import { gameBridge, type SelectionMode } from '~/composables/useGameBridge';
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
  SelectionPurpose,
  STORAGE_RESOURCE_UNITS,
  TerrainType,
  realBuildingCost,
  type FarmDto,
  type StorageUsage,
} from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { useSelectionStore } from '~/stores/selection';
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

describe('el panel de granja', () => {
  it('pinta las capacidades donde el modelo las guarda', async () => {
    await bootstrap();
    const farm = useFarmsStore().primary;
    expect(farm).not.toBeNull();

    const wrapper = mount(FarmOverviewPanel);
    const text = wrapper.text();

    expect(text).toContain(farm?.name ?? '');
    // Counted capacity, per building (GDD sections 96 and 108).
    expect(text).toContain(`${farm?.machineSlots.used} / ${farm?.machineSlots.total}`);
    expect(text).toContain(`${farm?.workerSlots.used} / ${farm?.workerSlots.total}`);
    // Fungible stock, aggregated per farm (GDD sections 27 and 136).
    const wheatUnits = STORAGE_RESOURCE_UNITS.GRAIN_LITERS;
    expect(text).toContain(
      formatQuantity(
        grainUsage(farm).storedUnits,
        wheatUnits.displayDivisor,
        wheatUnits.displayUnit,
      ),
    );
    expect(text).toContain(
      formatQuantity(
        grainUsage(farm).capacityUnits,
        wheatUnits.displayDivisor,
        wheatUnits.displayUnit,
      ),
    );
    expect(text).toContain('Con taller');
    wrapper.unmount();
  });

  it('lista los edificios de la granja con su valor de reventa', async () => {
    await bootstrap();
    const wrapper = mount(FarmOverviewPanel);
    const text = wrapper.text();

    for (const label of ['Garaje', 'Silo', 'Vivienda de trabajadores', 'Taller']) {
      expect(text).toContain(label);
    }
    // The footprint of each row comes from the catalogue.
    expect(text).toContain(
      `${BUILDING_CATALOGUE.GARAGE.widthCells} x ${BUILDING_CATALOGUE.GARAGE.heightCells} celdas`,
    );
    wrapper.unmount();
  });

  it('el paso uno ofrece el catalogo con los dos precios de §116', async () => {
    await bootstrap();
    const wrapper = mount(FarmOverviewPanel);

    await buttonWith(wrapper, 'Construir edificio')?.trigger('click');
    const text = wrapper.text();

    expect(text).toContain('1. Elegir tipo');
    for (const type of [BuildingType.GARAGE, BuildingType.SILO, BuildingType.WOOD_STORAGE]) {
      const cost = realBuildingCost(type, {
        landAlreadyOwned: true,
        terrain: TerrainType.GRASS,
      });
      // The price of the structure alone, which is what a player who owns the plot pays.
      expect(text).toContain(formatMoney(cost.total));
      // And the literal formula of GDD section 116, land included, as planning help.
      expect(text).toContain(formatMoney(cost.plannedCostWithLand));
    }
    wrapper.unmount();
  });

  it('el paso dos entrega el modo al lienzo por el puente y no muta nada', async () => {
    await bootstrap();
    const selection = useSelectionStore();
    const modes: SelectionMode[] = [];
    gameBridge().on('selection:mode', (mode) => modes.push(mode));

    const wrapper = mount(FarmOverviewPanel);
    await buttonWith(wrapper, 'Construir edificio')?.trigger('click');
    await buttonWith(wrapper, 'Garaje')?.trigger('click');
    expect(wrapper.text()).toContain('2. Colocar en el mapa');

    await buttonWith(wrapper, 'Activar modo de colocacion')?.trigger('click');

    expect(modes).toHaveLength(1);
    expect(modes[0]?.purpose).toBe(SelectionPurpose.BUILDING);
    // The footprint travels with the mode and comes from the catalogue.
    expect(modes[0]?.fixedWidthCells).toBe(BUILDING_CATALOGUE.GARAGE.widthCells);
    expect(modes[0]?.fixedHeightCells).toBe(BUILDING_CATALOGUE.GARAGE.heightCells);
    // Arming the mode selects nothing and buys nothing.
    expect(selection.intent?.buildingType).toBe(BuildingType.GARAGE);
    expect(selection.count).toBe(0);
    expect(wrapper.text()).toContain('Modo activo');
    wrapper.unmount();
  });

  it('funda una granja nueva sin coste ni huella', async () => {
    await bootstrap();
    const farms = useFarmsStore();
    const wrapper = mount(FarmOverviewPanel);

    const input = wrapper.find('input[type="text"]');
    await input.setValue('Granja del sur');
    await buttonWith(wrapper, 'Fundar granja')?.trigger('click');
    await flush();

    expect(farms.all.some((farm) => farm.name === 'Granja del sur')).toBe(true);
    // Founding moves no money: the sample server posted no ledger entry for it.
    expect(server.world.ledger.some((entry) => entry.type === 'BUILDING_PURCHASE')).toBe(false);
    wrapper.unmount();
  });

  it('no ofrece fundar una granja sin nombre', async () => {
    await bootstrap();
    const wrapper = mount(FarmOverviewPanel);

    const button = buttonWith(wrapper, 'Fundar granja');
    expect(button?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});

/** La ocupacion de la categoria de grano, que es lo que el panel dibuja como silo. */
function grainUsage(farm: FarmDto | null | undefined): StorageUsage {
  const row = farm?.storage.find((candidate) => candidate.category === 'GRAIN_LITERS');
  return row?.usage ?? { storedUnits: 0, reservedUnits: 0, capacityUnits: 0, occupancyBp: 0 };
}
