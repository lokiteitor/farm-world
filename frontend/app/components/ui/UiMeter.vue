<script setup lang="ts">
// A bar for a value in basis points.
//
// Owner: W3-C.
//
// Basis points and not a percentage, because that is the unit every domain percentage is
// stored and transmitted in (plan section 5.2): converting at the last possible moment
// keeps a rounded figure from re-entering a comparison. The `reserved` segment is drawn
// separately because a silo with committed capacity is not the same as a full one, and the
// distinction is what makes a harvest rejection explainable.
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    valueBp: number;
    /** Capacity already committed by a task in flight, in basis points. */
    reservedBp?: number;
    tone?: 'neutral' | 'accent' | 'warning' | 'danger';
    /** Threshold above which the bar switches to the warning tone. */
    warnAboveBp?: number;
  }>(),
  { tone: 'neutral', reservedBp: 0 },
);

const clamped = computed(() => Math.min(10_000, Math.max(0, props.valueBp)));
const reserved = computed(() => Math.min(10_000 - clamped.value, Math.max(0, props.reservedBp)));
const effectiveTone = computed(() =>
  props.warnAboveBp !== undefined && clamped.value + reserved.value >= props.warnAboveBp
    ? 'warning'
    : props.tone,
);
const percent = computed(() => (clamped.value / 100).toFixed(1));
</script>

<template>
  <div class="fw-meter">
    <div v-if="label !== undefined" class="fw-meter__head">
      <span>{{ label }}</span>
      <span class="fw-mono">{{ percent }} %</span>
    </div>
    <div
      class="fw-meter__track"
      role="meter"
      :aria-valuenow="clamped"
      aria-valuemin="0"
      aria-valuemax="10000"
      :aria-label="label"
    >
      <div
        class="fw-meter__fill"
        :class="`fw-meter__fill--${effectiveTone}`"
        :style="{ width: `${clamped / 100}%` }"
      />
      <div
        v-if="reserved > 0"
        class="fw-meter__reserved"
        :style="{ width: `${reserved / 100}%` }"
        title="Capacidad reservada por una tarea en curso"
      />
    </div>
  </div>
</template>

<style scoped>
.fw-meter {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.fw-meter__head {
  display: flex;
  justify-content: space-between;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-meter__track {
  display: flex;
  overflow: hidden;
  height: 6px;
  border-radius: 3px;
  background: var(--fw-surface-sunken, #101318);
}

.fw-meter__fill {
  height: 100%;
  background: var(--fw-text-muted, #9aa4b2);
}

.fw-meter__fill--accent {
  background: var(--fw-accent, #6ea36b);
}
.fw-meter__fill--warning {
  background: var(--fw-warning, #c9a227);
}
.fw-meter__fill--danger {
  background: var(--fw-danger, #b4544a);
}

.fw-meter__reserved {
  height: 100%;
  background: repeating-linear-gradient(
    45deg,
    var(--fw-warning, #c9a227) 0 3px,
    transparent 3px 6px
  );
}
</style>
