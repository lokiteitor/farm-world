<script setup lang="ts">
// The state of the live connection, always visible.
//
// Owner: W3-C.
//
// This is not decoration and it is not an afterthought of the top bar. In a game whose
// simulation runs while the player is away, a socket that died in silence looks exactly like
// a world where nothing is happening: the balance stops moving, no task completes, and
// there is nothing on screen to say why. Plan section 7 requires the state to be shown at
// all times for that reason, and it also shows how far behind the client is, because
// "connected" while forty frames behind is not the same as connected.
import { computed } from 'vue';
import UiBadge from '~/components/ui/UiBadge.vue';
import { ConnectionState, useNetStore } from '~/stores/net';

const net = useNetStore();

const LABELS: Readonly<Record<ConnectionState, string>> = {
  OFFLINE: 'Sin conexion',
  CONNECTING: 'Conectando',
  ONLINE: 'En linea',
  RESYNCING: 'Resincronizando',
  CONTRACT_MISMATCH: 'Version distinta',
};

const TONES: Readonly<Record<ConnectionState, 'accent' | 'warning' | 'danger' | 'info'>> = {
  OFFLINE: 'danger',
  CONNECTING: 'warning',
  ONLINE: 'accent',
  RESYNCING: 'info',
  CONTRACT_MISMATCH: 'danger',
};

const label = computed(() => LABELS[net.state]);
const tone = computed(() => TONES[net.state]);

const detail = computed(() => {
  if (net.state === ConnectionState.CONTRACT_MISMATCH) {
    return 'El servidor publica otra version del contrato compartido. Hay que recargar.';
  }
  if (net.state === ConnectionState.OFFLINE && net.nextRetryAtRealMs !== null) {
    const seconds = Math.max(0, Math.round((net.nextRetryAtRealMs - Date.now()) / 1000));
    return `Nuevo intento en ${seconds} s`;
  }
  if (net.behindBy > 0) {
    return `${net.behindBy} eventos por aplicar`;
  }
  return null;
});
</script>

<template>
  <div class="fw-connection" :title="detail ?? label">
    <span
      class="fw-connection__dot"
      :class="`fw-connection__dot--${net.state}`"
      aria-hidden="true"
    />
    <UiBadge :tone="tone">{{ label }}</UiBadge>
    <span v-if="detail !== null" class="fw-connection__detail fw-small fw-muted">{{ detail }}</span>
  </div>
</template>

<style scoped>
.fw-connection {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.fw-connection__dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fw-net-offline, #b4544a);
}

.fw-connection__dot--ONLINE {
  background: var(--fw-net-online, #6ea36b);
}
.fw-connection__dot--CONNECTING {
  background: var(--fw-net-connecting, #c9a227);
}
.fw-connection__dot--RESYNCING {
  background: var(--fw-net-resyncing, #5f88b0);
}
.fw-connection__dot--OFFLINE,
.fw-connection__dot--CONTRACT_MISMATCH {
  background: var(--fw-net-offline, #b4544a);
}

.fw-connection__detail {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
