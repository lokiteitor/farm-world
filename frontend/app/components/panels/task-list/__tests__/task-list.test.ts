// The task listing: the countdown, the warning of a cancellation, and the history.
//
// Owner: W6-T.
//
// The arithmetic of the countdown is asserted on `shared/taskProgress.ts` directly
// (`components/panels/shared/__tests__/taskProgress.test.ts`). What is asserted here is what
// only the component can be wrong about, and the three are the three obligations of GDD
// sections 105, 106 and 111.
//
// The bar moves with the clock the panel is given. The panel takes `atGameMs` as a property
// precisely so a suite can drive it, and the row it draws also carries `progressBp`, which is
// correct at the instant of the reply only: a listing that read it would freeze between
// replies and then jump. Both figures are on screen at once here, and only one of them may
// be the one drawn.
//
// Cancelling states what it costs. GDD section 106 is all or nothing, and plan section 2.2
// adds the two consequences the GDD leaves open: nothing is refunded and the wear of the
// hours worked is applied all the same. The confirmation has to say so before it is armed,
// not after.
//
// The history distinguishes what completed from what was cancelled. They are two different
// outcomes with two different meanings for the field they acted on, and a listing that drew
// them alike would hide the one that cost money for nothing.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import { OPERATION_LABELS } from '~/components/panels/legend/vocabulary';
import { taskProgressBp, workedGameHours } from '~/components/panels/shared/taskProgress';
import TaskListPanel from '~/components/panels/task-list/TaskListPanel.vue';
import { formatGameDuration } from '~/composables/useFormatting';
import { useShellUi } from '~/composables/useShellUi';
import {
  MS_PER_GAME_HOUR,
  TaskStatus,
  VALIDATION_MESSAGES,
  ValidationCode,
  fromWireGameMs,
  gameMs,
  type GameMs,
  type TaskDto,
} from '~/shared/index';
import { useTasksStore } from '~/stores/tasks';

/** The plough the sample world starts with, which is the one task in flight. */
function runningTask(): TaskDto {
  const task = useTasksStore().active[0];
  if (task === undefined) {
    throw new Error('el mundo simulado no trajo ninguna tarea en curso');
  }
  return task;
}

function at(task: TaskDto, gameHoursAfterStart: number): GameMs {
  return gameMs(
    fromWireGameMs(task.startGameMs) + BigInt(Math.round(gameHoursAfterStart * 3_600_000)),
  );
}

/** A closed copy of the running task, so the history has something to separate. */
function closedCopy(id: string, status: TaskStatus, endedGameHours: number): TaskDto {
  const source = runningTask();
  const copy: TaskDto = {
    ...source,
    id,
    status,
    endedGameMs: at(source, endedGameHours).toString(),
    cancelable: false,
  };
  useTasksStore().upsert(copy);
  return copy;
}

/**
 * The section under a heading, found by the heading and not by position.
 *
 * `UiCard` wraps the whole panel in a `<section>` of its own, so an index would be a claim
 * about the card and not about the listing.
 */
function sectionTitled(wrapper: ReturnType<typeof mount>, title: string) {
  return wrapper
    .findAll('section')
    .find(
      (section) =>
        section.find('.fw-tasks__heading').exists() &&
        section.find('.fw-tasks__heading').text().startsWith(title),
    );
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('la cuenta atras', () => {
  it('se mueve con el reloj inyectado y no con el del sistema', async () => {
    const task = runningTask();
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 1) } });
    await settle();
    const early = wrapper.find('[role="meter"]').attributes('aria-valuenow');
    expect(early).toBe(String(taskProgressBp(task, at(task, 1))));
    expect(wrapper.text()).toContain(
      formatGameDuration(fromWireGameMs(task.scheduledEndGameMs) - at(task, 1)),
    );

    await wrapper.setProps({ atGameMs: at(task, 6) });
    await settle();
    const later = wrapper.find('[role="meter"]').attributes('aria-valuenow');
    expect(later).toBe(String(taskProgressBp(task, at(task, 6))));
    expect(Number(later)).toBeGreaterThan(Number(early));
    expect(wrapper.text()).toContain(
      formatGameDuration(fromWireGameMs(task.scheduledEndGameMs) - at(task, 6)),
    );
    wrapper.unmount();
  });

  it('no dibuja el progreso que trae la fila, que solo vale en el instante de la respuesta', async () => {
    const tasks = useTasksStore();
    const task = runningTask();
    // A figure the reply could plausibly carry and that the clock contradicts.
    tasks.upsert({ ...task, progressBp: 10_000 });
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 1) } });
    await settle();
    expect(wrapper.find('[role="meter"]').attributes('aria-valuenow')).not.toBe('10000');
    wrapper.unmount();
  });

  it('una tarea cuyo fin previsto ya paso se lee como «ahora» y nunca en negativo', async () => {
    const task = runningTask();
    const past = gameMs(fromWireGameMs(task.scheduledEndGameMs) + 5n * MS_PER_GAME_HOUR);
    const wrapper = mount(TaskListPanel, { props: { atGameMs: past } });
    await settle();
    expect(wrapper.text()).toContain('ahora');
    expect(wrapper.text()).not.toContain('-');
    wrapper.unmount();
  });
});

describe('la cancelacion (§106)', () => {
  it('advierte de que el progreso se pierde por completo antes de armar el boton', async () => {
    const task = runningTask();
    const now = at(task, 3);
    const wrapper = mount(TaskListPanel, { props: { atGameMs: now } });
    await settle();

    expect(wrapper.text()).not.toContain('El progreso se pierde por completo');
    const cancel = wrapper.findAll('button').find((button) => button.text() === 'Cancelar');
    expect(cancel?.attributes('disabled')).toBeUndefined();
    await cancel?.trigger('click');

    const warning = wrapper.find('.fw-tasks__warning').text();
    expect(warning).toContain('El progreso se pierde por completo');
    expect(warning).toContain('el objetivo se queda en el estado anterior');
    // The two consequences of plan section 2.2 that GDD section 106 leaves open.
    expect(warning).toContain('No se reembolsa nada');
    expect(warning).toContain(`${workedGameHours(task, now).toFixed(1)} h`);
    // Cancelling is not armed by the first click: the confirmation is a second control.
    expect(wrapper.findAll('button').some((button) => button.text() === 'Seguir')).toBe(true);
    wrapper.unmount();
  });

  it('confirmar cancela de verdad y la tarea pasa al historial como cancelada', async () => {
    const tasks = useTasksStore();
    const task = runningTask();
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 3) } });
    await settle();

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cancelar')
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirmar cancelacion')
      ?.trigger('click');
    await settle(6);

    expect(tasks.get(task.id)?.status).toBe(TaskStatus.CANCELED);
    expect(tasks.active).toHaveLength(0);
    expect(wrapper.text()).toContain('Ninguna tarea en curso');
    expect(wrapper.text()).toContain('Historial');
    expect(wrapper.text()).toContain('Cancelada');
    wrapper.unmount();
  });

  it('una tarea que ya termino no se cancela, y lo dice', async () => {
    const tasks = useTasksStore();
    const task = runningTask();
    tasks.upsert({ ...task, cancelable: false });
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 3) } });
    await settle();
    const cancel = wrapper.findAll('button').find((button) => button.text() === 'Cancelar');
    expect(cancel?.attributes('disabled')).toBeDefined();
    expect(cancel?.attributes('title')).toBe(
      VALIDATION_MESSAGES[ValidationCode.TASK_NOT_CANCELABLE],
    );
    wrapper.unmount();
  });
});

describe('el historial (§111)', () => {
  it('separa lo completado de lo cancelado, con etiqueta y tono propios', async () => {
    const task = runningTask();
    const completed = closedCopy('task-done', TaskStatus.COMPLETED, 12);
    const cancelled = closedCopy('task-gone', TaskStatus.CANCELED, 2);
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 14) } });
    await settle();

    const history = sectionTitled(wrapper, 'Historial');
    expect(history).toBeDefined();
    const rows = history?.findAll('.fw-tasks__row') ?? [];
    expect(rows).toHaveLength(2);

    const labels = rows.map((row) => row.find('.fw-badge').text());
    expect(labels).toContain('Completada');
    expect(labels).toContain('Cancelada');
    // The two outcomes are not drawn alike: the cancelled one is the warning tone.
    const tones = rows.map((row) => row.find('.fw-badge').classes().join(' '));
    expect(tones.some((tone) => tone.includes('fw-badge--neutral'))).toBe(true);
    expect(tones.some((tone) => tone.includes('fw-badge--warning'))).toBe(true);

    // And the bar of a cancelled task stops where it stopped, while a completed one is full.
    const meters = history?.findAll('[role="meter"]') ?? [];
    const values = meters.map((meter) => Number(meter.attributes('aria-valuenow')));
    expect(values).toContain(taskProgressBp(completed, at(task, 14)));
    expect(values).toContain(taskProgressBp(cancelled, at(task, 14)));
    expect(Math.min(...values)).toBeLessThan(10_000);
    wrapper.unmount();
  });

  it('el historial se ordena por lo que termino mas tarde', async () => {
    const task = runningTask();
    closedCopy('task-old', TaskStatus.COMPLETED, 2);
    closedCopy('task-new', TaskStatus.CANCELED, 9);
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 14) } });
    await settle();
    const rows = sectionTitled(wrapper, 'Historial')?.findAll('.fw-badge') ?? [];
    expect(rows[0]?.text()).toBe('Cancelada');
    wrapper.unmount();
  });

  it('sin historial la seccion no se dibuja', async () => {
    const task = runningTask();
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 1) } });
    await settle();
    // The stat of the header still counts it; what must not be drawn is the section.
    expect(sectionTitled(wrapper, 'Historial')).toBeUndefined();
    expect(sectionTitled(wrapper, 'Activas')).toBeDefined();
    wrapper.unmount();
  });
});

describe('lo que la lista lleva a otra parte', () => {
  it('«Ver objetivo» abre el inspector del campo de la tarea', async () => {
    const task = runningTask();
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 1) } });
    await settle();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Ver objetivo')
      ?.trigger('click');
    const shell = useShellUi();
    expect(shell.sidePanel.value?.panelId).toBe('field-inspector');
    expect(shell.sidePanel.value?.props.fieldId).toBe(task.targetFieldId);
    wrapper.unmount();
  });

  it('nombra la operacion y el objetivo en castellano', async () => {
    const task = runningTask();
    const wrapper = mount(TaskListPanel, { props: { atGameMs: at(task, 1) } });
    await settle();
    expect(wrapper.text()).toContain(OPERATION_LABELS[task.operation]);
    expect(wrapper.text()).not.toContain(task.operation);
    wrapper.unmount();
  });
});
