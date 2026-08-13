<script setup lang="ts">
// The hiring pool: who is available, at what skill, at what price, and until when.
//
// Owner: W5-F. Panel `labor-pool` of the frozen registry. Surface: side panel of the staff
// tab.
//
// The pool of GDD section 102 is generated procedurally and per player, replaced whole, and
// refreshed after `poolRefreshInterval`, which the GDD names without giving a value; plan
// section 2.2 fixes it at 48 game hours. So the panel shows a countdown: a candidate the
// player is thinking about is an offer with an expiry, and hiding the expiry turns a
// decision into a surprise.
//
// The three figures each candidate is judged on come straight from the contract, and the
// derived one is computed here with the shared rule rather than read off the row: the skill
// factor of GDD section 103 is what the skill actually buys, since it is the multiplier
// that shortens every task the worker takes on (GDD section 91). Showing 62 % without
// showing x0.81 would leave the player comparing percentages that are not proportional to
// anything they can measure.
//
// Hiring is refused for three reasons and only three, in the order the server evaluates
// them (`hiring.ts`): the candidate is gone, the balance is negative, or there is no place
// in a worker home. The last one is the hard restriction of GDD section 108.
import { computed, ref } from 'vue';
import {
  hireBlockingCode,
  payrollAfterHire,
  refreshCountdown,
} from '~/components/panels/labor-pool/hiring';
import {
  derivedSkillFactor,
  formatSkillFactor,
  homeOccupancy,
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
import {
  BuildingType,
  POOL_REFRESH_INTERVAL_GAME_HOURS,
  VALIDATION_MESSAGES,
  fromWireMoney,
  type WorkerCandidateDto,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFarmsStore } from '~/stores/farms';
import { useLaborPoolStore } from '~/stores/laborPool';
import { usePlayerStore } from '~/stores/player';
import { useWorkersStore } from '~/stores/workers';

const props = withDefaults(defineProps<{ farmId?: string | null }>(), { farmId: null });

const farms = useFarmsStore();
const buildings = useBuildingsStore();
const laborPool = useLaborPoolStore();
const workers = useWorkersStore();
const player = usePlayerStore();
const shell = useShellUi();
const clock = useGameClock();
const api = useApi();
const format = useFormatting();

const failure = ref('');
/** Hire in flight. Local, because hiring moves no money and carries no idempotency key. */
const hiringId = ref<string | null>(null);

const farm = computed(() => {
  if (props.farmId !== null) {
    return farms.get(props.farmId) ?? farms.primary;
  }
  return farms.primary;
});

const activeFarmId = computed(() => farm.value?.id ?? '');

/**
 * Free places in the worker homes of the farm (GDD section 108), counted over the payroll
 * for the reason `homeOccupancy` states: the counter of the building only reaches the
 * client by frame, and the hire has to be refused or allowed on what the client can see.
 */
const freeHomeSlots = computed(
  () =>
    homeOccupancy(
      activeFarmId.value === ''
        ? []
        : buildings.ofType(activeFarmId.value, BuildingType.WORKER_HOME),
      activeFarmId.value === '' ? [] : workers.ofFarm(activeFarmId.value),
    ).free,
);

/** Countdown to the replacement of the pool (GDD section 102, plan section 2.2). */
const untilRefresh = computed(() => refreshCountdown(laborPool.nextRefresh, clock.gameMs.value));

const rows = computed(() =>
  laborPool.candidates.map((candidate) => {
    const code = hireBlockingCode({
      candidate,
      settledBalance: player.settledBalance,
      freeHomeSlots: freeHomeSlots.value,
    });
    return {
      candidate,
      factor: derivedSkillFactor(candidate.skillBp),
      asking: fromWireMoney(candidate.askingSalaryPerGameHour),
      payrollAfter: payrollAfterHire(workers.totalSalaryPerGameHour, candidate),
      reason: code === null ? '' : VALIDATION_MESSAGES[code],
      canHire: code === null && farm.value !== null,
      busy: hiringId.value === candidate.id,
    };
  }),
);

function openPayroll(): void {
  shell.openSidePanel('workers');
}

async function hire(candidate: WorkerCandidateDto): Promise<void> {
  const holding = farm.value;
  if (holding === null) {
    return;
  }
  failure.value = '';
  hiringId.value = candidate.id;
  const home = buildings.defaultHome(holding.id);
  try {
    await api.mutate('POST /api/workers/hire', {
      body: {
        candidateId: candidate.id,
        farmId: holding.id,
        // Named, so a refusal names the building the player has to extend; omitted, the
        // server picks the first home with room, which is the same choice.
        ...(home === null ? {} : { homeId: home.id }),
      },
      subjectKind: 'WORKER_CANDIDATE',
      subjectId: candidate.id,
    });
  } catch (error) {
    failure.value = isApiClientError(error) ? error.message : 'La peticion no pudo completarse.';
  } finally {
    hiringId.value = null;
  }
}
</script>

<template>
  <UiCard title="Pool de contratacion" subtitle="Candidatos, salario pedido y proximo refresco">
    <template #header>
      <UiButton size="sm" variant="ghost" @click="openPayroll">Ver plantilla</UiButton>
    </template>

    <div class="fw-pool">
      <div class="fw-pool__stats">
        <UiStat label="Candidatos" :value="format.formatCount(laborPool.count)" />
        <UiStat
          label="Proximo refresco"
          :value="format.formatGameDuration(untilRefresh)"
          hint="Intervalo del pool, en horas de juego"
        />
        <UiStat
          label="Plazas de vivienda"
          :value="format.formatCount(freeHomeSlots)"
          :tone="freeHomeSlots > 0 ? 'neutral' : 'warning'"
          hint="Restriccion dura de la seccion 108"
        />
        <UiStat
          label="Coste salarial actual"
          :value="format.formatRatePerGameHour(workers.totalSalaryPerGameHour)"
        />
      </div>

      <p class="fw-pool__muted">
        El pool se regenera cada {{ POOL_REFRESH_INTERVAL_GAME_HOURS }} horas de juego y no admite
        negociacion: el salario pedido es el salario (§102).
      </p>

      <p v-if="failure !== ''" class="fw-pool__failure">{{ failure }}</p>

      <UiEmptyState
        v-if="rows.length === 0"
        title="Sin candidatos"
        detail="El pool esta vacio hasta el proximo refresco."
      />

      <ul v-else class="fw-pool__list">
        <li v-for="row in rows" :key="row.candidate.id" class="fw-pool__row">
          <div class="fw-pool__rowhead">
            <span class="fw-pool__name">{{ row.candidate.name }}</span>
            <UiBadge tone="info">{{ formatSkillFactor(row.factor) }}</UiBadge>
            <span class="fw-pool__muted">Pide {{ format.formatRatePerGameHour(row.asking) }}</span>
          </div>

          <UiMeter label="Habilidad" :value-bp="row.candidate.skillBp" tone="accent" />
          <p class="fw-pool__muted">
            Factor de habilidad {{ formatSkillFactor(row.factor) }}: multiplica la velocidad de toda
            tarea que ejecute (§103).
          </p>
          <p class="fw-pool__muted">
            Coste salarial tras contratar
            {{ format.formatRatePerGameHour(row.payrollAfter) }}
          </p>

          <div class="fw-pool__actions">
            <UiButton
              size="sm"
              variant="primary"
              :disabled="!row.canHire"
              :busy="row.busy"
              :reason="row.reason"
              @click="hire(row.candidate)"
            >
              Contratar
            </UiButton>
            <span v-if="row.reason !== ''" class="fw-pool__blocked">{{ row.reason }}</span>
          </div>
        </li>
      </ul>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-pool {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fw-pool__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-pool__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-pool__row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-pool__rowhead {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.fw-pool__name {
  font-weight: 600;
}

.fw-pool__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-pool__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.fw-pool__blocked {
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-pool__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
