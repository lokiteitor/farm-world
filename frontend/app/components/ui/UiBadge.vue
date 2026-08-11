<script setup lang="ts">
// A short state label. Text and colour, never an icon.
//
// Owner: W3-C. The house style forbids emoji as state icons, so a state is a word.
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'info';
  }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <span class="fw-badge" :class="`fw-badge--${tone}`"><slot /></span>
</template>

<style scoped>
.fw-badge {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid currentcolor;
  border-radius: 999px;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: 11px;
  white-space: nowrap;
}

.fw-badge--accent {
  color: var(--fw-accent-strong, #85c07f);
}
.fw-badge--warning {
  color: var(--fw-warning, #c9a227);
}
.fw-badge--danger {
  color: var(--fw-danger, #b4544a);
}
.fw-badge--info {
  color: var(--fw-info, #5f88b0);
}
</style>
