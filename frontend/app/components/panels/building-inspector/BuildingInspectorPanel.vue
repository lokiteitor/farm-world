<script setup lang="ts">
// The inspector of one building: type, capacity, contents, occupants and demolition.
//
// Owner: W4-F. Panel `building-inspector` of the frozen registry.
//
// Capacity and contents are two different questions and the model answers them in two
// different places (plan section 5.4). The capacity is the building's own: four machines in
// a garage (GDD section 96), four workers in a home (GDD section 108), a hundred thousand
// litres in a silo (GDD section 27), five hundred cubic metres in a wood store (GDD section
// 136). The contents of a store, on the other hand, are the farm's, because grain and wood
// are fungible and are aggregated per holding; this panel says so rather than inventing a
// per building stock the server does not keep.
//
// Demolition is stated with its resale value before it is asked for, and its two
// predictable refusals are evaluated here with the same codes the server answers with
// (`backend/src/modules/farms/index.ts`): a building with a machine or a worker inside, and
// a store whose capacity the farm is still using. Both are `BUILDING_NOT_EMPTY`.
import { computed, ref } from 'vue';
import {
  capacityReadingOf,
  colourOfBuildingType,
  countsMachines,
  countsWorkers,
  footprintTextOf,
  labelOfBuildingType,
  storageResourceOf,
} from '~/components/panels/farm-overview/buildingPresentation';
// The tables of the two modules that own machinery and staff, so an occupant reads the same
// here and in its own panel. This file showed the enum identifier in monospace while they did
// not exist; they do since W5 (docs/handoff/NOTES-w4f.md 2.4, NOTES-w5f.md 3.1).
import {
  labelOfMachineStatus,
  labelOfMachineType,
} from '~/components/panels/machinery/machineryPresentation';
import { labelOfWorkerStatus } from '~/components/panels/workers/workerPresentation';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiMeter from '~/components/ui/UiMeter.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { isApiClientError } from '~/net/errors';
import {
  STORAGE_RESOURCE_UNITS,
  VALIDATION_MESSAGES,
  ValidationCode,
  fromWireGameMs,
  fromWireMoney,
  type StorageUsage,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFarmsStore } from '~/stores/farms';
import { useMachinesStore } from '~/stores/machines';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';
import { useWorkersStore } from '~/stores/workers';

const props = withDefaults(defineProps<{ buildingId?: string | null }>(), { buildingId: null });

const buildings = useBuildingsStore();
const farms = useFarmsStore();
const machines = useMachinesStore();
const workers = useWorkersStore();
const player = usePlayerStore();
const pending = usePendingStore();
const shell = useShellUi();
const bridge = useGameBridge();
const api = useApi();
const format = useFormatting();

const confirming = ref(false);
const removalFailure = ref('');
const removedRefund = ref<string | null>(null);

const building = computed(() =>
  props.buildingId === null ? undefined : buildings.get(props.buildingId),
);
const farm = computed(() => {
  const current = building.value;
  return current === undefined ? undefined : farms.get(current.farmId);
});

const reading = computed(() =>
  building.value === undefined ? null : capacityReadingOf(building.value.type),
);

/** Machines parked here (GDD section 96). The location is the building, not the farm. */
const parkedMachines = computed(() => {
  const current = building.value;
  if (current === undefined || !countsMachines(current.type)) {
    return [];
  }
  return machines.all.filter((machine) => machine.garageId === current.id);
});

/** Workers housed here (GDD section 108). `homeId` is mandatory on a worker. */
const housedWorkers = computed(() => {
  const current = building.value;
  if (current === undefined || !countsWorkers(current.type)) {
    return [];
  }
  return workers.ofHome(current.id);
});

/** The stock of the farm for the resource this building stores, or null. */
const storage = computed<{
  usage: StorageUsage;
  text: string;
  valueBp: number;
  reservedBp: number;
} | null>(() => {
  const current = building.value;
  const holding = farm.value;
  if (current === undefined || holding === undefined) {
    return null;
  }
  const resource = storageResourceOf(current.type);
  if (resource === null) {
    return null;
  }
  const usage = holding.storage.find((row) => row.category === resource)?.usage;
  if (usage === undefined) {
    return null;
  }
  const units = STORAGE_RESOURCE_UNITS[resource];
  const valueBp =
    usage.capacityUnits === 0 ? 0 : Math.round((usage.storedUnits / usage.capacityUnits) * 10_000);
  const stored = format.formatQuantity(usage.storedUnits, units.displayDivisor, units.displayUnit);
  const capacity = format.formatQuantity(
    usage.capacityUnits,
    units.displayDivisor,
    units.displayUnit,
  );
  return {
    usage,
    text: `${stored} de ${capacity} en la granja`,
    valueBp,
    reservedBp: Math.max(0, usage.occupancyBp - valueBp),
  };
});

const resaleValue = computed(() =>
  building.value === undefined ? null : fromWireMoney(building.value.resaleValue),
);

const builtOn = computed(() => {
  const current = building.value;
  const dto = player.dto;
  if (current === undefined || dto === null) {
    return '—';
  }
  return format.formatGameDay(
    fromWireGameMs(current.builtAtGameMs),
    fromWireGameMs(dto.startedAtGameMs),
  );
});

const busy = computed(() =>
  props.buildingId === null ? false : pending.isSubjectBusy('BUILDING', props.buildingId),
);

/**
 * Why the building cannot be retired, from the message table and never composed.
 *
 * The two conditions are the ones the server checks before it writes anything, in the same
 * order: the counted occupancy first, and then, for a store, whether removing its capacity
 * would leave the farm holding more than the remainder can take, reservation included.
 */
const removalReason = computed<string>(() => {
  const current = building.value;
  if (current === undefined) {
    return VALIDATION_MESSAGES[ValidationCode.NOT_FOUND];
  }
  if (current.occupancy > 0) {
    return VALIDATION_MESSAGES[ValidationCode.BUILDING_NOT_EMPTY];
  }
  const held = storage.value;
  if (held !== null) {
    const remaining = held.usage.capacityUnits - current.capacity;
    if (held.usage.storedUnits + held.usage.reservedUnits > remaining) {
      return VALIDATION_MESSAGES[ValidationCode.BUILDING_NOT_EMPTY];
    }
  }
  return '';
});

const canRemove = computed(
  () => building.value !== undefined && removalReason.value === '' && !busy.value,
);

function backToFarm(): void {
  shell.openSidePanel('farm-overview');
}

function showOnMap(): void {
  const current = building.value;
  if (current === undefined) {
    return;
  }
  bridge.emit('camera:goto', {
    cellX: current.originCellX + Math.floor(current.widthCells / 2),
    cellY: current.originCellY + Math.floor(current.heightCells / 2),
    smooth: true,
  });
}

async function remove(): Promise<void> {
  const current = building.value;
  if (current === undefined || !canRemove.value) {
    return;
  }
  removalFailure.value = '';
  try {
    const reply = await api.mutate('DELETE /api/buildings/:buildingId', {
      params: { buildingId: current.id },
      subjectKind: 'BUILDING',
      subjectId: current.id,
    });
    removedRefund.value = reply.result.refund;
    confirming.value = false;
  } catch (error) {
    removalFailure.value = isApiClientError(error)
      ? error.message
      : 'La peticion no pudo completarse.';
  }
}
</script>

<template>
  <UiCard title="Inspector de edificio" subtitle="Tipo, capacidad, contenido y reventa">
    <template #header>
      <UiButton size="sm" variant="ghost" @click="backToFarm">Ver la granja</UiButton>
    </template>

    <div v-if="removedRefund !== null" class="fw-building__removed">
      <p>Edificio retirado.</p>
      <p>
        Reembolso
        <span class="fw-mono">{{ format.formatMoney(fromWireMoney(removedRefund)) }}</span>
      </p>
      <p class="fw-building__muted">
        Las celdas vuelven a ser suelo en propiedad sin uso; la tierra no se vende.
      </p>
    </div>

    <UiEmptyState
      v-else-if="building === undefined"
      title="Ningun edificio seleccionado"
      detail="Elige un edificio en el panel de granja o en el mapa."
    />

    <div v-else class="fw-building">
      <div class="fw-building__head">
        <span
          class="fw-building__swatch"
          :style="{ background: colourOfBuildingType(building.type) }"
          aria-hidden="true"
        />
        <div>
          <p class="fw-building__title">{{ labelOfBuildingType(building.type) }}</p>
          <p class="fw-building__muted">
            {{ farm === undefined ? 'Granja desconocida' : farm.name }} ·
            {{ footprintTextOf(building.type) }}
          </p>
        </div>
        <UiBadge tone="neutral">{{ building.type }}</UiBadge>
      </div>

      <div class="fw-building__stats">
        <UiStat
          label="Origen"
          :value="`(${building.originCellX}, ${building.originCellY})`"
          hint="Esquina noroeste de la huella"
        />
        <UiStat label="Construido" :value="builtOn" />
        <UiStat
          label="Reventa"
          :value="resaleValue === null ? '—' : format.formatMoney(resaleValue)"
          tone="muted"
          hint="Factor de reventa sobre el precio de catalogo"
        />
      </div>

      <p v-if="reading !== null" class="fw-building__capacity">
        Capacidad:
        <template v-if="reading.value === null">{{ reading.note ?? 'sin capacidad' }}</template>
        <template v-else>
          {{ format.formatQuantity(reading.storedUnits, reading.displayDivisor, reading.unit) }}
        </template>
        <span class="fw-building__section">§{{ reading.gddSection }}</span>
      </p>

      <!-- Contents. Fungible stock belongs to the farm and not to the building. -->
      <div v-if="storage !== null" class="fw-building__storage">
        <UiMeter
          label="Contenido"
          :value-bp="storage.valueBp"
          :reserved-bp="storage.reservedBp"
          :warn-above-bp="9000"
        />
        <p class="fw-building__muted">{{ storage.text }}</p>
        <p class="fw-building__muted">
          Las existencias son de la granja, no del edificio: el grano y la madera son fungibles y se
          agregan por explotacion.
        </p>
      </div>

      <!-- Occupants. Identity and location are per building, which is where the server
           checks the capacity. -->
      <div v-if="countsMachines(building.type) || countsWorkers(building.type)">
        <p class="fw-building__label">
          Ocupantes
          <span class="fw-building__muted">
            {{ building.occupancy }} de {{ building.capacity }} plazas
          </span>
        </p>
        <ul v-if="parkedMachines.length > 0" class="fw-building__list">
          <li v-for="machine in parkedMachines" :key="machine.id">
            <span>{{ labelOfMachineType(machine.type) }}</span>
            <span class="fw-building__muted">
              Condicion {{ format.formatBp(machine.conditionBp, 0) }} ·
              {{ labelOfMachineStatus(machine.status) }}
            </span>
          </li>
        </ul>
        <ul v-else-if="housedWorkers.length > 0" class="fw-building__list">
          <li v-for="worker in housedWorkers" :key="worker.id">
            <span>{{ worker.name }}</span>
            <span class="fw-building__muted">
              Habilidad {{ format.formatBp(worker.skillBp, 0) }} ·
              {{ labelOfWorkerStatus(worker.status) }}
            </span>
          </li>
        </ul>
        <p v-else class="fw-building__muted">Sin ocupantes.</p>
      </div>

      <p v-if="removalFailure !== ''" class="fw-building__failure">{{ removalFailure }}</p>

      <div class="fw-building__actions">
        <UiButton size="sm" variant="ghost" @click="showOnMap">Centrar en el mapa</UiButton>
        <template v-if="!confirming">
          <UiButton
            variant="danger"
            :disabled="!canRemove"
            :busy="busy"
            :reason="removalReason"
            @click="confirming = true"
          >
            Retirar edificio
          </UiButton>
        </template>
        <template v-else>
          <UiButton variant="danger" :disabled="!canRemove" :busy="busy" @click="remove">
            Confirmar retirada por
            {{ resaleValue === null ? '—' : format.formatMoney(resaleValue) }}
          </UiButton>
          <UiButton variant="ghost" @click="confirming = false">Cancelar</UiButton>
        </template>
      </div>
      <p v-if="removalReason !== ''" class="fw-building__muted">{{ removalReason }}</p>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-building,
.fw-building__removed {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fw-building__removed p {
  margin: 0;
}

.fw-building__head {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.fw-building__swatch {
  width: 12px;
  height: 12px;
  margin-top: 3px;
  border-radius: 2px;
}

.fw-building__title {
  margin: 0;
  font-weight: 600;
}

.fw-building__muted,
.fw-building__capacity {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-building__section {
  margin-left: 6px;
}

.fw-building__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-building__storage {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fw-building__label {
  margin: 0 0 4px;
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.fw-building__list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-building__list li {
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.fw-building__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-building__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
</style>
