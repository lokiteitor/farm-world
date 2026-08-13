<script setup lang="ts">
// Settings: the preferences of this client, the diagnosis of the connection, and logging out.
//
// Owner: W4-E. Surface: modal, reachable from the help tab.
//
// Five preferences and none of them is a game rule: the grid and the outlines of plan section
// 9.3, the zoom at which the renderer changes level of detail, how much a wheel notch zooms,
// and reduced motion. They belong to this browser, they survive a reload through
// `localStorage`, and they are never sent anywhere.
//
// The multiplier of the world is shown and is not editable. It is a setting of the server and
// not a control of the player (GDD section 51, plan section 2.2): changing it alters the cash
// burn of everybody at once, so the interface states it in read only and says when the world
// is paused, because a stopped clock and a broken client look identical otherwise.
//
// Three of the five preferences take effect on the canvas and the bridge declares no event
// that carries them. What is done today: the values are persisted, reduced motion is applied
// to the root element, and `world:reload` is published so a scene that reads them rebuilds.
// What is pending, with the exact four lines, is in `docs/handoff/NOTES-w4e.md`, section 1.
import { computed, onMounted, ref, watch } from 'vue';
import {
  DEFAULT_PREFERENCES,
  LOD_THRESHOLD_CHOICES,
  ZOOM_SENSITIVITY_MAX,
  ZOOM_SENSITIVITY_MIN,
  applyDocumentPreferences,
  loadPreferences,
  savePreferences,
  type ClientPreferences,
} from '~/components/panels/settings/preferences';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { apiCloseSession } from '~/net/api';
import { useClockStore } from '~/stores/clock';
import { type ConnectionState, useNetStore } from '~/stores/net';
import { usePlayerStore } from '~/stores/player';
import { useWorldStore } from '~/stores/world';

const props = defineProps<{
  /** Where logging out goes. Injected so a test drives it without a real navigation. */
  redirect?: () => void;
}>();

const clock = useClockStore();
const net = useNetStore();
const player = usePlayerStore();
const world = useWorldStore();
const shell = useShellUi();
const bridge = useGameBridge();
const format = useFormatting();

const preferences = ref<ClientPreferences>(DEFAULT_PREFERENCES);
const loggingOut = ref(false);

const CONNECTION_LABELS: Readonly<Record<ConnectionState, string>> = {
  OFFLINE: 'Sin conexion',
  CONNECTING: 'Conectando',
  ONLINE: 'En linea',
  RESYNCING: 'Resincronizando',
  CONTRACT_MISMATCH: 'Version del contrato distinta',
};

const rate = computed(() => {
  const reading = clock.dto;
  return reading === null ? '—' : format.formatRate(reading.rateNum, reading.rateDen);
});

onMounted(() => {
  preferences.value = loadPreferences();
  applyDocumentPreferences(preferences.value, globalThis.document?.documentElement ?? null);
});

/**
 * Persists and publishes on every change.
 *
 * `world:reload` and not a dedicated event because there is no dedicated event: it is the one
 * frame of the frozen bridge that means "redraw everything", which is what a change of grid,
 * outlines or level of detail threshold requires of a scene that reads the preferences when
 * it builds.
 */
watch(
  preferences,
  (next) => {
    savePreferences(next);
    applyDocumentPreferences(next, globalThis.document?.documentElement ?? null);
    bridge.emit('world:reload', {});
  },
  { deep: true },
);

function update<TKey extends keyof ClientPreferences>(
  key: TKey,
  value: ClientPreferences[TKey],
): void {
  preferences.value = { ...preferences.value, [key]: value };
}

function restoreDefaults(): void {
  preferences.value = DEFAULT_PREFERENCES;
}

async function logout(): Promise<void> {
  loggingOut.value = true;
  try {
    await apiCloseSession();
  } catch {
    // A logout the server did not acknowledge still leaves this tab logged out: the access
    // token lives in memory and the refresh cookie is httpOnly, so the navigation below makes
    // the session unusable from here either way. Refusing to leave would be worse.
  }
  loggingOut.value = false;
  shell.reset();
  if (props.redirect !== undefined) {
    props.redirect();
    return;
  }
  // A full navigation and not a router push: closing the session has to drop the access token
  // held in memory, the socket and every store, and reloading the document is the only thing
  // that guarantees all three.
  globalThis.location?.assign('/login');
}
</script>

<template>
  <UiCard flat title="Ajustes" subtitle="Preferencias de este cliente y estado de la sesion">
    <section class="fw-settings__group">
      <h3 class="fw-small fw-muted">Renderizado</h3>

      <label class="fw-settings__row">
        <input
          type="checkbox"
          :checked="preferences.gridVisible"
          @change="update('gridVisible', ($event.target as HTMLInputElement).checked)"
        />
        <span>Rejilla</span>
        <span class="fw-small fw-muted">Solo con detalle cercano.</span>
      </label>

      <label class="fw-settings__row">
        <input
          type="checkbox"
          :checked="preferences.outlinesVisible"
          @change="update('outlinesVisible', ($event.target as HTMLInputElement).checked)"
        />
        <span>Contornos</span>
        <span class="fw-small fw-muted">Propiedad, campo, granja y parcela forestal.</span>
      </label>

      <label class="fw-settings__row">
        <span>Umbral de nivel de detalle</span>
        <select
          :value="preferences.lodThresholdZoom"
          @change="update('lodThresholdZoom', Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="choice in LOD_THRESHOLD_CHOICES" :key="choice" :value="choice">
            {{ choice }}x
          </option>
        </select>
        <span class="fw-small fw-muted">Por debajo se dibuja la miniatura por chunk.</span>
      </label>

      <label class="fw-settings__row">
        <span>Sensibilidad del zoom</span>
        <input
          type="range"
          :min="ZOOM_SENSITIVITY_MIN"
          :max="ZOOM_SENSITIVITY_MAX"
          step="0.25"
          :value="preferences.zoomSensitivity"
          @input="update('zoomSensitivity', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="fw-mono">{{ preferences.zoomSensitivity.toFixed(2) }}</span>
      </label>

      <label class="fw-settings__row">
        <input
          type="checkbox"
          :checked="preferences.reducedMotion"
          @change="update('reducedMotion', ($event.target as HTMLInputElement).checked)"
        />
        <span>Movimiento reducido</span>
        <span class="fw-small fw-muted">Suprime el vuelo de camara y la transicion de zoom.</span>
      </label>

      <UiButton size="sm" variant="ghost" @click="restoreDefaults">Restaurar valores</UiButton>
    </section>

    <section class="fw-settings__group">
      <h3 class="fw-small fw-muted">Mundo y conexion</h3>
      <dl class="fw-settings__facts">
        <dt>Multiplicador</dt>
        <dd>
          <span class="fw-mono">{{ rate }}</span>
          <UiBadge v-if="clock.paused" tone="warning">Mundo pausado</UiBadge>
          <span class="fw-small fw-muted">Configuracion del servidor, en solo lectura.</span>
        </dd>
        <dt>Estado</dt>
        <dd>
          <UiBadge :tone="net.online ? 'accent' : 'danger'">
            {{ CONNECTION_LABELS[net.state] }}
          </UiBadge>
        </dd>
        <dt>Secuencia aplicada</dt>
        <dd class="fw-mono">{{ net.lastAppliedSeq }} de {{ net.serverSeq }}</dd>
        <dt>Resincronizaciones</dt>
        <dd class="fw-mono">{{ net.resyncCount }} · {{ net.snapshotCount }} instantaneas</dd>
        <dt>Version del contrato</dt>
        <dd class="fw-mono">{{ world.contractVersion ?? '—' }}</dd>
      </dl>
      <UiButton size="sm" @click="net.reconnectNow('ajustes')">Reconectar ahora</UiButton>
    </section>

    <section class="fw-settings__group">
      <h3 class="fw-small fw-muted">Sesion</h3>
      <p class="fw-small">
        {{ player.displayName || 'Sin sesion' }}
      </p>
      <div class="fw-settings__actions">
        <UiButton variant="danger" :busy="loggingOut" @click="logout">Cerrar sesion</UiButton>
        <UiButton variant="ghost" @click="shell.closeTopModal()">Cerrar</UiButton>
      </div>
    </section>
  </UiCard>
</template>

<style scoped>
.fw-settings__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
  border-top: 1px solid var(--fw-border, #333a45);
}

.fw-settings__group:first-child {
  border-top: 0;
}

.fw-settings__group h3 {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fw-settings__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.fw-settings__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 12px;
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-settings__facts dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-settings__facts dd {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin: 0;
}

.fw-settings__actions {
  display: flex;
  gap: 8px;
}
</style>

<style>
/*
 * Reduced motion, applied by the attribute `preferences.ts` sets on the root element.
 *
 * Deliberately not scoped: it is a global preference and it has to reach the whole document,
 * including the panels of other agents. It is the only global rule this workflow adds, and it
 * suppresses animation rather than restyling anything.
 */
:root[data-fw-reduced-motion='true'] *,
:root[data-fw-reduced-motion='true'] *::before,
:root[data-fw-reduced-motion='true'] *::after {
  transition-duration: 0.001ms !important;
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
}
</style>
