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
const textEntryFocused = ref(false);
let modalCounter = 0;

/**
 * Whether the focused element takes typing.
 *
 * The three cases are the ones the panels of this interface actually contain: an input
 * that is not a button-like control, a textarea, and anything marked editable. A select
 * is deliberately not one of them: it consumes the keys it needs while it is open and
 * arrow keys over a closed select are not text.
 */
function isTextEntry(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }
  if (!(element instanceof HTMLInputElement)) {
    return false;
  }
  const type = element.type.toLowerCase();
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file'].includes(
    type,
  );
}

/**
 * Whether the world scene accepts input.
 *
 * One expression, one place. Two things take the input away from the canvas, and neither
 * of them is the side panel: the player has to be able to drag a selection while a panel
 * shows its price.
 *
 * The first is a modal, which is the case plan section 9.1 names. The second is the
 * keyboard focus sitting in a text field, which is not a subtlety: the camera binds WASD
 * on the document and the selection tool binds Enter and Escape, so naming a field
 * "Parcela sur" while a side panel is open would pan the camera and confirm the
 * selection (docs/handoff/NOTES-w4d.md 2.4 and NOTES-w4g.md 1.7). Only the keyboard is
 * really at stake, but the predicate is one boolean by design, and losing the drag while
 * the caret is in a field costs nothing: the player is typing, not dragging.
 */
const worldInputEnabled = computed(() => modals.value.length === 0 && !textEntryFocused.value);

const topModal = computed<OpenModal | null>(() => modals.value.at(-1) ?? null);
const modalOpen = computed(() => modals.value.length > 0);
const sidePanelOpen = computed(() => sidePanel.value !== null && !sidePanelCollapsed.value);

let arbiterInstalled = false;

/**
 * What the canvas answers when Escape is pressed: true when it consumed the key.
 *
 * Escape had two owners, which is one too many (docs/handoff/NOTES-w4g.md, section 1.6):
 * the selection tool cancels the mode from its own keyboard binding, and the shell
 * collapses the side panel, so one press did both. The tool cannot ask permission, because
 * it is a Phaser scene and it may not import this module, so the arbitration is inverted:
 * the shell asks the canvas whether this press is its, and stands down when it is. The
 * page that mounts the tool registers the claim, and nothing else may.
 */
export type CanvasEscapeClaim = () => boolean;
let canvasEscapeClaim: CanvasEscapeClaim | null = null;

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
          reason: enabled
            ? 'no modal open and no text field focused'
            : modals.value.length > 0
              ? 'modal holds the input'
              : 'a text field holds the keyboard',
        });
      },
      { immediate: true, flush: 'sync' },
    );
  });
  // The focus is a document fact and not a component one, so it is observed once, here,
  // where the predicate that consumes it lives. `focusin` and `focusout` and not `focus`
  // and `blur`, because only the first pair bubbles to the document.
  if (typeof document !== 'undefined') {
    const update = (): void => {
      textEntryFocused.value = isTextEntry(document.activeElement);
    };
    document.addEventListener('focusin', update, true);
    document.addEventListener('focusout', update, true);
    update();
  }
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
  /** Registers what the canvas answers to Escape. Null gives the key back to the shell. */
  setCanvasEscapeClaim: (claim: CanvasEscapeClaim | null) => void;
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

  function setCanvasEscapeClaim(claim: CanvasEscapeClaim | null): void {
    canvasEscapeClaim = claim;
  }

  /**
   * The keyboard of the shell.
   *
   * Escape means "go back one step" and not "close everything", which is the behaviour
   * that loses a half filled form, so it walks one ladder and stops at the first rung
   * that has something to give back: the topmost modal, then the canvas, then the notice
   * tray, then the side panel.
   *
   * The canvas is second and it is the only rung this module does not act on itself. The
   * selection tool cancels from its own binding, so what the shell has to do is stand
   * down; leaving it out of the ladder is what made one press cancel the selection and
   * collapse the panel at the same time. With a modal open the canvas has no input at all,
   * which is why it is asked after the modal and not before.
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
    if (worldInputEnabled.value && canvasEscapeClaim?.() === true) {
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
    canvasEscapeClaim = null;
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
    setCanvasEscapeClaim,
    reset,
  };
}
