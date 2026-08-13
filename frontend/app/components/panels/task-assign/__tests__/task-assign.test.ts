// The assignment dialogue: what it offers, what it refuses and what it previews.
//
// Owner: W6-T.
//
// The three tables it obeys are asserted on `shared/assignment.ts` directly
// (`components/panels/shared/__tests__/assignment.test.ts`), because a rendered `<select>`
// is the wrong place to read a state machine from. What is asserted here is the half that
// only the component can be wrong about:
//
//   - that the options offered are the transitions of GDD section 76 out of the projected
//     state, for the eight states of the cycle and not for the three that are convenient;
//   - that a combination the table of GDD section 90 refuses is drawn, greyed and carries
//     its sentence, which is the whole point of listing the invalid ones (ADR-0032);
//   - that the crop selector appears exactly when the catalogue says the operation sows;
//   - that the preview is asked of `POST /api/tasks/estimate` and shown, rather than
//     computed here;
//   - and that `operation` as a property and `effectiveOperation` as a computed property
//     behave as the panel claims, which is the pair the integrator had to rename.
//
// The suite runs against the simulated server through the real client and the real reducer,
// so every reply is validated against the Zod schemas of the contract on the way in.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import { CROP_LABELS, OPERATION_LABELS } from '~/components/panels/legend/vocabulary';
import { labelOfMachineType } from '~/components/panels/machinery/machineryPresentation';
import { operationsFromState } from '~/components/panels/shared/assignment';
import TaskAssignPanel from '~/components/panels/task-assign/TaskAssignPanel.vue';
import { MOCK_FARM_ID } from '~/mock/world';
import {
  CROP_CYCLE_STATES,
  CropCycleState,
  STORAGE_RESOURCE_UNITS,
  MachineStatus,
  MachineType,
  TaskOperation,
  VALIDATION_MESSAGES,
  ValidationCode,
  WorkerStatus,
  bp,
  type FieldDto,
  type MachineDto,
} from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { useMachinesStore } from '~/stores/machines';
import { useWorkersStore } from '~/stores/workers';

/** The transitions of GDD section 76, transcribed, as the operation selector must offer them. */
const OPERATIONS_OF_SECTION_76: Readonly<Record<CropCycleState, readonly TaskOperation[]>> = {
  VIRGIN: [TaskOperation.PLOW],
  PLOWED: [TaskOperation.CULTIVATE, TaskOperation.SEED],
  CULTIVATED: [TaskOperation.SEED],
  SEEDED: [],
  GERMINATING: [],
  GROWING: [],
  READY_TO_HARVEST: [TaskOperation.HARVEST],
  HARVESTED: [],
};

/**
 * A field of the sample world put into one state, with no task on it.
 *
 * Derived from a real field so that every instant it carries is in the epoch of the clock
 * the snapshot brought; a hand written timestamp would put the shared projections in a
 * different epoch from the world.
 */
function fieldInState(state: CropCycleState): FieldDto {
  const fields = useFieldsStore();
  const source = fields.all[0];
  if (source === undefined) {
    throw new Error('el mundo simulado no trajo ningun campo');
  }
  const copy: FieldDto = {
    ...source,
    id: `field-${state.toLowerCase()}`,
    name: `Parcela ${state}`,
    cropCycleState: state,
    currentTaskId: null,
    projection: { ...source.projection, cropCycleState: state, availableOperations: [] },
  };
  fields.upsert(copy);
  fields.applyCells(copy.id, fields.cellsOf(source.id));
  return copy;
}

/** Frees the machinery and the payroll the sample world has reserved for its plough. */
function freeTheHolding(): void {
  const machines = useMachinesStore();
  const workers = useWorkersStore();
  for (const machine of machines.all) {
    machines.upsert({ ...machine, status: MachineStatus.IDLE, currentTaskId: null });
  }
  for (const worker of workers.all) {
    workers.upsert({ ...worker, status: WorkerStatus.IDLE, currentTaskId: null });
  }
}

function addMachine(
  overrides: Partial<MachineDto> & { id: string; type: MachineType },
): MachineDto {
  const machines = useMachinesStore();
  const source = machines.all[0];
  if (source === undefined) {
    throw new Error('el mundo simulado no trajo ninguna maquina');
  }
  const copy: MachineDto = {
    ...source,
    farmId: MOCK_FARM_ID,
    status: MachineStatus.IDLE,
    currentTaskId: null,
    ...overrides,
  };
  machines.upsert(copy);
  return copy;
}

/** Waits past the debounce of the preview and lets the reply through the reducer. */
async function settleEstimate(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await settle(4);
}

/** The options of the operation selector, in the order the panel offers them. */
function operationOptions(wrapper: ReturnType<typeof mount>): string[] {
  const select = wrapper.findAll('select')[0];
  return select === undefined
    ? []
    : select.findAll('option').map((option) => option.attributes('value') ?? '');
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('la lista de operaciones (§76)', () => {
  it('ofrece exactamente las transiciones de la tabla en los ocho estados', async () => {
    expect(CROP_CYCLE_STATES).toHaveLength(8);
    for (const state of CROP_CYCLE_STATES) {
      const field = fieldInState(state);
      const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
      await settle();
      const expected = OPERATIONS_OF_SECTION_76[state];
      expect(operationOptions(wrapper)).toEqual([...expected]);
      if (expected.length === 0) {
        // Nothing to assign is a state of the dialogue and not an empty selector.
        expect(wrapper.text()).toContain('Nada que asignar');
      } else {
        expect(wrapper.text()).toContain(OPERATION_LABELS[expected[0] as TaskOperation]);
      }
      // The panel and the shared rule cannot disagree about a state.
      expect(operationOptions(wrapper)).toEqual([...operationsFromState(state)]);
      wrapper.unmount();
    }
  });

  it('un campo arado ofrece labrar y sembrar, que es la nota de §76 y la fila de §90', async () => {
    const field = fieldInState(CropCycleState.PLOWED);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    expect(operationOptions(wrapper)).toEqual([TaskOperation.CULTIVATE, TaskOperation.SEED]);
    wrapper.unmount();
  });

  it('el estado que manda es el proyectado y no el almacenado', async () => {
    const fields = useFieldsStore();
    const field = fieldInState(CropCycleState.GROWING);
    fields.upsert({
      ...field,
      projection: { ...field.projection, cropCycleState: CropCycleState.READY_TO_HARVEST },
    });
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    expect(operationOptions(wrapper)).toEqual([TaskOperation.HARVEST]);
    wrapper.unmount();
  });
});

describe('la operacion recibida por propiedad y la propiedad computada', () => {
  it('sin operacion recibida elige la primera que el estado admite', async () => {
    const field = fieldInState(CropCycleState.PLOWED);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    expect((wrapper.findAll('select')[0]?.element as HTMLSelectElement).value).toBe(
      TaskOperation.CULTIVATE,
    );
    expect(wrapper.text()).toContain(`Asignar ${OPERATION_LABELS.CULTIVATE.toLowerCase()}`);
    wrapper.unmount();
  });

  it('con operacion recibida y admisible, manda la recibida', async () => {
    const field = fieldInState(CropCycleState.PLOWED);
    const wrapper = mount(TaskAssignPanel, {
      props: { fieldId: field.id, operation: TaskOperation.SEED },
    });
    await settle();
    expect((wrapper.findAll('select')[0]?.element as HTMLSelectElement).value).toBe(
      TaskOperation.SEED,
    );
    expect(wrapper.text()).toContain(`Asignar ${OPERATION_LABELS.SEED.toLowerCase()}`);
    wrapper.unmount();
  });

  it('con operacion recibida que el estado no admite, no la ofrece ni la envia', async () => {
    const field = fieldInState(CropCycleState.PLOWED);
    const wrapper = mount(TaskAssignPanel, {
      props: { fieldId: field.id, operation: TaskOperation.HARVEST },
    });
    await settle();
    // The refusal is silent by construction: the offered list never contained it, so the
    // panel falls back to the first legal transition instead of previewing a request the
    // server would reject with FIELD_STATE_NOT_ALLOWED.
    expect(operationOptions(wrapper)).toEqual([TaskOperation.CULTIVATE, TaskOperation.SEED]);
    expect((wrapper.findAll('select')[0]?.element as HTMLSelectElement).value).toBe(
      TaskOperation.CULTIVATE,
    );
    expect(wrapper.text()).not.toContain(`Asignar ${OPERATION_LABELS.HARVEST.toLowerCase()}`);
    wrapper.unmount();
  });

  it('cambiar la operacion en el selector rehace la maquinaria y el cultivo', async () => {
    freeTheHolding();
    const field = fieldInState(CropCycleState.PLOWED);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    expect(wrapper.text()).toContain(labelOfMachineType(MachineType.CULTIVATOR));
    expect(wrapper.text()).not.toContain('Cultivo');

    await wrapper.findAll('select')[0]?.setValue(TaskOperation.SEED);
    await settle();
    expect(wrapper.text()).toContain(labelOfMachineType(MachineType.SEEDER));
    expect(wrapper.text()).toContain('Cultivo');
    wrapper.unmount();
  });
});

describe('el selector de cultivo (chequeo 8 de §104)', () => {
  it('solo aparece cuando la operacion siembra', async () => {
    const cases: readonly (readonly [CropCycleState, boolean])[] = [
      [CropCycleState.VIRGIN, false],
      [CropCycleState.CULTIVATED, true],
      [CropCycleState.READY_TO_HARVEST, false],
    ];
    for (const [state, expected] of cases) {
      const field = fieldInState(state);
      const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
      await settle();
      expect(wrapper.text().includes('Cultivo')).toBe(expected);
      expect(wrapper.text().includes(CROP_LABELS.WHEAT)).toBe(expected);
      wrapper.unmount();
    }
  });
});

describe('la maquinaria: toda combinacion aparece, y la que no sirve lo dice (§90)', () => {
  it('las combinaciones invalidas se dibujan inhabilitadas y con su motivo', async () => {
    const machines = useMachinesStore();
    freeTheHolding();
    // Four combinations for one ploughing: one usable, one with a busy tractor, one with a
    // plow below the condition floor, and one with both.
    addMachine({ id: 'tractor-busy', type: MachineType.TRACTOR, status: MachineStatus.WORKING });
    addMachine({ id: 'plow-worn', type: MachineType.PLOW, conditionBp: bp(400) });
    const field = fieldInState(CropCycleState.VIRGIN);

    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();

    const rows = wrapper.findAll('.fw-assign__row');
    expect(rows).toHaveLength(4);
    const usable = rows.filter((row) => row.find('input').attributes('disabled') === undefined);
    expect(usable).toHaveLength(1);

    for (const row of rows) {
      const disabled = row.find('input').attributes('disabled') !== undefined;
      const blocked = row.find('.fw-assign__blocked');
      expect(blocked.exists()).toBe(disabled);
      if (disabled) {
        // The sentence is the shared one, never written in the panel.
        expect([
          VALIDATION_MESSAGES[ValidationCode.MACHINE_NOT_IDLE],
          VALIDATION_MESSAGES[ValidationCode.MACHINE_CONDITION_TOO_LOW],
        ]).toContain(blocked.text());
      }
    }
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.MACHINE_NOT_IDLE]);
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.MACHINE_CONDITION_TOO_LOW]);
    expect(machines.ofFarm(MOCK_FARM_ID).length).toBe(6);
    wrapper.unmount();
  });

  it('la cabecera nombra los tipos que la operacion reserva', async () => {
    freeTheHolding();
    const field = fieldInState(CropCycleState.READY_TO_HARVEST);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    expect(wrapper.text()).toContain(
      `${labelOfMachineType(MachineType.HARVESTER)} + ${labelOfMachineType(MachineType.TRAILER)}`,
    );
    wrapper.unmount();
  });

  it('sin ninguna maquina del tipo, el boton se niega con el codigo que nombra lo que falta', async () => {
    freeTheHolding();
    const field = fieldInState(CropCycleState.READY_TO_HARVEST);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    // The sample world owns a combine and no trailer.
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.TRAILER_REQUIRED]);
    const submit = wrapper.findAll('button').find((button) => button.text().startsWith('Asignar'));
    expect(submit?.attributes('disabled')).toBeDefined();
    expect(submit?.attributes('title')).toBe(VALIDATION_MESSAGES[ValidationCode.TRAILER_REQUIRED]);
    wrapper.unmount();
  });

  it('el trabajador ocupado se ofrece con su motivo, y no se esconde', async () => {
    const field = fieldInState(CropCycleState.VIRGIN);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    const workerOptions = wrapper.findAll('select')[1]?.findAll('option') ?? [];
    expect(workerOptions).toHaveLength(2);
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.WORKER_NOT_IDLE]);
    wrapper.unmount();
  });
});

describe('la prevision de duracion y coste (§91, §104 y §114)', () => {
  it('se pide al servidor y se muestra con las unidades de la interfaz', async () => {
    freeTheHolding();
    const field = fieldInState(CropCycleState.VIRGIN);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();

    // Before the reply the panel says the local figure is provisional.
    expect(wrapper.text()).toContain('Prevision local provisional');

    await settleEstimate();
    const text = wrapper.text();
    expect(text).not.toContain('Prevision local provisional');
    for (const label of ['Duracion', 'Coste de operacion', 'Salario del periodo', 'Desgaste']) {
      expect(text).toContain(label);
    }
    // Every figure of the preview is real: none of the four is still the placeholder.
    expect(text).not.toContain('—');
    wrapper.unmount();
  });

  it('la cosecha previene ademas la produccion, con el importe formateado por Money', async () => {
    freeTheHolding();
    addMachine({ id: 'trailer-1', type: MachineType.TRAILER });
    const field = fieldInState(CropCycleState.READY_TO_HARVEST);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    await settleEstimate();

    const preview = wrapper.find('.fw-assign__preview').text();
    expect(preview).toContain('Produccion prevista');
    expect(preview).toContain(STORAGE_RESOURCE_UNITS.WHEAT_LITERS.displayUnit);
    // Every amount goes through `useFormatting`, which wraps `Money`: two decimals with a
    // comma, and never the raw wire string of four decimals with a point.
    expect(preview).toMatch(/\d,\d{2}/);
    expect(preview).not.toMatch(/\d\.\d{4}\b/);
    wrapper.unmount();
  });

  it('la prevision se rehace al cambiar de trabajador, porque la habilidad la mueve (§103)', async () => {
    freeTheHolding();
    const workers = useWorkersStore();
    const field = fieldInState(CropCycleState.VIRGIN);
    const wrapper = mount(TaskAssignPanel, { props: { fieldId: field.id } });
    await settle();
    await settleEstimate();
    const skilled = wrapper.find('.fw-assign__preview').text();

    const other = workers.all[1];
    expect(other).toBeDefined();
    await wrapper.findAll('select')[1]?.setValue(other?.id);
    await settle();
    await settleEstimate();

    // The two workers of the sample world differ in skill, so the duration must differ:
    // a preview that did not move would be showing the estimate of a choice no longer on
    // screen, which is what the request token exists to prevent.
    expect(wrapper.find('.fw-assign__preview').text()).not.toBe(skilled);
    wrapper.unmount();
  });
});
