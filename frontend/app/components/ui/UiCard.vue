<script setup lang="ts">
// A titled surface. The unit every panel is built out of.
//
// Owner: W3-C. Used by the shell and by the panels of W4 to W6.
defineProps<{
  title?: string;
  subtitle?: string;
  /** Renders without the outer border, for a card nested inside another. */
  flat?: boolean;
}>();
</script>

<template>
  <section class="fw-card" :class="{ 'fw-card--flat': flat }">
    <header v-if="title !== undefined || $slots.header" class="fw-card__header">
      <div class="fw-card__titles">
        <h2 v-if="title !== undefined" class="fw-card__title">{{ title }}</h2>
        <p v-if="subtitle !== undefined" class="fw-card__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.header" class="fw-card__actions"><slot name="header" /></div>
    </header>
    <div class="fw-card__body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="fw-card__footer"><slot name="footer" /></footer>
  </section>
</template>

<style scoped>
.fw-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface, #1c2027);
}

.fw-card--flat {
  border: 0;
  background: transparent;
}

.fw-card__header {
  display: flex;
  gap: var(--fw-gap, 8px);
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--fw-border, #333a45);
}

.fw-card--flat .fw-card__header {
  padding-inline: 0;
}

.fw-card__titles {
  min-width: 0;
}

.fw-card__title {
  font-size: var(--fw-font-size, 14px);
}

.fw-card__subtitle {
  margin: 2px 0 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-card__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.fw-card__body {
  min-height: 0;
  padding: 12px;
}

.fw-card--flat .fw-card__body {
  padding-inline: 0;
}

.fw-card__footer {
  padding: 10px 12px;
  border-top: 1px solid var(--fw-border, #333a45);
}
</style>
