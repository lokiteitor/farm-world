// The land purchase panel against the simulated server.
//
// Owner: W4-E.
//
// What is asserted is the chain the panel exists for: the selection is broken down by
// terrain with `cellPrice` of GDD section 115, the authoritative budget is asked of
// `POST /api/land/quote`, the two agree, a selection with blocked cells is refused with the
// aggregated reason of the shared table until the player accepts a partial purchase, and the
// confirmation sends the total of the quote as `expectedTotal`.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  loadChunkRect,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import LandPurchasePanel from '~/components/panels/land-purchase/LandPurchasePanel.vue';
import { formatMoney } from '~/composables/useFormatting';
import { gameBridge } from '~/composables/useGameBridge';
import {
  Money,
  VALIDATION_MESSAGES,
  ValidationCode,
  cellPrice,
  multiplyByCount,
  type CellCoordWire,
} from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useWorldStore } from '~/stores/world';

/** Longer than the debounce of the panel, so the quote has been asked for. */
async function quoted(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settle(4);
}

/** Several unowned grass cells, found by scanning the generator rather than written down. */
async function unownedGrass(count: number): Promise<readonly CellCoordWire[]> {
  const world = useWorldStore();
  const anchor = useFieldsStore().cellsOf(useFieldsStore().all[0]?.id ?? '')[0] ?? {
    cellX: 0,
    cellY: 0,
  };
  await loadChunkRect(anchor.cellX - 48, anchor.cellY - 48, anchor.cellX + 48, anchor.cellY + 48);
  const found: CellCoordWire[] = [];
  for (
    let cellY = anchor.cellY - 48;
    cellY <= anchor.cellY + 48 && found.length < count;
    cellY += 1
  ) {
    for (
      let cellX = anchor.cellX - 48;
      cellX <= anchor.cellX + 48 && found.length < count;
      cellX += 1
    ) {
      const cell = world.selectionCellAt(cellX, cellY, null);
      if (cell !== null && cell.terrain === 'GRASS' && cell.ownership === 'UNOWNED') {
        found.push({ cellX, cellY });
      }
    }
  }
  expect(found).toHaveLength(count);
  return found;
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('el panel de compra de tierra', () => {
  it('sin seleccion muestra la tabla de precios por terreno del catalogo', async () => {
    const wrapper = mount(LandPurchasePanel);
    await settle();
    const text = wrapper.text();
    expect(text).toContain('Precio por celda segun terreno');
    expect(text).toContain('Pradera');
    expect(text).toContain('Montana');
    expect(text).toContain('No comprable');
    wrapper.unmount();
  });

  it('desglosa por terreno y su total coincide con el presupuesto del servidor', async () => {
    const selection = useSelectionStore();
    const cells = await unownedGrass(6);
    selection.begin({ purpose: 'PURCHASE' });
    selection.replaceCells(cells);

    const wrapper = mount(LandPurchasePanel);
    await quoted();

    const unit = cellPrice('GRASS') ?? Money.ZERO;
    const total = multiplyByCount(unit, cells.length);
    const text = wrapper.text();
    expect(text).toContain('6 celdas');
    expect(text).toContain('600 m2');
    expect(text).toContain('Presupuesto local');
    // The same amount twice: the local budget and the one the server answered with.
    expect(text.split(formatMoney(total)).length - 1).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it('agrega el motivo de las celdas bloqueadas y salta al primer conflicto', async () => {
    const selection = useSelectionStore();
    const fields = useFieldsStore();
    const owned = fields.cellsOf(fields.all[0]?.id ?? '')[0];
    expect(owned).toBeDefined();
    const cells = [...(await unownedGrass(3)), owned as CellCoordWire];
    selection.begin({ purpose: 'PURCHASE' });
    selection.replaceCells(cells);

    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(LandPurchasePanel);
    await quoted();

    expect(wrapper.text()).toContain('Motivos de invalidez');
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.CELL_ALREADY_OWNED]);

    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Ir al primer conflicto');
    await button?.trigger('click');
    expect(orders).toEqual([{ cellX: owned?.cellX, cellY: owned?.cellY, smooth: true }]);
    wrapper.unmount();
  });

  it('niega la compra mixta hasta que el jugador admite la compra parcial', async () => {
    const selection = useSelectionStore();
    const fields = useFieldsStore();
    const owned = fields.cellsOf(fields.all[0]?.id ?? '')[0];
    selection.begin({ purpose: 'PURCHASE' });
    selection.replaceCells([...(await unownedGrass(2)), owned as CellCoordWire]);

    const wrapper = mount(LandPurchasePanel);
    await quoted();

    const confirm = () =>
      wrapper.findAll('button').find((candidate) => candidate.text() === 'Comprar');
    expect(confirm()?.attributes('disabled')).toBeDefined();
    expect(confirm()?.attributes('title')).toContain('compra parcial');

    await wrapper.find('input[type="checkbox"]').setValue(true);
    await settle();
    expect(confirm()?.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('compra y cobra exactamente el total del presupuesto', async () => {
    const selection = useSelectionStore();
    const player = usePlayerStore();
    const cells = await unownedGrass(4);
    selection.begin({ purpose: 'PURCHASE' });
    selection.replaceCells(cells);

    const wrapper = mount(LandPurchasePanel);
    await quoted();

    const before = player.settledBalance;
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Comprar');
    expect(button?.attributes('disabled')).toBeUndefined();
    await button?.trigger('click');
    await settle(6);

    const total = multiplyByCount(cellPrice('GRASS') ?? Money.ZERO, cells.length);
    expect(Money.toScaled(player.settledBalance)).toBe(
      Money.toScaled(before) - Money.toScaled(total),
    );
    expect(wrapper.text()).toContain('Compradas 4 celdas');
    expect(selection.count).toBe(0);
    wrapper.unmount();
  });

  it('niega el envio mientras haya celdas sin resolver', async () => {
    const selection = useSelectionStore();
    selection.begin({ purpose: 'PURCHASE' });
    // A cell nobody has loaded: the client holds no chunk for it and therefore no verdict.
    selection.replaceCells([{ cellX: 800_000, cellY: 800_000 }]);

    const wrapper = mount(LandPurchasePanel);
    await settle();
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Comprar');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toContain('Faltan por cargar');
    wrapper.unmount();
  });
});
