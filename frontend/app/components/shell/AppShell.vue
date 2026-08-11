<script setup lang="ts">
// The page composition of plan section 9.1.
//
// Owner: W3-C.
//
//   row 1  top bar
//   row 2  viewport | collapsible side panel
//   row 3  tab bar
//   fixed  modal layer, notice layer
//
// Three properties of this grid are load bearing and none of them is cosmetic.
//
// The grid decides the size of the canvas. The viewport cell is `1fr` with `min-width: 0`
// and `overflow: hidden`, so it shrinks when the side panel opens instead of pushing it off
// screen, and the `ResizeObserver` inside WorldViewport tells Phaser the new size. Phaser
// never measures the window.
//
// The modal and notice layers are fixed and outside the grid. Putting them in a row would
// make opening a dialogue reflow the viewport, which would resize the canvas, which in a
// tilemap renderer means rebuilding the visible chunks: a modal would cost a frame drop for
// no reason.
//
// The keyboard is bound once, here, because the arbiter it drives is single by design.
import { onBeforeUnmount, onMounted } from 'vue';
import ModalHost from '~/components/shell/ModalHost.vue';
import NoticeHost from '~/components/shell/NoticeHost.vue';
import SidePanelHost from '~/components/shell/SidePanelHost.vue';
import TabBar from '~/components/shell/TabBar.vue';
import TopBar from '~/components/shell/TopBar.vue';
import { useShellUi } from '~/composables/useShellUi';

const shell = useShellUi();

onMounted(() => {
  window.addEventListener('keydown', shell.handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', shell.handleKeydown);
});
</script>

<template>
  <div class="fw-grid">
    <div class="fw-grid__topbar">
      <TopBar />
    </div>

    <div class="fw-grid__viewport">
      <slot name="viewport" />
      <div class="fw-grid__overlays">
        <slot name="overlays" />
      </div>
    </div>

    <div class="fw-grid__side">
      <SidePanelHost />
    </div>

    <div class="fw-grid__tabbar">
      <TabBar />
    </div>

    <NoticeHost />
    <ModalHost />
  </div>
</template>

<style scoped>
/* The overlay strip sits over the canvas and passes pointer events through, except on the
   panels themselves: the legend and the minimap have to be clickable without stealing a
   drag that started on the map. */
.fw-grid__overlays {
  position: absolute;
  inset: 8px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  justify-content: flex-end;
  pointer-events: none;
}

.fw-grid__overlays > :deep(*) {
  pointer-events: auto;
}
</style>
