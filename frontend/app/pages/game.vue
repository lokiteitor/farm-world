<script setup lang="ts">
// The game page.
//
// Owner: W3-C.
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
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { PANEL_REGISTRY, PanelSurface, panelsOfSurface } from '~/components/panels/registry';
import AppShell from '~/components/shell/AppShell.vue';
import WorldViewport from '~/components/shell/WorldViewport.client.vue';
import { useGameBridge } from '~/composables/useGameBridge';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import { isApiClientError } from '~/net/errors';
import { apiErrorMessage } from '~/shared/index';
import { useNetStore } from '~/stores/net';
import { usePlayerStore } from '~/stores/player';
import { useWorldStore } from '~/stores/world';

definePageMeta({ layout: 'game' });

const net = useNetStore();
const player = usePlayerStore();
const world = useWorldStore();
const shell = useShellUi();
const bridge = useGameBridge();
const clock = useGameClock();

const loading = ref(true);
const failure = ref<string | null>(null);

/** Overlays are the panels that sit over the canvas without taking input from it. */
const overlays = panelsOfSurface(PanelSurface.OVERLAY);

onMounted(async () => {
  try {
    await net.bootstrap();
    // The camera opens where the player was placed, which the world description carries so the
    // client does not have to search for it (plan section 2).
    const spawn = world.spawnCell;
    if (spawn !== null) {
      bridge.emit('camera:goto', { cellX: spawn.cellX, cellY: spawn.cellY, smooth: false });
    }
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
});

onBeforeUnmount(() => {
  net.stop();
});
</script>

<template>
  <AppShell>
    <template #viewport>
      <WorldViewport />
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
