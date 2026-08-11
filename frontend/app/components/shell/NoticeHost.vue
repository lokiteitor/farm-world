<script setup lang="ts">
// The fixed notice layer.
//
// Owner: W3-C.
//
// It sits below the modal layer on purpose: a notice must never cover the dialogue that is
// taking input. Notices are dismissed explicitly and do not fade on a timer, because in this
// game a notice is the only record of a consequence that happened while the player was away
// (GDD sections 67 and 97) and losing it to a timeout loses the explanation.
import { computed } from 'vue';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import { useShellUi } from '~/composables/useShellUi';
import { useNoticesStore } from '~/stores/notices';

const notices = useNoticesStore();
const shell = useShellUi();

/** Newest first, and only the last few unless the tray is open. */
const shown = computed(() => {
  const list = [...notices.visible].reverse();
  return shell.noticeTrayOpen.value ? list : list.slice(0, 3);
});
</script>

<template>
  <div v-if="shown.length > 0" class="fw-notices" role="status" aria-live="polite">
    <article
      v-for="entry in shown"
      :key="entry.id"
      class="fw-notices__item"
      :class="{ 'fw-notices__item--warning': entry.notice.severity === 'WARNING' }"
    >
      <div class="fw-notices__head">
        <UiBadge :tone="entry.notice.severity === 'WARNING' ? 'warning' : 'info'">
          {{ entry.notice.kind }}
        </UiBadge>
        <UiButton
          size="sm"
          variant="ghost"
          aria-label="Descartar"
          @click="notices.dismiss(entry.id)"
        >
          Descartar
        </UiButton>
      </div>
      <p class="fw-notices__text">{{ notices.messageOf(entry) }}</p>
    </article>
    <UiButton
      v-if="notices.visible.length > shown.length"
      size="sm"
      variant="ghost"
      @click="shell.noticeTrayOpen.value = true"
    >
      Ver los {{ notices.visible.length }} avisos
    </UiButton>
  </div>
</template>

<style scoped>
.fw-notices {
  position: fixed;
  right: 12px;
  bottom: calc(var(--fw-tabbar-height, 40px) + 12px);
  z-index: var(--fw-z-notices, 40);
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(var(--fw-notice-width, 340px), calc(100vw - 24px));
}

.fw-notices__item {
  padding: 8px 10px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-raised, #242932);
}

.fw-notices__item--warning {
  border-color: var(--fw-warning, #c9a227);
}

.fw-notices__head {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.fw-notices__text {
  margin: 4px 0 0;
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
