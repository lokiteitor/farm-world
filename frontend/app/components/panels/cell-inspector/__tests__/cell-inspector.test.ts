// The cell inspector against the simulated server.
//
// Owner: W4-E.
//
// Three properties are worth pinning. The panel reads a cell through the same chunk cache
// the renderer draws from, so what it shows about ownership and use is what the canvas
// paints. The purchase is refused for the code `canPurchase` of `shared/rules/selection.ts`
// returns, and the reason shown is the message of the shared table, so a greyed out button
// and a 409 say the same thing. And the price is `cellPrice` of GDD section 115, formatted
// once by `useFormatting`.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  findUnownedGrass,
  loadChunksFor,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import CellInspectorPanel from '~/components/panels/cell-inspector/CellInspectorPanel.vue';
import { formatMoney } from '~/composables/useFormatting';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import {
  Money,
  VALIDATION_MESSAGES,
  ValidationCode,
  cellPrice,
  type CellCoordWire,
} from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { usePlayerStore } from '~/stores/player';

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

function firstFieldCell(): CellCoordWire {
  const fields = useFieldsStore();
  const field = fields.all[0];
  expect(field).toBeDefined();
  const cell = fields.cellsOf(field?.id ?? '')[0];
  expect(cell).toBeDefined();
  return cell as CellCoordWire;
}

describe('el inspector de celda', () => {
  it('lee terreno, propiedad, uso y el campo al que pertenece', async () => {
    const cell = firstFieldCell();
    await loadChunksFor([cell]);
    const wrapper = mount(CellInspectorPanel, { props: { cellX: cell.cellX, cellY: cell.cellY } });
    await settle();

    const text = wrapper.text();
    expect(text).toContain(`Celda ${cell.cellX}, ${cell.cellY}`);
    expect(text).toContain('Pradera');
    expect(text).toContain('En propiedad');
    expect(text).toContain('Campo');
    expect(text).toContain(useFieldsStore().all[0]?.name ?? '');
    wrapper.unmount();
  });

  it('muestra el precio de la celda con la regla compartida y el formato del cliente', async () => {
    const cell = firstFieldCell();
    await loadChunksFor([cell]);
    const wrapper = mount(CellInspectorPanel, { props: { cellX: cell.cellX, cellY: cell.cellY } });
    await settle();

    const expected = cellPrice('GRASS');
    expect(expected).not.toBeNull();
    expect(wrapper.text()).toContain(formatMoney(expected ?? Money.ZERO));
    wrapper.unmount();
  });

  it('inhabilita la compra de una celda ya poseida con el motivo de la tabla compartida', async () => {
    const cell = firstFieldCell();
    await loadChunksFor([cell]);
    const wrapper = mount(CellInspectorPanel, { props: { cellX: cell.cellX, cellY: cell.cellY } });
    await settle();

    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Comprar esta celda');
    expect(button).toBeDefined();
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toBe(
      VALIDATION_MESSAGES[ValidationCode.CELL_ALREADY_OWNED],
    );
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.CELL_ALREADY_OWNED]);
    wrapper.unmount();
  });

  it('compra una celda libre y el saldo baja exactamente su precio', async () => {
    const player = usePlayerStore();
    const cell = await findUnownedGrass(firstFieldCell());
    expect(cell).not.toBeNull();
    const before = player.settledBalance;

    const wrapper = mount(CellInspectorPanel, {
      props: { cellX: cell?.cellX ?? 0, cellY: cell?.cellY ?? 0 },
    });
    await settle();

    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Comprar esta celda');
    expect(button?.attributes('disabled')).toBeUndefined();
    await button?.trigger('click');
    await settle(6);

    const price = cellPrice('GRASS') ?? Money.ZERO;
    expect(Money.toScaled(player.settledBalance)).toBe(
      Money.toScaled(before) - Money.toScaled(price),
    );
    wrapper.unmount();
  });

  it('la compra por area cambia el modo del lienzo y abre su panel', async () => {
    const cell = firstFieldCell();
    await loadChunksFor([cell]);
    const modes: unknown[] = [];
    gameBridge().on('selection:mode', (payload) => modes.push(payload));

    const wrapper = mount(CellInspectorPanel, { props: { cellX: cell.cellX, cellY: cell.cellY } });
    await settle();
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Comprar por area');
    await button?.trigger('click');

    // The subject travels with the mode since W7, so a mode without a purpose of its own
    // arrives as itself (docs/handoff/NOTES-w6w.md 4.3). For a purchase the three identifiers
    // are null, which is what says "no subject" rather than "not sent".
    expect(modes).toEqual([
      {
        purpose: 'PURCHASE',
        mode: 'PURCHASE',
        fieldId: null,
        forestPlotId: null,
        buildingType: null,
      },
    ]);
    expect(useShellUi().sidePanel.value?.panelId).toBe('land-purchase');
    wrapper.unmount();
  });

  it('centrar publica la orden de camara del puente', async () => {
    const cell = firstFieldCell();
    await loadChunksFor([cell]);
    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(CellInspectorPanel, { props: { cellX: cell.cellX, cellY: cell.cellY } });
    await settle();
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Centrar');
    await button?.trigger('click');

    expect(orders).toEqual([{ cellX: cell.cellX, cellY: cell.cellY, smooth: true }]);
    wrapper.unmount();
  });

  it('dice que la celda no esta cargada en lugar de afirmar nada sobre ella', async () => {
    const wrapper = mount(CellInspectorPanel, { props: { cellX: 900_000, cellY: 900_000 } });
    // No settle: the panel is rendered before its own chunk request resolves, which is the
    // state the assertion is about.
    expect(wrapper.text()).toContain('Celda sin cargar');
    wrapper.unmount();
  });
});
