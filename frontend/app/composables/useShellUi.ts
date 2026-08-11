// The shell: tabs, side panel, modal stack, and the input arbiter.
//
// Owner: W3-C.
//
// The input arbiter is the reason this module exists and the reason it is one module. Plan
// section 9.1 asks for the arbitration to be centralised in a single place: opening a modal
// disables the input of the world scene and enables the pointers of the modal layer, and
// Escape closes the topmost modal. Spread over the components, that rule fails in the way
// input rules always fail, which is one component that forgets to restore what it disabled
// and leaves a canvas that no longer answers the mouse with nothing on screen to explain
// it.
//
// So there is exactly one predicate, `worldInputEnabled`, one place that computes it, and
// one event that publishes it to Phaser. A component never disables input; it opens a modal
// and the arbiter draws the consequence.
//
// State is module scoped rather than a store because it is presentation and not server
// state: nothing here is reduced from a frame, nothing here survives a reload, and putting
// it in Pinia would invite a reducer to write it.

import { computed, effectScope, readonly, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
  PANEL_REGISTRY,
  PANEL_TABS,
  type PanelId,
  type PanelTabId,
} from '~/components/panels/registry';
import { gameBridge } from '~/composables/useGameBridge';

/** A modal on the stack. The topmost one holds the input. */
export interface OpenModal {
  readonly instanceId: string;
  readonly panelId: PanelId;
  /** Props the panel needs, for example which field is being inspected. */
  readonly props: Readonly<Record<string, unknown>>;
  /** Whether Escape and a click on the backdrop may close it. */
  readonly dismissible: boolean;
}

/** What the side panel is showing. */
export interface SidePanelTarget {
  readonly panelId: PanelId;
  readonly props: Readonly<Record<string, unknown>>;
}

const activeTab = ref<PanelTabId>(PANEL_TABS[0].id);
const sidePanel = ref<SidePanelTarget | null>(null);
const sidePanelCollapsed = ref(false);
const modals = ref<readonly OpenModal[]>([]);
const noticeTrayOpen = ref(false);
let modalCounter = 0;

/**
 * Whether the world scene accepts input.
 *
 * One expression, one place. The world takes input when no modal is open; everything else
 * about the shell is irrelevant to it, and in particular the side panel does not disable
 * it, because the player has to be able to drag a selection while a panel shows its
 * price.
 */
const worldInputEnabled = computed(() => modals.value.length === 0);

const topModal = computed<OpenModal | null>(() => modals.value.at(-1) ?? null);
const modalOpen = computed(() => modals.value.length > 0);
const sidePanelOpen = computed(() => sidePanel.value !== null && !sidePanelCollapsed.value);

let arbiterInstalled = false;

/**
 * Publishes the input verdict to Phaser whenever it changes, and only from here.
 *
 * Two details of how the watcher is created are load bearing. It runs inside a detached
 * `effectScope`, so it belongs to the module and not to whichever component happened to call
 * `useShellUi` first: tied to a component scope it would be disposed when that component
 * unmounted, and from then on opening a modal would stop disabling the canvas. And it flushes
 * synchronously, because the arbiter has to have spoken before the frame that shows the modal
 * is drawn; with the default deferred flush the scene would take one more frame of input from
 * behind an open dialogue.
 */
function installArbiter(): void {
  if (arbiterInstalled) {
    return;
  }
  arbiterInstalled = true;
  effectScope(true).run(() => {
    watch(
      worldInputEnabled,
      (enabled) => {
        gameBridge().emit('input:enabled', {
          enabled,
          reason: enabled ? 'no modal open' : 'modal holds the input',
        });
      },
      { immediate: true, flush: 'sync' },
    );
  });
}

export interface ShellUi {
  readonly activeTab: Ref<PanelTabId>;
  readonly sidePanel: Readonly<Ref<SidePanelTarget | null>>;
  readonly sidePanelCollapsed: Ref<boolean>;
  readonly sidePanelOpen: ComputedRef<boolean>;
  readonly modals: Readonly<Ref<readonly OpenModal[]>>;
  readonly topModal: ComputedRef<OpenModal | null>;
  readonly modalOpen: ComputedRef<boolean>;
  readonly worldInputEnabled: ComputedRef<boolean>;
  readonly noticeTrayOpen: Ref<boolean>;
  selectTab: (tab: PanelTabId) => void;
  openSidePanel: (panelId: PanelId, props?: Readonly<Record<string, unknown>>) => void;
  closeSidePanel: () => void;
  toggleSidePanel: () => void;
  openModal: (
    panelId: PanelId,
    props?: Readonly<Record<string, unknown>>,
    dismissible?: boolean,
  ) => string;
  closeModal: (instanceId?: string) => void;
  closeTopModal: () => void;
  closeAllModals: () => void;
  /** The keydown handler of the shell. Registered once, by the layout. */
  handleKeydown: (event: KeyboardEvent) => void;
  reset: () => void;
}

export function useShellUi(): ShellUi {
  installArbiter();

  function selectTab(tab: PanelTabId): void {
    activeTab.value = tab;
    const defaultPanel = PANEL_TABS.find((candidate) => candidate.id === tab)?.defaultPanel;
    if (defaultPanel !== undefined) {
      sidePanel.value = { panelId: defaultPanel, props: {} };
      sidePanelCollapsed.value = false;
    }
  }

  function openSidePanel(panelId: PanelId, props: Readonly<Record<string, unknown>> = {}): void {
    sidePanel.value = { panelId, props };
    sidePanelCollapsed.value = false;
    const tab = PANEL_REGISTRY[panelId].tab;
    if (tab !== null) {
      activeTab.value = tab;
    }
  }

  function closeSidePanel(): void {
    sidePanel.value = null;
  }

  function toggleSidePanel(): void {
    sidePanelCollapsed.value = !sidePanelCollapsed.value;
  }

  function openModal(
    panelId: PanelId,
    props: Readonly<Record<string, unknown>> = {},
    dismissible = true,
  ): string {
    modalCounter += 1;
    const instanceId = `modal-${modalCounter}`;
    modals.value = [...modals.value, { instanceId, panelId, props, dismissible }];
    return instanceId;
  }

  function closeModal(instanceId?: string): void {
    if (instanceId === undefined) {
      modals.value = modals.value.slice(0, -1);
      return;
    }
    modals.value = modals.value.filter((modal) => modal.instanceId !== instanceId);
  }

  function closeTopModal(): void {
    const top = topModal.value;
    if (top === null || !top.dismissible) {
      return;
    }
    closeModal(top.instanceId);
  }

  function closeAllModals(): void {
    modals.value = modals.value.filter((modal) => !modal.dismissible);
  }

  /**
   * The keyboard of the shell.
   *
   * Escape closes the topmost modal and, when there is none, collapses the side panel;
   * that order is what makes Escape mean "go back one step" rather than "close everything",
   * which is the behaviour that loses a half filled form.
   */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    if (modalOpen.value) {
      event.preventDefault();
      closeTopModal();
      return;
    }
    if (noticeTrayOpen.value) {
      event.preventDefault();
      noticeTrayOpen.value = false;
      return;
    }
    if (sidePanelOpen.value) {
      event.preventDefault();
      sidePanelCollapsed.value = true;
    }
  }

  function reset(): void {
    activeTab.value = PANEL_TABS[0].id;
    sidePanel.value = null;
    sidePanelCollapsed.value = false;
    modals.value = [];
    noticeTrayOpen.value = false;
  }

  return {
    activeTab,
    sidePanel: readonly(sidePanel) as Readonly<Ref<SidePanelTarget | null>>,
    sidePanelCollapsed,
    sidePanelOpen,
    modals: readonly(modals) as Readonly<Ref<readonly OpenModal[]>>,
    topModal,
    modalOpen,
    worldInputEnabled,
    noticeTrayOpen,
    selectTab,
    openSidePanel,
    closeSidePanel,
    toggleSidePanel,
    openModal,
    closeModal,
    closeTopModal,
    closeAllModals,
    handleKeydown,
    reset,
  };
}
