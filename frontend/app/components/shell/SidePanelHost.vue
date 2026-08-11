<script setup lang="ts">
// The host of the side panel.
//
// Owner: W3-C. It resolves the panel through the frozen registry and renders it lazily, so
// a panel a player never opens is never downloaded.
//
// It does not take the input away from the world: the player has to be able to keep dragging
// a selection while the panel shows its price, which is the whole workflow of buying land.
// Only a modal takes the input (see useShellUi).
import { computed } from 'vue';
import { PANEL_REGISTRY } from '~/components/panels/registry';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import { useShellUi } from '~/composables/useShellUi';

const shell = useShellUi();

const target = computed(() => shell.sidePanel.value);
const definition = computed(() =>
  target.value === null ? null : PANEL_REGISTRY[target.value.panelId],
);
</script>

<template>
  <aside v-if="!shell.sidePanelCollapsed.value" class="fw-side" aria-label="Panel lateral">
    <div class="fw-side__body fw-scroll">
      <component
        :is="definition.component"
        v-if="definition !== null && target !== null"
        v-bind="target.props"
      />
      <UiEmptyState
        v-else
        title="Ningun panel abierto"
        detail="Selecciona una pestana o un elemento del mundo."
      />
    </div>
  </aside>
</template>

<style scoped>
.fw-side {
  display: flex;
  flex-direction: column;
  width: var(--fw-sidepanel-width, 360px);
  max-width: 100%;
  height: 100%;
  border-left: 1px solid var(--fw-border, #333a45);
  background: var(--fw-bg, #14171c);
}

.fw-side__body {
  flex: 1 1 auto;
  padding: 8px;
}
</style>
