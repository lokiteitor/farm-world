// The field inspector: the cycle, the bars, the estimate and the valid operations.
//
// Owner: W4-E.
//
// The assertions follow the four things the panel promises. The eight states of GDD sections
// 41 and 76 are all drawn, with the current one marked, so the player can see where the field
// is and what comes next. The expected yield is the figure of `finalYieldLiters`, the same
// one the harvest will use, and not a second approximation. The estimate of when the field is
// ready is extrapolated from the anchor with no request. And an operation is offered exactly
// when the transition table of GDD section 76 admits it, and refused with the code the server
// would refuse it with.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import FieldInspectorPanel from '~/components/panels/field-inspector/FieldInspectorPanel.vue';
import { formatArea } from '~/components/panels/legend/units';
import { CROP_STATE_LABELS, OPERATION_LABELS } from '~/components/panels/legend/vocabulary';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import {
  CROP_CYCLE_STATES,
  CropCycleState,
  TaskOperation,
  VALIDATION_MESSAGES,
  ValidationCode,
  type FieldDto,
} from '~/shared/index';
import { useClockStore } from '~/stores/clock';
import { useFieldsStore } from '~/stores/fields';

/** The field of the sample world that is growing, which is the one with a countdown. */
function growingField(): FieldDto {
  const field = useFieldsStore().all.find(
    (candidate) => candidate.cropCycleState === CropCycleState.GROWING,
  );
  expect(field).toBeDefined();
  return field as FieldDto;
}

/** The field of the sample world that has a task in progress. */
function busyField(): FieldDto {
  const field = useFieldsStore().all.find((candidate) => candidate.currentTaskId !== null);
  expect(field).toBeDefined();
  return field as FieldDto;
}

/**
 * A copy of a field of the sample world, idle and virgin.
 *
 * Derived from a real one and not invented, so every instant it carries is consistent with
 * the clock the snapshot brought; a hand written timestamp would put the projections of the
 * shared rules in a different epoch from the world.
 */
function idleVirginField(): FieldDto {
  const fields = useFieldsStore();
  const source = growingField();
  const copy: FieldDto = {
    ...source,
    id: 'field-idle',
    name: 'Parcela en barbecho',
    cropId: null,
    cropCycleState: CropCycleState.VIRGIN,
    seededAtGameMs: null,
    currentTaskId: null,
    projection: {
      ...source.projection,
      cropCycleState: CropCycleState.VIRGIN,
      readyAtGameMs: null,
      availableOperations: [TaskOperation.PLOW],
    },
  };
  fields.upsert(copy);
  fields.applyCells(copy.id, fields.cellsOf(source.id));
  return copy;
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('el inspector de campo', () => {
  it('dibuja los ocho estados del ciclo y marca el actual', async () => {
    const field = growingField();
    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: field.id } });
    await settle();

    const steps = wrapper.findAll('.fw-field__step');
    expect(steps).toHaveLength(CROP_CYCLE_STATES.length);
    for (const state of CROP_CYCLE_STATES) {
      expect(wrapper.text()).toContain(CROP_STATE_LABELS[state]);
    }
    expect(wrapper.find('[aria-current="step"]').text()).toContain(
      CROP_STATE_LABELS[CropCycleState.GROWING],
    );
    wrapper.unmount();
  });

  it('pinta las barras de fertilidad, malezas, fertilizacion y crecimiento', async () => {
    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: growingField().id } });
    await settle();
    const text = wrapper.text();
    for (const label of ['Fertilidad', 'Malezas', 'Fertilizacion', 'Progreso de crecimiento']) {
      expect(text).toContain(label);
    }
    expect(wrapper.findAll('[role="meter"]').length).toBeGreaterThanOrEqual(4);
    wrapper.unmount();
  });

  it('muestra el rendimiento previsto que producen las reglas compartidas', async () => {
    const fields = useFieldsStore();
    const clock = useClockStore();
    const field = growingField();
    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: field.id } });
    await settle();

    const breakdown = fields.expectedYieldAt(field.id, clock.displayGameMs);
    expect(breakdown).not.toBeNull();
    expect(breakdown?.liters ?? 0).toBeGreaterThan(0);
    expect(wrapper.text()).toContain((breakdown?.liters ?? 0).toLocaleString('es-ES'));
    expect(wrapper.text()).toContain('Rendimiento previsto');
    wrapper.unmount();
  });

  it('estima el momento de la cosecha con el reloj local, sin pedirselo al servidor', async () => {
    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: growingField().id } });
    await settle();
    const text = wrapper.text();
    expect(text).toContain('Listo para cosechar');
    // A countdown and not a dash: the field was sown sixty of its ninety six hours ago.
    expect(text).toMatch(/\d+ (d|h|min)/);
    wrapper.unmount();
  });

  it('muestra la superficie en la unidad de la escala del mundo', async () => {
    const field = growingField();
    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: field.id } });
    await settle();
    expect(wrapper.text()).toContain(formatArea(field.cellCount));
    wrapper.unmount();
  });

  it('ofrece arar un campo en barbecho y ocioso', async () => {
    const field = idleVirginField();
    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: field.id } });
    await settle();

    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === OPERATION_LABELS.PLOW);
    expect(button).toBeDefined();
    expect(button?.attributes('disabled')).toBeUndefined();
    await button?.trigger('click');
    expect(useShellUi().topModal.value?.panelId).toBe('task-assign');
    expect(useShellUi().topModal.value?.props).toEqual({
      fieldId: field.id,
      operation: TaskOperation.PLOW,
    });
    wrapper.unmount();
  });

  it('inhabilita las operaciones de un campo con tarea en curso y dice por que', async () => {
    const field = busyField();
    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: field.id } });
    await settle();

    const buttons = wrapper
      .findAll('button')
      .filter((candidate) => Object.values(OPERATION_LABELS).includes(candidate.text()));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.attributes('disabled')).toBeDefined();
      expect(button.attributes('title')).toBe(
        VALIDATION_MESSAGES[ValidationCode.FIELD_HAS_ACTIVE_TASK],
      );
    }
    expect(wrapper.text()).toContain('Tarea en curso');
    wrapper.unmount();
  });

  it('las tres operaciones de geometria abren el modal con su modo', async () => {
    const field = growingField();
    const shell = useShellUi();
    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: field.id } });
    await settle();

    for (const [label, mode] of [
      ['Ampliar', 'EXTEND'],
      ['Dividir', 'SPLIT'],
      ['Fusionar', 'MERGE'],
    ] as const) {
      const button = wrapper.findAll('button').find((candidate) => candidate.text() === label);
      await button?.trigger('click');
      expect(shell.topModal.value?.panelId).toBe('field-edit');
      expect(shell.topModal.value?.props).toEqual({ fieldId: field.id, mode });
      shell.closeAllModals();
    }
    wrapper.unmount();
  });

  it('centrar publica la orden de camara sobre la primera celda del campo', async () => {
    const fields = useFieldsStore();
    const field = growingField();
    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(FieldInspectorPanel, { props: { fieldId: field.id } });
    await settle();
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Centrar');
    await button?.trigger('click');

    const cell = fields.cellsOf(field.id)[0];
    expect(orders).toEqual([{ cellX: cell?.cellX, cellY: cell?.cellY, smooth: true }]);
    wrapper.unmount();
  });
});
