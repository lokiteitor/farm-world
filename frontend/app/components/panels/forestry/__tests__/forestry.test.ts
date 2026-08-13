// The forestry listing: what is standing, what it is worth, and what may be done to it.
//
// Owner: W6-T.
//
// The arithmetic is asserted on `shared/forestPresentation.ts` directly
// (`components/panels/shared/__tests__/forestPresentation.test.ts`). What is asserted here is
// what only the component can be wrong about.
//
// A plot is not a field: GDD section 128 makes forestry a parallel production system, and a
// plot is a collection of individual trees at different stages (GDD sections 129 and 130). So
// the reading that matters is the composition, and the panel has to draw the four stages of
// GDD section 131 always, including the empty ones, with the volume of each and the total the
// plot reports.
//
// And every control that refuses has to say why with the code the server would answer
// (ADR-0032). Two of the three refusals of this panel are codes of the contract, and the
// third one is not: `POST .../replant` names its cells one by one (GDD section 137), the tree
// page does not travel in the snapshot, and a client that has not read it cannot tell an
// empty cell from a planted one. The contract has no code for that, and the control still
// needs a sentence.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import ForestryPanel from '~/components/panels/forestry/ForestryPanel.vue';
import { formatArea } from '~/components/panels/legend/units';
import { TREE_STAGE_LABELS } from '~/components/panels/legend/vocabulary';
import { woodM3, woodValue } from '~/components/panels/shared/forestPresentation';
import { formatCount, formatMoney } from '~/composables/useFormatting';
import { useShellUi } from '~/composables/useShellUi';
import { apiCall } from '~/net/api';
import {
  TREE_GROWTH_STAGES,
  TaskOperation,
  VALIDATION_MESSAGES,
  ValidationCode,
  type ForestPlotDto,
} from '~/shared/index';
import { useForestryStore } from '~/stores/forestry';
import { useWorldStore } from '~/stores/world';

/** The plot the sample world starts with, already populated with natural forest. */
function samplePlot(): ForestPlotDto {
  const plot = useForestryStore().all[0];
  if (plot === undefined) {
    throw new Error('el mundo simulado no trajo ninguna parcela forestal');
  }
  return plot;
}

function patchPlot(overrides: Partial<ForestPlotDto>): ForestPlotDto {
  const forestry = useForestryStore();
  const patched = { ...samplePlot(), ...overrides };
  forestry.upsert(patched);
  return patched;
}

/**
 * Reads the tree page of the plot into the store.
 *
 * The trees do not travel in the snapshot (`shared/api/schemas/state.ts`): the detail route
 * exists precisely for the client that has the plot and not its trees. Until it answers, the
 * client cannot name an empty cell, which is what the replanting control depends on.
 */
async function loadTrees(): Promise<void> {
  const plot = samplePlot();
  const reply = await apiCall('GET /api/forest-plots/:forestPlotId', {
    params: { forestPlotId: plot.id },
  });
  useForestryStore().replacePlotTrees(plot.id, reply.trees);
}

function buttonOf(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label);
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('el recuento por fase (§131)', () => {
  it('dibuja las cuatro fases del ciclo, incluidas las vacias, con su recuento', async () => {
    const plot = patchPlot({
      stageHistogram: { SAPLING: 3, YOUNG: 0, MATURE: 7, OLD_GROWTH: 2 },
    });
    const wrapper = mount(ForestryPanel);
    await settle();

    const rows = wrapper.findAll('.fw-forestry__stages li');
    expect(rows).toHaveLength(TREE_GROWTH_STAGES.length);
    for (const stage of TREE_GROWTH_STAGES) {
      const row = rows.find((entry) => entry.text().includes(TREE_STAGE_LABELS[stage]));
      expect(row).toBeDefined();
      expect(row?.text()).toContain(formatCount(plot.stageHistogram[stage]));
    }
    // The stage that is empty is a fact worth reading, not a row to drop.
    expect(rows.some((row) => row.text().includes(TREE_STAGE_LABELS.YOUNG))).toBe(true);
    // The enum identifier never reaches the player.
    expect(wrapper.text()).not.toContain('OLD_GROWTH');
    wrapper.unmount();
  });

  it('marca como no talable la fase de planton, y solo esa', async () => {
    const wrapper = mount(ForestryPanel);
    await settle();
    const rows = wrapper.findAll('.fw-forestry__stages li');
    const notFellable = rows.filter((row) => row.text().includes('no talable'));
    expect(notFellable).toHaveLength(1);
    expect(notFellable[0]?.text()).toContain(TREE_STAGE_LABELS.SAPLING);
    wrapper.unmount();
  });
});

describe('el volumen estimado y su valor (§131 y §133)', () => {
  it('muestra la madera en pie y la talable de la parcela, en metros cubicos', async () => {
    const plot = samplePlot();
    const wrapper = mount(ForestryPanel);
    await settle();
    const text = wrapper.text();
    expect(text).toContain(`${woodM3(plot.standingWoodDm3).toFixed(2)} m3`);
    expect(text).toContain(`${woodM3(plot.fellableWoodDm3).toFixed(2)} m3`);
    // Standing wood includes the saplings, which are not fellable, so the two differ.
    expect(plot.standingWoodDm3).toBeGreaterThan(plot.fellableWoodDm3);
    wrapper.unmount();
  });

  it('valora la tala con la regla compartida y nunca con un precio escrito aqui', async () => {
    const plot = samplePlot();
    const wrapper = mount(ForestryPanel);
    await settle();
    expect(wrapper.text()).toContain(formatMoney(woodValue(plot.fellableWoodDm3)));
    wrapper.unmount();
  });

  it('la superficie se da en la escala del mundo y no en celdas a secas', async () => {
    const plot = samplePlot();
    const wrapper = mount(ForestryPanel);
    await settle();
    expect(wrapper.text()).toContain(formatArea(plot.cellCount, useWorldStore().cellSizeM));
    wrapper.unmount();
  });
});

describe('los controles de tala y replantacion, con sus motivos', () => {
  it('con arboles talables y sin tarea, la tala esta disponible', async () => {
    const plot = samplePlot();
    expect(plot.fellableTreeCount).toBeGreaterThan(0);
    const wrapper = mount(ForestryPanel);
    await settle();
    expect(buttonOf(wrapper, 'Talar la parcela')?.attributes('disabled')).toBeUndefined();
    expect(buttonOf(wrapper, 'Talar un area')?.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('una tarea en curso bloquea la tala y la replantacion con el mismo motivo', async () => {
    patchPlot({ currentTaskId: 'task-plow-east', emptyCellCount: 4 });
    const wrapper = mount(ForestryPanel);
    await settle();
    const reason = VALIDATION_MESSAGES[ValidationCode.FIELD_HAS_ACTIVE_TASK];
    for (const label of ['Talar la parcela', 'Talar un area', 'Replantar']) {
      const button = buttonOf(wrapper, label);
      expect(button?.attributes('disabled')).toBeDefined();
      expect(button?.attributes('title')).toBe(reason);
    }
    expect(wrapper.text()).toContain(reason);
    wrapper.unmount();
  });

  it('sin arboles talables la tala se niega nombrando esa razon', async () => {
    patchPlot({ fellableTreeCount: 0, fellableWoodDm3: 0 });
    const wrapper = mount(ForestryPanel);
    await settle();
    const button = buttonOf(wrapper, 'Talar la parcela');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toBe(VALIDATION_MESSAGES[ValidationCode.NO_FELLABLE_TREES]);
    wrapper.unmount();
  });

  it('sin celdas vacias la replantacion se niega, y con ellas se ofrece', async () => {
    await loadTrees();
    patchPlot({ emptyCellCount: 0 });
    const full = mount(ForestryPanel);
    await settle();
    const denied = buttonOf(full, 'Replantar');
    expect(denied?.attributes('disabled')).toBeDefined();
    expect(denied?.attributes('title')).toBe(
      VALIDATION_MESSAGES[ValidationCode.CELL_ALREADY_HAS_TREE],
    );
    full.unmount();

    // One tree felled leaves its cell free, which is what replanting fills (GDD 137).
    const forestry = useForestryStore();
    const plot = samplePlot();
    forestry.replacePlotTrees(plot.id, forestry.treesOf(plot.id).slice(1));
    patchPlot({ emptyCellCount: 1 });
    const wrapper = mount(ForestryPanel);
    await settle();
    const offered = buttonOf(wrapper, 'Replantar');
    expect(offered?.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('sin el arbolado leido no ofrece replantar, aunque la parcela diga que hay hueco', async () => {
    // The tree page does not travel in the snapshot, and `emptyCells` over an empty page
    // returns every cell of the plot: offering it would name two hundred cells that do
    // carry a tree. The count of the plot is the check.
    patchPlot({ emptyCellCount: 5 });
    expect(useForestryStore().treesOf(samplePlot().id)).toHaveLength(0);

    const wrapper = mount(ForestryPanel);
    await settle();
    const button = buttonOf(wrapper, 'Replantar');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.attributes('title')).toBeDefined();
    expect(button?.attributes('title')).not.toBe('');
    expect(wrapper.text()).toContain('arbolado no leido todavia');
    wrapper.unmount();
  });
});

describe('lo que la lista entrega a otro panel (ADR-0032)', () => {
  it('talar la parcela entera abre la asignacion con la operacion y sin area', async () => {
    const plot = samplePlot();
    const wrapper = mount(ForestryPanel);
    await settle();
    await buttonOf(wrapper, 'Talar la parcela')?.trigger('click');

    const shell = useShellUi();
    const modal = shell.topModal.value;
    expect(modal?.panelId).toBe('task-assign');
    expect(modal?.props.forestPlotId).toBe(plot.id);
    expect(modal?.props.operation).toBe(TaskOperation.FELL);
    // An omitted area means the whole plot on the wire (GDD section 132, option B).
    expect(modal?.props.cells).toEqual([]);
    wrapper.unmount();
  });

  it('replantar entrega las celdas vacias una a una', async () => {
    await loadTrees();
    const forestry = useForestryStore();
    const plot = samplePlot();
    forestry.replacePlotTrees(plot.id, forestry.treesOf(plot.id).slice(2));
    patchPlot({ emptyCellCount: 2 });

    const wrapper = mount(ForestryPanel);
    await settle();
    await buttonOf(wrapper, 'Replantar')?.trigger('click');

    const modal = useShellUi().topModal.value;
    expect(modal?.panelId).toBe('task-assign');
    expect(modal?.props.operation).toBe(TaskOperation.REPLANT);
    expect((modal?.props.cells as unknown[]).length).toBe(2);
    wrapper.unmount();
  });

  it('inspeccionar abre el panel de la parcela', async () => {
    const plot = samplePlot();
    const wrapper = mount(ForestryPanel);
    await settle();
    await buttonOf(wrapper, 'Inspeccionar')?.trigger('click');
    const shell = useShellUi();
    expect(shell.sidePanel.value?.panelId).toBe('forest-plot');
    expect(shell.sidePanel.value?.props.forestPlotId).toBe(plot.id);
    wrapper.unmount();
  });

  it('sin parcelas explica como se consigue una', async () => {
    useForestryStore().replaceAll([]);
    const wrapper = mount(ForestryPanel);
    await settle();
    expect(wrapper.text()).toContain('Sin parcelas forestales');
    expect(buttonOf(wrapper, 'Talar la parcela')).toBeUndefined();
    wrapper.unmount();
  });
});
