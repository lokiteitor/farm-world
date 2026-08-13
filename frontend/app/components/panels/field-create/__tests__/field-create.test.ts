// Creating a field, against the simulated server.
//
// Owner: W4-E.
//
// The suite buys the land first and then creates the field on it, which is the real sequence
// of GDD sections 13 and 19 and the only one that produces cells in `OWNED` use: a field can
// only be drawn over land the player already has. Doing it that way also means the two routes
// are exercised together, so a purchase that did not actually change the chunk would fail
// here as a field that cannot be created.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  loadChunkRect,
  loadChunksFor,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import FieldCreatePanel from '~/components/panels/field-create/FieldCreatePanel.vue';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { apiCall } from '~/net/api';
import { VALIDATION_MESSAGES, ValidationCode, type CellCoordWire } from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { useSelectionStore } from '~/stores/selection';
import { useWorldStore } from '~/stores/world';

const SPAN = 48;

/** A rectangle of cells that are all unowned grass, found by scanning the generator. */
async function findUnownedGrassRect(
  width: number,
  height: number,
): Promise<readonly CellCoordWire[]> {
  const world = useWorldStore();
  const fields = useFieldsStore();
  const anchor = fields.cellsOf(fields.all[0]?.id ?? '')[0] ?? { cellX: 0, cellY: 0 };
  await loadChunkRect(
    anchor.cellX - SPAN,
    anchor.cellY - SPAN,
    anchor.cellX + SPAN,
    anchor.cellY + SPAN,
  );
  const free = (cellX: number, cellY: number): boolean => {
    const cell = world.selectionCellAt(cellX, cellY, null);
    return cell !== null && cell.terrain === 'GRASS' && cell.ownership === 'UNOWNED';
  };
  for (let cellY = anchor.cellY - SPAN; cellY <= anchor.cellY + SPAN - height; cellY += 1) {
    for (let cellX = anchor.cellX - SPAN; cellX <= anchor.cellX + SPAN - width; cellX += 1) {
      let ok = true;
      for (let dy = 0; dy < height && ok; dy += 1) {
        for (let dx = 0; dx < width && ok; dx += 1) {
          ok = free(cellX + dx, cellY + dy);
        }
      }
      if (ok) {
        const cells: CellCoordWire[] = [];
        for (let dy = 0; dy < height; dy += 1) {
          for (let dx = 0; dx < width; dx += 1) {
            cells.push({ cellX: cellX + dx, cellY: cellY + dy });
          }
        }
        return cells;
      }
    }
  }
  throw new Error('El mundo de ejemplo no ofrece un rectangulo de pradera libre.');
}

/** Buys a set of cells through the contract and refreshes the chunks they live in. */
async function buy(cells: readonly CellCoordWire[]): Promise<void> {
  await apiCall('POST /api/land/purchase', {
    body: { cells: cells.map((cell) => ({ ...cell })), allowPartial: false },
    idempotencyKey: `test-${cells.length}-${cells[0]?.cellX}-${cells[0]?.cellY}`,
  });
  await loadChunksFor(cells);
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

/** What `startSelectionMode` publishes for the creation mode, subject included. */
const FIELD_CREATE_MODE = {
  purpose: 'FIELD',
  mode: 'FIELD_CREATE',
  fieldId: null,
  forestPlotId: null,
  buildingType: null,
};

describe('el panel de creacion de campo', () => {
  it('activa el modo de creacion del lienzo al montarse y lo apaga al cerrarse', async () => {
    const modes: unknown[] = [];
    gameBridge().on('selection:mode', (payload) => modes.push(payload));

    const wrapper = mount(FieldCreatePanel);
    await settle();
    // The mode travels with its subject since W7 (docs/handoff/NOTES-w6w.md 4.3); a creation
    // has none, so the three identifiers are null.
    expect(modes).toEqual([FIELD_CREATE_MODE]);

    wrapper.unmount();
    expect(modes).toEqual([FIELD_CREATE_MODE, { purpose: null }]);
  });

  it('sin seleccion no admite crear y dice que hay que dibujarla', async () => {
    const wrapper = mount(FieldCreatePanel);
    await settle();
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Crear campo');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toContain('Arrastra sobre el mapa');
    wrapper.unmount();
  });

  it('crea el campo sobre celdas propias y contiguas, y abre su inspector', async () => {
    const selection = useSelectionStore();
    const fields = useFieldsStore();
    const cells = await findUnownedGrassRect(3, 2);
    await buy(cells);
    selection.begin({ purpose: 'FIELD' });
    selection.replaceCells(cells);

    const before = fields.count;
    const wrapper = mount(FieldCreatePanel);
    await settle();

    expect(wrapper.text()).toContain('6 celdas');
    expect(wrapper.text()).toContain('600 m2');
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Crear campo');
    expect(button?.attributes('disabled')).toBeUndefined();
    // The form and not the button: the control is a submit and jsdom does not run the
    // activation behaviour of a dispatched click.
    await wrapper.find('form').trigger('submit');
    await settle(6);

    expect(fields.count).toBe(before + 1);
    const shell = useShellUi();
    expect(shell.sidePanel.value?.panelId).toBe('field-inspector');
    expect(shell.modals.value).toHaveLength(0);
    wrapper.unmount();
  });

  it('niega la creacion sobre celdas que no son del jugador, con el motivo compartido', async () => {
    const selection = useSelectionStore();
    const cells = await findUnownedGrassRect(2, 2);
    selection.begin({ purpose: 'FIELD' });
    selection.replaceCells(cells);

    const wrapper = mount(FieldCreatePanel);
    await settle();

    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.CELL_NOT_OWNED]);
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Crear campo');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toBe(VALIDATION_MESSAGES[ValidationCode.CELL_NOT_OWNED]);
    wrapper.unmount();
  });

  it('exige contigüidad y salta a la primera celda en conflicto', async () => {
    const selection = useSelectionStore();
    const rect = await findUnownedGrassRect(3, 2);
    await buy(rect);
    const orphan = { cellX: (rect[0]?.cellX ?? 0) + 20, cellY: (rect[0]?.cellY ?? 0) + 20 };
    await loadChunksFor([orphan]);
    selection.begin({ purpose: 'FIELD' });
    selection.replaceCells([...rect, orphan]);

    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(FieldCreatePanel);
    await settle();

    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.SELECTION_NOT_CONTIGUOUS]);
    const jump = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Ir al primer conflicto');
    await jump?.trigger('click');
    expect(orders).toHaveLength(1);
    wrapper.unmount();
  });

  it('niega el envio mientras alguna celda no este resuelta', async () => {
    const selection = useSelectionStore();
    selection.begin({ purpose: 'FIELD' });
    selection.replaceCells([{ cellX: 700_000, cellY: 700_000 }]);

    const wrapper = mount(FieldCreatePanel);
    await settle();
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Crear campo');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toContain('Faltan por cargar');
    wrapper.unmount();
  });
});
