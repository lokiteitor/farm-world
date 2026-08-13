<script setup lang="ts">
// The notice tray: everything that happened without the player in front of the screen, and
// everything the server refused.
//
// Owner: W4-E. Surface: overlay, anchored over the canvas without taking input from it.
//
// It is not the same thing as `components/shell/NoticeHost.vue`, which shows the last three
// as a stack of toasts. This is the tray: the whole bounded ring of `stores/notices.ts`,
// filtered and dismissable, plus the operations the server refused, which live in
// `stores/pending.ts` with the code of their refusal.
//
// In a game whose simulation runs while the player is away (GDD section 52), a notice is the
// only record of a consequence nobody witnessed: a silo that overflowed at harvest (GDD
// sections 83 and 97), a field that advanced a phase on its own (GDD section 76), a forced
// liquidation (plan section 6.6). That is why they are dismissed explicitly and never on a
// timer, and why this panel exists at all.
//
// Every text with a code comes from the shared message table and never from the wire. The
// server sends the text too, for its own logs and for a client without the table, but a
// client that has the table must use it: otherwise the reason a control was disabled and the
// reason the notice gives could be worded differently for the same code (plan section 8).
import { computed, ref } from 'vue';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import { NOTICE_KINDS, apiErrorMessage, fromWireGameMs, type NoticeKind } from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { useNoticesStore } from '~/stores/notices';
import { PendingState, usePendingStore } from '~/stores/pending';

/**
 * What each kind of notice is called. The set is closed by the contract, so a kind added to
 * `shared/api/schemas/state.ts` stops the compilation here rather than rendering as a raw
 * identifier over the canvas.
 */
const NOTICE_KIND_LABELS: Readonly<Record<NoticeKind, string>> = {
  HARVEST_OVERFLOW: 'Silo desbordado',
  WOOD_OVERFLOW: 'Almacen de madera desbordado',
  FORCED_LIQUIDATION: 'Liquidacion forzosa',
  DEBT_ENTERED: 'Saldo en negativo',
  DEBT_CLEARED: 'Saldo restablecido',
  FOREST_MILESTONE: 'Arbolado',
  FIELD_PHASE_ADVANCED: 'Transicion de campo',
  REPAIR_COMPLETED: 'Reparacion terminada',
  WORLD_RETIMED: 'Multiplicador del mundo',
  GENERIC: 'Aviso',
};

const notices = useNoticesStore();
const pending = usePendingStore();
const fields = useFieldsStore();
const shell = useShellUi();
const bridge = useGameBridge();
const clock = useGameClock();
const format = useFormatting();

const kindFilter = ref<NoticeKind | 'ALL'>('ALL');
const onlyWarnings = ref(false);

const entries = computed(() =>
  [...notices.visible]
    .reverse()
    .filter((entry) => kindFilter.value === 'ALL' || entry.notice.kind === kindFilter.value)
    .filter((entry) => !onlyWarnings.value || entry.notice.severity === 'WARNING'),
);

/** Kinds that actually occur, so the filter offers no empty option. */
const presentKinds = computed(() => NOTICE_KINDS.filter((kind) => notices.ofKind(kind).length > 0));

/**
 * Operations the server refused, newest first.
 *
 * They are not notices and they are shown here anyway, because from the point of view of the
 * player they are the same question: what went wrong and why. The code is the one the error
 * body carried, so the message is the same one the disabled control would have shown.
 */
const refusals = computed(() =>
  pending.all
    .filter(
      (operation) => operation.state === PendingState.FAILED && operation.failureCode !== null,
    )
    .sort((left, right) => right.startedAtRealMs - left.startedAtRealMs)
    .slice(0, 10),
);

/** How long ago a notice happened, in game time, from the extrapolating clock. */
function elapsed(atGameMs: string): string {
  const delta = clock.gameMs.value - fromWireGameMs(atGameMs);
  return delta <= 0n ? 'ahora' : `hace ${format.formatGameDuration(delta)}`;
}

/** Jumps to the entity a notice is about, when the contract named one. */
function jumpTo(subjectType: string | null, subjectId: string | null): void {
  if (subjectType === null || subjectId === null) {
    return;
  }
  if (subjectType === 'FIELD') {
    shell.openSidePanel('field-inspector', { fieldId: subjectId });
    const first = fields.cellsOf(subjectId)[0];
    if (first !== undefined) {
      bridge.emit('camera:goto', { cellX: first.cellX, cellY: first.cellY, smooth: true });
    }
  }
}

function canJump(subjectType: string | null, subjectId: string | null): boolean {
  return subjectType === 'FIELD' && subjectId !== null && fields.get(subjectId) !== undefined;
}
</script>

<template>
  <UiCard title="Avisos" :subtitle="`${format.formatCount(notices.unreadCount)} sin descartar`">
    <template #header>
      <UiButton
        size="sm"
        variant="ghost"
        :disabled="notices.unreadCount === 0"
        @click="notices.dismissAll()"
      >
        Descartar todos
      </UiButton>
    </template>

    <div class="fw-notice__controls">
      <label class="fw-small">
        <span class="fw-muted">Tipo</span>
        <select v-model="kindFilter">
          <option value="ALL">Todos</option>
          <option v-for="kind in presentKinds" :key="kind" :value="kind">
            {{ NOTICE_KIND_LABELS[kind] }}
          </option>
        </select>
      </label>
      <label class="fw-small">
        <input v-model="onlyWarnings" type="checkbox" />
        Solo advertencias
      </label>
    </div>

    <UiEmptyState
      v-if="entries.length === 0 && refusals.length === 0"
      title="Sin avisos"
      detail="Aqui aparece lo que ocurrio durante la ausencia y lo que el servidor rechazo."
    />

    <ul v-if="entries.length > 0" class="fw-notice__list fw-scroll">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="fw-notice__item"
        :class="{ 'fw-notice__item--warning': entry.notice.severity === 'WARNING' }"
      >
        <div class="fw-notice__head">
          <UiBadge :tone="entry.notice.severity === 'WARNING' ? 'warning' : 'info'">
            {{ NOTICE_KIND_LABELS[entry.notice.kind] }}
          </UiBadge>
          <span class="fw-small fw-muted fw-mono">{{ elapsed(entry.notice.atGameMs) }}</span>
        </div>
        <p class="fw-notice__text">{{ notices.messageOf(entry) }}</p>
        <div class="fw-notice__actions">
          <UiButton
            v-if="canJump(entry.notice.subjectType, entry.notice.subjectId)"
            size="sm"
            variant="ghost"
            @click="jumpTo(entry.notice.subjectType, entry.notice.subjectId)"
          >
            Ir al campo
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="notices.dismiss(entry.id)">
            Descartar
          </UiButton>
        </div>
      </li>
    </ul>

    <section v-if="refusals.length > 0" class="fw-notice__refusals">
      <h3 class="fw-small fw-muted">Peticiones rechazadas</h3>
      <ul>
        <li v-for="operation in refusals" :key="operation.idempotencyKey">
          <UiBadge tone="danger">{{ operation.failureCode }}</UiBadge>
          <span class="fw-small">
            {{ operation.failureCode === null ? '' : apiErrorMessage(operation.failureCode) }}
          </span>
          <span class="fw-small fw-muted fw-mono">{{ operation.routeKey }}</span>
        </li>
      </ul>
    </section>
  </UiCard>
</template>

<style scoped>
.fw-notice__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.fw-notice__controls label {
  display: flex;
  gap: 4px;
  align-items: center;
}

.fw-notice__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: min(40vh, 360px);
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-notice__item {
  padding: 6px 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-raised, #242932);
}

.fw-notice__item--warning {
  border-color: var(--fw-warning, #c9a227);
}

.fw-notice__head {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.fw-notice__text {
  margin: 4px 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-notice__actions {
  display: flex;
  gap: 4px;
}

.fw-notice__refusals {
  margin-top: 10px;
}

.fw-notice__refusals h3 {
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fw-notice__refusals ul {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-notice__refusals li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
}
</style>
