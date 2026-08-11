<script setup lang="ts">
// Stub of the panel 'farm-overview'. Owner of the implementation: W4-E.
//
// Created by W3-C together with frontend/app/components/panels/registry.ts, which imports
// it at this exact path (plan section 11, rule 3). The registry is frozen: W4-E replaces
// the body of this file and adds whatever it needs inside this directory, and does not
// touch the index.
//
// Contract of a panel. It reads the Pinia stores and never writes them; it sends through
// the typed client of app/net/api.ts and feeds the reply to the reducer with
// `useApi().mutate`, which is the only path that respects the sequence; it validates in
// advance with the same schemas and the same shared rules the server validates with, so
// that a disabled control is disabled for the reason the server would refuse; and it opens
// no modal of its own, because the input arbiter of `useShellUi` owns that.
import UiPendingPanel from '~/components/ui/UiPendingPanel.vue';
</script>

<template>
  <UiPendingPanel panel-id="farm-overview" />
</template>
