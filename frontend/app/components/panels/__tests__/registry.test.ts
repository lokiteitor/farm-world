// The registry and its twenty three stubs.
//
// Owner: W3-C.
//
// The registry is frozen after this phase, so what is asserted here is the contract the agents
// of W4, W5 and W6 will find: twenty three panels, one directory each, every declared component
// resolvable, and every stub mounting without a console error. The last one is the assertion
// that makes the freeze safe: a registry that imports a module that does not exist fails at the
// moment a panel is opened, which is a long way from where the mistake was made.

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  PANEL_IDS,
  PANEL_REGISTRY,
  PANEL_TABS,
  PANEL_TAB_IDS,
  PanelSurface,
  panelsOfOwner,
  panelsOfSurface,
  panelsOfTab,
  type PanelId,
} from '~/components/panels/registry';

/** Resolves an async component to the component it loads. */
async function resolvePanel(panelId: PanelId): Promise<unknown> {
  const definition = PANEL_REGISTRY[panelId];
  const asAsync = definition.component as { __asyncLoader?: () => Promise<unknown> };
  expect(typeof asAsync.__asyncLoader).toBe('function');
  const loader = asAsync.__asyncLoader;
  if (loader === undefined) {
    throw new Error(`El panel ${panelId} no declara un cargador asincrono.`);
  }
  const loaded = (await loader()) as { default?: unknown };
  return loaded.default ?? loaded;
}

let warn: MockInstance;
let error: MockInstance;

beforeEach(() => {
  setActivePinia(createPinia());
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe('el registro de paneles', () => {
  it('declara exactamente veintitres paneles', () => {
    expect(PANEL_IDS).toHaveLength(23);
    expect(new Set(PANEL_IDS).size).toBe(23);
  });

  it('cada entrada coincide con su clave y declara secciones del GDD', () => {
    for (const id of PANEL_IDS) {
      const panel = PANEL_REGISTRY[id];
      expect(panel.id).toBe(id);
      expect(panel.title.length).toBeGreaterThan(0);
      expect(panel.summary.length).toBeGreaterThan(0);
      expect(panel.gddSections.length).toBeGreaterThan(0);
    }
  });

  it('reparte los paneles entre los tres agentes de las fases posteriores', () => {
    const w4 = panelsOfOwner('W4-E').length;
    const w5 = panelsOfOwner('W5-F').length;
    const w6 = panelsOfOwner('W6-D').length;
    expect(w4 + w5 + w6).toBe(23);
    expect(w4).toBeGreaterThan(0);
    expect(w5).toBeGreaterThan(0);
    expect(w6).toBeGreaterThan(0);
  });

  it('toda pestana tiene un panel por omision que existe y la reclama', () => {
    for (const tab of PANEL_TABS) {
      const target = PANEL_REGISTRY[tab.defaultPanel as PanelId];
      expect(target).toBeDefined();
      expect(panelsOfTab(tab.id).length).toBeGreaterThan(0);
    }
    expect(PANEL_TAB_IDS).toHaveLength(PANEL_TABS.length);
  });

  it('todo panel con pestana declara una pestana que existe', () => {
    for (const id of PANEL_IDS) {
      const tab = PANEL_REGISTRY[id].tab;
      if (tab !== null) {
        expect(PANEL_TAB_IDS).toContain(tab);
      }
    }
  });

  it('reparte los paneles entre las tres superficies', () => {
    const side = panelsOfSurface(PanelSurface.SIDE).length;
    const modal = panelsOfSurface(PanelSurface.MODAL).length;
    const overlay = panelsOfSurface(PanelSurface.OVERLAY).length;
    expect(side + modal + overlay).toBe(23);
  });
});

describe('los stubs de panel', () => {
  it('todos montan sin error de consola', async () => {
    for (const id of PANEL_IDS) {
      const component = await resolvePanel(id);
      const wrapper = mount(component as Parameters<typeof mount>[0]);
      // El stub dice su titulo y se declara no implementado, que es lo que lo distingue de
      // un panel roto.
      expect(wrapper.text()).toContain(PANEL_REGISTRY[id].title);
      expect(wrapper.text()).toContain('No implementado');
      expect(wrapper.text()).toContain(PANEL_REGISTRY[id].owner);
      wrapper.unmount();
    }
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
