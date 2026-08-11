<script setup lang="ts">
// The root route: it decides where to go and renders nothing of its own.
//
// Owner: W3-C (it replaces the W1 scaffolding page).
//
// The decision is already made by the global route middleware, which sends a player with a
// session to the game and one without to the login form. This page exists because
// `<NuxtPage />` needs a route at `/`, and it redirects rather than duplicating the decision:
// two places deciding where a player belongs is how a redirect loop is born.
import { onMounted } from 'vue';
import { hasSession } from '~/net/session';

onMounted(async () => {
  await navigateTo(hasSession() ? '/game' : '/login');
});
</script>

<template>
  <div class="fw-boot">
    <p class="fw-small fw-muted">Cargando…</p>
  </div>
</template>

<style scoped>
.fw-boot {
  display: grid;
  place-items: center;
  height: 100%;
}
</style>
