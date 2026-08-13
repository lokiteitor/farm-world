// One forest plot: its composition, its worth, and the two areas that end here.
//
// Owner: W6-T.
//
// The listing answers "what do I own"; this panel answers what a plot is made of and what may
// be done to it, and the three things it must get right are the three the brief of this lot
// names: the count of trees per stage, the estimated volume, and the felling and replanting
// controls with the reason each one is refused for.
//
// Two properties hold the figures up and both are asserted with the clock injected. Nothing
// about a tree is stored except when it was planted (ADR-0030), so the composition of a sub
// area is derived here with the same shared functions the server uses, and a forest that
// matures does so with no traffic at all. And the felling of GDD section 132 is by batch and
// never tree by tree: the panel decides the area and hands it to `task-assign`, which is the
// one place that decides a worker and a combination of machines (ADR-0032).

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import ForestPlotPanel from '~/components/panels/forest-plot/ForestPlotPanel.vue';
import { TREE_STAGE_LABELS } from '~/components/panels/legend/vocabulary';
import {
  composeArea,
  stageRows,
  woodM3,
  woodValue,
} from '~/components/panels/shared/forestPresentation';
import { taskProgressBp } from '~/components/panels/shared/taskProgress';
import { formatCount, formatMoney } from '~/composables/useFormatting';
import { useShellUi } from '~/composables/useShellUi';
import {
  MS_PER_GAME_HOUR,
  TREE_GROWTH_STAGES,
  TaskOperation,
  TreeStatus,
  VALIDATION_MESSAGES,
  ValidationCode,
  fromWireGameMs,
  gameMs,
  type CellCoordWire,
  type ForestPlotDto,
  type GameMs,
  type TaskDto,
} from '~/shared/index';
import { useForestryStore } from '~/stores/forestry';
import { useSelectionStore } from '~/stores/selection';
import { useTasksStore } from '~/stores/tasks';

function samplePlot(): ForestPlotDto {
  const plot = useForestryStore().all[0];
  if (plot === undefined) {
    throw new Error('el mundo simulado no trajo ninguna parcela forestal');
  }
  return plot;
}

/** The instant the plot was measured at, which is the epoch every derived figure lives in. */
function plotNow(): GameMs {
  return fromWireGameMs(samplePlot().atGameMs);
}

function patchPlot(overrides: Partial<ForestPlotDto>): ForestPlotDto {
  const patched = { ...samplePlot(), ...overrides };
  useForestryStore().upsert(patched);
  return patched;
}

function buttonOf(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label);
}

/** Mounts the panel and lets `ensureTrees` answer, which is what fills the tree page. */
async function mountPanel(atGameMs: GameMs = plotNow()) {
  const wrapper = mount(ForestPlotPanel, {
    props: { forestPlotId: samplePlot().id, atGameMs },
  });
  await settle(6);
  return wrapper;
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('la composicion de la parcela (§130 y §131)', () => {
  it('lee el arbolado que el instantaneo no trae, con la ruta de detalle', async () => {
    const forestry = useForestryStore();
    const plot = samplePlot();
    expect(forestry.treesOf(plot.id)).toHaveLength(0);
    const wrapper = await mountPanel();
    expect(forestry.treesOf(plot.id).length).toBe(plot.standingTreeCount);
    wrapper.unmount();
  });

  it('dibuja las cuatro fases con su recuento y el volumen de un arbol de cada una', async () => {
    const plot = samplePlot();
    const wrapper = await mountPanel();
    const rows = wrapper.findAll('.fw-plot__stages li');
    expect(rows).toHaveLength(TREE_GROWTH_STAGES.length);
    for (const row of stageRows(plot.stageHistogram)) {
      const drawn = rows.find((entry) => entry.text().includes(row.label));
      expect(drawn).toBeDefined();
      expect(drawn?.text()).toContain(formatCount(row.count));
      expect(drawn?.text()).toContain(`${row.volumeM3.toFixed(2)} m3`);
    }
    expect(wrapper.text()).not.toContain('OLD_GROWTH');
    wrapper.unmount();
  });

  it('el planton se marca como no talable y las otras tres no', async () => {
    const wrapper = await mountPanel();
    const notFellable = wrapper
      .findAll('.fw-plot__stages li')
      .filter((row) => row.text().includes('no talable'));
    expect(notFellable).toHaveLength(1);
    expect(notFellable[0]?.text()).toContain(TREE_STAGE_LABELS.SAPLING);
    wrapper.unmount();
  });

  it('publica el volumen en pie, el talable y su valor con la regla compartida', async () => {
    const plot = samplePlot();
    const wrapper = await mountPanel();
    const text = wrapper.text();
    expect(text).toContain(`${woodM3(plot.standingWoodDm3).toFixed(2)} m3`);
    expect(text).toContain(`${woodM3(plot.fellableWoodDm3).toFixed(2)} m3`);
    expect(text).toContain(formatMoney(woodValue(plot.fellableWoodDm3)));
    expect(text).toContain(formatCount(plot.standingTreeCount));
    wrapper.unmount();
  });

  it('anuncia el proximo cambio de fase sin convertirlo en una cuenta atras', async () => {
    const wrapper = await mountPanel();
    expect(wrapper.text()).toContain('Proximo cambio de fase en');
    // GDD section 131 is explicit that a mature tree is not lost if it is not felled.
    expect(wrapper.text()).toContain('no se pierde si no se tala');
    wrapper.unmount();
  });
});

describe('el area de tala, que ninguna ruta informa (§132, opcion B)', () => {
  /** A handful of cells of the plot, which is what the tool would hand over. */
  function areaOfPlot(count: number): readonly CellCoordWire[] {
    return useForestryStore().cellsOf(samplePlot().id).slice(0, count);
  }

  it('describe el area elegida con las mismas reglas que el servidor', async () => {
    const forestry = useForestryStore();
    const selection = useSelectionStore();
    const wrapper = await mountPanel();

    await buttonOf(wrapper, 'Elegir area')?.trigger('click');
    const area = areaOfPlot(6);
    selection.replaceCells(area);
    await settle();

    const wanted = new Set(area.map((cell) => `${cell.cellX}:${cell.cellY}`));
    const inside = forestry
      .treesOf(samplePlot().id)
      .filter((tree) => wanted.has(`${tree.cellX}:${tree.cellY}`));
    const expected = composeArea(inside, plotNow());

    const text = wrapper.text();
    expect(text).toContain(`${formatCount(expected.standingCount)} arboles`);
    expect(text).toContain(`${formatCount(expected.fellableCount)} talables`);
    expect(text).toContain(`${expected.volumeM3.toFixed(2)} m3`);
    expect(text).toContain(formatMoney(expected.value));
    wrapper.unmount();
  });

  it('el bosque madura con el reloj inyectado y el area vale mas', async () => {
    const selection = useSelectionStore();
    const wrapper = await mountPanel();
    await buttonOf(wrapper, 'Elegir area')?.trigger('click');
    selection.replaceCells(areaOfPlot(8));
    await settle();
    const now = wrapper.find('.fw-plot__area').text();

    // A thousand game hours later every sapling of the area has crossed two boundaries of
    // the catalogue, with no request in between.
    await wrapper.setProps({ atGameMs: gameMs(plotNow() + 1_000n * MS_PER_GAME_HOUR) });
    await settle();
    expect(wrapper.find('.fw-plot__area').text()).not.toBe(now);
    wrapper.unmount();
  });

  it('entrega el area a la asignacion, que es quien decide trabajador y maquinaria', async () => {
    const selection = useSelectionStore();
    const wrapper = await mountPanel();
    await buttonOf(wrapper, 'Elegir area')?.trigger('click');
    const area = areaOfPlot(4);
    selection.replaceCells(area);
    await settle();

    await buttonOf(wrapper, 'Talar el area')?.trigger('click');
    const modal = useShellUi().topModal.value;
    expect(modal?.panelId).toBe('task-assign');
    expect(modal?.props.operation).toBe(TaskOperation.FELL);
    expect(modal?.props.forestPlotId).toBe(samplePlot().id);
    expect((modal?.props.cells as readonly CellCoordWire[]).length).toBe(area.length);
    wrapper.unmount();
  });

  it('talar la parcela entera va sin area, que es lo que significa omitir las celdas', async () => {
    const wrapper = await mountPanel();
    await buttonOf(wrapper, 'Talar la parcela entera')?.trigger('click');
    const modal = useShellUi().topModal.value;
    expect(modal?.props.operation).toBe(TaskOperation.FELL);
    expect(modal?.props.cells).toEqual([]);
    wrapper.unmount();
  });

  it('el desmonte explica que es la unica direccion del MVP', async () => {
    const wrapper = await mountPanel();
    await buttonOf(wrapper, 'Desmontar area')?.trigger('click');
    await settle();
    const text = wrapper.text();
    expect(text).toContain('terreno cultivable');
    expect(text).toContain('reforestar un campo queda fuera');
    expect(buttonOf(wrapper, 'Desmontar el area')).toBeDefined();
    wrapper.unmount();
  });
});

describe('los motivos de bloqueo de la tala y la replantacion', () => {
  it('sin arboles talables, ni la parcela ni un area se talan', async () => {
    const wrapper = await mountPanel();
    // Patched after the mount, because `ensureTrees` writes the reply of the detail route
    // over the row: the server is the authority on the plot and the panel keeps it so.
    patchPlot({ fellableTreeCount: 0, fellableWoodDm3: 0 });
    await settle();
    const button = buttonOf(wrapper, 'Talar la parcela entera');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toBe(VALIDATION_MESSAGES[ValidationCode.NO_FELLABLE_TREES]);
    wrapper.unmount();
  });

  it('un area sin nada talable se niega aunque la parcela si tenga', async () => {
    const forestry = useForestryStore();
    const selection = useSelectionStore();
    const wrapper = await mountPanel();
    // The whole plot admits felling.
    expect(buttonOf(wrapper, 'Talar la parcela entera')?.attributes('disabled')).toBeUndefined();

    await buttonOf(wrapper, 'Elegir area')?.trigger('click');
    // An area whose only tree is a sapling, which GDD section 131 does not fell.
    const plot = samplePlot();
    const sapling = forestry
      .treesOf(plot.id)
      .find((tree) => tree.status === TreeStatus.STANDING && !tree.fellable);
    expect(sapling).toBeDefined();
    selection.replaceCells([{ cellX: sapling?.cellX ?? 0, cellY: sapling?.cellY ?? 0 }]);
    await settle();

    const button = buttonOf(wrapper, 'Talar el area');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toBe(VALIDATION_MESSAGES[ValidationCode.NO_FELLABLE_TREES]);
    wrapper.unmount();
  });

  it('una tarea en curso sobre la parcela bloquea la tala con su motivo', async () => {
    const tasks = useTasksStore();
    const running = tasks.active[0];
    expect(running).toBeDefined();
    const onPlot: TaskDto = {
      ...(running as TaskDto),
      id: 'task-fell',
      operation: TaskOperation.FELL,
      targetFieldId: null,
      targetForestPlotId: samplePlot().id,
    };
    tasks.upsert(onPlot);

    const wrapper = await mountPanel();
    patchPlot({ currentTaskId: onPlot.id });
    await settle();
    const button = buttonOf(wrapper, 'Talar la parcela entera');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toBe(
      VALIDATION_MESSAGES[ValidationCode.FIELD_HAS_ACTIVE_TASK],
    );
    // And the task in flight is drawn with the countdown of the listing, from the same clock.
    expect(wrapper.text()).toContain('Tarea en curso');
    const meters = wrapper.findAll('[role="meter"]');
    const progress = meters[meters.length - 1]?.attributes('aria-valuenow');
    expect(progress).toBe(String(taskProgressBp(onPlot, plotNow())));
    wrapper.unmount();
  });

  it('sin celdas vacias la replantacion se niega con el codigo compartido', async () => {
    const wrapper = await mountPanel();
    const button = wrapper.findAll('button').find((entry) => entry.text().startsWith('Replantar'));
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toBe(
      VALIDATION_MESSAGES[ValidationCode.CELL_ALREADY_HAS_TREE],
    );
    wrapper.unmount();
  });

  it('con celdas vacias y el arbolado leido, la replantacion las nombra una a una', async () => {
    const wrapper = await mountPanel();
    const forestry = useForestryStore();
    const plot = samplePlot();
    forestry.replacePlotTrees(plot.id, forestry.treesOf(plot.id).slice(3));
    patchPlot({ emptyCellCount: 3 });
    await settle();

    const button = wrapper.findAll('button').find((entry) => entry.text().startsWith('Replantar'));
    expect(button?.text()).toContain('3');
    expect(button?.attributes('disabled')).toBeUndefined();
    await button?.trigger('click');

    const modal = useShellUi().topModal.value;
    expect(modal?.props.operation).toBe(TaskOperation.REPLANT);
    expect((modal?.props.cells as readonly CellCoordWire[]).length).toBe(3);
    wrapper.unmount();
  });

  it('sin parcela elegida no dibuja ningun control', async () => {
    const wrapper = mount(ForestPlotPanel, { props: { forestPlotId: null } });
    await settle();
    expect(wrapper.text()).toContain('Ninguna parcela seleccionada');
    expect(buttonOf(wrapper, 'Talar la parcela entera')).toBeUndefined();
    wrapper.unmount();
  });
});
