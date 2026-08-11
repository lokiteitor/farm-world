<script setup lang="ts">
// What a panel shows when it has nothing to show.
//
// Owner: W3-C. It states the reason and, where there is one, the next step: an empty
// machinery panel in this game usually means the player has no garage yet, which is a
// different situation from having sold every machine.
defineProps<{ title: string; detail?: string }>();
</script>

<template>
  <div class="fw-empty">
    <p class="fw-empty__title">{{ title }}</p>
    <p v-if="detail !== undefined" class="fw-empty__detail">{{ detail }}</p>
    <slot />
  </div>
</template>

<style scoped>
.fw-empty {
  padding: 16px 12px;
  color: var(--fw-text-muted, #9aa4b2);
  text-align: center;
}

.fw-empty__title {
  margin: 0;
  color: var(--fw-text, #e6e9ee);
}

.fw-empty__detail {
  margin: 4px 0 0;
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
