<script setup lang="ts">
// Default layout: a full-height wrapper and nothing else.
//
// Owner: W3-C. Used by the routes that are neither the authentication form nor the game, which
// today is only the measurement route of `make perf-lab`.
</script>

<template>
  <div class="fw-layout-default">
    <slot />
  </div>
</template>

<style scoped>
.fw-layout-default {
  height: 100%;
  overflow-y: auto;
}
</style>
