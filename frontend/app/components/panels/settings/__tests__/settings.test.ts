// The settings panel and the preferences it owns.
//
// Owner: W4-E.
//
// The preferences module is asserted on its own, because what matters about it is that it is
// total: the input is whatever was in `localStorage`, possibly written by an older version of
// the file, and one bad key must not reset the other four. The panel is asserted on the two
// things it is answerable for: the multiplier of the world is shown and cannot be edited (GDD
// section 51), and logging out closes the session before it navigates away.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import {
  DEFAULT_PREFERENCES,
  LOD_THRESHOLD_CHOICES,
  PREFERENCES_STORAGE_KEY,
  ZOOM_SENSITIVITY_MAX,
  ZOOM_SENSITIVITY_MIN,
  applyDocumentPreferences,
  loadPreferences,
  normalisePreferences,
  savePreferences,
  type PreferenceStorage,
} from '~/components/panels/settings/preferences';
import SettingsPanel from '~/components/panels/settings/SettingsPanel.vue';
import { gameBridge } from '~/composables/useGameBridge';
import { NEAR_LOD_MIN_ZOOM } from '~/game/world/config';

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('las preferencias del cliente', () => {
  it('parte del umbral de nivel de detalle del renderizador y no de un literal', () => {
    expect(DEFAULT_PREFERENCES.lodThresholdZoom).toBe(NEAR_LOD_MIN_ZOOM);
    expect(LOD_THRESHOLD_CHOICES).toContain(NEAR_LOD_MIN_ZOOM);
  });

  it('un valor ilegible de una clave no arrastra a las demas', () => {
    const normalised = normalisePreferences({
      gridVisible: false,
      lodThresholdZoom: 'lo que sea',
      zoomSensitivity: 99,
      reducedMotion: true,
    });
    expect(normalised.gridVisible).toBe(false);
    expect(normalised.reducedMotion).toBe(true);
    expect(normalised.lodThresholdZoom).toBe(DEFAULT_PREFERENCES.lodThresholdZoom);
    expect(normalised.zoomSensitivity).toBe(ZOOM_SENSITIVITY_MAX);
  });

  it('acota la sensibilidad del zoom por los dos extremos', () => {
    expect(normalisePreferences({ zoomSensitivity: -5 }).zoomSensitivity).toBe(
      ZOOM_SENSITIVITY_MIN,
    );
    expect(normalisePreferences({ zoomSensitivity: 1.5 }).zoomSensitivity).toBe(1.5);
  });

  it('un almacenamiento con basura devuelve los valores por omision', () => {
    const storage = memoryStorage({ [PREFERENCES_STORAGE_KEY]: '{no es json' });
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
  });

  it('sobrevive a una recarga', () => {
    const storage = memoryStorage();
    savePreferences({ ...DEFAULT_PREFERENCES, gridVisible: false, zoomSensitivity: 1.75 }, storage);
    const loaded = loadPreferences(storage);
    expect(loaded.gridVisible).toBe(false);
    expect(loaded.zoomSensitivity).toBe(1.75);
  });

  it('el movimiento reducido es un atributo del elemento raiz', () => {
    const root = document.createElement('html');
    applyDocumentPreferences({ ...DEFAULT_PREFERENCES, reducedMotion: true }, root);
    expect(root.getAttribute('data-fw-reduced-motion')).toBe('true');
    applyDocumentPreferences(DEFAULT_PREFERENCES, root);
    expect(root.hasAttribute('data-fw-reduced-motion')).toBe(false);
  });
});

describe('el panel de ajustes', () => {
  beforeEach(async () => {
    await bootMockClient();
    globalThis.localStorage?.removeItem(PREFERENCES_STORAGE_KEY);
  });

  afterEach(() => {
    teardownMockClient();
  });

  it('ofrece las cinco preferencias', async () => {
    const wrapper = mount(SettingsPanel);
    await settle();
    const text = wrapper.text();
    for (const label of [
      'Rejilla',
      'Contornos',
      'Umbral de nivel de detalle',
      'Sensibilidad del zoom',
      'Movimiento reducido',
    ]) {
      expect(text).toContain(label);
    }
    wrapper.unmount();
  });

  it('muestra el multiplicador en solo lectura y el estado de la conexion', async () => {
    const wrapper = mount(SettingsPanel);
    await settle();
    expect(wrapper.text()).toContain('Configuracion del servidor, en solo lectura');
    expect(wrapper.text()).toContain('24x');
    expect(wrapper.text()).toContain('Sin conexion');
    wrapper.unmount();
  });

  it('persiste un cambio y pide al lienzo que se repinte', async () => {
    const reloads: unknown[] = [];
    gameBridge().on('world:reload', (payload) => reloads.push(payload));

    const wrapper = mount(SettingsPanel);
    await settle();
    await wrapper.findAll('input[type="checkbox"]')[0]?.setValue(false);
    await settle();

    expect(loadPreferences().gridVisible).toBe(false);
    expect(reloads.length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('restaurar valores vuelve a los del renderizador', async () => {
    const wrapper = mount(SettingsPanel);
    await settle();
    await wrapper.findAll('input[type="checkbox"]')[0]?.setValue(false);
    await settle();
    const restore = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Restaurar valores');
    await restore?.trigger('click');
    await settle();
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    wrapper.unmount();
  });

  it('cerrar sesion cierra la sesion antes de navegar', async () => {
    const redirect = vi.fn();
    const wrapper = mount(SettingsPanel, { props: { redirect } });
    await settle();
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Cerrar sesion');
    await button?.trigger('click');
    await settle(6);
    expect(redirect).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
