<script setup lang="ts">
// Layout of the game page.
//
// Owner: W3-C.
//
// It is deliberately thin: a full-height box that does not scroll. The grid of plan section 9.1
// lives in `components/shell/AppShell.vue` and the page composes it, because the page is what
// knows which component goes in the viewport and which panels go over it, and a Nuxt layout can
// only receive the page through its default slot.
//
// What this layout does contribute is the one property the grid depends on: an ancestor chain
// with a definite height and no scrolling of the page body. Without it the viewport cell would
// grow with its content instead of shrinking to what is left, and the canvas would be sized by
// the panels rather than by the grid.
</script>

<template>
  <div class="fw-layout-game">
    <slot />
  </div>
</template>

<style scoped>
.fw-layout-game {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
