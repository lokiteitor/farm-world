<script setup lang="ts">
// A labelled figure. The unit the top bar and every summary are built out of.
//
// Owner: W3-C.
//
// The value is monospaced with tabular figures on purpose: a balance that reflows every
// time its width changes makes a top bar flicker on every accrual, and in this game the
// accruals are continuous.
withDefaults(
  defineProps<{
    label: string;
    value: string;
    unit?: string;
    /** Tone of the figure. `warning` and `danger` are domain states, not styling. */
    tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'muted';
    /** Longer explanation, shown as the accessible title. */
    hint?: string;
  }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <div class="fw-stat" :title="hint">
    <span class="fw-stat__label">{{ label }}</span>
    <span class="fw-stat__value" :class="`fw-stat__value--${tone}`">
      {{ value }}<span v-if="unit !== undefined" class="fw-stat__unit">{{ unit }}</span>
    </span>
  </div>
</template>

<style scoped>
.fw-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.fw-stat__label {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.fw-stat__value {
  font-family: var(--fw-font-mono, monospace);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.fw-stat__value--accent {
  color: var(--fw-accent-strong, #85c07f);
}
.fw-stat__value--warning {
  color: var(--fw-warning, #c9a227);
}
.fw-stat__value--danger {
  color: var(--fw-danger, #b4544a);
}
.fw-stat__value--muted {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-stat__unit {
  margin-left: 2px;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
