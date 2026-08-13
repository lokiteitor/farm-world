<script setup lang="ts">
// The field listing: every field of the holding, with the state of its cycle and what it
// is waiting for.
//
// Owner: W4-E. Surface: side panel of the fields tab.
//
// It answers the question GDD sections 16 to 22 leave the player with once there is more
// than one field: which of them needs an order now. So the columns are the ones that decide
// that -- surface, state of the cycle, crop, time left and the task in progress -- and the
// default order is the time left, ascending, which puts the field that is about to change
// state at the top.
//
// Every figure is projected locally at the instant of the extrapolating clock, with the
// same pure rules the server settles with (`stores/fields.ts`, plan section 8): the
// countdown moves between replies instead of freezing until the next one, and it cannot
// disagree with what the harvest will actually use.
import { computed, ref } from 'vue';
import {
  FIELD_FILTER_LABELS,
  FIELD_SORT_LABELS,
  FieldFilter,
  FieldSort,
  matchesFilter,
  matchesText,
  sortRows,
  type FieldRow,
} from '~/components/panels/field-list/ordering';
import { areaHectares, formatHectares } from '~/components/panels/legend/units';
import {
  CROP_LABELS,
  CROP_STATE_LABELS,
  OPERATION_LABELS,
  cropStateColour,
} from '~/components/panels/legend/vocabulary';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import {
  CROP_CYCLE_STATES,
  CROP_CYCLE_TRANSITIONS,
  CropCycleState,
  type CropCycleState as CropCycleStateType,
} from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { useTasksStore } from '~/stores/tasks';
import { useWorldStore } from '~/stores/world';

const fields = useFieldsStore();
const tasks = useTasksStore();
const world = useWorldStore();
const shell = useShellUi();
const bridge = useGameBridge();
const clock = useGameClock();
const format = useFormatting();

const sort = ref<FieldSort>(FieldSort.REMAINING);
const descending = ref(false);
const filter = ref<FieldFilter>(FieldFilter.ALL);
const search = ref('');

/**
 * States whose only outgoing transitions are automatic.
 *
 * Derived from the transition table and not written down: a state the clock will leave on
 * its own is not waiting for the player, and the complement of that set is exactly what the
 * "waiting for the player" filter means (GDD section 76).
 */
const actionableStates = computed<ReadonlySet<CropCycleStateType>>(() => {
  const set = new Set<CropCycleStateType>();
  for (const transition of CROP_CYCLE_TRANSITIONS) {
    if (!transition.automatic) {
      set.add(transition.from);
    }
  }
  return set;
});

const rows = computed<readonly FieldRow[]>(() => {
  const at = clock.gameMs.value;
  return fields.all.map((field) => {
    const projection = fields.projectAt(field.id, at);
    const task = tasks.activeByFieldId[field.id] ?? null;
    const boundary = projection?.nextBoundaryGameMs ?? projection?.readyAtGameMs ?? null;
    return {
      id: field.id,
      name: field.name,
      cellCount: field.cellCount,
      hectares: areaHectares(field.cellCount, world.cellSizeM),
      state: projection?.cropCycleState ?? field.cropCycleState,
      cropId: field.cropId,
      remainingGameMs: boundary === null ? null : boundary - at > 0n ? boundary - at : 0n,
      operation: task?.operation ?? null,
      hasActiveTask: task !== null,
      expectedYieldLiters: projection?.expectedYieldLiters ?? 0,
    };
  });
});

const visible = computed(() =>
  sortRows(
    rows.value.filter(
      (row) =>
        matchesText(row, search.value) &&
        matchesFilter(row, filter.value, actionableStates.value, CropCycleState.READY_TO_HARVEST),
    ),
    sort.value,
    descending.value,
    CROP_CYCLE_STATES,
  ),
);

const totals = computed(() => ({
  cells: rows.value.reduce((total, row) => total + row.cellCount, 0),
  hectares: rows.value.reduce((total, row) => total + row.hectares, 0),
}));

function open(row: FieldRow): void {
  shell.openSidePanel('field-inspector', { fieldId: row.id });
  const first = fields.cellsOf(row.id)[0];
  if (first !== undefined) {
    bridge.emit('camera:goto', { cellX: first.cellX, cellY: first.cellY, smooth: true });
  }
}

function toggleSort(next: FieldSort): void {
  if (sort.value === next) {
    descending.value = !descending.value;
    return;
  }
  sort.value = next;
  descending.value = false;
}
</script>

<template>
  <UiCard
    title="Campos"
    :subtitle="`${format.formatCount(fields.count)} campos · ${format.formatCount(totals.cells)} celdas · ${totals.hectares.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`"
  >
    <template #header>
      <UiButton size="sm" @click="shell.openModal('field-create')">Crear campo</UiButton>
    </template>

    <div class="fw-fields__controls">
      <label class="fw-fields__control fw-small">
        <span class="fw-muted">Filtro</span>
        <select v-model="filter">
          <option v-for="(label, value) in FIELD_FILTER_LABELS" :key="value" :value="value">
            {{ label }}
          </option>
        </select>
      </label>
      <label class="fw-fields__control fw-small">
        <span class="fw-muted">Orden</span>
        <select v-model="sort">
          <option v-for="(label, value) in FIELD_SORT_LABELS" :key="value" :value="value">
            {{ label }}
          </option>
        </select>
      </label>
      <UiButton size="sm" variant="ghost" @click="descending = !descending">
        {{ descending ? 'Descendente' : 'Ascendente' }}
      </UiButton>
      <input
        v-model="search"
        class="fw-fields__search"
        type="search"
        placeholder="Buscar por nombre"
        aria-label="Buscar campos por nombre"
      />
    </div>

    <UiEmptyState
      v-if="fields.count === 0"
      title="Sin campos"
      detail="Un campo es un conjunto contiguo de celdas propias. Compra tierra y crea el primero."
    />
    <UiEmptyState
      v-else-if="visible.length === 0"
      title="Ningun campo cumple el filtro"
      detail="Cambia el filtro o el texto de busqueda."
    />

    <table v-else class="fw-fields__table">
      <thead>
        <tr>
          <th scope="col">
            <button type="button" @click="toggleSort(FieldSort.NAME)">Campo</button>
          </th>
          <th scope="col">
            <button type="button" @click="toggleSort(FieldSort.SURFACE)">Superficie</button>
          </th>
          <th scope="col">
            <button type="button" @click="toggleSort(FieldSort.STATE)">Estado</button>
          </th>
          <th scope="col">
            <button type="button" @click="toggleSort(FieldSort.REMAINING)">Restante</button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visible" :key="row.id" class="fw-fields__row" @click="open(row)">
          <td>
            <span class="fw-fields__name">{{ row.name }}</span>
            <span class="fw-small fw-muted">
              {{ format.formatCount(row.cellCount) }} celdas ·
              {{ row.cropId === null ? 'sin cultivo' : CROP_LABELS[row.cropId] }}
            </span>
          </td>
          <td class="fw-mono">{{ formatHectares(row.cellCount, world.cellSizeM) }}</td>
          <td>
            <span class="fw-fields__state">
              <span class="fw-fields__dot" :style="{ background: cropStateColour(row.state) }" />
              {{ CROP_STATE_LABELS[row.state] }}
            </span>
            <span v-if="row.operation !== null" class="fw-small fw-muted">
              {{ OPERATION_LABELS[row.operation] }} en curso
            </span>
          </td>
          <td class="fw-mono">
            {{
              row.remainingGameMs === null ? '—' : format.formatGameDuration(row.remainingGameMs)
            }}
          </td>
        </tr>
      </tbody>
    </table>
  </UiCard>
</template>

<style scoped>
.fw-fields__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.fw-fields__control {
  display: flex;
  gap: 4px;
  align-items: center;
}

.fw-fields__search {
  flex: 1 1 120px;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-sunken, #101318);
  color: var(--fw-text, #e6e9ee);
}

.fw-fields__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-fields__table th {
  padding: 2px 4px;
  text-align: right;
}

.fw-fields__table th:first-child {
  text-align: left;
}

.fw-fields__table th button {
  border: 0;
  background: transparent;
  color: var(--fw-text-muted, #9aa4b2);
  font: inherit;
  cursor: pointer;
}

.fw-fields__table th button:hover {
  color: var(--fw-text, #e6e9ee);
}

.fw-fields__table td {
  padding: 4px;
  border-top: 1px solid var(--fw-border, #333a45);
  vertical-align: top;
  text-align: right;
}

.fw-fields__table td:first-child,
.fw-fields__table td:nth-child(3) {
  text-align: left;
}

.fw-fields__row {
  cursor: pointer;
}

.fw-fields__row:hover {
  background: var(--fw-surface-raised, #242932);
}

.fw-fields__name,
.fw-fields__state {
  display: block;
}

.fw-fields__state {
  display: flex;
  gap: 6px;
  align-items: center;
}

.fw-fields__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
