<script setup lang="ts">
// The measurement route.
//
// Owner of the route: W3-C, because `frontend/app/pages/` is frozen after this phase and
// `make perf-lab` already points at `/perf`. Owner of the numbers: W4-D, which publishes them
// on the bridge as `render:stats` from inside the scene.
//
// It exists as a route of its own and not as a panel for the reason plan section 9.3 gives: a
// budget that is only aspirational is not a budget. Around 110 draw calls and 8 000 quads at
// zoom 1 has to be measurable on demand, over the real scene, without the panels competing for
// the frame. So this page mounts the viewport and the counters and nothing else.
import { onMounted, ref } from 'vue';
import WorldViewport from '~/components/shell/WorldViewport.client.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useGameBridge, type CameraView, type RenderStats } from '~/composables/useGameBridge';
import { useNetStore } from '~/stores/net';
import { useWorldStore } from '~/stores/world';

definePageMeta({ layout: 'default' });

/** The budget of plan section 9.3, so the page states what it is measuring against. */
const DRAW_CALL_BUDGET = 110;
const QUAD_BUDGET = 8_000;

const bridge = useGameBridge();
const net = useNetStore();
const world = useWorldStore();

const stats = ref<RenderStats | null>(bridge.latest('render:stats') ?? null);
const camera = ref<CameraView | null>(bridge.latest('camera:changed') ?? null);
const failure = ref<string | null>(null);

bridge.on('render:stats', (payload) => {
  stats.value = payload;
});
bridge.on('camera:changed', (payload) => {
  camera.value = payload;
});

onMounted(async () => {
  try {
    await net.bootstrap();
  } catch {
    failure.value = 'La medicion necesita el estado del mundo, que no se pudo cargar.';
  }
});
</script>

<template>
  <div class="fw-perf">
    <UiCard
      title="Ruta de medicion"
      subtitle="Presupuesto del plan, seccion 9.3: unos 110 draw calls y 8.000 cuadrilateros a zoom 1"
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
          :tone="stats !== null && stats.drawCalls > DRAW_CALL_BUDGET ? 'danger' : 'accent'"
          :hint="`Presupuesto ${DRAW_CALL_BUDGET}`"
        />
        <UiStat
          label="Cuadrilateros"
          :value="stats === null ? '—' : String(stats.quads)"
          :tone="stats !== null && stats.quads > QUAD_BUDGET ? 'danger' : 'accent'"
          :hint="`Presupuesto ${QUAD_BUDGET}`"
        />
        <UiStat
          label="Nivel de detalle"
          :value="stats === null ? '—' : stats.levelOfDetail"
          tone="muted"
        />
        <UiStat label="Chunks en cache" :value="String(world.loadedChunkCount)" />
        <UiStat label="Zoom" :value="camera === null ? '—' : camera.zoom.toFixed(2)" tone="muted" />
      </div>
      <p v-if="stats === null" class="fw-small fw-muted">
        Sin datos: los contadores los publica la escena de W4-D en el puente, como
        <code>render:stats</code>.
      </p>
    </UiCard>

    <div class="fw-perf__viewport">
      <WorldViewport label="Vista de medicion" />
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

.fw-perf__failure {
  margin: 0 0 8px;
  color: var(--fw-danger, #b4544a);
}

.fw-perf__viewport {
  min-height: 0;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
  overflow: hidden;
}
</style>
