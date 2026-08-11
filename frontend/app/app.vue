<script setup lang="ts">
// Root component.
//
// Owner: W3-C (it replaces the W1 scaffolding).
//
// It does three things and nothing else. It imports the global stylesheet of the shell, which
// nuxt.config.ts cannot list because that file is frozen and names only tokens.css. It wires
// the transport a second time, harmlessly, so that a page opened without going through the
// route middleware still has one. And it renders the layout, which is what decides whether
// the page is the authentication form or the game.
//
// `<NuxtPage />` stays the only routed slot, so the router contract of the W1 scaffolding is
// unchanged.
import { onMounted } from 'vue';
import '~/assets/shell.css';
import { ensureClientBootstrapped } from '~/net/bootstrap';

const config = useRuntimeConfig();

onMounted(() => {
  void ensureClientBootstrapped(config.public);
});
</script>

<template>
  <div class="fw-app">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>

<style scoped>
.fw-app {
  height: 100%;
}
</style>
