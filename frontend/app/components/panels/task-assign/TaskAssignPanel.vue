<script setup lang="ts">
// Assigning a task: the central dialogue of the game.
//
// Owner: W6-D. Panel `task-assign` of the frozen registry. Surface: modal.
//
// Everything the loop of GDD section 39 does passes through here. The player never drives a
// machine: he picks an operation, a worker and a combination of machines, and the server
// schedules the completion (GDD sections 1, 39 and 104). So this panel has one obligation
// above every other, and it is not the layout: whatever it offers must be exactly what the
// server would accept, and whatever it refuses must be refused for the reason the server
// would give and in the order the server evaluates.
//
// The four selectors, and where each of them gets its truth:
//
//   Operation    the transitions of `CROP_CYCLE_TRANSITIONS` out of the *projected* state of
//                the field (GDD section 76, ADR-0035). The projected one and not the stored
//                one, because the server validates against the projection and a field whose
//                materialising job has not run yet would otherwise show no operation at all.
//   Worker       the payroll, with `WORKER_NOT_IDLE` or `WORKER_WRONG_FARM` on the rows that
//                cannot take it (GDD sections 104 and 108).
//   Machinery    every combination the holding could offer, valid or not, each with the code
//                of the table of GDD section 90 on the row. Showing the invalid ones is the
//                point: a selector that hid them would leave the player with an empty list
//                and nothing to fix.
//   Crop         only when the operation sows, because `requiresCrop` of the catalogue says
//                so and not because this file knows that sowing needs seed.
//
// The preview comes from `POST /api/tasks/estimate` and not from arithmetic done here. The
// route exists for this panel (`shared/api/schemas/tasks.ts`) and reports the duration, the
// operating cost, the wages, the wear and the production of the assignment, plus every
// blocker at once, computed by the same evaluation the mutating route runs. What is computed
// locally is only the figure that has to move with the selector before a round trip
// finishes, `estimateFor` of the machines store, and it is labelled as provisional until the
// server answers.
//
// The order of the refusals is `shared/assignment.ts`, which transcribes
// `backend/src/modules/tasks/assignment.ts` (ADR-0048). It is not repeated here.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  CROP_FAMILY_LABELS,
  OPERATION_LABELS,
  SEASON_LABELS,
  STORAGE_CATEGORY_LABELS,
} from '~/components/panels/legend/vocabulary';
import { labelOfMachineType } from '~/components/panels/machinery/machineryPresentation';
import {
  assignmentBlockingCode,
  machineCombinations,
  operationsForField,
  reservedMachineTypes,
  cropBlockingCode,
  requirementOf,
  unitLabel,
  unitsForAssignment,
  workerChoices,
  type MachineCombination,
  type TargetSituation,
} from '~/components/panels/shared/assignment';
import { composeArea } from '~/components/panels/shared/forestPresentation';
import { cropGroups, firstSowableCrop } from '~/components/panels/task-assign/cropChoices';
import { buildEstimateBody } from '~/components/panels/task-assign/request';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import { isApiClientError } from '~/net/errors';
import {
  CROPS,
  CROP_FAMILIES,
  STORAGE_RESOURCE_UNITS,
  TaskOperation,
  VALIDATION_MESSAGES,
  apiErrorMessage,
  cellKey,
  fromWireGameMs,
  fromWireMoney,
  seasonAtGameMs,
  type CellCoordWire,
  type CropFamily,
  type CropId,
  type StorageResource,
  type TaskEstimateReply,
  type ValidationCode,
} from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { useFieldsStore } from '~/stores/fields';
import { useForestryStore } from '~/stores/forestry';
import { useInventoryStore } from '~/stores/inventory';
import { useMachinesStore } from '~/stores/machines';
import { useSelectionStore } from '~/stores/selection';
import { useWorkersStore } from '~/stores/workers';

const props = withDefaults(
  defineProps<{
    fieldId?: string | null;
    forestPlotId?: string | null;
    operation?: TaskOperation | null;
    /** Cells of a felling area, a replanting or a clearing, when the canvas chose them. */
    cells?: readonly CellCoordWire[] | null;
  }>(),
  { fieldId: null, forestPlotId: null, operation: null, cells: null },
);

const fields = useFieldsStore();
const forestry = useForestryStore();
const farms = useFarmsStore();
const machines = useMachinesStore();
const workers = useWorkersStore();
const inventory = useInventoryStore();
const selection = useSelectionStore();
const shell = useShellUi();
const api = useApi();
const format = useFormatting();
const clock = useGameClock();

const failure = ref('');
const estimate = ref<TaskEstimateReply | null>(null);
const estimating = ref(false);
const submitting = ref(false);
let estimateTimer: ReturnType<typeof setTimeout> | null = null;
let estimateToken = 0;

const field = computed(() => (props.fieldId === null ? null : (fields.get(props.fieldId) ?? null)));
const plot = computed(() =>
  props.forestPlotId === null ? null : (forestry.get(props.forestPlotId) ?? null),
);

/** The farm the assignment belongs to: the one serving the target, or the only one. */
const farmId = computed(() => field.value?.farmId ?? plot.value?.farmId ?? farms.primary?.id ?? '');

/**
 * Cells the request carries: the ones the panel was opened with, or the live selection.
 *
 * The panel is opened by the confirmation of a selection mode (`pages/game.vue`), which is
 * why the props win: the tool published a snapshot and the panel confirms it. Reading the
 * store as well is what lets the player adjust the area with the dialogue open.
 */
const cells = computed<readonly CellCoordWire[]>(() =>
  props.cells !== null && props.cells.length > 0 ? props.cells : selection.cells,
);

// ---------------------------------------------------------------------------
// Operation
// ---------------------------------------------------------------------------

/**
 * Operations offered, which is the table of GDD section 76 for a field and the two forestry
 * operations of GDD sections 132 and 137 for a plot. Clearing appears only with cells,
 * because its target is the selection and not an entity (GDD section 10).
 */
const availableOperations = computed<readonly TaskOperation[]>(() => {
  if (field.value !== null) {
    return operationsForField(field.value);
  }
  if (plot.value !== null) {
    return [TaskOperation.FELL, TaskOperation.REPLANT];
  }
  return cells.value.length > 0 ? [TaskOperation.CLEAR_LAND] : [];
});

const chosenOperation = ref<TaskOperation | null>(props.operation);
const effectiveOperation = computed<TaskOperation | null>(() => {
  const wanted = chosenOperation.value;
  if (wanted !== null && availableOperations.value.includes(wanted)) {
    return wanted;
  }
  return availableOperations.value[0] ?? wanted;
});
const selectedOperation = computed<string>({
  get: () => effectiveOperation.value ?? '',
  set: (value) => {
    chosenOperation.value = value === '' ? null : (value as TaskOperation);
  },
});

// ---------------------------------------------------------------------------
// Machinery and worker
// ---------------------------------------------------------------------------

const holding = computed(() => (farmId.value === '' ? [] : machines.ofFarm(farmId.value)));

const combinations = computed<readonly MachineCombination[]>(() =>
  effectiveOperation.value === null
    ? []
    : machineCombinations(effectiveOperation.value, holding.value),
);

const chosenCombinationKey = ref<string | null>(null);
const combination = computed<MachineCombination | null>(() => {
  const rows = combinations.value;
  const wanted = rows.find((row) => row.key === chosenCombinationKey.value);
  if (wanted !== undefined) {
    return wanted;
  }
  // The first usable one, so the dialogue opens on a choice that works when there is one.
  return rows.find((row) => row.usable) ?? rows[0] ?? null;
});
const selectedCombinationKey = computed<string>({
  get: () => combination.value?.key ?? '',
  set: (value) => {
    chosenCombinationKey.value = value === '' ? null : value;
  },
});

const payroll = computed(() => (farmId.value === '' ? [] : workers.ofFarm(farmId.value)));
const workerRows = computed(() =>
  workerChoices(payroll.value, combination.value?.powered.farmId ?? null),
);

const chosenWorkerId = ref<string | null>(null);
const worker = computed(() => {
  const rows = workerRows.value;
  const wanted = rows.find((row) => row.worker.id === chosenWorkerId.value);
  if (wanted !== undefined) {
    return wanted.worker;
  }
  return (rows.find((row) => row.usable) ?? rows[0])?.worker ?? null;
});
const selectedWorkerId = computed<string>({
  get: () => worker.value?.id ?? '',
  set: (value) => {
    chosenWorkerId.value = value === '' ? null : value;
  },
});

// ---------------------------------------------------------------------------
// Crop and destination
// ---------------------------------------------------------------------------

/**
 * La estacion vigente, derivada del reloj con la misma funcion pura que usa el servidor.
 *
 * No viaja por la API: el cliente ya extrapola `gameMs`, asi que preguntar por la estacion
 * seria pedir algo que ya se puede calcular, y dos implementaciones de eso es como el panel
 * y el servidor acaban discrepando.
 */
const season = computed(() => seasonAtGameMs(clock.gameMs.value));

/** Filtro de familia: con sesenta y dos cultivos, elegir empieza por reducir. */
const familyFilter = ref<CropFamily | null>(null);
const cropOptions = computed(() => cropGroups(season.value, familyFilter.value));

const requiresCrop = computed(() =>
  effectiveOperation.value === null ? false : requirementOf(effectiveOperation.value).requiresCrop,
);
// Por omision, el primero que se pueda sembrar hoy: proponer uno fuera de temporada seria
// ofrecer algo que el servidor va a rechazar.
const chosenCropId = ref<CropId | null>(firstSowableCrop(season.value));
const cropId = computed<CropId | null>(() => (requiresCrop.value ? chosenCropId.value : null));
/** La entrada del catalogo elegida, para la ficha que acompania al selector. */
const chosenCrop = computed(() => (cropId.value === null ? null : CROPS[cropId.value]));
/** El motivo por el que el cultivo elegido no se puede sembrar, o cadena vacia. */
const cropReason = computed(() =>
  effectiveOperation.value === null
    ? ''
    : reasonOf(cropBlockingCode(effectiveOperation.value, cropId.value, season.value)),
);
const selectedCropId = computed<string>({
  get: () => chosenCropId.value ?? '',
  set: (value) => {
    chosenCropId.value = value === '' ? null : (value as CropId);
  },
});

const requiresStorage = computed(() =>
  effectiveOperation.value === null
    ? null
    : requirementOf(effectiveOperation.value).requiresStorage,
);
const destinationFarmId = computed(() => (requiresStorage.value === null ? null : farmId.value));

/**
 * The storage category the task will deposit into.
 *
 * A harvest does not fix one: the crop standing on the field does, which is why the
 * requirement table answers `FROM_CROP` and this resolves it here.
 */
const storageCategory = computed<StorageResource | null>(() => {
  const required = requiresStorage.value;
  if (required === null) {
    return null;
  }
  if (required !== 'FROM_CROP') {
    return required;
  }
  const crop = field.value?.cropId ?? null;
  return crop === null ? null : CROPS[crop].storageResource;
});

const storageSituation = computed(() => {
  const resource = storageCategory.value;
  if (resource === null || destinationFarmId.value === null) {
    return null;
  }
  const usage = inventory.usageOf(destinationFarmId.value, resource);
  return {
    hasStore: usage !== null && usage.capacityUnits > 0,
    freeUnits: inventory.freeUnits(destinationFarmId.value, resource),
  };
});

// ---------------------------------------------------------------------------
// The target
// ---------------------------------------------------------------------------

/**
 * Trees of the selected area that admit felling, derived locally with the shared rules.
 *
 * The plot already reports the count for the whole plot; what no route reports is the same
 * count for a sub area, which is exactly what GDD section 132 option B lets the player pick.
 * With no area chosen the figure of the plot is used, which is what an omitted `cells` means
 * on the wire.
 */
const fellableTreeCount = computed(() => {
  const current = plot.value;
  if (current === null) {
    return 0;
  }
  if (cells.value.length === 0) {
    return current.fellableTreeCount;
  }
  const wanted = new Set(cells.value.map((cell) => cellKey(cell.cellX, cell.cellY)));
  const inside = forestry
    .treesOf(current.id)
    .filter((tree) => wanted.has(cellKey(tree.cellX, tree.cellY)));
  return composeArea(inside, fromWireGameMs(current.atGameMs)).fellableCount;
});

const target = computed<TargetSituation>(() => ({
  field: field.value,
  plot: plot.value,
  selectedCellCount: cells.value.length,
  fellableTreeCount: fellableTreeCount.value,
  emptyCellCount: plot.value?.emptyCellCount ?? 0,
}));

const units = computed(() =>
  effectiveOperation.value === null
    ? 0
    : unitsForAssignment(effectiveOperation.value, target.value),
);

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

const blockingCode = computed(() => {
  if (effectiveOperation.value === null) {
    return null;
  }
  return assignmentBlockingCode({
    operation: effectiveOperation.value,
    worker: worker.value,
    combination: combination.value,
    machines: holding.value,
    target: target.value,
    cropId: cropId.value,
    storage: storageSituation.value,
  });
});

const blockingReason = computed(() =>
  blockingCode.value === null ? '' : VALIDATION_MESSAGES[blockingCode.value],
);
const canSubmit = computed(() => effectiveOperation.value !== null && blockingCode.value === null);

/** The blockers of the server, which are every reason at once and not just the first. */
const serverBlockers = computed(() =>
  (estimate.value?.blockers ?? []).map((blocker) => ({
    code: blocker.code,
    message: blocker.message.length > 0 ? blocker.message : apiErrorMessage(blocker.code),
  })),
);

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

/**
 * The duration computed locally, which moves with the selector and produces no traffic.
 *
 * Provisional by construction and labelled as such: the server counts the cells and the
 * trees itself, and its figure is the one the task is scheduled with.
 */
const localEstimate = computed(() => {
  const chosen = combination.value;
  const person = worker.value;
  if (chosen === null || person === null || effectiveOperation.value === null || units.value <= 0) {
    return null;
  }
  return machines.estimateFor({
    operation: effectiveOperation.value,
    units: units.value,
    paceMachineId: chosen.paceMachine.id,
    skillBp: person.skillBp,
  });
});

const requestBody = computed(() => {
  if (effectiveOperation.value === null || worker.value === null || combination.value === null) {
    return null;
  }
  return buildEstimateBody({
    operation: effectiveOperation.value,
    workerId: worker.value.id,
    poweredMachineId: combination.value.powered.id,
    implementMachineId: combination.value.implement?.id ?? null,
    targetFieldId: field.value?.id ?? null,
    targetForestPlotId: plot.value?.id ?? null,
    destinationFarmId: destinationFarmId.value,
    cropId: cropId.value,
    cells: cells.value,
  });
});

/**
 * Asks the server for the estimate, debounced.
 *
 * Debounced because every selector writes the same signature and the player changes two or
 * three of them in a row; a request per keystroke of the interface would put the figure a
 * round trip behind the choice, which is the defect ADR-0034 documented for the land budget.
 * The token discards a reply that arrives after a newer request, so the panel cannot show
 * the estimate of a choice that is no longer on screen.
 */
async function refreshEstimate(): Promise<void> {
  const body = requestBody.value;
  if (body === null) {
    estimate.value = null;
    return;
  }
  estimateToken += 1;
  const token = estimateToken;
  estimating.value = true;
  try {
    const reply = await api.query('POST /api/tasks/estimate', { body });
    if (token === estimateToken) {
      estimate.value = reply;
    }
  } catch (error) {
    if (token === estimateToken) {
      estimate.value = null;
      failure.value = isApiClientError(error) ? error.message : 'La prevision no pudo calcularse.';
    }
  } finally {
    if (token === estimateToken) {
      estimating.value = false;
    }
  }
}

const ESTIMATE_DEBOUNCE_REAL_MS = 120;

watch(
  requestBody,
  () => {
    if (estimateTimer !== null) {
      clearTimeout(estimateTimer);
    }
    estimateTimer = setTimeout(() => {
      estimateTimer = null;
      void refreshEstimate();
    }, ESTIMATE_DEBOUNCE_REAL_MS);
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(() => {
  if (estimateTimer !== null) {
    clearTimeout(estimateTimer);
    estimateTimer = null;
  }
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const productionUnit = computed(() => {
  const resource = storageCategory.value;
  return resource === null ? null : STORAGE_RESOURCE_UNITS[resource];
});

/** The message of a code, from the shared table and never a sentence written here. */
function reasonOf(code: ValidationCode | null): string {
  return code === null ? '' : VALIDATION_MESSAGES[code];
}

/**
 * Sends the assignment to the route the operation belongs to.
 *
 * Four routes and one body: `POST /api/tasks` for the agricultural operations, and the three
 * forestry paths, which carry the plot in the URL and therefore take the same body without
 * the discriminant. None of them moves money at the moment of creation, so none carries an
 * idempotency key; what stops a double submission is the conditional reservation of the
 * worker and the machines, which answers `WORKER_NOT_IDLE` or `MACHINE_NOT_IDLE`
 * (`shared/api/schemas/tasks.ts`).
 */
async function submit(): Promise<void> {
  const body = requestBody.value;
  const current = effectiveOperation.value;
  if (body === null || current === null || submitting.value) {
    return;
  }
  failure.value = '';
  submitting.value = true;
  try {
    switch (body.operation) {
      case 'FELL': {
        const { operation: _fell, targetForestPlotId, ...rest } = body;
        await api.mutate('POST /api/forest-plots/:forestPlotId/fell', {
          params: { forestPlotId: targetForestPlotId },
          body: rest,
          subjectKind: 'FOREST_PLOT',
          subjectId: targetForestPlotId,
        });
        break;
      }
      case 'REPLANT': {
        const { operation: _replant, targetForestPlotId, ...rest } = body;
        await api.mutate('POST /api/forest-plots/:forestPlotId/replant', {
          params: { forestPlotId: targetForestPlotId },
          body: rest,
          subjectKind: 'FOREST_PLOT',
          subjectId: targetForestPlotId,
        });
        break;
      }
      case 'CLEAR_LAND': {
        const { operation: _clear, ...rest } = body;
        await api.mutate('POST /api/land/clear', {
          body: rest,
          subjectKind: 'FOREST_PLOT',
          subjectId: plot.value?.id ?? '',
        });
        break;
      }
      default: {
        await api.mutate('POST /api/tasks', {
          body,
          subjectKind: 'FIELD',
          subjectId: body.targetFieldId,
        });
        break;
      }
    }
    selection.cancel();
    shell.closeTopModal();
    shell.openSidePanel('task-list');
  } catch (error) {
    failure.value = isApiClientError(error) ? error.message : 'La tarea no pudo asignarse.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <UiCard flat>
    <UiEmptyState
      v-if="effectiveOperation === null"
      title="Nada que asignar"
      detail="Elige un campo, una parcela forestal o un area de celdas antes de asignar una tarea."
    />

    <div v-else class="fw-assign">
      <!-- 1. The operation: the legal transitions of the state of the field (§76). -->
      <label class="fw-assign__field">
        <span>Operacion</span>
        <select v-model="selectedOperation">
          <option v-for="option in availableOperations" :key="option" :value="option">
            {{ OPERATION_LABELS[option] }}
          </option>
        </select>
      </label>
      <p class="fw-assign__muted">
        <template v-if="field !== null">
          {{ field.name }} · {{ format.formatCount(units) }}
          {{ unitLabel(effectiveOperation, units) }}
        </template>
        <template v-else-if="plot !== null">
          {{ plot.name }} · {{ format.formatCount(units) }}
          {{ unitLabel(effectiveOperation, units) }}
        </template>
        <template v-else>
          {{ format.formatCount(units) }} {{ unitLabel(effectiveOperation, units) }} seleccionadas
        </template>
      </p>

      <!-- 2. The worker. Idle, of the same farm (§104 y §108). -->
      <label class="fw-assign__field">
        <span>Trabajador</span>
        <select v-model="selectedWorkerId">
          <option v-for="row in workerRows" :key="row.worker.id" :value="row.worker.id">
            {{ row.worker.name }} · habilidad {{ format.formatBp(row.worker.skillBp) }}
            <template v-if="!row.usable"> — {{ reasonOf(row.code) }}</template>
          </option>
        </select>
      </label>
      <UiEmptyState
        v-if="workerRows.length === 0"
        title="Sin plantilla"
        detail="Toda operacion exige un trabajador ocioso. Contrata en el pool antes de asignar."
      />

      <!-- 3. The machinery, with the reason of §90 on every row that does not work. -->
      <section>
        <h3 class="fw-assign__heading">
          Maquinaria
          <span>
            {{ reservedMachineTypes(effectiveOperation).map(labelOfMachineType).join(' + ') }} · §90
          </span>
        </h3>
        <UiEmptyState
          v-if="combinations.length === 0"
          title="Sin combinacion posible"
          :detail="blockingReason"
        />
        <ul v-else class="fw-assign__list">
          <li v-for="row in combinations" :key="row.key" class="fw-assign__row">
            <label class="fw-assign__choice">
              <input
                v-model="selectedCombinationKey"
                type="radio"
                name="fw-assign-machines"
                :value="row.key"
                :disabled="!row.usable"
              />
              <span class="fw-assign__name">
                {{ labelOfMachineType(row.powered.type) }}
                <template v-if="row.implement !== null">
                  + {{ labelOfMachineType(row.implement.type) }}
                </template>
              </span>
              <UiBadge :tone="row.usable ? 'neutral' : 'warning'">
                {{ format.formatBp(row.paceMachine.conditionBp) }}
              </UiBadge>
            </label>
            <p v-if="!row.usable" class="fw-assign__blocked">{{ reasonOf(row.code) }}</p>
          </li>
        </ul>
      </section>

      <!-- 4. The crop, only when the catalogue says the effectiveOperation sows. -->
      <template v-if="requiresCrop">
        <div class="fw-assign__families">
          <UiButton
            size="sm"
            :variant="familyFilter === null ? 'primary' : 'ghost'"
            @click="familyFilter = null"
          >
            Todos
          </UiButton>
          <UiButton
            v-for="family in CROP_FAMILIES"
            :key="family"
            size="sm"
            :variant="familyFilter === family ? 'primary' : 'ghost'"
            @click="familyFilter = family"
          >
            {{ CROP_FAMILY_LABELS[family] }}
          </UiButton>
        </div>
        <label class="fw-assign__field">
          <span>Cultivo</span>
          <select v-model="selectedCropId">
            <optgroup v-for="group in cropOptions" :key="group.family" :label="group.label">
              <option
                v-for="option in group.options"
                :key="option.cropId"
                :value="option.cropId"
                :disabled="!option.usable"
              >
                {{ option.label
                }}<template v-if="!option.usable">
                  — fuera de temporada ({{ option.seasons }})</template
                >
              </option>
            </optgroup>
          </select>
        </label>
        <p class="fw-assign__muted">
          Estacion: {{ SEASON_LABELS[season] }}. Un cultivo fuera de su ventana aparece pero no se
          puede sembrar; el ciclo que se pase del final de la ventana no se penaliza.
        </p>
        <p v-if="cropReason !== ''" class="fw-assign__blocked">{{ cropReason }}</p>
        <dl v-if="chosenCrop !== null" class="fw-assign__crop">
          <div>
            <dt>Ciclo</dt>
            <dd>{{ chosenCrop.growthDurationGameHours }} h</dd>
          </div>
          <div>
            <dt>Rendimiento</dt>
            <dd>{{ chosenCrop.baseYieldPerCellLiters }} L/celda</dd>
          </div>
          <div>
            <dt>Precio</dt>
            <dd>{{ format.formatMoney(chosenCrop.sellPricePerLiter) }} / L</dd>
          </div>
          <div>
            <dt>Almacen</dt>
            <dd>{{ STORAGE_CATEGORY_LABELS[chosenCrop.storageResource] }}</dd>
          </div>
        </dl>
      </template>

      <!-- The preview of §104: duration and cost, from the estimate route. -->
      <section class="fw-assign__preview">
        <h3 class="fw-assign__heading">Prevision <span>§91 · §104 · §114</span></h3>
        <div class="fw-assign__stats">
          <UiStat
            label="Duracion"
            :value="
              estimate !== null
                ? format.formatGameHours(BigInt(estimate.durationGameMs))
                : localEstimate !== null
                  ? `${localEstimate.durationGameHours.toFixed(1)} h`
                  : '—'
            "
            :tone="estimate === null ? 'muted' : 'neutral'"
            hint="Duracion en horas de juego, fijada una sola vez al iniciar la tarea (§91)"
          />
          <UiStat
            label="Coste de operacion"
            :value="
              estimate !== null ? format.formatMoney(fromWireMoney(estimate.operatingCost)) : '—'
            "
            hint="Se paga solo mientras la maquina trabaja (§94 y §114)"
          />
          <UiStat
            label="Salario del periodo"
            :value="
              estimate !== null ? format.formatMoney(fromWireMoney(estimate.workerWages)) : '—'
            "
            hint="Se devenga trabaje o no el trabajador (§107)"
          />
          <UiStat
            label="Desgaste"
            :value="estimate !== null ? format.formatBp(estimate.conditionLossBp, 2) : '—'"
            hint="Condicion que pierde la maquina que marca el ritmo (§93)"
          />
          <UiStat
            v-if="
              estimate !== null &&
              estimate.expectedProductionUnits !== null &&
              productionUnit !== null
            "
            label="Produccion prevista"
            :value="
              format.formatQuantity(
                estimate.expectedProductionUnits,
                productionUnit.displayDivisor,
                productionUnit.displayUnit,
              )
            "
            hint="Con la formula de rendimiento de la seccion 83"
          />
          <UiStat
            v-if="estimate !== null"
            label="Termina en"
            :value="format.formatGameDuration(BigInt(estimate.durationGameMs))"
            tone="muted"
            hint="Tiempo de juego que falta desde el instante de la prevision"
          />
        </div>
        <p v-if="estimating" class="fw-assign__muted">Calculando la prevision…</p>
        <p v-else-if="estimate === null && localEstimate !== null" class="fw-assign__muted">
          Prevision local provisional. La autoritativa la calcula el servidor.
        </p>
        <p
          v-if="estimate !== null && estimate.overflowUnits > 0 && productionUnit !== null"
          class="fw-assign__blocked"
        >
          No cabe todo:
          {{
            format.formatQuantity(
              estimate.overflowUnits,
              productionUnit.displayDivisor,
              productionUnit.displayUnit,
            )
          }}
          se desperdiciaran por falta de capacidad (§83 y §97).
        </p>
      </section>

      <!-- Every reason at once, as the estimate reports them. -->
      <ul v-if="serverBlockers.length > 0" class="fw-assign__blockers">
        <li v-for="blocker in serverBlockers" :key="blocker.code">{{ blocker.message }}</li>
      </ul>

      <p v-if="failure !== ''" class="fw-assign__failure">{{ failure }}</p>

      <div class="fw-assign__actions">
        <UiButton
          variant="primary"
          :disabled="!canSubmit"
          :busy="submitting"
          :reason="blockingReason"
          @click="submit"
        >
          Asignar {{ OPERATION_LABELS[effectiveOperation].toLowerCase() }}
        </UiButton>
        <UiButton variant="ghost" @click="shell.closeTopModal()">Cancelar</UiButton>
        <span v-if="blockingReason !== ''" class="fw-assign__blocked">{{ blockingReason }}</span>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-assign {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fw-assign__field {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-assign__field select {
  flex: 1 1 auto;
  min-width: 0;
}

.fw-assign__heading {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 0 6px;
  font-size: var(--fw-font-size, 14px);
}

.fw-assign__heading span {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-assign__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-assign__row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-assign__choice {
  display: flex;
  gap: 8px;
  align-items: center;
}

.fw-assign__name {
  flex: 1 1 auto;
  font-weight: 600;
}

.fw-assign__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-assign__preview {
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-assign__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-assign__blocked {
  margin: 0;
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-assign__families {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.fw-assign__crop {
  display: flex;
  flex-wrap: wrap;
  gap: var(--fw-gap-lg, 16px);
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-assign__crop dt {
  color: var(--fw-text-muted, #8b949e);
}

.fw-assign__crop dd {
  margin: 0;
}

.fw-assign__blockers {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding-left: 18px;
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-assign__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-assign__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
</style>
