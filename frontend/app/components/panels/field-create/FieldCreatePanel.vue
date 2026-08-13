<script setup lang="ts">
// Creating a field over a selection of cells.
//
// Owner: W4-E. Surface: modal, opened from the field listing and from the confirmation of
// the selection tool.
//
// GDD sections 17 and 19 define a field as a contiguous set of cells the player owns, of
// arbitrary shape. Plan section 9.5 resolves "arbitrary" without a freehand tool: rectangles
// combined with union, subtraction and per cell toggling, and what travels to the server is
// the explicit set of cells. So this panel owns the name, the farm and the confirmation, and
// the shape belongs to the canvas.
//
// The verdict is `validateToolSelection`, which for this mode is one call to
// `validateSelection` of `shared/rules/selection.ts` and nothing else: the same function the
// endpoint runs before it mutates anything. A refusal here therefore carries the same code
// the 409 would, and the button says so instead of being greyed out in silence.
//
// A selection with cells whose chunk has not arrived is undecided and not invalid. The
// confirmation is refused while any remains, which is the conservative reading of plan
// section 7: the client is a cache and cannot claim anything about a cell it does not hold.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  jumpToCell,
  judgeSelection,
  panelCellReader,
  reasonLines,
  startSelectionMode,
  stopSelectionMode,
} from '~/components/panels/cell-inspector/worldAccess';
import { formatArea } from '~/components/panels/legend/units';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { SelectionToolMode } from '~/game/selection/modes';
import { isApiClientError } from '~/net/errors';
import { MAX_NAME_LENGTH, apiErrorMessage } from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { useFieldsStore } from '~/stores/fields';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useWorldStore } from '~/stores/world';

const world = useWorldStore();
const player = usePlayerStore();
const fields = useFieldsStore();
const farms = useFarmsStore();
const selection = useSelectionStore();
const shell = useShellUi();
const bridge = useGameBridge();
const api = useApi();
const format = useFormatting();

const name = ref(`Campo ${fields.count + 1}`);
const farmId = ref<string | null>(farms.primary?.id ?? null);
const sending = ref(false);
const failure = ref<string | null>(null);

const reader = panelCellReader(world, () => player.id);
const cells = computed(() => selection.cells);

const verdict = computed(() => {
  void world.revision;
  return judgeSelection(reader, { mode: SelectionToolMode.FIELD_CREATE }, cells.value);
});

const reasons = computed(() => reasonLines(verdict.value.validation));

const trimmedName = computed(() => name.value.trim());

/** Why the field cannot be created, or null when it can. */
const blockedBy = computed<string | null>(() => {
  if (trimmedName.value.length === 0) {
    return 'El campo necesita un nombre.';
  }
  if (trimmedName.value.length > MAX_NAME_LENGTH) {
    return `El nombre admite ${MAX_NAME_LENGTH} caracteres como maximo.`;
  }
  if (cells.value.length === 0) {
    return 'Arrastra sobre el mapa para elegir las celdas del campo.';
  }
  if (verdict.value.unresolvedCount > 0) {
    return `Faltan por cargar ${verdict.value.unresolvedCount} celdas de la seleccion.`;
  }
  return reasons.value[0]?.message ?? null;
});

const canCreate = computed(() => blockedBy.value === null && verdict.value.sendable);
/** The `reason` prop of the button, or nothing: `exactOptionalPropertyTypes` is on. */
const reasonProps = computed(() => (blockedBy.value === null ? {} : { reason: blockedBy.value }));

onMounted(() => {
  startSelectionMode({ bridge, selection }, { mode: SelectionToolMode.FIELD_CREATE });
});

onBeforeUnmount(() => {
  stopSelectionMode({ bridge, selection });
});

async function create(): Promise<void> {
  if (!canCreate.value || sending.value) {
    return;
  }
  sending.value = true;
  failure.value = null;
  try {
    const reply = await api.mutate('POST /api/fields', {
      body: {
        name: trimmedName.value,
        farmId: farmId.value,
        cells: cells.value.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
      },
    });
    selection.cancel();
    shell.closeTopModal();
    shell.openSidePanel('field-inspector', { fieldId: reply.result.field.id });
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo crear el campo.';
  } finally {
    sending.value = false;
  }
}

function goToConflict(): void {
  const target = verdict.value.firstConflict;
  if (target !== null) {
    jumpToCell(bridge, target);
  }
}
</script>

<template>
  <UiCard
    flat
    title="Campo nuevo"
    :subtitle="`${format.formatCount(cells.length)} celdas · ${formatArea(cells.length, world.cellSizeM)}`"
  >
    <form class="fw-create" @submit.prevent="create">
      <label class="fw-create__field">
        <span class="fw-small fw-muted">Nombre</span>
        <input v-model="name" type="text" :maxlength="MAX_NAME_LENGTH" required />
      </label>

      <label class="fw-create__field">
        <span class="fw-small fw-muted">Granja que lo atiende</span>
        <select v-model="farmId">
          <option :value="null">Sin granja</option>
          <option v-for="farm in farms.all" :key="farm.id" :value="farm.id">{{ farm.name }}</option>
        </select>
      </label>

      <dl class="fw-create__facts">
        <dt>Celdas</dt>
        <dd class="fw-mono">{{ format.formatCount(cells.length) }}</dd>
        <dt>Superficie</dt>
        <dd class="fw-mono">{{ formatArea(cells.length, world.cellSizeM) }}</dd>
        <dt>Validas</dt>
        <dd class="fw-mono">{{ format.formatCount(verdict.validation.validCellCount) }}</dd>
        <dt>Sin resolver</dt>
        <dd class="fw-mono">{{ format.formatCount(verdict.unresolvedCount) }}</dd>
      </dl>

      <p v-if="cells.length === 0" class="fw-small fw-muted">
        El modo de creacion esta activo. Arrastra sobre el mapa; mayusculas une, alt resta y control
        conmuta una celda. El campo debe ser contiguo y estar formado por celdas propias y aptas
        para agricultura.
      </p>

      <section v-if="reasons.length > 0" class="fw-create__reasons">
        <h3 class="fw-small fw-muted">Motivos de invalidez</h3>
        <ul>
          <li v-for="reason in reasons" :key="reason.code">
            <UiBadge tone="danger">{{ format.formatCount(reason.cellCount) }}</UiBadge>
            {{ reason.message }}
          </li>
        </ul>
        <UiButton
          size="sm"
          variant="ghost"
          :disabled="verdict.firstConflict === null"
          @click="goToConflict"
        >
          Ir al primer conflicto
        </UiButton>
      </section>

      <p v-if="failure !== null" class="fw-create__failure fw-small">{{ failure }}</p>

      <div class="fw-create__actions">
        <UiButton
          type="submit"
          variant="primary"
          :disabled="!canCreate"
          :busy="sending"
          v-bind="reasonProps"
        >
          Crear campo
        </UiButton>
        <UiButton variant="ghost" @click="shell.closeTopModal()">Cancelar</UiButton>
        <span v-if="blockedBy !== null" class="fw-small fw-muted">{{ blockedBy }}</span>
      </div>
    </form>
  </UiCard>
</template>

<style scoped>
.fw-create {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fw-create__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fw-create__field input,
.fw-create__field select {
  padding: 4px 6px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-sunken, #101318);
  color: var(--fw-text, #e6e9ee);
}

.fw-create__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-create__facts dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-create__facts dd {
  margin: 0;
  text-align: right;
}

.fw-create__reasons h3 {
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fw-create__reasons ul {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0 0 6px;
  padding: 0;
  font-size: var(--fw-font-size-sm, 12px);
  list-style: none;
}

.fw-create__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.fw-create__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
}
</style>
