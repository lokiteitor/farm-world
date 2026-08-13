// The placement panel against the simulated server.
//
// Owner: W4-F.
//
// The panel is exercised the way the game runs it: the real typed client over the mock
// transport, the real reducer, and the real chunk cache filled from `POST /api/world/chunks`
// so that ownership and terrain are resolved by `selectionCellAt` and not by a stub. What is
// asserted is the contract of the panel: the footprint comes from the catalogue, the cost is
// the one `shared/rules/pricing.ts` produces, an invalid footprint says why with the code of
// the contract, and confirming reaches the server and moves the state through the reducer.

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BuildingPlacementPanel from '~/components/panels/building-placement/BuildingPlacementPanel.vue';
import { footprintFromOrigin } from '~/components/panels/building-placement/placementPlan';
import { formatMoney } from '~/composables/useFormatting';
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
  CellOwnership,
  LandUse,
  Money,
  TerrainType,
  ValidationCode,
  landPurchasePrice,
  type CellCoordWire,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useSyncStore } from '~/stores/sync';
import { useWorldStore } from '~/stores/world';

let server: MockServer;

/** Opens the session, applies the snapshot and loads the chunks around the farm. */
async function bootstrap(): Promise<CellCoordWire> {
  await apiOpenSession('POST /api/auth/login', {
    email: 'dev@farm-world.local',
    password: 'farm-world-dev',
  });
  const snapshot = await apiCall('GET /api/state/snapshot');
  useSyncStore().applySnapshot(snapshot);

  const world = useWorldStore();
  const spawnX = snapshot.world.spawnCellX ?? 0;
  const spawnY = snapshot.world.spawnCellY ?? 0;
  const chunks = world.chunksForArea(spawnX - 48, spawnY - 48, spawnX + 48, spawnY + 48);
  const reply = await apiCall('POST /api/world/chunks', {
    body: { chunks: chunks.map((chunk) => ({ chunkX: chunk.chunkX, chunkY: chunk.chunkY })) },
  });
  for (const result of reply.chunks) {
    world.applyChunkResult(result, 0);
  }
  return { cellX: spawnX, cellY: spawnY };
}

/** The first anchor whose whole footprint is free, unowned grass. */
function findFreeOrigin(spawn: CellCoordWire, type: BuildingType): CellCoordWire {
  const world = useWorldStore();
  const viewer = usePlayerStore().id;
  const definition = BUILDING_CATALOGUE[type];
  for (let dy = -40; dy <= 40; dy += 1) {
    for (let dx = -40; dx <= 40; dx += 1) {
      const origin = { cellX: spawn.cellX + dx, cellY: spawn.cellY + dy };
      const cells = footprintFromOrigin(type, origin);
      const free = cells.every((cell) => {
        const resolved = world.selectionCellAt(cell.cellX, cell.cellY, viewer);
        return (
          resolved !== null &&
          resolved.terrain === TerrainType.GRASS &&
          resolved.ownership === CellOwnership.UNOWNED &&
          resolved.landUse === LandUse.NONE &&
          !resolved.hasStandingTree
        );
      });
      if (free && cells.length === definition.footprintCells) {
        return origin;
      }
    }
  }
  throw new Error('El mundo de ejemplo no ofrece ninguna huella libre cerca del origen.');
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

describe('el panel de colocacion', () => {
  it('pinta la huella del catalogo y el coste con el suelo cuando no es del jugador', async () => {
    const spawn = await bootstrap();
    const origin = findFreeOrigin(spawn, BuildingType.GARAGE);
    const definition = BUILDING_CATALOGUE[BuildingType.GARAGE];

    const wrapper = mount(BuildingPlacementPanel, {
      props: {
        type: BuildingType.GARAGE,
        originCellX: origin.cellX,
        originCellY: origin.cellY,
      },
    });
    const text = wrapper.text();

    expect(text).toContain(`${definition.widthCells} x ${definition.heightCells} celdas`);
    expect(text).toContain('Coste total');
    // The three figures are the ones the shared rules produce, never literals.
    const land = landPurchasePrice(
      Array.from({ length: definition.footprintCells }, () => TerrainType.GRASS),
    ).total;
    const total = Money.add(definition.purchasePrice, land);
    expect(text).toContain(formatMoney(definition.purchasePrice));
    expect(text).toContain(formatMoney(land));
    expect(text).toContain(formatMoney(total));
    expect(text).toContain('Colocacion valida');
    wrapper.unmount();
  });

  it('declara el motivo y bloquea la confirmacion sobre una huella ocupada', async () => {
    await bootstrap();
    const occupied = server.world.buildings[0];
    expect(occupied).toBeDefined();

    const wrapper = mount(BuildingPlacementPanel, {
      props: {
        type: BuildingType.SILO,
        originCellX: occupied?.originCellX ?? 0,
        originCellY: occupied?.originCellY ?? 0,
      },
    });

    expect(wrapper.text()).toContain(ValidationCode.BUILDING_FOOTPRINT_OVERLAPS);
    expect(wrapper.text()).toContain('Colocacion no valida');
    const confirm = wrapper.findAll('button').find((button) => button.text().includes('Confirmar'));
    expect(confirm?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('situa la huella centrada en la celda que el lienzo publica', async () => {
    const spawn = await bootstrap();
    const selection = useSelectionStore();
    const wrapper = mount(BuildingPlacementPanel, { props: { type: BuildingType.SILO } });

    gameBridge().emit('canvas:pick', {
      cell: spawn,
      subjectKind: 'CELL',
      subjectId: null,
      additive: false,
      subtractive: false,
    });
    await wrapper.vm.$nextTick();

    expect(selection.count).toBe(BUILDING_CATALOGUE.SILO.footprintCells);
    // Centred on the cursor, which is what `game/selection/ghost.ts` draws.
    expect(selection.has(spawn.cellX, spawn.cellY)).toBe(true);
    wrapper.unmount();
  });

  it('confirma contra el servidor y el reductor incorpora el edificio', async () => {
    const spawn = await bootstrap();
    const origin = findFreeOrigin(spawn, BuildingType.GARAGE);
    const buildings = useBuildingsStore();
    const player = usePlayerStore();
    const before = buildings.count;
    const balanceBefore = player.settledBalance;

    const wrapper = mount(BuildingPlacementPanel, {
      props: {
        type: BuildingType.GARAGE,
        originCellX: origin.cellX,
        originCellY: origin.cellY,
      },
    });
    const confirm = wrapper.findAll('button').find((button) => button.text().includes('Confirmar'));
    expect(confirm).toBeDefined();
    await confirm?.trigger('click');
    await flush();

    expect(buildings.count).toBe(before + 1);
    expect(wrapper.text()).toContain('Total cobrado');
    expect(wrapper.emitted('placed')).toBeTruthy();
    // The reducer applied the balance the server answered with, and it went down.
    expect(Money.compare(player.settledBalance, balanceBefore)).toBe(-1);
    wrapper.unmount();
  });
});

/** Lets the pending microtasks of a mutation settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
