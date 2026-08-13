<script setup lang="ts">
// The measurement route.
//
// Owner of the file: W4-D, by the per file ownership of `frontend/app/pages/`
// (docs/ownership.md, section 3.6). W3-C created the route and the shell around it; this
// workflow owns the canvas it mounts and the numbers it publishes.
//
// It exists as a route of its own and not as a panel for the reason plan section 9.3
// gives: a budget that is only aspirational is not a budget. So this page mounts the
// real scene, runs the bench of `game/world/bench.ts` over it, and prints what it
// measured rather than what the plan hoped for.
//
// Two decisions worth stating.
//
// The default source is offline. The chunks are generated locally with the same
// deterministic generator the server runs (ADR-0010), and no chunk request leaves the
// page, because a budget measured through an HTTP round trip measures the round trip.
// `?source=store` switches to the real path, binding the world store with
// `createStoreWorldSource`, which is also how the game page will do it.
//
// The report is published on `window.__fwPerf`. A headless run needs a way to read the
// numbers without a human, and a global on a development-only route is the cheapest one
// that does not add a dependency to a frozen `package.json`.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import WorldViewport from '~/components/shell/WorldViewport.client.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiStat from '~/components/ui/UiStat.vue';
import {
  useGameBridge,
  gameBridge,
  type CameraView,
  type RenderStats,
} from '~/composables/useGameBridge';
import { connectShellBridge, createGame, type GameHandle } from '~/game';
import {
  RENDER_BUDGET,
  benchPatchesOf,
  createStaticWorldSource,
  createStoreWorldSource,
  createWorldScenes,
  formatBenchReport,
  runWorldBench,
  type BenchReport,
  type WorldSource,
} from '~/game/world';
import { apiCall } from '~/net/api';
import { CropCycleState, bp } from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { useNetStore } from '~/stores/net';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';
import { useWorldStore } from '~/stores/world';

definePageMeta({ layout: 'default' });

/** Player the bench colours ownership against. Any identifier will do offline. */
const BENCH_PLAYER = 'bench-player';

const bridge = useGameBridge();
const net = useNetStore();
const world = useWorldStore();
const player = usePlayerStore();
const fields = useFieldsStore();
const pending = usePendingStore();

const viewport = ref<InstanceType<typeof WorldViewport> | null>(null);
const stats = ref<RenderStats | null>(bridge.latest('render:stats') ?? null);
const camera = ref<CameraView | null>(bridge.latest('camera:changed') ?? null);
const failure = ref<string | null>(null);
const sourceKind = ref<'offline' | 'store'>('offline');
const running = ref(false);
const progress = ref<{ label: string; ratio: number } | null>(null);
const report = ref<BenchReport | null>(null);

let handle: GameHandle | null = null;
let scenes: ReturnType<typeof createWorldScenes> | null = null;
let disconnect: (() => void) | null = null;

bridge.on('render:stats', (payload) => {
  stats.value = payload;
});
bridge.on('camera:changed', (payload) => {
  camera.value = payload;
});

/** The query string of the route, read without Nuxt's router to keep the page inert. */
function query(name: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * The offline source: a deterministic world with a real modification layer.
 *
 * The patches are not decoration. The near level of detail draws two tilemap layers and
 * the outline pass extracts border segments, and both are proportional to how much of a
 * chunk is owned and used, so a bench over an empty world would measure the cheap half
 * of the renderer.
 */
function offlineSource(): WorldSource {
  return createStaticWorldSource({
    seed: 20_260_812,
    viewerPlayerId: BENCH_PLAYER,
    patchesOf: benchPatchesOf(BENCH_PLAYER),
    fieldState: () => ({
      cropCycleState: CropCycleState.GROWING,
      growthProgressBp: bp(4_200),
    }),
  });
}

/**
 * The real source: the world store bound to the port.
 *
 * Twenty lines, and every one a translation. This is the binding the game page needs,
 * and it lives here because `frontend/app/game` may not import `frontend/app/stores`
 * (eslint zone rule), so the two are joined outside the canvas.
 */
function storeSource(): WorldSource {
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

onMounted(async () => {
  if (query('source') === 'store') {
    try {
      await net.bootstrap();
      sourceKind.value = 'store';
    } catch {
      failure.value =
        'No se pudo cargar el estado del mundo: la medicion sigue con el generador local.';
    }
  }

  const host = viewport.value?.host ?? null;
  if (host === null) {
    failure.value = 'El punto de montaje del lienzo no existe.';
    return;
  }

  const source = sourceKind.value === 'store' ? storeSource() : offlineSource();
  const spawn = world.spawnCell;
  scenes = createWorldScenes({
    source,
    bridge: gameBridge(),
    debug: true,
    home: sourceKind.value === 'store' && spawn !== null ? spawn : { cellX: 0, cellY: 0 },
  });
  handle = createGame({ host, worldScenes: scenes.scenes });
  disconnect = connectShellBridge(handle, gameBridge());
  // The scene handles on the window, for the same reason the report is there: a manual
  // or headless check of the canvas needs a way to move the camera without a mouse. It
  // is a development-only route and nothing in the client reads this.
  (window as unknown as { __fwWorld: unknown }).__fwWorld = {
    world: scenes.world,
    overlay: scenes.overlay,
    game: handle.game,
  };

  publish();
  if (query('bench') === '1') {
    // The canvas has to exist and its textures have to be generated before anything is
    // measured, so the automatic run waits for the scene instead of a fixed delay.
    await waitForScene();
    await run();
  }
});

onBeforeUnmount(() => {
  disconnect?.();
  disconnect = null;
  handle?.destroy();
  handle = null;
  scenes = null;
});

/** Resolves once the world scene has run its `create`. */
function waitForScene(): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const check = (): void => {
      if (scenes?.world.isReady === true || performance.now() - start > 20_000) {
        resolve();
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

async function run(): Promise<void> {
  const target = scenes;
  const game = handle?.game ?? null;
  if (target === null || game === null || running.value) {
    return;
  }
  running.value = true;
  report.value = null;
  publish();
  try {
    report.value = await runWorldBench({
      world: target.world,
      game,
      onProgress: (label, ratio) => {
        progress.value = { label, ratio };
        publish();
      },
    });
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    running.value = false;
    progress.value = null;
    publish();
  }
}

/** Publishes the state on the window, which is what a headless run reads. */
function publish(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const current = report.value;
  (window as unknown as { __fwPerf: unknown }).__fwPerf = {
    status: running.value ? 'running' : current === null ? 'idle' : 'done',
    source: sourceKind.value,
    progress: progress.value,
    failure: failure.value,
    report: current,
    text: current === null ? null : formatBenchReport(current),
  };
}

const summary = computed(() => (report.value === null ? null : formatBenchReport(report.value)));
</script>

<template>
  <div class="fw-perf">
    <UiCard
      title="Ruta de medicion"
      :subtitle="`Presupuesto del plan, seccion 9.3: ${RENDER_BUDGET.near.maxDrawCalls} draw calls a zoom 1 con ${RENDER_BUDGET.near.chunks} chunks y ${RENDER_BUDGET.far.maxDrawCalls} a zoom 0,25 con ${RENDER_BUDGET.far.chunks}, nunca por debajo de ${RENDER_BUDGET.minFps} fotogramas`"
    >
      <p v-if="failure !== null" class="fw-perf__failure">{{ failure }}</p>
      <div class="fw-perf__stats">
        <UiStat
          label="Fotogramas"
          :value="stats === null ? '—' : stats.fps.toFixed(0)"
          unit="fps"
        />
        <UiStat
          label="Draw calls"
          :value="stats === null ? '—' : String(stats.drawCalls)"
          :tone="
            stats !== null && stats.drawCalls > RENDER_BUDGET.near.maxDrawCalls
              ? 'danger'
              : 'accent'
          "
        />
        <UiStat label="Cuadrilateros" :value="stats === null ? '—' : String(stats.quads)" />
        <UiStat
          label="Nivel de detalle"
          :value="stats === null ? '—' : stats.levelOfDetail"
          tone="muted"
        />
        <UiStat
          label="Chunks cargados"
          :value="stats === null ? '—' : String(stats.loadedChunks)"
        />
        <UiStat label="Zoom" :value="camera === null ? '—' : camera.zoom.toFixed(2)" tone="muted" />
        <UiStat label="Origen de datos" :value="sourceKind" tone="muted" />
      </div>

      <div class="fw-perf__actions">
        <button type="button" class="fw-perf__run" :disabled="running" @click="run">
          {{ running ? 'Midiendo…' : 'Ejecutar banco de medida' }}
        </button>
        <span v-if="progress !== null" class="fw-small fw-muted">
          {{ progress.label }} — {{ (progress.ratio * 100).toFixed(0) }} %
        </span>
        <span v-else class="fw-small fw-muted">F3 conmuta el contador de depuracion.</span>
      </div>

      <pre v-if="summary !== null" class="fw-perf__report">{{ summary }}</pre>
      <p v-if="report !== null" class="fw-small" :class="report.passed ? 'fw-ok' : 'fw-ko'">
        {{ report.passed ? 'Dentro del presupuesto.' : 'Fuera del presupuesto.' }}
        <template v-if="!report.drawCallsMeasured">
          El contador de draw calls no esta disponible en este renderizador.
        </template>
      </p>
    </UiCard>

    <div class="fw-perf__viewport">
      <WorldViewport ref="viewport" label="Vista de medicion" />
    </div>
  </div>
</template>

<style scoped>
.fw-perf {
  display: grid;
  gap: 12px;
  height: 100%;
  padding: 12px;
  grid-template-rows: auto 1fr;
  min-height: 0;
}

.fw-perf__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.fw-perf__actions {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 12px;
}

.fw-perf__run {
  padding: 6px 12px;
  color: var(--fw-text, #e6e9ee);
  cursor: pointer;
  background: var(--fw-surface-raised, #1b1f27);
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-perf__run:disabled {
  cursor: progress;
  opacity: 0.6;
}

.fw-perf__report {
  margin: 12px 0 0;
  padding: 10px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  background: var(--fw-surface-sunken, #101318);
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-perf__failure {
  margin: 0 0 8px;
  color: var(--fw-danger, #b4544a);
}

.fw-ok {
  color: var(--fw-success, #7ad07a);
}

.fw-ko {
  color: var(--fw-danger, #b4544a);
}

.fw-perf__viewport {
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}
</style>
