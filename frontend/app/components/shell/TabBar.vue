<script setup lang="ts">
// The tab bar. Selecting a tab opens its default panel in the side panel.
//
// Owner: W3-C. The tabs come from the frozen registry, so a panel added later cannot
// produce a tab that no panel answers to.
import { computed } from 'vue';
import { PANEL_TABS, panelsOfTab } from '~/components/panels/registry';
import { useShellUi } from '~/composables/useShellUi';

const shell = useShellUi();

const tabs = computed(() =>
  PANEL_TABS.map((tab) => ({
    ...tab,
    panelCount: panelsOfTab(tab.id).length,
  })),
);
</script>

<template>
  <nav class="fw-tabbar" aria-label="Secciones">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="fw-tabbar__tab"
      :class="{ 'fw-tabbar__tab--active': shell.activeTab.value === tab.id }"
      :aria-current="shell.activeTab.value === tab.id ? 'page' : undefined"
      @click="shell.selectTab(tab.id)"
    >
      {{ tab.label }}
    </button>
    <span class="fw-tabbar__spacer" />
    <button
      type="button"
      class="fw-tabbar__tab"
      :aria-pressed="!shell.sidePanelCollapsed.value"
      @click="shell.toggleSidePanel()"
    >
      {{ shell.sidePanelCollapsed.value ? 'Mostrar panel' : 'Ocultar panel' }}
    </button>
  </nav>
</template>

<style scoped>
.fw-tabbar {
  display: flex;
  gap: 2px;
  align-items: stretch;
  height: 100%;
  padding: 0 8px;
  overflow-x: auto;
  border-top: 1px solid var(--fw-border, #333a45);
  background: var(--fw-surface, #1c2027);
}

.fw-tabbar__tab {
  padding: 0 12px;
  border: 0;
  border-top: 2px solid transparent;
  background: transparent;
  color: var(--fw-text-muted, #9aa4b2);
  white-space: nowrap;
  cursor: pointer;
}

.fw-tabbar__tab:hover {
  color: var(--fw-text, #e6e9ee);
}

.fw-tabbar__tab--active {
  border-top-color: var(--fw-accent, #6ea36b);
  color: var(--fw-text, #e6e9ee);
}

.fw-tabbar__spacer {
  flex: 1 1 auto;
}
</style>
