<script setup lang="ts">
// A button that can state why it is disabled.
//
// Owner: W3-C.
//
// `reason` is not a nicety. Most of the buttons of this interface are disabled by a domain
// rule evaluated with the shared rules, and a control that is greyed out with no
// explanation is the single most common way a management game becomes unplayable: the
// player cannot tell a missing garage place from a machine below the condition floor. The
// reason is rendered as the accessible title and is available as a slot, so a panel can
// also show it in place.
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'md' | 'sm';
    disabled?: boolean;
    busy?: boolean;
    /**
     * Why the button is disabled, in Spanish, from the shared message table.
     *
     * `| undefined` explicitly, because `exactOptionalPropertyTypes` is on: without it
     * the property may be absent but may not be bound to `undefined`, and "the reason of
     * this control, when there is one" is exactly an expression that evaluates to
     * `undefined`. Every panel of W4 hit it and each worked around it separately
     * (docs/handoff/NOTES-w4f.md, section 4.5).
     */
    reason?: string | undefined;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
);
</script>

<template>
  <button
    :type="type"
    class="fw-button"
    :class="[`fw-button--${variant}`, `fw-button--${size}`, { 'fw-button--busy': busy }]"
    :disabled="disabled === true || busy === true"
    :title="disabled === true && reason !== undefined ? reason : undefined"
    :aria-describedby="undefined"
  >
    <span v-if="busy" class="fw-button__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.fw-button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-raised, #242932);
  color: var(--fw-text, #e6e9ee);
  cursor: pointer;
}

.fw-button--sm {
  padding: 3px 8px;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-button:hover:not(:disabled) {
  border-color: var(--fw-text-muted, #9aa4b2);
}

.fw-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fw-button--primary {
  border-color: var(--fw-accent, #6ea36b);
  background: var(--fw-accent, #6ea36b);
  color: var(--fw-text-inverse, #14171c);
}

.fw-button--danger {
  border-color: var(--fw-danger, #b4544a);
  color: var(--fw-danger, #b4544a);
}

.fw-button--ghost {
  border-color: transparent;
  background: transparent;
}

.fw-button__spinner {
  width: 10px;
  height: 10px;
  border: 2px solid currentcolor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: fw-spin 0.8s linear infinite;
}

@keyframes fw-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
