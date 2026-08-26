// The shell: the grid, and the single input arbiter.
//
// Owner: W3-C.
//
// The arbiter is the thing worth testing here. Plan section 9.1 asks for the arbitration to be
// centralised in one place, and the failure it prevents is a component that disables the input
// of the world and forgets to restore it, leaving a canvas that no longer answers the mouse
// with nothing on screen to explain it. So the test drives the shell the way the interface does
// -- open a modal, press Escape -- and asserts both the predicate and the event published to
// Phaser, because a predicate that is right while the event is not would leave the scene
// disabled all the same.

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AppShell from '~/components/shell/AppShell.vue';
import TopBar from '~/components/shell/TopBar.vue';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { toWireMoney, Money } from '~/shared/index';
import { usePlayerStore } from '~/stores/player';

function seedPlayer(): void {
  usePlayerStore().applyPlayer({
    id: 'player-test',
    email: 'test@farm-world.local',
    displayName: 'Explotacion de prueba',
    status: 'ACTIVE',
    balance: toWireMoney(Money.fromUnits(1_000)),
    projectedBalance: toWireMoney(Money.fromUnits(990)),
    startedAtGameMs: '0',
    dayNumber: 1,
    lastAccrualGameMs: '0',
    lastLoginGameMs: '0',
    lastSummaryGameMs: '0',
    ledgerSeq: 0,
    eventSeq: 0,
    holdingCostPerGameHour: toWireMoney(Money.fromUnits(12)),
    atGameMs: '0',
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  useShellUi().reset();
  gameBridge().clear();
});

afterEach(() => {
  useShellUi().reset();
  gameBridge().clear();
});

describe('la barra superior', () => {
  it('pinta las siete cifras del plan y el estado de conexion', () => {
    seedPlayer();
    const wrapper = mount(TopBar);
    const text = wrapper.text();
    for (const label of [
      'Saldo',
      'Dia',
      'Multiplicador',
      'Plantilla',
      'Maquinaria',
      'Almacen',
      'Consumo',
    ]) {
      expect(text).toContain(label);
    }
    // La conexion se muestra siempre: un socket muerto en silencio es indistinguible de que
    // no este pasando nada (plan seccion 7).
    expect(text).toContain('Sin conexion');
    expect(text).toContain('Explotacion de prueba');
    wrapper.unmount();
  });
});

describe('el arbitro de entrada', () => {
  it('deshabilita la entrada del mundo al abrir un modal y la restaura al cerrarlo', () => {
    seedPlayer();
    const shell = useShellUi();
    const published: boolean[] = [];
    gameBridge().on('input:enabled', (payload) => {
      published.push(payload.enabled);
    });

    const wrapper = mount(AppShell);
    expect(shell.worldInputEnabled.value).toBe(true);

    shell.openModal('settings');
    expect(shell.worldInputEnabled.value).toBe(false);
    expect(shell.modals.value).toHaveLength(1);

    shell.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shell.modals.value).toHaveLength(0);
    expect(shell.worldInputEnabled.value).toBe(true);

    // Publicado en los dos sentidos, y solo desde el arbitro.
    expect(published).toContain(false);
    expect(published.at(-1)).toBe(true);
    wrapper.unmount();
  });

  it('apila los modales y Escape cierra solo el de arriba', () => {
    const shell = useShellUi();
    shell.openModal('settings');
    shell.openModal('welcome-back');
    expect(shell.topModal.value?.panelId).toBe('welcome-back');

    shell.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shell.modals.value).toHaveLength(1);
    expect(shell.topModal.value?.panelId).toBe('settings');
    expect(shell.worldInputEnabled.value).toBe(false);
  });

  it('no cierra un modal no descartable', () => {
    const shell = useShellUi();
    shell.openModal('welcome-back', {}, false);
    shell.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shell.modals.value).toHaveLength(1);
  });

  it('el panel lateral no quita la entrada al mundo', () => {
    const shell = useShellUi();
    shell.openSidePanel('cell-inspector');
    // Arrastrar una seleccion mientras el panel muestra su precio es el flujo entero de la
    // compra de tierra, de modo que el panel lateral no puede robar el puntero.
    expect(shell.worldInputEnabled.value).toBe(true);
    expect(shell.sidePanel.value?.panelId).toBe('cell-inspector');
  });

  it('Escape colapsa el panel lateral cuando no hay modal', () => {
    const shell = useShellUi();
    shell.openSidePanel('field-list');
    shell.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shell.sidePanelCollapsed.value).toBe(true);
  });

  it('seleccionar una pestana abre su panel por omision', () => {
    const shell = useShellUi();
    shell.selectTab('economy');
    expect(shell.activeTab.value).toBe('economy');
    expect(shell.sidePanel.value?.panelId).toBe('market');
  });
});
