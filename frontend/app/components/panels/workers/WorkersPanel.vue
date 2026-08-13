<script setup lang="ts">
// The payroll: who works here, at what skill, at what wage and on what.
//
// Owner: W5-F. Panel `workers` of the frozen registry. Surface: side panel of the staff tab.
//
// Three readings the player decides on, and each has a section of the GDD behind it. The
// wage is continuous and is paid whether the worker is idle or working (GDD section 107),
// so the panel leads with the total per game hour rather than with a headcount. Housing is
// a hard restriction checked per building (GDD section 108), so the free places are shown
// next to it: a payroll that could not say why hiring is blocked would send the player to
// guess in the farm panel. And a worker in the middle of a task cannot be dismissed (GDD
// section 109), which is the one refusal this panel has to explain.
//
// The task is the authoritative link between a worker and a machine (plan section 5.2,
// ADR-0028): the row of a working worker reads its task and the task names the operation
// and the countdown. There is no `currentTask` text stored anywhere to go stale.
import { computed, ref } from 'vue';
import { labelOfBuildingType } from '~/components/panels/farm-overview/buildingPresentation';
import { OPERATION_LABELS } from '~/components/panels/legend/vocabulary';
import {
  derivedSkillFactor,
  fireBlockingCode,
  formatSkillFactor,
  homeOccupancy,
  isAtSkillCap,
  labelOfWorkerStatus,
  skillAfterNextTask,
  toneOfWorkerStatus,
} from '~/components/panels/workers/workerPresentation';
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
import { BuildingType, VALIDATION_MESSAGES, fromWireMoney, type WorkerDto } from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFarmsStore } from '~/stores/farms';
import { useTasksStore } from '~/stores/tasks';
import { useWorkersStore } from '~/stores/workers';

const props = withDefaults(defineProps<{ farmId?: string | null }>(), { farmId: null });

const farms = useFarmsStore();
const buildings = useBuildingsStore();
const workers = useWorkersStore();
const tasks = useTasksStore();
const shell = useShellUi();
const clock = useGameClock();
const api = useApi();
const format = useFormatting();

const chosenFarmId = ref<string | null>(null);
const failure = ref('');
const confirmingDismissal = ref<string | null>(null);
/**
 * Dismissal in flight. A local marker and not `stores/pending`: the pending store is
 * indexed by idempotency key, and firing moves no money and therefore carries none
 * (`shared/api/schemas/workers.ts`), so there would never be an entry to read.
 */
const dismissingId = ref<string | null>(null);

const farm = computed(() => {
  const wanted = chosenFarmId.value ?? props.farmId;
  if (wanted !== null) {
    return farms.get(wanted) ?? farms.primary;
  }
  return farms.primary;
});

const activeFarmId = computed(() => farm.value?.id ?? '');

const selectedFarmId = computed<string>({
  get: () => activeFarmId.value,
  set: (value) => {
    chosenFarmId.value = value;
  },
});

const payroll = computed(() =>
  activeFarmId.value === '' ? [] : workers.ofFarm(activeFarmId.value),
);

/**
 * Housing places: capacity from the buildings, occupancy from the payroll that names them.
 * `homeOccupancy` explains why it is not read off the counter (GDD section 108).
 */
const homeSlots = computed(() =>
  homeOccupancy(
    activeFarmId.value === '' ? [] : buildings.ofType(activeFarmId.value, BuildingType.WORKER_HOME),
    payroll.value,
  ),
);
const freeHomeSlots = computed(() => homeSlots.value.free);

/** Average skill of the payroll, in basis points. Zero with no staff, not undefined. */
const averageSkillBp = computed(() => {
  if (payroll.value.length === 0) {
    return 0;
  }
  const total = payroll.value.reduce((sum, worker) => sum + worker.skillBp, 0);
  return Math.round(total / payroll.value.length);
});

const rows = computed(() =>
  payroll.value.map((worker) => {
    const task = tasks.activeByWorkerId[worker.id] ?? null;
    const code = fireBlockingCode(worker);
    const home = buildings.get(worker.homeId);
    return {
      worker,
      statusLabel: labelOfWorkerStatus(worker.status),
      statusTone: toneOfWorkerStatus(worker.status),
      // Derived with the shared rule, and equal to the `skillFactor` the row carries.
      factor: derivedSkillFactor(worker.skillBp),
      nextSkillBp: skillAfterNextTask(worker.skillBp),
      atCap: isAtSkillCap(worker.skillBp),
      salary: fromWireMoney(worker.salaryPerGameHour),
      operationLabel: task === null ? null : OPERATION_LABELS[task.operation],
      remaining: task === null ? null : tasks.remainingGameMs(task.id, clock.gameMs.value),
      homeLabel: home === undefined ? null : labelOfBuildingType(home.type),
      reason: code === null ? '' : VALIDATION_MESSAGES[code],
      canFire: code === null,
      busy: dismissingId.value === worker.id,
    };
  }),
);

function openPool(): void {
  shell.openSidePanel('labor-pool');
}

async function fire(worker: WorkerDto): Promise<void> {
  failure.value = '';
  confirmingDismissal.value = null;
  dismissingId.value = worker.id;
  try {
    await api.mutate('POST /api/workers/:workerId/fire', {
      params: { workerId: worker.id },
      subjectKind: 'WORKER',
      subjectId: worker.id,
    });
  } catch (error) {
    failure.value = isApiClientError(error) ? error.message : 'La peticion no pudo completarse.';
  } finally {
    dismissingId.value = null;
  }
}
</script>

<template>
  <UiCard title="Trabajadores" subtitle="Plantilla, habilidad, salario y estado">
    <template #header>
      <UiButton size="sm" variant="ghost" @click="openPool">Ver candidatos</UiButton>
    </template>

    <UiEmptyState
      v-if="farm === null"
      title="Ninguna granja creada"
      detail="Un trabajador pertenece a una granja y vive en una de sus viviendas."
    />

    <div v-else class="fw-staff">
      <label v-if="farms.count > 1" class="fw-staff__field">
        <span>Granja</span>
        <select v-model="selectedFarmId">
          <option v-for="option in farms.all" :key="option.id" :value="option.id">
            {{ option.name }}
          </option>
        </select>
      </label>

      <div class="fw-staff__stats">
        <UiStat label="Plantilla" :value="format.formatCount(payroll.length)" />
        <UiStat
          label="Plazas de vivienda"
          :value="`${homeSlots.used} / ${homeSlots.total}`"
          :tone="freeHomeSlots > 0 ? 'neutral' : 'warning'"
          hint="Restriccion dura de la seccion 108, comprobada por edificio"
        />
        <UiStat
          label="Coste salarial"
          :value="format.formatRatePerGameHour(workers.totalSalaryPerGameHour)"
          hint="Se cobra siempre, este ocioso o trabajando (seccion 107)"
        />
        <UiStat label="Habilidad media" :value="format.formatBp(averageSkillBp)" tone="muted" />
      </div>

      <p v-if="failure !== ''" class="fw-staff__failure">{{ failure }}</p>

      <UiEmptyState
        v-if="rows.length === 0"
        title="Sin plantilla"
        detail="Ninguna tarea puede asignarse sin un trabajador ocioso. Los candidatos estan en el pool de contratacion."
      >
        <UiButton size="sm" variant="primary" @click="openPool">Ir al pool</UiButton>
      </UiEmptyState>

      <ul v-else class="fw-staff__list">
        <li v-for="row in rows" :key="row.worker.id" class="fw-staff__row">
          <div class="fw-staff__rowhead">
            <span class="fw-staff__name">{{ row.worker.name }}</span>
            <UiBadge :tone="row.statusTone">{{ row.statusLabel }}</UiBadge>
            <span class="fw-staff__muted">
              {{ format.formatRatePerGameHour(row.salary) }}
            </span>
          </div>

          <UiMeter label="Habilidad" :value-bp="row.worker.skillBp" tone="accent" />
          <p class="fw-staff__muted">
            Factor {{ formatSkillFactor(row.factor) }} · {{ row.worker.completedTaskCount }} tareas
            completadas ·
            <template v-if="row.atCap">habilidad en el techo de la seccion 103</template>
            <template v-else> tras la siguiente, {{ format.formatBp(row.nextSkillBp) }} </template>
          </p>

          <p class="fw-staff__muted">
            <template v-if="row.operationLabel !== null">
              {{ row.operationLabel }}
              <template v-if="row.remaining !== null">
                · termina en {{ format.formatGameDuration(row.remaining) }}
              </template>
            </template>
            <template v-else>Sin tarea en curso</template>
            <template v-if="row.homeLabel !== null"> · {{ row.homeLabel }}</template>
          </p>

          <div class="fw-staff__actions">
            <template v-if="confirmingDismissal !== row.worker.id">
              <UiButton
                size="sm"
                variant="danger"
                :disabled="!row.canFire"
                :busy="row.busy"
                :reason="row.reason"
                @click="confirmingDismissal = row.worker.id"
              >
                Despedir
              </UiButton>
            </template>
            <template v-else>
              <UiButton size="sm" variant="danger" :busy="row.busy" @click="fire(row.worker)">
                Confirmar despido
              </UiButton>
              <UiButton size="sm" variant="ghost" @click="confirmingDismissal = null">
                Cancelar
              </UiButton>
            </template>
            <span v-if="row.reason !== ''" class="fw-staff__blocked">{{ row.reason }}</span>
          </div>
        </li>
      </ul>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-staff {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fw-staff__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-staff__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-staff__row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-staff__rowhead {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.fw-staff__name {
  font-weight: 600;
}

.fw-staff__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-staff__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.fw-staff__blocked {
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-staff__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-staff__field {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
