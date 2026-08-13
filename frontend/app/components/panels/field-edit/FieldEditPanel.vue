<script setup lang="ts">
// The three geometry operations over an existing field: extend, split and merge.
//
// Owner: W4-E. Surface: modal, opened from the field inspector.
//
// One panel and not three because they are one decision with three shapes, and because the
// GDD treats them as one clause (sections 20, 21 and 22). What differs between them is the
// rule, and none of the three rules is written here:
//
//   - Extending is `SelectionPurpose.FIELD_EXTEND` of `shared/rules/selection.ts`: the new
//     cells must be owned, arable, free of use, and the selection must touch the field
//     (GDD section 20).
//   - Splitting has no purpose in the shared rules, which is recorded in
//     `docs/handoff/NOTES-w4g.md`, section 1.3: every cell of a split already has
//     `landUse = FIELD` and `canBeFieldCell` would refuse it with `CELL_IN_USE`. The rule is
//     composed in `game/selection/rules.ts` from the same primitives and mirrors
//     `splitField` of the fields module sentence by sentence, including the half that stays:
//     a selection that carves a doughnut leaves a ring that is contiguous and a hole that is
//     not, and the server refuses it.
//   - Merging is not a selection at all but a set of fields, so its two conditions are
//     checked here with the shared `isContiguous` and with the same comparison the server
//     makes: two fields at different points of the cycle cannot become one, because the
//     result would have to discard one of the two histories (GDD section 22).
//
// None of the three moves money: the land is already owned and a field is a logical entity
// over it (GDD sections 13 and 19), so none carries an idempotency key. What protects them
// from a double submission is the exclusivity of use of the cell, which is a conditional
// update with a row count check on the server (plan section 5.4).
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  ensureFieldGeometry,
  jumpToCell,
  judgeSelection,
  panelCellReader,
  reasonLines,
  startSelectionMode,
  stopSelectionMode,
} from '~/components/panels/cell-inspector/worldAccess';
import { formatArea } from '~/components/panels/legend/units';
import { CROP_STATE_LABELS } from '~/components/panels/legend/vocabulary';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { SelectionToolMode } from '~/game/selection/modes';
import { isApiClientError } from '~/net/errors';
import {
  MAX_NAME_LENGTH,
  MAX_SELECTION_CELLS,
  VALIDATION_MESSAGES,
  ValidationCode,
  apiErrorMessage,
  isContiguous,
} from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useWorldStore } from '~/stores/world';

type EditMode = 'EXTEND' | 'SPLIT' | 'MERGE';

const props = withDefaults(defineProps<{ fieldId?: string; mode?: EditMode }>(), {
  mode: 'EXTEND',
});

const MODE_LABELS: Readonly<Record<EditMode, string>> = {
  EXTEND: 'Ampliar',
  SPLIT: 'Dividir',
  MERGE: 'Fusionar',
};

const MODE_SECTIONS: Readonly<Record<EditMode, string>> = {
  EXTEND: '§20',
  SPLIT: '§21',
  MERGE: '§22',
};

const world = useWorldStore();
const player = usePlayerStore();
const fields = useFieldsStore();
const selection = useSelectionStore();
const shell = useShellUi();
const bridge = useGameBridge();
const api = useApi();
const format = useFormatting();

const mode = ref<EditMode>(props.mode);
const splitName = ref('');
const mergeName = ref('');
const mergeWith = ref<readonly string[]>([]);
const sending = ref(false);
const failure = ref<string | null>(null);

const reader = panelCellReader(world, () => player.id);

const field = computed(() =>
  props.fieldId === undefined ? (fields.all[0] ?? null) : (fields.get(props.fieldId) ?? null),
);
const fieldCells = computed(() => (field.value === null ? [] : fields.cellsOf(field.value.id)));
const cells = computed(() => selection.cells);

/** Fields that could be merged with this one: every other field of the holding. */
const mergeCandidates = computed(() =>
  field.value === null ? [] : fields.all.filter((candidate) => candidate.id !== field.value?.id),
);

const verdict = computed(() => {
  void world.revision;
  const current = field.value;
  if (current === null) {
    return null;
  }
  if (mode.value === 'EXTEND') {
    return judgeSelection(
      reader,
      {
        mode: SelectionToolMode.FIELD_EXTEND,
        fieldId: current.id,
        targetCells: fieldCells.value,
      },
      cells.value,
    );
  }
  if (mode.value === 'SPLIT') {
    return judgeSelection(
      reader,
      {
        mode: SelectionToolMode.FIELD_SPLIT,
        fieldId: current.id,
        targetCells: fieldCells.value,
      },
      cells.value,
    );
  }
  return null;
});

const reasons = computed(() => reasonLines(verdict.value?.validation ?? null));

/**
 * The two conditions a merge has, checked with the shared primitives.
 *
 * Contiguity of the union is `isContiguous` of `shared/rules/geometry.ts`, the same breadth
 * first traversal with the same ceiling the server runs. Compatibility is the comparison
 * GDD section 22 asks for, stated as the equality of the pair that carries the agricultural
 * history: two fields in different states or with different crops would force the merge to
 * discard one of them.
 */
const mergeIssues = computed<readonly { code: string; message: string }[]>(() => {
  const current = field.value;
  if (current === null || mergeWith.value.length === 0) {
    return [];
  }
  const chosen = mergeWith.value
    .map((id) => fields.get(id))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  const issues: { code: string; message: string }[] = [];
  const incompatible = chosen.some(
    (candidate) =>
      candidate.cropCycleState !== current.cropCycleState || candidate.cropId !== current.cropId,
  );
  if (incompatible) {
    issues.push({
      code: ValidationCode.FIELD_MERGE_INCOMPATIBLE,
      message: VALIDATION_MESSAGES[ValidationCode.FIELD_MERGE_INCOMPATIBLE],
    });
  }
  const union = [
    ...fieldCells.value,
    ...chosen.flatMap((candidate) => fields.cellsOf(candidate.id)),
  ];
  if (union.length > MAX_SELECTION_CELLS) {
    issues.push({
      code: ValidationCode.SELECTION_TOO_LARGE,
      message: VALIDATION_MESSAGES[ValidationCode.SELECTION_TOO_LARGE],
    });
  } else if (!isContiguous(union, MAX_SELECTION_CELLS)) {
    issues.push({
      code: ValidationCode.SELECTION_NOT_CONTIGUOUS,
      message: VALIDATION_MESSAGES[ValidationCode.SELECTION_NOT_CONTIGUOUS],
    });
  }
  return issues;
});

const mergeCellCount = computed(
  () =>
    fieldCells.value.length +
    mergeWith.value.reduce((total, id) => total + fields.cellsOf(id).length, 0),
);

/** Cell count the field would end up with, per mode. Computed here so the template has none. */
const resultingCellCount = computed(() => {
  if (mode.value === 'EXTEND') {
    return fieldCells.value.length + cells.value.length;
  }
  const remainder = fieldCells.value.length - cells.value.length;
  return remainder > 0 ? remainder : 0;
});

/** Why the operation of the active mode cannot be sent, or null when it can. */
const blockedBy = computed<string | null>(() => {
  if (field.value === null) {
    return VALIDATION_MESSAGES[ValidationCode.NOT_FOUND];
  }
  if (mode.value === 'MERGE') {
    if (mergeWith.value.length === 0) {
      return 'Elige al menos un campo con el que fusionar.';
    }
    if (mergeName.value.trim().length === 0) {
      return 'El campo resultante necesita un nombre.';
    }
    return mergeIssues.value[0]?.message ?? null;
  }
  if (mode.value === 'SPLIT' && splitName.value.trim().length === 0) {
    return 'El campo que se separa necesita un nombre.';
  }
  if (cells.value.length === 0) {
    return mode.value === 'EXTEND'
      ? 'Arrastra sobre el mapa las celdas que se anaden al campo.'
      : 'Arrastra sobre el mapa las celdas que se separan del campo.';
  }
  const current = verdict.value;
  if (current === null) {
    return VALIDATION_MESSAGES[ValidationCode.VALIDATION_FAILED];
  }
  if (current.unresolvedCount > 0) {
    return `Faltan por cargar ${current.unresolvedCount} celdas de la seleccion.`;
  }
  return reasons.value[0]?.message ?? null;
});

const canSend = computed(() => blockedBy.value === null && !sending.value);
/** The `reason` prop of the button, or nothing: `exactOptionalPropertyTypes` is on. */
const reasonProps = computed(() => (blockedBy.value === null ? {} : { reason: blockedBy.value }));

/** Puts the canvas in the mode of the tab, and takes it out when the tab or the modal changes. */
function applyMode(): void {
  const current = field.value;
  if (current === null || mode.value === 'MERGE') {
    stopSelectionMode({ bridge, selection });
    return;
  }
  startSelectionMode(
    { bridge, selection },
    {
      mode:
        mode.value === 'EXTEND' ? SelectionToolMode.FIELD_EXTEND : SelectionToolMode.FIELD_SPLIT,
      fieldId: current.id,
      targetCells: fieldCells.value,
    },
    fieldCells.value,
  );
}

/**
 * Loads the geometry of the field when the client does not hold it.
 *
 * Every one of the three operations validates against the cells of the field, and the listing
 * does not carry them: without this the panel would refuse an extension for not touching a
 * surface it simply had not been told about.
 */
watch(
  () => field.value?.id,
  async (id) => {
    if (id === undefined) {
      return;
    }
    try {
      await ensureFieldGeometry(
        fields,
        (fieldId) => api.query('GET /api/fields/:fieldId', { params: { fieldId } }),
        id,
      );
    } catch (error) {
      failure.value = isApiClientError(error)
        ? apiErrorMessage(error.code)
        : 'No se pudo cargar la geometria del campo.';
    }
  },
  { immediate: true },
);

watch([mode, field, fieldCells], applyMode, { immediate: true });

watch(
  field,
  (current) => {
    splitName.value = current === null ? '' : `${current.name} B`;
    mergeName.value = current === null ? '' : current.name;
    mergeWith.value = [];
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopSelectionMode({ bridge, selection });
});

function toggleMerge(id: string): void {
  mergeWith.value = mergeWith.value.includes(id)
    ? mergeWith.value.filter((candidate) => candidate !== id)
    : [...mergeWith.value, id];
}

async function send(): Promise<void> {
  const current = field.value;
  if (current === null || !canSend.value) {
    return;
  }
  sending.value = true;
  failure.value = null;
  const body = cells.value.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY }));
  try {
    if (mode.value === 'EXTEND') {
      await api.mutate('POST /api/fields/:fieldId/extend', {
        params: { fieldId: current.id },
        body: { cells: body },
      });
    } else if (mode.value === 'SPLIT') {
      await api.mutate('POST /api/fields/:fieldId/split', {
        params: { fieldId: current.id },
        body: { name: splitName.value.trim(), cells: body },
      });
    } else {
      await api.mutate('POST /api/fields/merge', {
        body: {
          name: mergeName.value.trim(),
          fieldIds: [current.id, ...mergeWith.value],
        },
      });
    }
    selection.cancel();
    shell.closeTopModal();
    shell.openSidePanel('field-inspector', { fieldId: current.id });
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo aplicar la operacion.';
  } finally {
    sending.value = false;
  }
}

function goToConflict(): void {
  const target = verdict.value?.firstConflict ?? null;
  if (target !== null) {
    jumpToCell(bridge, target);
  }
}
</script>

<template>
  <UiCard
    flat
    :title="field?.name ?? 'Campo'"
    :subtitle="`${format.formatCount(fieldCells.length)} celdas · ${formatArea(fieldCells.length, world.cellSizeM)}`"
  >
    <UiEmptyState
      v-if="field === null"
      title="Campo no encontrado"
      detail="El campo se ha eliminado o todavia no ha llegado al cliente."
    />

    <template v-else>
      <nav class="fw-edit__tabs" aria-label="Operacion de geometria">
        <button
          v-for="(label, value) in MODE_LABELS"
          :key="value"
          type="button"
          class="fw-edit__tab"
          :class="{ 'fw-edit__tab--active': mode === value }"
          :aria-current="mode === value ? 'true' : undefined"
          @click="mode = value"
        >
          {{ label }} <span class="fw-mono fw-muted">{{ MODE_SECTIONS[value] }}</span>
        </button>
      </nav>

      <template v-if="mode !== 'MERGE'">
        <label v-if="mode === 'SPLIT'" class="fw-edit__field">
          <span class="fw-small fw-muted">Nombre del campo que se separa</span>
          <input v-model="splitName" type="text" :maxlength="MAX_NAME_LENGTH" required />
        </label>

        <dl class="fw-edit__facts">
          <dt>Celdas seleccionadas</dt>
          <dd class="fw-mono">{{ format.formatCount(cells.length) }}</dd>
          <dt>Superficie seleccionada</dt>
          <dd class="fw-mono">{{ formatArea(cells.length, world.cellSizeM) }}</dd>
          <dt>Resultado</dt>
          <dd class="fw-mono">{{ formatArea(resultingCellCount, world.cellSizeM) }}</dd>
          <dt>Sin resolver</dt>
          <dd class="fw-mono">{{ format.formatCount(verdict?.unresolvedCount ?? 0) }}</dd>
        </dl>

        <p class="fw-small fw-muted">
          {{
            mode === 'EXTEND'
              ? 'Las celdas nuevas deben ser propias, cultivables, libres de uso y adyacentes al campo, y la union debe seguir siendo contigua.'
              : 'Las celdas elegidas dejan el campo y forman uno nuevo. Las dos mitades deben quedar contiguas y no vacias.'
          }}
        </p>
      </template>

      <template v-else>
        <label class="fw-edit__field">
          <span class="fw-small fw-muted">Nombre del campo resultante</span>
          <input v-model="mergeName" type="text" :maxlength="MAX_NAME_LENGTH" required />
        </label>

        <UiEmptyState
          v-if="mergeCandidates.length === 0"
          title="No hay otro campo"
          detail="La fusion necesita al menos dos campos."
        />
        <ul v-else class="fw-edit__candidates">
          <li v-for="candidate in mergeCandidates" :key="candidate.id">
            <label>
              <input
                type="checkbox"
                :checked="mergeWith.includes(candidate.id)"
                @change="toggleMerge(candidate.id)"
              />
              <span>{{ candidate.name }}</span>
              <span class="fw-small fw-muted">
                {{ format.formatCount(candidate.cellCount) }} celdas ·
                {{ CROP_STATE_LABELS[candidate.cropCycleState] }}
              </span>
            </label>
          </li>
        </ul>

        <dl class="fw-edit__facts">
          <dt>Celdas resultantes</dt>
          <dd class="fw-mono">{{ format.formatCount(mergeCellCount) }}</dd>
          <dt>Superficie resultante</dt>
          <dd class="fw-mono">{{ formatArea(mergeCellCount, world.cellSizeM) }}</dd>
        </dl>
      </template>

      <section v-if="reasons.length > 0 || mergeIssues.length > 0" class="fw-edit__reasons">
        <h3 class="fw-small fw-muted">Motivos de invalidez</h3>
        <ul>
          <li v-for="reason in reasons" :key="reason.code">
            <UiBadge tone="danger">{{ format.formatCount(reason.cellCount) }}</UiBadge>
            {{ reason.message }}
          </li>
          <li v-for="issue in mergeIssues" :key="issue.code">
            <UiBadge tone="danger">Fusion</UiBadge>
            {{ issue.message }}
          </li>
        </ul>
        <UiButton
          v-if="mode !== 'MERGE'"
          size="sm"
          variant="ghost"
          :disabled="(verdict?.firstConflict ?? null) === null"
          @click="goToConflict"
        >
          Ir al primer conflicto
        </UiButton>
      </section>

      <p v-if="failure !== null" class="fw-edit__failure fw-small">{{ failure }}</p>

      <div class="fw-edit__actions">
        <UiButton
          variant="primary"
          :disabled="!canSend"
          :busy="sending"
          v-bind="reasonProps"
          @click="send"
        >
          {{ MODE_LABELS[mode] }}
        </UiButton>
        <UiButton variant="ghost" @click="shell.closeTopModal()">Cancelar</UiButton>
        <span v-if="blockedBy !== null" class="fw-small fw-muted">{{ blockedBy }}</span>
      </div>
    </template>
  </UiCard>
</template>

<style scoped>
.fw-edit__tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 10px;
}

.fw-edit__tab {
  padding: 4px 10px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
  background: transparent;
  color: var(--fw-text-muted, #9aa4b2);
  font: inherit;
  cursor: pointer;
}

.fw-edit__tab--active {
  border-color: var(--fw-accent, #6ea36b);
  color: var(--fw-text, #e6e9ee);
}

.fw-edit__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.fw-edit__field input {
  padding: 4px 6px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-sunken, #101318);
  color: var(--fw-text, #e6e9ee);
}

.fw-edit__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0 0 10px;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-edit__facts dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-edit__facts dd {
  margin: 0;
  text-align: right;
}

.fw-edit__candidates {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.fw-edit__candidates label {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.fw-edit__reasons h3 {
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fw-edit__reasons ul {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0 0 6px;
  padding: 0;
  font-size: var(--fw-font-size-sm, 12px);
  list-style: none;
}

.fw-edit__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.fw-edit__failure {
  margin: 0 0 8px;
  color: var(--fw-danger, #b4544a);
}
</style>
