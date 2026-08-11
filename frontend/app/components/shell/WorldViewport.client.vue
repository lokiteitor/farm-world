<script setup lang="ts">
// The mount point of the Phaser canvas.
//
// Owner: W3-C. W3-D and W4-D instantiate the game inside the element this component
// exposes; this component never imports Phaser and never creates a scene, so that the
// heavy dependency stays out of the shell and out of the component tests.
//
// The grid decides the size, not Phaser (plan section 9.1). A `ResizeObserver` measures the
// element and publishes `viewport:resized` on the bridge; the scene is configured with
// `Scale.RESIZE` and reacts to that event. Letting Phaser size itself from the window is
// what produces the classic bug of this layout, a canvas that covers the side panel because
// it measured the window and the panel had not opened yet.
//
// The `.client` suffix keeps it out of any server render. The application is a single page
// app (`ssr: false`), so there is no server render today, and the suffix is what makes that
// still true if the topology ever changes.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useGameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';

withDefaults(defineProps<{ label?: string }>(), { label: 'Vista del mundo' });

const bridge = useGameBridge();
const shell = useShellUi();

/** The element W3-D passes to the Phaser configuration as its parent. */
const host = ref<HTMLDivElement | null>(null);
const size = ref<{ width: number; height: number }>({ width: 0, height: 0 });
const sceneReady = ref(false);
const preload = ref<{ ratio: number; label: string } | null>(null);
const sceneError = ref<string | null>(null);

let observer: ResizeObserver | null = null;

/** Exposed so that W3-D can mount into it without querying the document. */
defineExpose({ host, size });

function publishSize(width: number, height: number): void {
  const rounded = {
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
  if (rounded.width === size.value.width && rounded.height === size.value.height) {
    return;
  }
  size.value = rounded;
  bridge.emit('viewport:resized', rounded);
}

onMounted(() => {
  const element = host.value;
  if (element === null) {
    return;
  }
  publishSize(element.clientWidth, element.clientHeight);
  if (typeof ResizeObserver === 'undefined') {
    return;
  }
  observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry === undefined) {
      return;
    }
    // `contentRect` and not `clientWidth`: the observer reports the size that caused the
    // callback, so reading the element again can measure a layout that has moved on.
    publishSize(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(element);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

bridge.on('scene:ready', () => {
  sceneReady.value = true;
  preload.value = null;
  sceneError.value = null;
});
bridge.on('scene:preload', (payload) => {
  preload.value = payload;
});
bridge.on('scene:error', (payload) => {
  sceneError.value = payload.message;
});
</script>

<template>
  <div
    ref="host"
    class="fw-viewport"
    :class="{ 'fw-input-blocked': !shell.worldInputEnabled.value }"
    role="application"
    :aria-label="label"
    :aria-busy="!sceneReady"
    data-fw-viewport
  >
    <!-- Placeholder while no scene is mounted. W3-D replaces nothing here: it mounts the
         canvas as a child of this element and the placeholder disappears on scene:ready. -->
    <div v-if="!sceneReady" class="fw-viewport__placeholder">
      <p v-if="sceneError !== null" class="fw-viewport__error">
        No se pudo iniciar el lienzo: {{ sceneError }}
      </p>
      <template v-else>
        <p class="fw-viewport__title">Lienzo del mundo</p>
        <p class="fw-viewport__detail">
          Punto de montaje de Phaser. Lo instala el flujo de trabajo W3-D.
        </p>
        <p v-if="preload !== null" class="fw-viewport__detail fw-mono">
          {{ preload.label }} — {{ (preload.ratio * 100).toFixed(0) }} %
        </p>
        <p class="fw-viewport__detail fw-mono">{{ size.width }} × {{ size.height }} px</p>
      </template>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.fw-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--fw-surface-sunken, #101318);
  /* The canvas is dragged with the pointer, so a text selection would fight it. */
  user-select: none;
  touch-action: none;
}

.fw-viewport :deep(canvas) {
  display: block;
}

.fw-viewport__placeholder {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--fw-text-muted, #9aa4b2);
  text-align: center;
}

.fw-viewport__title {
  margin: 0;
  color: var(--fw-text, #e6e9ee);
}

.fw-viewport__detail {
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-viewport__error {
  margin: 0;
  color: var(--fw-danger, #b4544a);
}
</style>
