<script setup lang="ts">
// The body of a panel that is registered and not yet implemented.
//
// Owner: W3-C. Rendered by all twenty three stubs of the registry.
//
// Rule 3 of plan section 11 asks for a registry with stubs and never a registry by
// addition: the agent who writes the index also writes every module it imports, with its
// final path and signature, and a later agent replaces the body in place. This component is
// what makes that cheap: a stub is three lines, it mounts without a console error, and it
// says out loud which agent owns it and which sections of the GDD it answers to, so an
// unimplemented panel reads as planned work rather than as a bug.
import { computed } from 'vue';
import { PANEL_REGISTRY, type PanelId } from '~/components/panels/registry';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiCard from '~/components/ui/UiCard.vue';

const props = defineProps<{ panelId: PanelId }>();

const definition = computed(() => PANEL_REGISTRY[props.panelId]);
const sections = computed(() =>
  definition.value.gddSections.map((section) => `§${section}`).join(' · '),
);
</script>

<template>
  <UiCard :title="definition.title" :subtitle="definition.summary">
    <template #header>
      <UiBadge tone="warning">No implementado</UiBadge>
    </template>
    <dl class="fw-pending">
      <dt>Identificador</dt>
      <dd class="fw-mono">{{ definition.id }}</dd>
      <dt>Superficie</dt>
      <dd>{{ definition.surface }}</dd>
      <dt>Agente responsable</dt>
      <dd class="fw-mono">{{ definition.owner }}</dd>
      <dt>Referencias del GDD</dt>
      <dd>{{ sections }}</dd>
    </dl>
  </UiCard>
</template>

<style scoped>
.fw-pending {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-pending dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-pending dd {
  margin: 0;
}
</style>
