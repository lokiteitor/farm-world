<script setup lang="ts">
// Active tasks, their countdown, and what cancelling one really costs.
//
// Owner: W6-D. Panel `task-list` of the frozen registry. Surface: side panel of the tasks tab.
//
// The countdown is the most read figure of an idle game and it is the one most easily got
// wrong. Two rules hold it up, both inherited and neither negotiable here.
//
// It never asks the server for the time. The instant comes from `useGameClock`, which
// extrapolates locally from the anchor with the rational multiplier of ADR-0007 using the
// very function the server schedules with, so the bar advances between replies and cannot
// drift by construction of the arithmetic (plan section 7). `progressBp` does travel on the
// row, and it is correct at the instant of the reply only; showing it would produce a bar
// that freezes for a minute and then jumps.
//
// A finished task stops where it stopped. `endedGameMs` differs from the scheduled end
// exactly when the task was cancelled, and `taskProgressBp` of `shared/taskProgress.ts` caps
// the numerator with it, so a cancelled task never keeps filling towards a completion that
// is not going to happen (GDD section 106).
//
// Cancellation is the other half of this panel and it is written as a warning and not as a
// button, because GDD section 106 is a genuinely destructive rule: the model is all or
// nothing, the field stays in the state it was in before, and the partial progress is lost
// entirely. Plan section 2.2 adds the two consequences the GDD leaves open and the player
// has to be told: nothing is refunded, and the wear of the hours actually worked is applied
// all the same. So the confirmation states the hours that will have been paid for nothing,
// computed from the same clock the countdown uses.
import { computed, ref } from 'vue';
import { OPERATION_LABELS } from '~/components/panels/legend/vocabulary';
import { labelOfMachineType } from '~/components/panels/machinery/machineryPresentation';
import {
  byMostRecentlyEnded,
  byNextToFinish,
  scheduledDurationGameMs,
  taskProgressBp,
  taskRemainingGameMs,
  workedGameHours,
} from '~/components/panels/shared/taskProgress';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiMeter from '~/components/ui/UiMeter.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import { isApiClientError } from '~/net/errors';
import {
  STORAGE_RESOURCE_UNITS,
  TaskStatus,
  VALIDATION_MESSAGES,
  ValidationCode,
  gameMs,
  type GameMs,
  type TaskDto,
} from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { useForestryStore } from '~/stores/forestry';
import { useMachinesStore } from '~/stores/machines';
import { useTasksStore } from '~/stores/tasks';
import { useWorkersStore } from '~/stores/workers';

const props = withDefaults(
  defineProps<{
    /**
     * Instant the countdowns are drawn at. Injected so a suite drives the clock.
     *
     * Declared as a plain `bigint` and branded below rather than declared as `GameMs`: the
     * runtime type of a property is inferred from its written type, and a branded bigint is
     * an intersection, which the compiler can only turn into `Object`. Declaring it that way
     * made every mount that passed the instant emit an "expected Object, got BigInt"
     * warning, which is noise in the console of a panel whose whole point is the clock.
     */
    atGameMs?: bigint | null;
  }>(),
  { atGameMs: null },
);

const tasks = useTasksStore();
const fields = useFieldsStore();
const forestry = useForestryStore();
const workers = useWorkersStore();
const machines = useMachinesStore();
const shell = useShellUi();
const clock = useGameClock();
const api = useApi();
const format = useFormatting();

const failure = ref('');
const confirmingCancel = ref<string | null>(null);
const cancelling = ref<string | null>(null);

/** The clock of the panel: the injected instant when there is one, the local one otherwise. */
const now = computed<GameMs>(() =>
  props.atGameMs === null ? clock.gameMs.value : gameMs(props.atGameMs),
);

/** What the task is being done to, named as the interface names it. */
function targetName(task: TaskDto): string {
  if (task.targetFieldId !== null) {
    return fields.get(task.targetFieldId)?.name ?? 'Campo';
  }
  if (task.targetForestPlotId !== null) {
    return forestry.get(task.targetForestPlotId)?.name ?? 'Parcela forestal';
  }
  return 'Celdas seleccionadas';
}

function machineNames(task: TaskDto): string {
  return task.machineIds
    .map((id) => {
      const machine = machines.get(id);
      return machine === undefined ? id : labelOfMachineType(machine.type);
    })
    .join(' + ');
}

interface TaskRow {
  readonly task: TaskDto;
  readonly operationLabel: string;
  readonly targetLabel: string;
  readonly workerName: string;
  readonly machinesLabel: string;
  readonly progressBp: number;
  readonly remainingGameMs: bigint | null;
  readonly workedGameHours: number;
  readonly durationGameMs: bigint;
  readonly cancelCode: ValidationCode | null;
  readonly productionLabel: string | null;
}

function rowOf(task: TaskDto): TaskRow {
  const worker = workers.get(task.workerId);
  const unit =
    task.reservedStorageUnits === null
      ? null
      : task.operation === 'FELL'
        ? STORAGE_RESOURCE_UNITS.WOOD_M3
        : STORAGE_RESOURCE_UNITS.WHEAT_LITERS;
  return {
    task,
    operationLabel: OPERATION_LABELS[task.operation],
    targetLabel: targetName(task),
    workerName: worker?.name ?? task.workerId,
    machinesLabel: machineNames(task),
    progressBp: taskProgressBp(task, now.value),
    remainingGameMs: taskRemainingGameMs(task, now.value),
    workedGameHours: workedGameHours(task, now.value),
    durationGameMs: scheduledDurationGameMs(task),
    // The one refusal this panel can produce: a task that is no longer running, or one the
    // server marked as not cancelable (`shared/api/schemas/tasks.ts`).
    cancelCode:
      task.status !== TaskStatus.IN_PROGRESS
        ? ValidationCode.TASK_ALREADY_FINISHED
        : task.cancelable
          ? null
          : ValidationCode.TASK_NOT_CANCELABLE,
    productionLabel:
      task.reservedStorageUnits === null || unit === null
        ? null
        : format.formatQuantity(task.reservedStorageUnits, unit.displayDivisor, unit.displayUnit),
  };
}

const activeRows = computed(() => [...tasks.active].sort(byNextToFinish).map(rowOf));
const historyRows = computed(() => [...tasks.finished].sort(byMostRecentlyEnded).map(rowOf));

/** Sum of the countdowns, which is what the tasks tab shows as "what is still to happen". */
const nextToFinish = computed(() => activeRows.value[0] ?? null);

function reasonOf(code: ValidationCode | null): string {
  return code === null ? '' : VALIDATION_MESSAGES[code];
}

function statusLabel(task: TaskDto): string {
  switch (task.status) {
    case TaskStatus.IN_PROGRESS:
      return 'En curso';
    case TaskStatus.COMPLETED:
      return 'Completada';
    case TaskStatus.CANCELED:
      return 'Cancelada';
  }
}

function statusTone(task: TaskDto): 'accent' | 'neutral' | 'warning' {
  switch (task.status) {
    case TaskStatus.IN_PROGRESS:
      return 'accent';
    case TaskStatus.COMPLETED:
      return 'neutral';
    case TaskStatus.CANCELED:
      return 'warning';
  }
}

async function cancel(task: TaskDto): Promise<void> {
  failure.value = '';
  confirmingCancel.value = null;
  cancelling.value = task.id;
  try {
    await api.mutate('POST /api/tasks/:taskId/cancel', {
      params: { taskId: task.id },
      subjectKind: 'TASK',
      subjectId: task.id,
    });
  } catch (error) {
    failure.value = isApiClientError(error) ? error.message : 'La cancelacion no pudo completarse.';
  } finally {
    cancelling.value = null;
  }
}

function inspect(task: TaskDto): void {
  if (task.targetFieldId !== null) {
    shell.openSidePanel('field-inspector', { fieldId: task.targetFieldId });
    return;
  }
  if (task.targetForestPlotId !== null) {
    shell.openSidePanel('forest-plot', { forestPlotId: task.targetForestPlotId });
  }
}
</script>

<template>
  <UiCard title="Tareas" subtitle="Cuenta atras en vivo y cancelacion advertida">
    <div class="fw-tasks">
      <div class="fw-tasks__stats">
        <UiStat label="En curso" :value="format.formatCount(activeRows.length)" />
        <UiStat
          label="Proxima en terminar"
          :value="
            nextToFinish === null || nextToFinish.remainingGameMs === null
              ? '—'
              : format.formatGameDuration(nextToFinish.remainingGameMs)
          "
          hint="Tiempo de juego, extrapolado localmente desde el ancla del reloj"
        />
        <UiStat label="Historial" :value="format.formatCount(historyRows.length)" tone="muted" />
      </div>

      <p v-if="failure !== ''" class="fw-tasks__failure">{{ failure }}</p>

      <section>
        <h3 class="fw-tasks__heading">Activas <span>§105 · §106</span></h3>
        <UiEmptyState
          v-if="activeRows.length === 0"
          title="Ninguna tarea en curso"
          detail="Abre un campo o una parcela forestal y asigna una operacion a un trabajador ocioso."
        />
        <ul v-else class="fw-tasks__list">
          <li v-for="row in activeRows" :key="row.task.id" class="fw-tasks__row">
            <div class="fw-tasks__rowhead">
              <span class="fw-tasks__name">{{ row.operationLabel }} · {{ row.targetLabel }}</span>
              <UiBadge :tone="statusTone(row.task)">{{ statusLabel(row.task) }}</UiBadge>
            </div>

            <UiMeter label="Progreso" :value-bp="row.progressBp" tone="accent" />

            <p class="fw-tasks__muted">
              Termina en
              <span class="fw-tasks__countdown">
                {{
                  row.remainingGameMs === null
                    ? 'ahora'
                    : format.formatGameDuration(row.remainingGameMs)
                }}
              </span>
              · duracion {{ format.formatGameHours(row.durationGameMs) }}
            </p>
            <p class="fw-tasks__muted">
              {{ row.workerName }} · {{ row.machinesLabel }}
              <template v-if="row.productionLabel !== null">
                · reserva {{ row.productionLabel }}
              </template>
            </p>

            <div class="fw-tasks__actions">
              <UiButton size="sm" variant="ghost" @click="inspect(row.task)">Ver objetivo</UiButton>
              <template v-if="confirmingCancel !== row.task.id">
                <UiButton
                  size="sm"
                  variant="danger"
                  :disabled="row.cancelCode !== null"
                  :reason="reasonOf(row.cancelCode)"
                  @click="confirmingCancel = row.task.id"
                >
                  Cancelar
                </UiButton>
              </template>
              <template v-else>
                <UiButton
                  size="sm"
                  variant="danger"
                  :busy="cancelling === row.task.id"
                  @click="cancel(row.task)"
                >
                  Confirmar cancelacion
                </UiButton>
                <UiButton size="sm" variant="ghost" @click="confirmingCancel = null">
                  Seguir
                </UiButton>
              </template>
            </div>

            <p v-if="confirmingCancel === row.task.id" class="fw-tasks__warning">
              El progreso se pierde por completo: el objetivo se queda en el estado anterior y no
              hay progreso parcial (§106). No se reembolsa nada, y el desgaste de las
              {{ row.workedGameHours.toFixed(1) }} h ya trabajadas se aplica igual.
            </p>
          </li>
        </ul>
      </section>

      <section v-if="historyRows.length > 0">
        <h3 class="fw-tasks__heading">Historial <span>§111</span></h3>
        <ul class="fw-tasks__list">
          <li v-for="row in historyRows" :key="row.task.id" class="fw-tasks__row">
            <div class="fw-tasks__rowhead">
              <span class="fw-tasks__name">{{ row.operationLabel }} · {{ row.targetLabel }}</span>
              <UiBadge :tone="statusTone(row.task)">{{ statusLabel(row.task) }}</UiBadge>
            </div>
            <UiMeter
              :value-bp="row.progressBp"
              :tone="statusTone(row.task) === 'warning' ? 'warning' : 'neutral'"
            />
            <p class="fw-tasks__muted">
              {{ row.workerName }} · {{ row.machinesLabel }} ·
              {{ row.workedGameHours.toFixed(1) }} h trabajadas
            </p>
          </li>
        </ul>
      </section>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-tasks {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fw-tasks__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-tasks__heading {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 0 6px;
  font-size: var(--fw-font-size, 14px);
}

.fw-tasks__heading span {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-tasks__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-tasks__row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-tasks__rowhead {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.fw-tasks__name {
  font-weight: 600;
}

.fw-tasks__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-tasks__countdown {
  font-family: var(--fw-font-mono, monospace);
  font-variant-numeric: tabular-nums;
}

.fw-tasks__warning {
  margin: 0;
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-tasks__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-tasks__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
</style>
