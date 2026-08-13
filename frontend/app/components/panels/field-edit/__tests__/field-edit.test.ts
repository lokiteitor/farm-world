// The three geometry operations of GDD sections 20, 21 and 22, against the simulated server.
//
// Owner: W4-E.
//
// The suite builds its own field out of land it buys, in a rectangle it finds by scanning the
// generator. That is the only way to get a deterministic geometry: the fields of the sample
// world are claimed cell by cell over whatever the terrain happens to be, so a split of one of
// them would be asserting something about the noise function and not about the panel.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  loadChunkRect,
  loadChunksFor,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import FieldEditPanel from '~/components/panels/field-edit/FieldEditPanel.vue';
import { useApi } from '~/composables/useApi';
import { gameBridge } from '~/composables/useGameBridge';
import { apiCall } from '~/net/api';
import { VALIDATION_MESSAGES, ValidationCode, type CellCoordWire } from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { useSelectionStore } from '~/stores/selection';
import { useWorldStore } from '~/stores/world';

const SPAN = 48;

/** A rectangle of unowned grass of the given size, found by scanning. */
async function findRect(width: number, height: number): Promise<readonly CellCoordWire[]> {
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

interface Bench {
  readonly fieldId: string;
  /** The four by two block the field is made of. */
  readonly body: readonly CellCoordWire[];
  /** The four by one strip below it, bought and free. */
  readonly strip: readonly CellCoordWire[];
}

/** Buys a four by three block, turns its top two rows into a field and keeps the third. */
async function benchField(): Promise<Bench> {
  const api = useApi();
  const block = await findRect(4, 3);
  await apiCall('POST /api/land/purchase', {
    body: { cells: block.map((cell) => ({ ...cell })), allowPartial: false },
    idempotencyKey: 'test-bench-purchase',
  });
  await loadChunksFor(block);
  const body = block.slice(0, 8);
  const strip = block.slice(8);
  const reply = await api.mutate('POST /api/fields', {
    body: { name: 'Parcela de banco', farmId: null, cells: body.map((cell) => ({ ...cell })) },
  });
  await loadChunksFor(block);
  return { fieldId: reply.result.field.id, body, strip };
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('el panel de geometria de campo', () => {
  it('ofrece las tres operaciones con la seccion del GDD de cada una', async () => {
    const bench = await benchField();
    const wrapper = mount(FieldEditPanel, { props: { fieldId: bench.fieldId } });
    await settle();
    const tabs = wrapper.findAll('.fw-edit__tab').map((tab) => tab.text());
    expect(tabs).toEqual(['Ampliar §20', 'Dividir §21', 'Fusionar §22']);
    wrapper.unmount();
  });

  it('cada modo pone el lienzo en su proposito, y la fusion lo devuelve a inspeccion', async () => {
    const bench = await benchField();
    const modes: unknown[] = [];
    gameBridge().on('selection:mode', (payload) => modes.push(payload));

    const wrapper = mount(FieldEditPanel, { props: { fieldId: bench.fieldId, mode: 'EXTEND' } });
    await settle();
    // The mode is republished when the geometry of the field arrives, because the cells it
    // must touch travel with it. Re-entering the same mode is idempotent for the tool.
    // The field being extended travels with the mode since W7, which is what lets the tool
    // judge the cells against the right subject (docs/handoff/NOTES-w6w.md 4.3).
    expect(modes.at(-1)).toEqual({
      purpose: 'FIELD_EXTEND',
      mode: 'FIELD_EXTEND',
      fieldId: bench.fieldId,
      forestPlotId: null,
      buildingType: null,
    });

    await wrapper.findAll('.fw-edit__tab')[2]?.trigger('click');
    await settle();
    expect(modes.at(-1)).toEqual({ purpose: null });
    wrapper.unmount();
  });

  it('amplia el campo con la franja adyacente y el recuento de celdas crece', async () => {
    const bench = await benchField();
    const fields = useFieldsStore();
    const selection = useSelectionStore();
    selection.begin({ purpose: 'FIELD_EXTEND', fieldId: bench.fieldId }, bench.body);
    selection.replaceCells(bench.strip);

    const wrapper = mount(FieldEditPanel, { props: { fieldId: bench.fieldId, mode: 'EXTEND' } });
    await settle();

    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Ampliar');
    expect(button?.attributes('disabled')).toBeUndefined();
    await button?.trigger('click');
    await settle(6);

    expect(fields.get(bench.fieldId)?.cellCount).toBe(12);
    wrapper.unmount();
  });

  it('niega la ampliacion con celdas que no tocan el campo', async () => {
    const bench = await benchField();
    const selection = useSelectionStore();
    // Thirty cells away in both axes: far enough that no edge of it touches the field, which
    // is the condition GDD section 20 states.
    const origin = bench.body[0] ?? { cellX: 0, cellY: 0 };
    const far = [
      { cellX: origin.cellX + 30, cellY: origin.cellY + 30 },
      { cellX: origin.cellX + 31, cellY: origin.cellY + 30 },
    ];
    await loadChunksFor(far);
    selection.begin({ purpose: 'FIELD_EXTEND', fieldId: bench.fieldId }, bench.body);
    selection.replaceCells(far);

    const wrapper = mount(FieldEditPanel, { props: { fieldId: bench.fieldId, mode: 'EXTEND' } });
    await settle();

    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.SELECTION_NOT_ADJACENT]);
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Ampliar');
    expect(button?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('divide el campo en dos mitades contiguas', async () => {
    const bench = await benchField();
    const fields = useFieldsStore();
    const selection = useSelectionStore();
    // The left half of the four by two block: two columns, so both halves stay contiguous.
    const left = bench.body.filter((cell) => cell.cellX < (bench.body[0]?.cellX ?? 0) + 2);
    selection.cancel();
    selection.replaceCells(left);

    const before = fields.count;
    const wrapper = mount(FieldEditPanel, { props: { fieldId: bench.fieldId, mode: 'SPLIT' } });
    await settle();

    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Dividir');
    expect(button?.attributes('disabled')).toBeUndefined();
    await button?.trigger('click');
    await settle(6);

    expect(fields.count).toBe(before + 1);
    expect(fields.get(bench.fieldId)?.cellCount).toBe(4);
    wrapper.unmount();
  });

  it('rechaza una division que dejaria vacia la mitad que se queda', async () => {
    const bench = await benchField();
    const selection = useSelectionStore();
    selection.cancel();
    selection.replaceCells(bench.body);

    const wrapper = mount(FieldEditPanel, { props: { fieldId: bench.fieldId, mode: 'SPLIT' } });
    await settle();

    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.FIELD_SPLIT_INCOMPLETE]);
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Dividir');
    expect(button?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('rechaza fusionar campos incompatibles o no contiguos, con el codigo compartido', async () => {
    const bench = await benchField();
    const fields = useFieldsStore();
    const other = fields.all.find((candidate) => candidate.id !== bench.fieldId);
    expect(other).toBeDefined();

    const wrapper = mount(FieldEditPanel, { props: { fieldId: bench.fieldId, mode: 'MERGE' } });
    await settle();

    const checkbox = wrapper.findAll('input[type="checkbox"]')[0];
    await checkbox?.setValue(true);
    await settle();

    const text = wrapper.text();
    expect(
      text.includes(VALIDATION_MESSAGES[ValidationCode.FIELD_MERGE_INCOMPATIBLE]) ||
        text.includes(VALIDATION_MESSAGES[ValidationCode.SELECTION_NOT_CONTIGUOUS]),
    ).toBe(true);
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Fusionar');
    expect(button?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('exige elegir un campo antes de fusionar', async () => {
    const bench = await benchField();
    const wrapper = mount(FieldEditPanel, { props: { fieldId: bench.fieldId, mode: 'MERGE' } });
    await settle();
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Fusionar');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toContain('Elige al menos un campo');
    wrapper.unmount();
  });
});
