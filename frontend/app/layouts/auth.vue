<script setup lang="ts">
// Layout of the authentication page.
//
// Owner: W3-C.
//
// No canvas is mounted here, which is deliberate and not an omission: Phaser generates every
// texture in code at boot (plan section 9.4) and doing that behind a login form would spend
// the budget of the first frames on a scene the player cannot see yet. The game page mounts it
// once there is a session.
</script>

<template>
  <div class="fw-layout-auth">
    <main class="fw-layout-auth__panel">
      <slot />
    </main>
    <footer class="fw-layout-auth__foot fw-small fw-muted">
      Simulador de gestion agricola y forestal. Servidor autoritativo.
    </footer>
  </div>
</template>

<style scoped>
.fw-layout-auth {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 24px;
  background: var(--fw-bg, #14171c);
  grid-template-rows: 1fr auto;
}

.fw-layout-auth__panel {
  width: min(420px, 100%);
}

.fw-layout-auth__foot {
  padding-top: 12px;
}
</style>
