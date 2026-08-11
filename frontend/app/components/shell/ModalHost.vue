<script setup lang="ts">
// The fixed modal layer.
//
// Owner: W3-C.
//
// A stack and not a single slot, because the flows of this interface nest: placing a building
// opens a confirmation over the placement panel, and assigning a task opens a warning over
// the assignment. The topmost modal holds the input and Escape closes it, which is handled by
// the arbiter of useShellUi and not here: this component renders the stack and reports the
// two gestures that dismiss one.
import { computed } from 'vue';
import { PANEL_REGISTRY } from '~/components/panels/registry';
import UiButton from '~/components/ui/UiButton.vue';
import { useShellUi } from '~/composables/useShellUi';

const shell = useShellUi();

const stack = computed(() =>
  shell.modals.value.map((modal) => ({ modal, definition: PANEL_REGISTRY[modal.panelId] })),
);
</script>

<template>
  <div v-if="stack.length > 0" class="fw-modals">
    <div
      v-for="(entry, index) in stack"
      :key="entry.modal.instanceId"
      class="fw-modals__layer"
      :style="{ zIndex: index }"
    >
      <div
        class="fw-modals__backdrop"
        @click="entry.modal.dismissible ? shell.closeModal(entry.modal.instanceId) : undefined"
      />
      <div
        class="fw-modals__dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="entry.definition.title"
      >
        <header class="fw-modals__head">
          <h2 class="fw-modals__title">{{ entry.definition.title }}</h2>
          <UiButton
            v-if="entry.modal.dismissible"
            size="sm"
            variant="ghost"
            aria-label="Cerrar"
            @click="shell.closeModal(entry.modal.instanceId)"
          >
            Cerrar
          </UiButton>
        </header>
        <div class="fw-modals__body fw-scroll">
          <component :is="entry.definition.component" v-bind="entry.modal.props" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fw-modals {
  position: fixed;
  inset: 0;
  z-index: var(--fw-z-modals, 50);
}

.fw-modals__layer {
  position: absolute;
  display: grid;
  inset: 0;
  place-items: center;
}

.fw-modals__backdrop {
  position: absolute;
  inset: 0;
  background: var(--fw-overlay, #0b0d1199);
}

.fw-modals__dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius-lg, 8px);
  background: var(--fw-surface, #1c2027);
}

.fw-modals__head {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--fw-border, #333a45);
}

.fw-modals__title {
  font-size: var(--fw-font-size-lg, 16px);
}

.fw-modals__body {
  flex: 1 1 auto;
  padding: 12px;
}
</style>
