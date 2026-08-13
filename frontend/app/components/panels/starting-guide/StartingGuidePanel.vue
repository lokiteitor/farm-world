<script setup lang="ts">
// The starting guide: the staged purchase sequence the balance of the opening requires.
//
// Owner: W5-F. Panel `starting-guide` of the frozen registry. Surface: side panel of the
// help tab.
//
// GDD section 119 states the problem without softening it: with the illustrative values of
// the GDD, the first cycle in isolation is not profitable, and GDD section 120 answers it
// with three levers, of which the one the player controls is the staged purchase. So this
// panel is not a tutorial of the interface. It is the one place that says, with the figures
// of the catalogue rather than with encouragement, that buying the combine on day one costs
// maintenance for the two hundred and thirty hours before it is first used.
//
// The sequence advances with the holding and not with a stored progress counter: every step
// is checked against the stores, so a player who bought the silo in another session finds it
// ticked, and a machine is due when a field of the holding reaches the state its operation
// departs from. There is nothing to reset and nothing that can disagree with the world.
//
// The three figures at the top come from `shared/rules/balance.ts`, the same functions
// `tools/balance` emits the report of GDD section 125 with.
import { computed } from 'vue';
import { CROP_STATE_LABELS } from '~/components/panels/legend/vocabulary';
import {
  StepStatus,
  evaluateSequence,
  startingBudget,
  type EvaluatedStep,
} from '~/components/panels/starting-guide/steps';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiMeter from '~/components/ui/UiMeter.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useFormatting } from '~/composables/useFormatting';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import { CropCycleState, Money, type BuildingType, type MachineType } from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFarmsStore } from '~/stores/farms';
import { useFieldsStore } from '~/stores/fields';
import { useMachinesStore } from '~/stores/machines';
import { usePlayerStore } from '~/stores/player';
import { useWorkersStore } from '~/stores/workers';

const farms = useFarmsStore();
const buildings = useBuildingsStore();
const fields = useFieldsStore();
const machines = useMachinesStore();
const workers = useWorkersStore();
const player = usePlayerStore();
const shell = useShellUi();
const clock = useGameClock();
const format = useFormatting();

const budget = startingBudget();

const farm = computed(() => farms.primary);

/**
 * Furthest state any field of the holding has reached, projected to the local clock.
 *
 * The projection and not the stored column, for the reason ADR-0035 gives: the materialising
 * job may lag behind, the server validates against the projection, and a guide that told the
 * player to wait for a transition that has already happened would be wrong in the direction
 * that costs a cycle.
 */
const furthestFieldState = computed<CropCycleState | null>(() => {
  const holding = farm.value;
  if (holding === null) {
    return null;
  }
  const owned = fields.all.filter((field) => field.farmId === holding.id);
  let furthest: CropCycleState | null = null;
  let best = -1;
  for (const field of owned) {
    const projected = fields.projectAt(field.id, clock.gameMs.value);
    const state = projected?.cropCycleState ?? field.cropCycleState;
    const index = Object.values(CropCycleState).indexOf(state);
    if (index > best) {
      best = index;
      furthest = state;
    }
  }
  return furthest;
});

const situation = computed(() => {
  const holding = farm.value;
  return {
    hasFarm: holding !== null,
    buildingTypes:
      holding === null
        ? []
        : (buildings.ofFarm(holding.id).map((building) => building.type) as BuildingType[]),
    fieldCount:
      holding === null ? 0 : fields.all.filter((field) => field.farmId === holding.id).length,
    workerCount: holding === null ? 0 : workers.ofFarm(holding.id).length,
    ownedMachineTypes:
      holding === null
        ? []
        : (machines.ofFarm(holding.id).map((machine) => machine.type) as MachineType[]),
    furthestFieldState: furthestFieldState.value,
  };
});

const rows = computed<readonly EvaluatedStep[]>(() => evaluateSequence(situation.value));

const doneRows = computed(() => rows.value.filter((row) => row.status === StepStatus.DONE));
const doneCount = computed(() => doneRows.value.length);
const dueRows = computed(() => rows.value.filter((row) => row.status === StepStatus.DUE));
const laterRows = computed(() => rows.value.filter((row) => row.status === StepStatus.LATER));

/** Cost of everything still due, which is what the player has to have in hand next. */
const dueCost = computed(() => Money.sum(dueRows.value.map((row) => row.step.cost)));

const progressBp = computed(() =>
  rows.value.length === 0 ? 0 : Math.round((doneCount.value / rows.value.length) * 10_000),
);

function toneOf(status: StepStatus): 'accent' | 'warning' | 'neutral' {
  if (status === StepStatus.DONE) {
    return 'accent';
  }
  return status === StepStatus.DUE ? 'warning' : 'neutral';
}

function labelOf(status: StepStatus): string {
  if (status === StepStatus.DONE) {
    return 'Hecho';
  }
  return status === StepStatus.DUE ? 'Ahora' : 'Todavia no';
}

function goTo(row: EvaluatedStep): void {
  switch (row.step.kind) {
    case 'FARM':
    case 'BUILDING':
      shell.openSidePanel('farm-overview');
      return;
    case 'FIELD':
      shell.openSidePanel('field-list');
      return;
    case 'WORKER':
      shell.openSidePanel('labor-pool');
      return;
    case 'MACHINE':
      shell.openSidePanel('machinery');
  }
}
</script>

<template>
  <UiCard title="Guia de arranque" subtitle="La secuencia de compra escalonada de la seccion 120">
    <div class="fw-guide">
      <div class="fw-guide__stats">
        <UiStat
          label="Progreso"
          :value="`${doneCount} / ${rows.length}`"
          :tone="progressBp === 10_000 ? 'accent' : 'neutral'"
        />
        <UiStat
          label="Setup minimo"
          :value="format.formatMoney(budget.setup.total)"
          hint="Tierra, edificios y maquinaria de la seccion 117"
        />
        <UiStat
          label="Colchon"
          :value="format.formatMoney(budget.cushion)"
          :tone="Money.isNegative(budget.cushion) ? 'danger' : 'muted'"
          hint="Capital inicial menos el setup minimo"
        />
        <UiStat
          label="Saldo"
          :value="format.formatMoney(player.projectedBalance)"
          :tone="player.inDebt ? 'danger' : 'neutral'"
        />
      </div>

      <UiMeter label="Secuencia completada" :value-bp="progressBp" tone="accent" />

      <p class="fw-guide__muted">
        Sostener las cinco maquinas desde el dia uno cuesta
        {{ format.formatMoney(budget.holdingUpfront) }} durante el ciclo de
        {{ budget.cycleGameHours.toFixed(0) }} h; comprandolas cuando hacen falta,
        {{ format.formatMoney(budget.holdingStaggered) }}. La diferencia,
        <span class="fw-mono">{{ format.formatMoney(budget.saving) }}</span
        >, es la palanca que la seccion 120 recomienda, frente a un ingreso previsto de
        {{ format.formatMoney(budget.revenuePerCycle) }} por ciclo.
      </p>

      <section v-if="dueRows.length > 0">
        <h3 class="fw-guide__heading">
          Ahora <span>{{ format.formatMoney(dueCost) }} en catalogo</span>
        </h3>
        <ul class="fw-guide__list">
          <li v-for="row in dueRows" :key="row.step.id" class="fw-guide__row">
            <div class="fw-guide__rowhead">
              <span class="fw-guide__title">{{ row.step.title }}</span>
              <UiBadge :tone="toneOf(row.status)">{{ labelOf(row.status) }}</UiBadge>
              <span v-if="!Money.isZero(row.step.cost)" class="fw-guide__muted">
                {{ format.formatMoney(row.step.cost) }}
              </span>
            </div>
            <p class="fw-guide__muted">{{ row.step.detail }}</p>
            <p class="fw-guide__sections">
              §{{ row.step.gddSections.join(' · §') }}
              <UiButton size="sm" variant="ghost" @click="goTo(row)">Ir</UiButton>
            </p>
          </li>
        </ul>
      </section>

      <section v-if="laterRows.length > 0">
        <h3 class="fw-guide__heading">
          Todavia no <span>comprarlo ahora solo paga mantenimiento</span>
        </h3>
        <ul class="fw-guide__list">
          <li v-for="row in laterRows" :key="row.step.id" class="fw-guide__row">
            <div class="fw-guide__rowhead">
              <span class="fw-guide__title">{{ row.step.title }}</span>
              <UiBadge :tone="toneOf(row.status)">{{ labelOf(row.status) }}</UiBadge>
              <span v-if="!Money.isZero(row.step.cost)" class="fw-guide__muted">
                {{ format.formatMoney(row.step.cost) }}
              </span>
            </div>
            <p class="fw-guide__muted">{{ row.step.detail }}</p>
            <p class="fw-guide__muted">
              Se necesita a las {{ row.step.neededAtGameHours.toFixed(0) }} h del ciclo, cuando el
              campo llegue a
              {{ row.step.dueFromState === null ? '—' : CROP_STATE_LABELS[row.step.dueFromState] }}.
            </p>
          </li>
        </ul>
      </section>

      <section v-if="doneCount > 0">
        <h3 class="fw-guide__heading">Hecho</h3>
        <ul class="fw-guide__done">
          <li v-for="row in doneRows" :key="row.step.id">{{ row.step.title }}</li>
        </ul>
      </section>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-guide {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fw-guide__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-guide__heading {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 0 6px;
  font-size: var(--fw-font-size, 14px);
}

.fw-guide__heading span {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-guide__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-guide__row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-guide__rowhead {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.fw-guide__title {
  font-weight: 600;
}

.fw-guide__muted,
.fw-guide__sections {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-guide__sections {
  display: flex;
  gap: 8px;
  align-items: center;
}

.fw-guide__done {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding-left: 16px;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
