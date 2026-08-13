// The legend, its vocabulary and the units of the world.
//
// Owner: W4-E.
//
// The one assertion that matters here is that not a single colour of the legend is written
// in this codebase twice. GDD sections 59 and 60 make the legend a requirement of
// playability, and a legend whose swatch is a hand copied hex is worse than none: it lies
// the first time somebody changes the palette. So the suite compares every swatch against
// `game/textures/palette.ts`, which is the module that generates the textures themselves.

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import LegendPanel from '~/components/panels/legend/LegendPanel.vue';
import {
  areaHectares,
  cellAreaM2,
  formatArea,
  formatHectares,
  scaleStatement,
} from '~/components/panels/legend/units';
import {
  CROP_STATE_LABELS,
  LEGEND_GROUPS,
  TERRAIN_LABELS,
  TREE_STAGE_LABELS,
  cropStateColour,
  terrainColour,
  treeStageColour,
} from '~/components/panels/legend/vocabulary';
import { useShellUi } from '~/composables/useShellUi';
import { PALETTE, toCssHex } from '~/game/textures/palette';
import { CELL_SIZE_M, CROP_CYCLE_STATES, TERRAIN_TYPES, TREE_GROWTH_STAGES } from '~/shared/index';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('el vocabulario de la leyenda', () => {
  it('nombra los cuatro terrenos, los ocho estados y las cuatro fases de arbol', () => {
    expect(Object.keys(TERRAIN_LABELS)).toHaveLength(TERRAIN_TYPES.length);
    expect(Object.keys(CROP_STATE_LABELS)).toHaveLength(CROP_CYCLE_STATES.length);
    expect(Object.keys(TREE_STAGE_LABELS)).toHaveLength(TREE_GROWTH_STAGES.length);
  });

  it('toma cada color de la paleta y no de un literal', () => {
    for (const terrain of TERRAIN_TYPES) {
      expect(terrainColour(terrain)).toBe(toCssHex(PALETTE.terrain[terrain].base));
    }
    for (const state of CROP_CYCLE_STATES) {
      expect(cropStateColour(state)).toBe(toCssHex(PALETTE.crop[state].mark));
    }
    for (const stage of TREE_GROWTH_STAGES) {
      expect(treeStageColour(stage)).toBe(toCssHex(PALETTE.tree[stage].canopy));
    }
  });

  it('cada grupo cita las secciones del GDD a las que responde', () => {
    for (const group of LEGEND_GROUPS) {
      expect(group.entries.length).toBeGreaterThan(0);
      expect(group.gddSections.length).toBeGreaterThan(0);
      for (const entry of group.entries) {
        expect(entry.colour).toMatch(/^#[0-9a-f]{6,8}$/i);
        expect(entry.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('las unidades de superficie', () => {
  it('una celda son cien metros cuadrados con la escala del plan', () => {
    expect(cellAreaM2(CELL_SIZE_M)).toBe(100);
    expect(formatArea(1)).toBe('100 m2');
  });

  it('cien celdas son una hectarea', () => {
    expect(areaHectares(100)).toBe(1);
    expect(formatHectares(100)).toBe('1,00 ha');
  });

  it('las 250 celdas del arranque son 2,50 ha', () => {
    // GDD section 117 buys 250 cells; plan section 2.2 fixes the 10 m cell, so the figure
    // the interface has to show is 2,5 ha and not something the panel rounds its own way.
    expect(formatHectares(250)).toBe('2,50 ha');
  });

  it('enuncia la escala con el tamano de celda que le pasan', () => {
    expect(scaleStatement(10)).toContain('10 x 10 m');
    expect(scaleStatement(10)).toContain('100 m2');
  });
});

describe('el panel de leyenda', () => {
  it('pinta los seis grupos con una muestra por entrada', () => {
    const wrapper = mount(LegendPanel);
    const text = wrapper.text();
    for (const group of LEGEND_GROUPS) {
      expect(text).toContain(group.title);
    }
    for (const state of CROP_CYCLE_STATES) {
      expect(text).toContain(CROP_STATE_LABELS[state]);
    }
    const swatches = wrapper.findAll('.fw-legend__swatch');
    const entries = LEGEND_GROUPS.reduce((total, group) => total + group.entries.length, 0);
    expect(swatches).toHaveLength(entries);
    wrapper.unmount();
  });

  it('es la unica via hacia los ajustes, que son un modal sin otra entrada', async () => {
    const wrapper = mount(LegendPanel);
    const button = wrapper.findAll('button').find((candidate) => candidate.text() === 'Ajustes');
    expect(button).toBeDefined();
    await button?.trigger('click');
    expect(useShellUi().topModal.value?.panelId).toBe('settings');
    useShellUi().reset();
    wrapper.unmount();
  });

  it('se pliega y se despliega sin perder la cabecera', async () => {
    const wrapper = mount(LegendPanel);
    expect(wrapper.text()).toContain('Terreno');
    const fold = wrapper.findAll('button').find((candidate) => candidate.text() === 'Plegar');
    await fold?.trigger('click');
    expect(wrapper.text()).not.toContain('Terreno');
    expect(wrapper.text()).toContain('Leyenda');
    wrapper.unmount();
  });

  it('muestra los atajos de teclado bajo peticion', async () => {
    const wrapper = mount(LegendPanel);
    expect(wrapper.text()).not.toContain('Desplazar el mapa');
    const toggles = wrapper.findAll('button');
    const shortcuts = toggles.find((button) => button.text() === 'Mostrar');
    expect(shortcuts).toBeDefined();
    await shortcuts?.trigger('click');
    expect(wrapper.text()).toContain('Desplazar el mapa');
    expect(wrapper.text()).toContain('Cancelar la seleccion');
    wrapper.unmount();
  });
});
