<script setup lang="ts">
// The field inspector: where one field is in its cycle, and what can be done to it now.
//
// Owner: W4-E. Surface: side panel of the fields tab.
//
// It is the panel the agricultural loop is played from, so it shows the loop itself: the
// eight states of GDD sections 41 and 76 as a track with the current one marked, and under
// it the three attributes that decide the yield of GDD section 83 -- fertility of GDD
// section 77, weeds of GDD section 78 and fertilisation of GDD section 79.
//
// Every number is projected locally and never read off the reply alone. The row carries
// each attribute together with the instant it was settled at (plan section 6.5), and
// `stores/fields.ts` projects the pair to the reading of the extrapolating clock with the
// very functions of `shared/rules/yield.ts` the server settles with. The consequence worth
// stating: the weed bar moves while the panel is open, the estimate of when the field will
// be ready is computed from the anchor and not asked for, and the expected yield is the
// figure the harvest will actually produce rather than an approximation of it.
//
// The stored state and the projected state are shown apart when they differ. A field whose
// materialising job has not run yet is still in its stored state on the row while the
// projection has already moved on, and the server validates against the projection
// (plan section 6.5): hiding the difference would make the panel look wrong to anyone
// comparing it with the database, and showing only the stored one would refuse an operation
// the server accepts.
import { computed, watch } from 'vue';
import { ensureFieldGeometry } from '~/components/panels/cell-inspector/worldAccess';
import { formatArea } from '~/components/panels/legend/units';
import {
  CROP_LABELS,
  CROP_STATE_DETAILS,
  CROP_STATE_LABELS,
  OPERATION_LABELS,
  SOIL_CONDITION_LABELS,
  cropStateColour,
} from '~/components/panels/legend/vocabulary';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiMeter from '~/components/ui/UiMeter.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import {
  CROPS,
  CROP_CYCLE_STATES,
  CropCycleState,
  CropId,
  VALIDATION_MESSAGES,
  ValidationCode,
  fromWireGameMs,
  type TaskOperation,
} from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { operationsFromState, useFieldsStore } from '~/stores/fields';
import { useTasksStore } from '~/stores/tasks';
import { useWorldStore } from '~/stores/world';

const props = defineProps<{ fieldId?: string }>();

const fields = useFieldsStore();
const tasks = useTasksStore();
const farms = useFarmsStore();
const world = useWorldStore();
const shell = useShellUi();
const bridge = useGameBridge();
const clock = useGameClock();
const api = useApi();
const format = useFormatting();

/** The field the panel was opened with, or the first one so the panel is never blank. */
const field = computed(() => {
  if (props.fieldId !== undefined) {
    return fields.get(props.fieldId) ?? null;
  }
  return fields.all[0] ?? null;
});

const projection = computed(() =>
  field.value === null ? null : fields.projectAt(field.value.id, clock.gameMs.value),
);

const state = computed(
  () => projection.value?.cropCycleState ?? field.value?.cropCycleState ?? CropCycleState.VIRGIN,
);

/** True when the materialising job has not caught up with the projection yet. */
const stateDrifted = computed(
  () => field.value !== null && field.value.cropCycleState !== state.value,
);

const crop = computed(() => CROPS[field.value?.cropId ?? CropId.WHEAT]);
const farm = computed(() =>
  field.value?.farmId == null ? null : (farms.get(field.value.farmId) ?? null),
);
const task = computed(() =>
  field.value === null ? null : (tasks.activeByFieldId[field.value.id] ?? null),
);

const yieldBreakdown = computed(() =>
  field.value === null ? null : fields.expectedYieldAt(field.value.id, clock.gameMs.value),
);

/**
 * When the field reaches `READY_TO_HARVEST`, extrapolated locally.
 *
 * The instant comes from the projection of the crop phases, which is a function of the
 * sowing instant and of the phase durations of the catalogue, and the countdown is the
 * difference with the reading of the local clock. No request is involved, which is the
 * whole point of plan section 7: nothing in this interface asks the server what time it is.
 */
const readyAt = computed(() => projection.value?.readyAtGameMs ?? null);
const readyIn = computed(() => {
  const at = readyAt.value;
  if (at === null) {
    return null;
  }
  const remaining = at - clock.gameMs.value;
  return remaining > 0n ? remaining : 0n;
});

const nextBoundary = computed(() => projection.value?.nextBoundaryGameMs ?? null);
const nextBoundaryIn = computed(() => {
  const at = nextBoundary.value;
  if (at === null) {
    return null;
  }
  const remaining = at - clock.gameMs.value;
  return remaining > 0n ? remaining : 0n;
});

const taskRemaining = computed(() =>
  task.value === null ? null : tasks.remainingGameMs(task.value.id, clock.gameMs.value),
);
const taskProgressBp = computed(() =>
  task.value === null ? 0 : tasks.progressBpAt(task.value.id, clock.gameMs.value),
);

/**
 * The operations the projected state admits (GDD section 76, table of GDD section 90).
 *
 * `operationsFromState` reads the shared transition table of `shared/config/transitions.ts`
 * rather than a switch, which is what lets a test cross it with the machinery requirements;
 * two switches cross with nothing. It is evaluated on the projected state and not on the
 * stored one, because the projection is what the server validates against.
 */
const projectedOperations = computed<readonly TaskOperation[]>(() =>
  operationsFromState(state.value),
);

/** The list the reply carried, computed by the server at the instant of that reply. */
const serverOperations = computed<readonly TaskOperation[]>(() =>
  field.value === null ? [] : fields.availableOperations(field.value.id),
);

/** The union. The projected ones first, which is the order of the cycle. */
const offeredOperations = computed<readonly TaskOperation[]>(() => [
  ...new Set<TaskOperation>([...projectedOperations.value, ...serverOperations.value]),
]);

/** Why an operation cannot be ordered, or null when it can (GDD section 104). */
function blockedReason(operation: TaskOperation): string | null {
  if (task.value !== null) {
    return VALIDATION_MESSAGES[ValidationCode.FIELD_HAS_ACTIVE_TASK];
  }
  if (!projectedOperations.value.includes(operation)) {
    return VALIDATION_MESSAGES[ValidationCode.FIELD_STATE_NOT_ALLOWED];
  }
  return null;
}

/** The `reason` prop of one operation button, or nothing: `exactOptionalPropertyTypes`. */
function reasonProps(operation: TaskOperation): Record<string, string> {
  const reason = blockedReason(operation);
  return reason === null ? {} : { reason };
}

function assign(operation: TaskOperation): void {
  const current = field.value;
  if (current === null || blockedReason(operation) !== null) {
    return;
  }
  shell.openModal('task-assign', { fieldId: current.id, operation });
}

function editGeometry(mode: 'EXTEND' | 'SPLIT' | 'MERGE'): void {
  const current = field.value;
  if (current !== null) {
    shell.openModal('field-edit', { fieldId: current.id, mode });
  }
}

function centre(): void {
  const current = field.value;
  const first = current === null ? undefined : fields.cellsOf(current.id)[0];
  if (first !== undefined) {
    bridge.emit('camera:goto', { cellX: first.cellX, cellY: first.cellY, smooth: true });
  }
}

/** The geometry of the field, which the listing does not carry, for the camera jump. */
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
    } catch {
      // The camera jump degrades to doing nothing; the panel says everything else.
    }
  },
  { immediate: true },
);

function stepTone(step: CropCycleState): 'past' | 'current' | 'future' {
  const currentIndex = CROP_CYCLE_STATES.indexOf(state.value);
  const stepIndex = CROP_CYCLE_STATES.indexOf(step);
  if (stepIndex === currentIndex) {
    return 'current';
  }
  return stepIndex < currentIndex ? 'past' : 'future';
}
</script>

<template>
  <UiCard
    :title="field?.name ?? 'Inspector de campo'"
    :subtitle="
      field === null
        ? 'Sin campo seleccionado'
        : `${format.formatCount(field.cellCount)} celdas · ${formatArea(field.cellCount, world.cellSizeM)}${farm === null ? '' : ` · ${farm.name}`}`
    "
  >
    <template #header>
      <UiButton size="sm" variant="ghost" :disabled="field === null" @click="centre">
        Centrar
      </UiButton>
    </template>

    <UiEmptyState
      v-if="field === null"
      title="Ningun campo"
      detail="Crea un campo sobre celdas propias, contiguas y aptas para agricultura."
    />

    <template v-else>
      <ol class="fw-field__track" aria-label="Estados del ciclo de cultivo">
        <li
          v-for="step in CROP_CYCLE_STATES"
          :key="step"
          class="fw-field__step"
          :class="`fw-field__step--${stepTone(step)}`"
          :aria-current="stepTone(step) === 'current' ? 'step' : undefined"
          :title="CROP_STATE_DETAILS[step]"
        >
          <span class="fw-field__stepDot" :style="{ background: cropStateColour(step) }" />
          <span class="fw-field__stepLabel">{{ CROP_STATE_LABELS[step] }}</span>
        </li>
      </ol>

      <p v-if="stateDrifted" class="fw-small fw-muted">
        Estado almacenado {{ CROP_STATE_LABELS[field.cropCycleState] }}; la proyeccion ya esta en
        {{ CROP_STATE_LABELS[state] }}. El trabajo que materializa la transicion todavia no ha
        corrido y la validacion del servidor acepta la proyeccion.
      </p>

      <dl class="fw-field__facts">
        <dt>Cultivo</dt>
        <dd>{{ field.cropId === null ? 'Sin sembrar' : CROP_LABELS[field.cropId] }}</dd>
        <dt>Suelo</dt>
        <dd>{{ SOIL_CONDITION_LABELS[field.soilCondition] }}</dd>
        <dt>Siguiente transicion</dt>
        <dd class="fw-mono">
          {{ nextBoundaryIn === null ? '—' : format.formatGameDuration(nextBoundaryIn) }}
        </dd>
        <dt>Listo para cosechar</dt>
        <dd class="fw-mono">
          {{ readyIn === null ? '—' : format.formatGameDuration(readyIn) }}
        </dd>
      </dl>

      <div class="fw-field__meters">
        <UiMeter label="Fertilidad" :value-bp="projection?.fertilityBp ?? 0" tone="accent" />
        <UiMeter
          label="Malezas"
          :value-bp="projection?.weedLevelBp ?? 0"
          tone="warning"
          :warn-above-bp="5000"
        />
        <UiMeter
          label="Fertilizacion"
          :value-bp="projection?.fertilizationBp ?? 0"
          tone="neutral"
        />
        <UiMeter
          label="Progreso de crecimiento"
          :value-bp="projection?.growthProgressBp ?? 0"
          tone="accent"
        />
      </div>

      <section v-if="yieldBreakdown !== null" class="fw-field__yield">
        <h3 class="fw-small fw-muted">Rendimiento previsto</h3>
        <p class="fw-field__yieldValue fw-mono">
          {{ format.formatQuantity(yieldBreakdown.liters, 1, 'L') }}
        </p>
        <p class="fw-small fw-muted">
          Base {{ format.formatQuantity(yieldBreakdown.baseLiters, 1, 'L') }} · fertilidad x{{
            yieldBreakdown.fertilityMultiplier.toFixed(2)
          }}
          · fertilizacion x{{ yieldBreakdown.fertilizationMultiplier.toFixed(2) }} · malezas -{{
            (yieldBreakdown.weedPenalty * 100).toFixed(1)
          }}
          %
        </p>
        <p class="fw-small fw-muted">
          {{ format.formatQuantity(crop.baseYieldPerCellLiters, 1, 'L') }} por celda antes de
          multiplicadores (§82).
        </p>
      </section>

      <section v-if="task !== null" class="fw-field__task">
        <h3 class="fw-small fw-muted">Tarea en curso</h3>
        <p>
          <UiBadge tone="info">{{ OPERATION_LABELS[task.operation] }}</UiBadge>
          <span class="fw-mono">
            {{ taskRemaining === null ? '—' : format.formatGameDuration(taskRemaining) }}
          </span>
        </p>
        <UiMeter label="Progreso de la tarea" :value-bp="taskProgressBp" tone="accent" />
        <p class="fw-small fw-muted">
          En marcha desde hace
          {{ format.formatGameDuration(clock.gameMs.value - fromWireGameMs(task.startGameMs)) }}.
        </p>
      </section>
    </template>

    <template v-if="field !== null" #footer>
      <div class="fw-field__actions">
        <UiButton
          v-for="operation in offeredOperations"
          :key="operation"
          size="sm"
          variant="primary"
          :disabled="blockedReason(operation) !== null"
          v-bind="reasonProps(operation)"
          @click="assign(operation)"
        >
          {{ OPERATION_LABELS[operation] }}
        </UiButton>
        <span v-if="offeredOperations.length === 0" class="fw-small fw-muted">
          El estado actual no admite ninguna operacion: la siguiente transicion es automatica.
        </span>
      </div>
      <div class="fw-field__actions fw-field__actions--geometry">
        <UiButton size="sm" @click="editGeometry('EXTEND')">Ampliar</UiButton>
        <UiButton size="sm" @click="editGeometry('SPLIT')">Dividir</UiButton>
        <UiButton size="sm" @click="editGeometry('MERGE')">Fusionar</UiButton>
      </div>
    </template>
  </UiCard>
</template>

<style scoped>
.fw-field__track {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.fw-field__step {
  display: flex;
  gap: 4px;
  align-items: center;
  font-size: 11px;
}

.fw-field__stepDot {
  width: 8px;
  height: 8px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: 50%;
}

.fw-field__step--past .fw-field__stepLabel {
  color: var(--fw-text-muted, #9aa4b2);
  text-decoration: line-through;
}

.fw-field__step--current .fw-field__stepLabel {
  color: var(--fw-text, #e6e9ee);
  font-weight: 600;
}

.fw-field__step--future .fw-field__stepLabel {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-field__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 0 0 10px;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-field__facts dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-field__facts dd {
  margin: 0;
  text-align: right;
}

.fw-field__meters {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fw-field__yield,
.fw-field__task {
  margin-top: 12px;
}

.fw-field__yield h3,
.fw-field__task h3 {
  margin: 0 0 2px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fw-field__yieldValue {
  margin: 0;
  font-size: var(--fw-font-size-lg, 16px);
}

.fw-field__task p {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 4px;
}

.fw-field__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.fw-field__actions--geometry {
  margin-top: 6px;
}
</style>
