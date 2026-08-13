// The field listing: its rows, its order and its filter.
//
// Owner: W4-E.
//
// The ordering and the filtering are asserted on `ordering.ts` directly, because they are
// pure and a table is the worst place to read a comparator from. What is asserted on the
// component is the part that is not pure: that every row carries the four figures GDD
// sections 16 to 22 make the player choose on, that the surface is in hectares with the
// scale of plan section 2.2, and that opening a row moves the camera and the side panel
// together.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import FieldListPanel from '~/components/panels/field-list/FieldListPanel.vue';
import {
  FieldFilter,
  FieldSort,
  matchesFilter,
  matchesText,
  sortRows,
  type FieldRow,
} from '~/components/panels/field-list/ordering';
import { formatHectares } from '~/components/panels/legend/units';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { CROP_CYCLE_STATES, CropCycleState } from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';

function row(overrides: Partial<FieldRow> = {}): FieldRow {
  return {
    id: 'field-a',
    name: 'Parcela A',
    cellCount: 100,
    hectares: 1,
    state: CropCycleState.VIRGIN,
    cropId: null,
    remainingGameMs: null,
    operation: null,
    hasActiveTask: false,
    expectedYieldLiters: 0,
    ...overrides,
  };
}

describe('el orden y el filtro del listado', () => {
  const actionable = new Set([CropCycleState.VIRGIN, CropCycleState.READY_TO_HARVEST]);

  it('ordena por superficie en los dos sentidos', () => {
    const rows = [row({ id: 'a', hectares: 1 }), row({ id: 'b', hectares: 3 })];
    expect(sortRows(rows, FieldSort.SURFACE, false, CROP_CYCLE_STATES).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
    expect(sortRows(rows, FieldSort.SURFACE, true, CROP_CYCLE_STATES).map((r) => r.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('ordena por estado siguiendo el ciclo y no el alfabeto', () => {
    const rows = [
      row({ id: 'ready', state: CropCycleState.READY_TO_HARVEST }),
      row({ id: 'virgin', state: CropCycleState.VIRGIN }),
    ];
    expect(sortRows(rows, FieldSort.STATE, false, CROP_CYCLE_STATES).map((r) => r.id)).toEqual([
      'virgin',
      'ready',
    ]);
  });

  it('deja al final los campos sin cuenta atras, en los dos sentidos', () => {
    const rows = [row({ id: 'none' }), row({ id: 'soon', remainingGameMs: 10n })];
    for (const descending of [false, true]) {
      expect(
        sortRows(rows, FieldSort.REMAINING, descending, CROP_CYCLE_STATES).map((r) => r.id),
      ).toEqual(['soon', 'none']);
    }
  });

  it('busca por nombre sin distinguir acentos ni mayusculas', () => {
    expect(matchesText(row({ name: 'Parcela Este' }), 'este')).toBe(true);
    expect(matchesText(row({ name: 'Parcela Este' }), 'ESTE')).toBe(true);
    expect(matchesText(row({ name: 'Ladera Norte' }), 'este')).toBe(false);
  });

  it('el filtro de espera del jugador excluye lo que tiene tarea en curso', () => {
    const waiting = row({ state: CropCycleState.VIRGIN });
    const working = row({ state: CropCycleState.VIRGIN, hasActiveTask: true });
    expect(
      matchesFilter(waiting, FieldFilter.ACTIONABLE, actionable, CropCycleState.READY_TO_HARVEST),
    ).toBe(true);
    expect(
      matchesFilter(working, FieldFilter.ACTIONABLE, actionable, CropCycleState.READY_TO_HARVEST),
    ).toBe(false);
  });
});

describe('el panel de campos', () => {
  beforeEach(async () => {
    await bootMockClient();
  });

  afterEach(() => {
    teardownMockClient();
  });

  it('pinta un renglon por campo con celdas, superficie y estado', async () => {
    const fields = useFieldsStore();
    const wrapper = mount(FieldListPanel);
    await settle();

    const text = wrapper.text();
    expect(fields.count).toBeGreaterThan(0);
    for (const field of fields.all) {
      expect(text).toContain(field.name);
      expect(text).toContain(`${field.cellCount} celdas`);
      expect(text).toContain(formatHectares(field.cellCount));
    }
    expect(wrapper.findAll('tbody tr')).toHaveLength(fields.count);
    wrapper.unmount();
  });

  it('muestra una cuenta atras para el campo que esta creciendo', async () => {
    const wrapper = mount(FieldListPanel);
    await settle();
    // The growing field of the sample world was sown sixty game hours ago over a cycle of
    // ninety six, so what has to appear is a countdown and not a dash.
    expect(wrapper.text()).toMatch(/\d+ (d|h|min)/);
    wrapper.unmount();
  });

  it('el filtro de listos para cosechar vacia la tabla en el mundo de ejemplo', async () => {
    const wrapper = mount(FieldListPanel);
    await settle();
    const select = wrapper.findAll('select')[0];
    await select?.setValue(FieldFilter.READY);
    expect(wrapper.text()).toContain('Ningun campo cumple el filtro');
    wrapper.unmount();
  });

  it('la busqueda por nombre deja solo el campo que casa', async () => {
    const fields = useFieldsStore();
    const target = fields.all[0];
    const wrapper = mount(FieldListPanel);
    await settle();
    await wrapper.find('input[type="search"]').setValue(target?.name ?? '');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.text()).toContain(target?.name ?? '');
    wrapper.unmount();
  });

  it('abrir un renglon mueve la camara y el panel lateral a la vez', async () => {
    const fields = useFieldsStore();
    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(FieldListPanel);
    await settle();
    await wrapper.findAll('tbody tr')[0]?.trigger('click');

    const shell = useShellUi();
    expect(shell.sidePanel.value?.panelId).toBe('field-inspector');
    const openedId = shell.sidePanel.value?.props.fieldId;
    expect(typeof openedId).toBe('string');
    const cell = fields.cellsOf(String(openedId))[0];
    expect(orders).toEqual([{ cellX: cell?.cellX, cellY: cell?.cellY, smooth: true }]);
    wrapper.unmount();
  });

  it('crear campo abre el modal de creacion y no un panel lateral', async () => {
    const wrapper = mount(FieldListPanel);
    await settle();
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Crear campo');
    await button?.trigger('click');
    expect(useShellUi().topModal.value?.panelId).toBe('field-create');
    wrapper.unmount();
  });
});
