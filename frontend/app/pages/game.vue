<script setup lang="ts">
// The game page.
//
// Owner: W3-C, and the seam of the canvas is W5-W.
//
// It is the place where the pieces are joined and it holds no logic of its own beyond that
// joining, which is the point: the grid is in AppShell, the reducer is in the sync store, the
// connection is in the net store, and the clock extrapolates in its composable. What the page
// decides is the order in which they start, and that order matters.
//
// First the full state, then the socket. Loading the snapshot before connecting means the mark
// of the reducer is already at the sequence of the snapshot when `HELLO` arrives, so the
// comparison finds no gap and no replay is requested for frames the snapshot already contains.
// Connecting first would work too, through the ladder, but it would spend a replay on every
// page load.
//
// Then the canvas, and only then. The world source generates the terrain of a chunk locally
// from the seed (plan section 5.1), and the generated terrain is cached, so a scene built
// before `world/info` arrived would cache chunks drawn with a seed of zero and keep showing
// them. The canvas is therefore mounted after the bootstrap has resolved, one way or the
// other: a failed bootstrap still mounts it, because the failure is already reported over it
// and an empty viewport says less than a world with a banner on top.
//
// Six bindings live here and cannot live anywhere else, because `app/game` may not import
// `app/stores` (zone rule of eslint.config.js) and a Phaser scene may not call `inject`:
//
//   1. `WorldSource`, which is the world store seen through the port of W4-D.
//   2. `EntitySource`, which is the same idea for the entity layer of W5-D: buildings,
//      machinery, staff and trees, plus the cells a task drives over.
//   3. `SelectionPort`, which is the selection tool of W4-G writing the selection store and
//      opening the panel that owns each request.
//   4. The subject of a mode a panel arms, which is the half of `selection:mode` that the
//      shared vocabulary of purposes cannot carry.
//   5. The rendering preferences, which the settings panel persists and the scene applies.
//   6. The claim on Escape, so that the key has one owner per press.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  PANEL_REGISTRY,
  PanelSurface,
  panelsOfSurface,
  type PanelId,
} from '~/components/panels/registry';
import { loadPreferences } from '~/components/panels/settings/preferences';
import AppShell from '~/components/shell/AppShell.vue';
import WorldViewport from '~/components/shell/WorldViewport.client.vue';
import {
  gameBridge,
  useGameBridge,
  type SelectionMode,
  type SelectionToolModeName,
} from '~/composables/useGameBridge';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import { connectShellBridge, createGame, type GameHandle } from '~/game';
import {
  createEntityLayer,
  createStoreEntitySource,
  type EntityLayer,
  type EntitySource,
} from '~/game/entities';
import { type OverlayScene } from '~/game/overlay';
import {
  SELECTION_TOOL_MODES,
  SelectionToolMode,
  createSelectionTool,
  modeDrawsSelection,
  type SelectionSnapshot,
  type SelectionTool,
} from '~/game/selection';
import {
  createStoreWorldSource,
  createWorldScenes,
  type WorldScene,
  type WorldSource,
} from '~/game/world';
import { apiCall } from '~/net/api';
import { isApiClientError } from '~/net/errors';
import { apiErrorMessage, bp, type CellCoordWire } from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFieldsStore } from '~/stores/fields';
import { useForestryStore } from '~/stores/forestry';
import { useMachinesStore } from '~/stores/machines';
import { useNetStore } from '~/stores/net';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useSyncStore } from '~/stores/sync';
import { useTasksStore } from '~/stores/tasks';
import { useWorkersStore } from '~/stores/workers';
import { useWorldStore } from '~/stores/world';

definePageMeta({ layout: 'game' });

const net = useNetStore();
const player = usePlayerStore();
const world = useWorldStore();
const fields = useFieldsStore();
const buildings = useBuildingsStore();
const machines = useMachinesStore();
const workers = useWorkersStore();
const tasks = useTasksStore();
const forestry = useForestryStore();
const sync = useSyncStore();
const pending = usePendingStore();
const selection = useSelectionStore();
const shell = useShellUi();
const bridge = useGameBridge();
const clock = useGameClock();

const loading = ref(true);
const failure = ref<string | null>(null);
const viewport = ref<InstanceType<typeof WorldViewport> | null>(null);

let handle: GameHandle | null = null;
let disconnect: (() => void) | null = null;
let tool: SelectionTool | null = null;
let entities: EntityLayer | null = null;
let toolTimer: ReturnType<typeof setTimeout> | null = null;
let unmounted = false;

/** Overlays are the panels that sit over the canvas without taking input from it. */
const overlays = panelsOfSurface(PanelSurface.OVERLAY);

/** How often, and for how long, the page waits for the world scene to be created. */
const TOOL_ATTACH_POLL_MS = 50;
const TOOL_ATTACH_TIMEOUT_MS = 20_000;

/**
 * Which panel owns the request of each selection mode (plan section 9.5).
 *
 * Confirming a selection mutates nothing: the tool publishes a snapshot and the panel named
 * here is the one that asks the server, with the authoritative budget the server answers
 * with. The table is exhaustive over the nine modes by its type, so a mode added to
 * `game/selection/modes.ts` without a panel is a compile error and not a confirmation that
 * silently does nothing.
 *
 * Four entries name panels that are still the stub of W3-C. `forestry` and `forest-plot`
 * belong to W6-D and the modes that open them are already complete on the canvas side, so
 * the row exists and the props they will need are handed over from now: the plot the felling
 * or the clearing acts on. No panel of the W5 lot appears here and none should:
 * `machinery`, `workers`, `labor-pool`, `market` and `starting-guide` are reached from their
 * tab and none of them is the destination of a drag over the map.
 */
const PANEL_OF_MODE: Readonly<Record<SelectionToolMode, PanelId>> = {
  INSPECT: 'cell-inspector',
  PURCHASE: 'land-purchase',
  FIELD_CREATE: 'field-create',
  FIELD_EXTEND: 'field-edit',
  FIELD_SPLIT: 'field-edit',
  FOREST_PLOT: 'forestry',
  FELL_AREA: 'forest-plot',
  CLEAR_LAND: 'forest-plot',
  BUILDING: 'building-placement',
};

/**
 * What the panel of a mode needs to know beyond the cells.
 *
 * `field-edit` is one panel for the three geometry operations and takes the tab it opens on
 * as a prop, which is what lets the extension and the split share it.
 */
function propsOfMode(snapshot: SelectionSnapshot): Readonly<Record<string, unknown>> {
  const intent = snapshot.intent;
  switch (intent.mode) {
    case SelectionToolMode.FIELD_EXTEND:
      return { fieldId: intent.fieldId ?? null, mode: 'EXTEND' };
    case SelectionToolMode.FIELD_SPLIT:
      return { fieldId: intent.fieldId ?? null, mode: 'SPLIT' };
    case SelectionToolMode.BUILDING:
      return { type: intent.buildingType ?? null };
    case SelectionToolMode.FELL_AREA:
    case SelectionToolMode.CLEAR_LAND:
      return { forestPlotId: intent.forestPlotId ?? null };
    default:
      return {};
  }
}

/**
 * Opens a panel on the surface the registry declares for it.
 *
 * The surface is read from the registry and never decided here, which is the point of the
 * registry carrying it: a panel that moves from the modal layer to the side column, as the
 * placement panel just did, needs no change at this call site.
 *
 * Opening what is already open does nothing. It is not a micro optimisation: the panel that
 * started a mode is usually the one the confirmation opens, and reopening it would stack a
 * second modal of the same panel, or remount the side panel in the middle of the flow it is
 * conducting.
 */
function openPanel(panelId: PanelId, props: Readonly<Record<string, unknown>>): void {
  if (PANEL_REGISTRY[panelId].surface === PanelSurface.MODAL) {
    if (!shell.modals.value.some((modal) => modal.panelId === panelId)) {
      shell.openModal(panelId, props);
    }
    return;
  }
  if (shell.sidePanel.value?.panelId === panelId && shell.sidePanelOpen.value) {
    return;
  }
  shell.openSidePanel(panelId, props);
}

/**
 * Keeps the intent of the selection store in step with the mode of the tool.
 *
 * The tool owns the cells and the store owns the intent, and the panel that receives a
 * confirmation reads both: `startSelectionMode` keeps an existing selection when the purpose
 * already matches, and begins a new one when it does not, which would throw away the very
 * cells the panel was opened to confirm. The three modes the shared rules have no purpose for
 * are left alone on purpose, because for those the panel keeps the verdict itself
 * (docs/handoff/NOTES-w4g.md, section 1.3).
 */
function syncSelectionIntent(snapshot: SelectionSnapshot): void {
  const intent = snapshot.intent;
  const purpose = SELECTION_TOOL_MODES[intent.mode].purpose;
  if (purpose === null || selection.intent?.purpose === purpose) {
    return;
  }
  selection.begin({
    purpose,
    ...(intent.fieldId == null ? {} : { fieldId: intent.fieldId }),
    ...(intent.forestPlotId == null ? {} : { forestPlotId: intent.forestPlotId }),
    ...(intent.buildingType == null ? {} : { buildingType: intent.buildingType }),
  });
}

/**
 * The world store seen through the port of the renderer.
 *
 * Every member is a translation and none is a rule. It is the same binding `pages/perf.vue`
 * uses with `?source=store`, which is what let the real data path be exercised before this
 * page mounted anything.
 */
function worldSource(): WorldSource {
  return createStoreWorldSource({
    store: world,
    viewerPlayerId: () => player.id,
    requestChunks: async (requests) => {
      const reply = await apiCall('POST /api/world/chunks', {
        body: { chunks: requests.map((request) => ({ ...request })) },
      });
      return reply.chunks;
    },
    fieldState: (fieldId) => {
      const field = fields.get(fieldId);
      return field === undefined
        ? undefined
        : {
            cropCycleState: field.cropCycleState,
            growthProgressBp: bp(field.projection.growthProgressBp),
          };
    },
    pendingCells: () => pending.pendingCellKeys,
  });
}

/**
 * The stores seen through the port of the entity layer (ADR-0046).
 *
 * Every accessor is read on each call and none is captured: a Pinia setup store unwraps
 * its computed refs on the proxy, so reading `machines.all` again is what yields the
 * current value. The layer watches one number, `sync.lastAppliedSeq`, which every applied
 * frame and every mutating reply moves, and which is therefore the definition of "the
 * domain moved" (docs/handoff/NOTES-w5d.md, section 4).
 *
 * `nowGameMs` is the locally extrapolated clock and never `Date.now`: the position of a
 * machine on its route is a function of the game instant (ADR-0045), and a renderer that
 * read the wall clock would part company with every countdown of the interface the minute
 * the multiplier changed.
 */
function entitySource(): EntitySource {
  return createStoreEntitySource({
    buildings: () => buildings.all,
    machines: () => machines.all,
    workers: () => workers.all,
    tasks: () => tasks.active,
    trees: () => Object.values(forestry.treesByPlotId).flatMap((byId) => Object.values(byId)),
    fieldCells: (fieldId) => fields.cellsOf(fieldId),
    // The geometry of a plot now reaches the store, so the fallback of the binder --
    // driving over wherever the standing trees are -- no longer runs for a plot whose
    // frame or snapshot has arrived (docs/handoff/NOTES-w5d.md, section 5.5).
    forestPlotCells: (forestPlotId) => forestry.cellsOf(forestPlotId),
    nowGameMs: () => clock.gameMs.value,
    revision: () => sync.lastAppliedSeq,
  });
}

/**
 * Publishes the stored rendering preferences to the canvas.
 *
 * The settings panel persists them and republishes `world:reload`, which is the only frozen
 * event that meant "draw it all again"; this page turns that into the event that says what
 * changed. The bridge retains the payload, so publishing before the scene exists is not a
 * lost message.
 */
function publishPreferences(): void {
  bridge.emit('settings:changed', loadPreferences());
}

function mountCanvas(): void {
  const host = viewport.value?.host ?? null;
  if (host === null) {
    failure.value = 'El punto de montaje del lienzo no existe.';
    return;
  }
  const spawn = world.spawnCell;
  const scenes = createWorldScenes({
    source: worldSource(),
    bridge: gameBridge(),
    preferences: loadPreferences(),
    // The camera opens where the player was placed, which the world description carries so
    // the client does not have to search for it (plan section 2). It is also the cell "back
    // to the farm" returns to.
    ...(spawn === null ? {} : { home: spawn }),
  });
  handle = createGame({ host, worldScenes: scenes.scenes });
  disconnect = connectShellBridge(handle, gameBridge());
  attachToScene(scenes.world, scenes.overlay, Date.now() + TOOL_ATTACH_TIMEOUT_MS);
}

/**
 * Creates the two pieces that hang off the world scene, once that scene exists.
 *
 * Neither can be created with the game. Phaser registers the scenes and boots them on its
 * own schedule, and `Scene.events` is assigned by `Systems.init` when the scene manager
 * boots it, not by the constructor: until then the emitter is `undefined` and so is the
 * display list. The boot is asynchronous by design -- the preload scene generates every
 * texture in code first -- so the wait is a poll with a deadline, the same one
 * `pages/perf.vue` uses.
 *
 * The entity layer was expected to need no wait, because it checks `isReady` and falls
 * back to subscribing to `Phaser.Scenes.Events.CREATE` (docs/handoff/NOTES-w5d.md,
 * section 5.1). That fallback cannot run before the boot: it reads `world.events` to
 * subscribe, and that is the property that does not exist yet, so building the layer in
 * the same statement as `createGame` threw and took the whole page down with it. Waiting
 * for `isReady` here means the constructor always takes its first branch, which is the
 * one that works. The observation is recorded in docs/handoff/NOTES-w6w.md, section 3.1.
 */
function attachToScene(world: WorldScene, overlay: OverlayScene, deadlineRealMs: number): void {
  toolTimer = null;
  if (unmounted) {
    return;
  }
  if (!world.isReady) {
    if (Date.now() > deadlineRealMs) {
      failure.value = 'El lienzo no llego a iniciarse: la seleccion por arrastre no esta activa.';
      return;
    }
    toolTimer = setTimeout(() => {
      attachToScene(world, overlay, deadlineRealMs);
    }, TOOL_ATTACH_POLL_MS);
    return;
  }
  entities = createEntityLayer({
    world,
    overlay,
    source: entitySource(),
  });
  tool = createSelectionTool({
    world,
    overlay,
    bridge: gameBridge(),
    port: {
      onChanged: (snapshot) => {
        syncSelectionIntent(snapshot);
        selection.replaceCells(snapshot.cells);
      },
      onConfirm: (snapshot) => {
        openPanel(PANEL_OF_MODE[snapshot.intent.mode], propsOfMode(snapshot));
      },
      onCancel: () => {
        selection.cancel();
      },
    },
  });

  // Escape belongs to the canvas whenever the canvas has a mode to leave, and to the shell
  // otherwise. The tool cancels from its own binding, so what the claim does is stop the
  // shell from also collapsing the side panel on the same press.
  shell.setCanvasEscapeClaim(
    () => tool !== null && modeDrawsSelection(tool.snapshot().intent.mode),
  );

  // A panel may have armed a mode while the canvas was still booting, which is the normal
  // case for a page opened straight into a flow: the request waited and lands now.
  applyModeRequest();
}

// ---------------------------------------------------------------------------
// The subject of a mode a panel arms
// ---------------------------------------------------------------------------

/**
 * Every mode of the tool, by the name the bridge uses.
 *
 * Exhaustive over `SelectionToolMode` by the type of the record, and over
 * `SelectionToolModeName` by the type of its values, so a mode added on either side is a
 * compile error here and not a mode that silently cannot be armed.
 */
const MODE_NAMES: Readonly<Record<SelectionToolMode, SelectionToolModeName>> = {
  [SelectionToolMode.INSPECT]: 'INSPECT',
  [SelectionToolMode.PURCHASE]: 'PURCHASE',
  [SelectionToolMode.FIELD_CREATE]: 'FIELD_CREATE',
  [SelectionToolMode.FIELD_EXTEND]: 'FIELD_EXTEND',
  [SelectionToolMode.FIELD_SPLIT]: 'FIELD_SPLIT',
  [SelectionToolMode.FOREST_PLOT]: 'FOREST_PLOT',
  [SelectionToolMode.FELL_AREA]: 'FELL_AREA',
  [SelectionToolMode.CLEAR_LAND]: 'CLEAR_LAND',
  [SelectionToolMode.BUILDING]: 'BUILDING',
};

const MODE_OF_NAME = Object.fromEntries(
  Object.entries(MODE_NAMES).map(([mode, name]) => [name, mode as SelectionToolMode]),
) as Readonly<Record<SelectionToolModeName, SelectionToolMode>>;

/** The last mode request that carried a subject, until the tool has taken it. */
let modeRequest: SelectionMode | null = null;

/** Whether a request says anything the purpose alone does not already say. */
function carriesSubject(request: SelectionMode): boolean {
  return (
    request.mode !== undefined ||
    request.fieldId != null ||
    request.forestPlotId != null ||
    request.buildingType != null
  );
}

/**
 * Takes a mode request from either channel and schedules it.
 *
 * Deferred to a microtask on purpose: the tool subscribes to the same bridge event and
 * sets the mode from the purpose, and this has to land after it whichever order the two
 * subscriptions ended up in. Running synchronously would also re-enter `setIntent` from
 * inside its own publication.
 */
function requestMode(request: SelectionMode): void {
  if (!carriesSubject(request)) {
    return;
  }
  modeRequest = request;
  queueMicrotask(applyModeRequest);
}

/** Cells the selection is judged against: the field being edited, or the plot. */
function targetCellsOf(
  mode: SelectionToolMode,
  fieldId: string | null,
  forestPlotId: string | null,
): readonly CellCoordWire[] | undefined {
  if (
    (mode === SelectionToolMode.FIELD_EXTEND || mode === SelectionToolMode.FIELD_SPLIT) &&
    fieldId !== null
  ) {
    return fields.cellsOf(fieldId);
  }
  if (
    (mode === SelectionToolMode.FELL_AREA || mode === SelectionToolMode.CLEAR_LAND) &&
    forestPlotId !== null
  ) {
    return forestry.cellsOf(forestPlotId);
  }
  return undefined;
}

/**
 * Completes the intent of the tool with the subject the panel named.
 *
 * It writes only when something actually differs, which is what keeps a panel that
 * republishes its mode from clearing a selection the player is composing: `setIntent`
 * empties the set by design.
 */
function applyModeRequest(): void {
  const request = modeRequest;
  if (request === null || tool === null) {
    // With no tool yet the request stays pending: the canvas is mounted after the
    // bootstrap resolves, so a panel can easily be ahead of it.
    return;
  }
  modeRequest = null;
  const current = tool.snapshot().intent;
  const mode = request.mode === undefined ? current.mode : MODE_OF_NAME[request.mode];
  const fieldId = request.fieldId ?? null;
  const forestPlotId = request.forestPlotId ?? null;
  const buildingType = request.buildingType ?? null;
  if (
    mode === current.mode &&
    fieldId === (current.fieldId ?? null) &&
    forestPlotId === (current.forestPlotId ?? null) &&
    buildingType === (current.buildingType ?? null)
  ) {
    return;
  }
  const targetCells = targetCellsOf(mode, fieldId, forestPlotId);
  tool.setIntent({
    mode,
    fieldId,
    forestPlotId,
    buildingType,
    ...(targetCells === undefined ? {} : { targetCells }),
  });
}

bridge.on('canvas:hover', (payload) => {
  selection.setHover(payload.cell);
});
// The subject half of `selection:mode`. The tool takes the mode from the purpose on its
// own; what it cannot take is which field, plot or building type the panel meant, because
// neither the shared vocabulary of purposes nor a Phaser scene can reach a store.
// `startSelectionMode` of the panel layer fills all four fields since W7, which is what
// makes `FELL_AREA` and `FIELD_SPLIT` arrive as themselves and not as the nearest purpose
// (docs/handoff/NOTES-w6w.md 4.3).
bridge.on('selection:mode', (payload) => {
  requestMode(payload);
});
// The same subject by the channel the panels already use, kept as the second source: a panel
// that only writes the selection store, without publishing on the bridge, still names its
// field or its plot. The two agree by construction, because `applyModeRequest` writes only
// when something differs from the intent the tool already holds.
watch(
  () => selection.intent,
  (intent) => {
    if (intent === null) {
      return;
    }
    requestMode({
      purpose: intent.purpose,
      ...(intent.fieldId === undefined ? {} : { fieldId: intent.fieldId }),
      ...(intent.forestPlotId === undefined ? {} : { forestPlotId: intent.forestPlotId }),
      ...(intent.buildingType === undefined ? {} : { buildingType: intent.buildingType }),
    });
  },
);
// A preference change is published as `world:reload` by the settings panel, which is the
// only frozen event with that meaning. Reading them back here is what turns it into the
// change of settings the scene can act on without rebuilding every chunk it holds.
bridge.on('world:reload', () => {
  publishPreferences();
});

onMounted(async () => {
  // The default panel of the tab that is already active, so the side column does not open
  // empty with the Mundo tab marked as selected (docs/handoff/NOTES-w4e.md, section 1.3).
  shell.selectTab('world');
  publishPreferences();
  try {
    await net.bootstrap();
    // The return summary is opened once, and only when the server says there is one to show.
    if (player.welcomeBackPending) {
      shell.openModal('welcome-back', {}, true);
    } else if (player.firstSession) {
      shell.openSidePanel('starting-guide');
    }
    net.start();
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo cargar el estado de la partida.';
  } finally {
    loading.value = false;
    clock.tick();
  }
  mountCanvas();
});

onBeforeUnmount(() => {
  unmounted = true;
  if (toolTimer !== null) {
    clearTimeout(toolTimer);
    toolTimer = null;
  }
  shell.setCanvasEscapeClaim(null);
  modeRequest = null;
  tool?.destroy();
  tool = null;
  entities?.destroy();
  entities = null;
  disconnect?.();
  disconnect = null;
  handle?.destroy();
  handle = null;
  net.stop();
});
</script>

<template>
  <AppShell>
    <template #viewport>
      <WorldViewport ref="viewport" />
      <div v-if="failure !== null" class="fw-game__failure">
        <p>{{ failure }}</p>
      </div>
      <p v-else-if="loading" class="fw-game__loading fw-small fw-muted">Cargando el estado…</p>
    </template>
    <template #overlays>
      <component
        v-for="panel in overlays"
        :key="panel.id"
        :is="PANEL_REGISTRY[panel.id].component"
      />
    </template>
  </AppShell>
</template>

<style scoped>
.fw-game__failure {
  position: absolute;
  display: grid;
  inset: 0;
  place-items: center;
  padding: 24px;
  color: var(--fw-danger, #b4544a);
  text-align: center;
  background: var(--fw-overlay, #0b0d1199);
}

.fw-game__loading {
  position: absolute;
  top: 8px;
  left: 8px;
  margin: 0;
}
</style>
