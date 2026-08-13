<script setup lang="ts">
// Machinery: the holding, the catalogue, and why a purchase is blocked.
//
// Owner: W5-F. Panel `machinery` of the frozen registry. Surface: side panel of the
// machinery tab.
//
// The panel answers three questions and nothing else. What do I own, in what condition, and
// what would it cost to put it back (GDD section 93). What can I buy, at what price and at
// what running cost (GDD sections 89, 94 and 134). And, when the buy button is grey, why:
// GDD section 96 makes a free garage place a hard block, and a shop that refuses without
// saying so is the single most common way a management game becomes unreadable.
//
// No figure here is written down. Prices, running costs, work speeds, capacities and wear
// rates come from `MACHINE_CATALOGUE`; the resale value, the repair cost and the repair
// duration travel already derived on the row, computed by the server with the shared rules
// of `shared/rules/machinery.ts`; and the reason of every disabled control is the
// `ValidationCode` the server would refuse the request with, in the order it evaluates them
// (ADR-0032). The three orders live in `machineryPresentation.ts`, pure, so the suite
// asserts the code and not the sentence.
//
// The worker of a machine is derived and never stored. The authoritative link between a
// worker and a machine is the task (plan section 5.2, ADR-0028), so the row of a working
// machine reads its task and the task names the worker; there is no `assignedWorkerId` to
// go stale.
import { computed, ref } from 'vue';
import { OPERATION_LABELS } from '~/components/panels/legend/vocabulary';
import {
  MACHINE_TYPE_ORDER,
  MACHINE_TYPE_SECTIONS,
  assignabilityNote,
  conditionTone,
  definitionOfMachineType,
  garageOccupancy,
  labelOfMachineStatus,
  labelOfMachineType,
  purchaseBlockingCode,
  repairBlockingCode,
  sellBlockingCode,
  toneOfMachineStatus,
} from '~/components/panels/machinery/machineryPresentation';
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
  STORAGE_RESOURCE_UNITS,
  VALIDATION_MESSAGES,
  fromWireGameMs,
  fromWireMoney,
  type MachineDto,
  type MachineRole,
  type MachineType,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFarmsStore } from '~/stores/farms';
import { useMachinesStore } from '~/stores/machines';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';
import { useTasksStore } from '~/stores/tasks';
import { useWorkersStore } from '~/stores/workers';

const props = withDefaults(defineProps<{ farmId?: string | null }>(), { farmId: null });

const farms = useFarmsStore();
const buildings = useBuildingsStore();
const machines = useMachinesStore();
const tasks = useTasksStore();
const workers = useWorkersStore();
const player = usePlayerStore();
const pending = usePendingStore();
const shell = useShellUi();
const clock = useGameClock();
const api = useApi();
const format = useFormatting();

const chosenFarmId = ref<string | null>(null);
const failure = ref('');
const confirmingSale = ref<string | null>(null);

/** The farm the panel acts on: the one it was opened with, the chosen one, or the first. */
const farm = computed(() => {
  const wanted = chosenFarmId.value ?? props.farmId;
  if (wanted !== null) {
    return farms.get(wanted) ?? farms.primary;
  }
  return farms.primary;
});

const activeFarmId = computed(() => farm.value?.id ?? '');

/** Writable, so the chooser shows the farm in use before anything has been chosen. */
const selectedFarmId = computed<string>({
  get: () => activeFarmId.value,
  set: (value) => {
    chosenFarmId.value = value;
  },
});

const owned = computed(() =>
  activeFarmId.value === '' ? [] : machines.ofFarm(activeFarmId.value),
);

/**
 * Garage places: capacity from the buildings, occupancy from the machines that name them.
 *
 * Not `farm.machineSlots`, which no mutation of this area refreshes, and not the counter of
 * the building, which only travels by frame; `garageOccupancy` explains why and counts the
 * same fact the database trigger counts (GDD section 96, ADR-0018).
 */
const garageSlots = computed(() =>
  garageOccupancy(
    activeFarmId.value === '' ? [] : buildings.ofType(activeFarmId.value, BuildingType.GARAGE),
    owned.value,
  ),
);
const freeGarageSlots = computed(() => garageSlots.value.free);
const hasWorkshop = computed(() =>
  activeFarmId.value === '' ? false : buildings.hasWorkshop(activeFarmId.value),
);

/**
 * Rows of the holding, with everything a decision needs already resolved.
 *
 * The worker comes through the task and not through a column on the machine, and the two
 * refusals are the shared ones: a machine that is not idle cannot be sold, and a repair
 * needs a workshop, a machine that is not at full condition and enough settled balance.
 */
const rows = computed(() =>
  owned.value.map((machine) => {
    const task = tasks.activeByMachineId[machine.id] ?? null;
    const worker = task === null || task.workerId === null ? null : workers.get(task.workerId);
    const sellCode = sellBlockingCode(machine);
    const repairCode = repairBlockingCode({
      machine,
      hasWorkshop: hasWorkshop.value,
      settledBalance: player.settledBalance,
    });
    return {
      machine,
      label: labelOfMachineType(machine.type),
      statusLabel: labelOfMachineStatus(machine.status),
      statusTone: toneOfMachineStatus(machine.status),
      conditionTone: conditionTone(machine.conditionBp),
      assignability: assignabilityNote(machine),
      workerName: worker?.name ?? null,
      // The operation as the interface names it, never the enum identifier.
      operationLabel: task === null ? null : OPERATION_LABELS[task.operation],
      repairEndsIn:
        machine.repairEndsAtGameMs === null
          ? null
          : fromWireGameMs(machine.repairEndsAtGameMs) - clock.gameMs.value,
      resaleValue: fromWireMoney(machine.resaleValue),
      repairCost: fromWireMoney(machine.repairCost),
      sellReason: sellCode === null ? '' : VALIDATION_MESSAGES[sellCode],
      repairReason: repairCode === null ? '' : VALIDATION_MESSAGES[repairCode],
      canSell: sellCode === null,
      canRepair: repairCode === null,
      busy: pending.isSubjectBusy('MACHINE', machine.id),
    };
  }),
);

/** The catalogue, with the purchase verdict of each type against the current situation. */
const catalogue = computed(() =>
  MACHINE_TYPE_ORDER.map((type) => {
    const definition = definitionOfMachineType(type);
    const code = purchaseBlockingCode({
      freeGarageSlots: freeGarageSlots.value,
      settledBalance: player.settledBalance,
      price: definition.purchasePrice,
    });
    return {
      type,
      definition,
      label: labelOfMachineType(type),
      section: MACHINE_TYPE_SECTIONS[type],
      ownedCount: owned.value.filter((machine) => machine.type === type).length,
      capacityText:
        definition.capacity === null || definition.capacityResource === null
          ? null
          : format.formatQuantity(
              definition.capacity,
              STORAGE_RESOURCE_UNITS[definition.capacityResource].displayDivisor,
              STORAGE_RESOURCE_UNITS[definition.capacityResource].displayUnit,
            ),
      reason: code === null ? '' : VALIDATION_MESSAGES[code],
      canBuy: code === null,
    };
  }),
);

const roleFilter = ref<'ALL' | MachineRole>('ALL');
const visibleCatalogue = computed(() =>
  roleFilter.value === 'ALL'
    ? catalogue.value
    : catalogue.value.filter((entry) => entry.definition.role === roleFilter.value),
);

const buying = computed(() => pending.isRouteBusy('POST /api/machines'));

/** Hourly burn the machinery contributes (GDD sections 94 and 107). */
const maintenancePerHour = computed(() => machines.maintenancePerGameHour);
const operatingPerHour = computed(() => machines.operatingPerGameHour);

function note(error: unknown): void {
  failure.value = isApiClientError(error) ? error.message : 'La peticion no pudo completarse.';
}

async function buy(type: MachineType): Promise<void> {
  const holding = farm.value;
  if (holding === null) {
    return;
  }
  failure.value = '';
  const garage = buildings.defaultGarage(holding.id);
  try {
    await api.mutate('POST /api/machines', {
      body: {
        farmId: holding.id,
        type,
        ...(garage === null ? {} : { garageId: garage.id }),
        // The price the player is looking at, so a catalogue that moved under the panel is
        // refused instead of charged in silence (ADR-0034).
        expectedTotal: definitionOfMachineType(type).purchasePrice,
      },
      subjectKind: 'MACHINE_TYPE',
      subjectId: type,
    });
  } catch (error) {
    note(error);
  }
}

async function sell(machine: MachineDto): Promise<void> {
  failure.value = '';
  confirmingSale.value = null;
  try {
    await api.mutate('POST /api/machines/:machineId/sell', {
      params: { machineId: machine.id },
      subjectKind: 'MACHINE',
      subjectId: machine.id,
    });
  } catch (error) {
    note(error);
  }
}

async function repair(machine: MachineDto): Promise<void> {
  failure.value = '';
  try {
    await api.mutate('POST /api/machines/:machineId/repair', {
      params: { machineId: machine.id },
      body: { expectedTotal: machine.repairCost },
      subjectKind: 'MACHINE',
      subjectId: machine.id,
    });
  } catch (error) {
    note(error);
  }
}

function openFarm(): void {
  shell.openSidePanel('farm-overview');
}

/**
 * The starting guide, which is where the staged purchase of GDD section 120 is explained.
 *
 * The entry point lives here because the guide is declared on the help tab while that tab
 * opens the legend by default, so nothing reaches it: the same gap the settings panel had
 * (`docs/handoff/NOTES-w4e.md`, section 1.4). The machinery panel is also the right place
 * for it, since buying the combine on day one is the mistake the guide exists to prevent.
 */
function openStartingGuide(): void {
  shell.openSidePanel('starting-guide');
}
</script>

<template>
  <UiCard title="Maquinaria" subtitle="Parque, catalogo y coste de reparacion">
    <template #header>
      <UiButton size="sm" variant="ghost" @click="openStartingGuide">Guia de arranque</UiButton>
      <UiButton size="sm" variant="ghost" @click="openFarm">Ver la granja</UiButton>
    </template>

    <UiEmptyState
      v-if="farm === null"
      title="Ninguna granja creada"
      detail="La maquinaria pertenece a una granja y se guarda en su garaje."
    />

    <div v-else class="fw-machinery">
      <label v-if="farms.count > 1" class="fw-machinery__field">
        <span>Granja</span>
        <select v-model="selectedFarmId">
          <option v-for="option in farms.all" :key="option.id" :value="option.id">
            {{ option.name }}
          </option>
        </select>
      </label>

      <div class="fw-machinery__stats">
        <UiStat label="Parque" :value="format.formatCount(owned.length)" unit=" maq." />
        <UiStat
          label="Plazas de garaje"
          :value="`${garageSlots.used} / ${garageSlots.total}`"
          :tone="freeGarageSlots > 0 ? 'neutral' : 'warning'"
          hint="Bloqueo simple de la seccion 96: sin plaza libre no se compra"
        />
        <UiStat
          label="Mantenimiento"
          :value="format.formatRatePerGameHour(maintenancePerHour)"
          hint="Se paga siempre, trabaje o no la maquina (seccion 94)"
        />
        <UiStat
          label="Operacion"
          :value="format.formatRatePerGameHour(operatingPerHour)"
          hint="Se paga solo mientras la maquina ejecuta una tarea (seccion 94)"
        />
        <UiStat
          label="Reventa del parque"
          :value="format.formatMoney(machines.totalResaleValue)"
          tone="muted"
        />
      </div>

      <p v-if="failure !== ''" class="fw-machinery__failure">{{ failure }}</p>

      <!-- The holding. Condition, state, worker, repair and sale. -->
      <section>
        <h3 class="fw-machinery__heading">Parque propio <span>§93 · §96</span></h3>
        <UiEmptyState
          v-if="rows.length === 0"
          title="Sin maquinaria"
          detail="Compra en el catalogo de abajo. Toda operacion exige una automotriz y, casi siempre, un apero."
        />
        <ul v-else class="fw-machinery__list">
          <li v-for="row in rows" :key="row.machine.id" class="fw-machinery__row">
            <div class="fw-machinery__rowhead">
              <span class="fw-machinery__name">{{ row.label }}</span>
              <UiBadge :tone="row.statusTone">{{ row.statusLabel }}</UiBadge>
              <span class="fw-machinery__muted">
                Reventa {{ format.formatMoney(row.resaleValue) }}
              </span>
            </div>

            <UiMeter
              label="Condicion"
              :value-bp="row.machine.conditionBp"
              :tone="row.conditionTone"
            />
            <p v-if="row.assignability !== ''" class="fw-machinery__muted">
              {{ row.assignability }}
            </p>

            <p class="fw-machinery__muted">
              <template v-if="row.workerName !== null">
                Asignada a {{ row.workerName
                }}<template v-if="row.operationLabel !== null">
                  · {{ row.operationLabel }}</template
                >
              </template>
              <template v-else-if="row.repairEndsIn !== null">
                En taller: termina en {{ format.formatGameDuration(row.repairEndsIn) }}
              </template>
              <template v-else>Sin trabajador asignado</template>
            </p>

            <p class="fw-machinery__muted">
              Reparacion completa {{ format.formatMoney(row.repairCost) }} ·
              {{ row.machine.repairDurationGameHours.toFixed(1) }} h de juego
            </p>

            <div class="fw-machinery__actions">
              <UiButton
                size="sm"
                :disabled="!row.canRepair"
                :busy="row.busy"
                :reason="row.repairReason"
                @click="repair(row.machine)"
              >
                Reparar
              </UiButton>
              <template v-if="confirmingSale !== row.machine.id">
                <UiButton
                  size="sm"
                  variant="danger"
                  :disabled="!row.canSell"
                  :busy="row.busy"
                  :reason="row.sellReason"
                  @click="confirmingSale = row.machine.id"
                >
                  Vender
                </UiButton>
              </template>
              <template v-else>
                <UiButton size="sm" variant="danger" :busy="row.busy" @click="sell(row.machine)">
                  Confirmar venta por {{ format.formatMoney(row.resaleValue) }}
                </UiButton>
                <UiButton size="sm" variant="ghost" @click="confirmingSale = null">
                  Cancelar
                </UiButton>
              </template>
            </div>
            <p v-if="row.repairReason !== ''" class="fw-machinery__muted">
              {{ row.repairReason }}
            </p>
          </li>
        </ul>
      </section>

      <!-- The catalogue. Constants of shared/config, never a literal. -->
      <section>
        <h3 class="fw-machinery__heading">Catalogo <span>§89 · §134</span></h3>
        <label class="fw-machinery__field">
          <span>Tipo</span>
          <select v-model="roleFilter">
            <option value="ALL">Todas</option>
            <option value="POWERED">Automotrices</option>
            <option value="IMPLEMENT">Aperos</option>
          </select>
        </label>
        <ul class="fw-machinery__list">
          <li v-for="entry in visibleCatalogue" :key="entry.type" class="fw-machinery__row">
            <div class="fw-machinery__rowhead">
              <span class="fw-machinery__name">{{ entry.label }}</span>
              <UiBadge tone="info">§{{ entry.section }}</UiBadge>
              <span class="fw-machinery__muted">
                {{ format.formatMoney(entry.definition.purchasePrice) }}
              </span>
            </div>
            <dl class="fw-machinery__specs">
              <div>
                <dt>Mantenimiento</dt>
                <dd>
                  {{ format.formatRatePerGameHour(entry.definition.maintenanceCostPerGameHour) }}
                </dd>
              </div>
              <div>
                <dt>Operacion</dt>
                <dd>
                  {{ format.formatRatePerGameHour(entry.definition.operatingCostPerGameHour) }}
                </dd>
              </div>
              <div v-if="entry.definition.workSpeedUnitsPerGameHour !== null">
                <dt>Velocidad</dt>
                <dd>
                  {{ entry.definition.workSpeedUnitsPerGameHour.toFixed(1) }}
                  {{ entry.definition.workUnit === 'TREES' ? 'arboles' : 'celdas' }} / h
                </dd>
              </div>
              <div v-if="entry.capacityText !== null">
                <dt>Capacidad</dt>
                <dd>{{ entry.capacityText }}</dd>
              </div>
              <div>
                <dt>Desgaste</dt>
                <dd>{{ format.formatBp(entry.definition.wearRateBpPerGameHour, 2) }} / h</dd>
              </div>
              <div>
                <dt>En propiedad</dt>
                <dd>{{ entry.ownedCount }}</dd>
              </div>
            </dl>
            <div class="fw-machinery__actions">
              <UiButton
                size="sm"
                variant="primary"
                :disabled="!entry.canBuy"
                :busy="buying"
                :reason="entry.reason"
                @click="buy(entry.type)"
              >
                Comprar por {{ format.formatMoney(entry.definition.purchasePrice) }}
              </UiButton>
              <span v-if="entry.reason !== ''" class="fw-machinery__blocked">
                {{ entry.reason }}
              </span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-machinery {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fw-machinery__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-machinery__heading {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 0 6px;
  font-size: var(--fw-font-size, 14px);
}

.fw-machinery__heading span {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-machinery__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-machinery__row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-machinery__rowhead {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.fw-machinery__name {
  font-weight: 600;
}

.fw-machinery__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-machinery__specs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 4px 12px;
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-machinery__specs dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-machinery__specs dd {
  margin: 0;
  font-family: var(--fw-font-mono, monospace);
  font-variant-numeric: tabular-nums;
}

.fw-machinery__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.fw-machinery__blocked {
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-machinery__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-machinery__field {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
