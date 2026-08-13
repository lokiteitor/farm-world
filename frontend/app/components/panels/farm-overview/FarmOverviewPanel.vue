<script setup lang="ts">
// The farm panel: holdings, capacities, buildings and the three steps of raising one.
//
// Owner: W4-F. Panel `farm-overview` of the frozen registry.
//
// The asymmetry of plan section 5.4 is the shape of this panel and not a detail of its
// layout: the fungible stock is aggregated per farm, because grain and wood have no
// individual identity, while the counted capacity is per building, because a machine and a
// worker do have one and the server checks their capacity on the building row. So the silo
// (GDD section 27) and the wood store (GDD section 136) are read from the farm, and the
// garage places (GDD section 96) and the home places (GDD section 108) are shown both
// aggregated, which is what the player decides with, and per building, which is where a
// refusal would come from.
//
// Raising a building is three steps, and they are three on purpose (plan section 9.5):
// choosing the type is a decision about money, placing the footprint is a decision about
// space (GDD section 24), and confirming is where the budget is shown. The second step
// hands the canvas its mode over the bridge and mutates nothing; the third is the companion
// panel, embedded here so that the flow does not leave the tab.
//
// Founding a farm costs nothing and occupies nothing (GDD sections 23, 30 and 31, and
// ADR-0029): what occupies cells are the buildings, which is why the form is a name and a
// button and the route carries no idempotency key.
import { computed, ref } from 'vue';
import BuildingPlacementPanel from '~/components/panels/building-placement/BuildingPlacementPanel.vue';
import {
  BUILDING_TYPE_ORDER,
  capacityReadingOf,
  colourOfBuildingType,
  footprintTextOf,
  labelOfBuildingType,
} from '~/components/panels/farm-overview/buildingPresentation';
import FarmFootprint from '~/components/panels/farm-overview/FarmFootprint.vue';
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
import { footprintOf } from '~/game/selection/ghost';
import { isApiClientError } from '~/net/errors';
import {
  BUILDABLE_TERRAINS,
  SelectionPurpose,
  STORAGE_RESOURCE_UNITS,
  StorageResource,
  TerrainType,
  VALIDATION_MESSAGES,
  ValidationCode,
  createFarmBodySchema,
  fromWireMoney,
  realBuildingCost,
  type BuildingType,
  type StorageUsage,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFarmsStore } from '~/stores/farms';
import { usePendingStore } from '~/stores/pending';
import { useSelectionStore } from '~/stores/selection';

const farms = useFarmsStore();
const buildings = useBuildingsStore();
const selection = useSelectionStore();
const pending = usePendingStore();
const shell = useShellUi();
const bridge = useGameBridge();
const api = useApi();
const format = useFormatting();

// ---------------------------------------------------------------------------
// Founding a farm (GDD sections 23 and 31)
// ---------------------------------------------------------------------------

const newFarmName = ref('');
const createFailure = ref('');

const newFarmValid = computed(
  () => createFarmBodySchema.safeParse({ name: newFarmName.value }).success,
);
const creating = computed(() => pending.isRouteBusy('POST /api/farms'));
const nameReason = VALIDATION_MESSAGES[ValidationCode.VALIDATION_FAILED];

async function createFarm(): Promise<void> {
  if (!newFarmValid.value) {
    return;
  }
  createFailure.value = '';
  try {
    await api.mutate('POST /api/farms', { body: { name: newFarmName.value.trim() } });
    newFarmName.value = '';
  } catch (error) {
    createFailure.value = isApiClientError(error)
      ? error.message
      : 'La peticion no pudo completarse.';
  }
}

// ---------------------------------------------------------------------------
// The three steps of raising a building
// ---------------------------------------------------------------------------

/** Farm the flow is running for, or null when it is not running. */
const buildFarmId = ref<string | null>(null);
const buildType = ref<BuildingType | null>(null);
const placementArmed = ref(false);
const placed = ref(false);

const step = computed(() => {
  if (placed.value) {
    // The companion keeps showing what was charged, so the flow stays on its last step.
    return 3;
  }
  if (buildType.value === null) {
    return 1;
  }
  return selection.count > 0 ? 3 : 2;
});

function startBuild(farmId: string): void {
  buildFarmId.value = farmId;
  buildType.value = null;
  placementArmed.value = false;
  placed.value = false;
  selection.cancel();
}

function chooseType(type: BuildingType): void {
  buildType.value = type;
  placementArmed.value = false;
  placed.value = false;
  selection.cancel();
}

function changeType(): void {
  buildType.value = null;
  placementArmed.value = false;
  placed.value = false;
  selection.cancel();
  bridge.emit('selection:mode', { purpose: null });
}

/**
 * Step two: the canvas is told which mode to enter, and nothing else happens.
 *
 * The bridge is the only channel from Vue to Phaser (plan section 9), and the footprint it
 * carries comes from the catalogue, so the ghost the scene draws is the rectangle this
 * panel priced. The selection store is begun with the same intent, because it is what the
 * companion panel reads and what the binding of the selection tool writes into
 * (docs/handoff/NOTES-w4g.md, section 1.5).
 */
function armPlacement(): void {
  const type = buildType.value;
  if (type === null) {
    return;
  }
  const size = footprintOf(type);
  selection.begin({ purpose: SelectionPurpose.BUILDING, buildingType: type });
  bridge.emit('selection:mode', {
    purpose: SelectionPurpose.BUILDING,
    fixedWidthCells: size.widthCells,
    fixedHeightCells: size.heightCells,
  });
  placementArmed.value = true;
}

function cancelBuild(): void {
  selection.cancel();
  bridge.emit('selection:mode', { purpose: null });
  buildFarmId.value = null;
  buildType.value = null;
  placementArmed.value = false;
  placed.value = false;
}

function onPlaced(): void {
  placed.value = true;
  placementArmed.value = false;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/**
 * The two segments of a storage bar. `occupancyBp` of the contract already includes the
 * reservation, so the stored part is computed apart and the reservation is the difference:
 * a silo with committed room is not the same as a full one, and that distinction is what
 * makes a harvest rejection explainable (plan section 5.4).
 */
function storageBars(usage: StorageUsage): { valueBp: number; reservedBp: number } {
  if (usage.capacityUnits === 0) {
    return { valueBp: 0, reservedBp: 0 };
  }
  const valueBp = Math.round((usage.storedUnits / usage.capacityUnits) * 10_000);
  return { valueBp, reservedBp: Math.max(0, usage.occupancyBp - valueBp) };
}

function storageText(usage: StorageUsage, resource: StorageResource): string {
  const units = STORAGE_RESOURCE_UNITS[resource];
  if (usage.capacityUnits === 0) {
    return 'Sin almacen construido';
  }
  const stored = format.formatQuantity(usage.storedUnits, units.displayDivisor, units.displayUnit);
  const capacity = format.formatQuantity(
    usage.capacityUnits,
    units.displayDivisor,
    units.displayUnit,
  );
  return `${stored} de ${capacity}`;
}

function capacityTextOf(type: BuildingType): string {
  const reading = capacityReadingOf(type);
  if (reading.value === null) {
    return reading.note ?? 'Sin capacidad';
  }
  return format.formatQuantity(reading.storedUnits, reading.displayDivisor, reading.unit);
}

/**
 * The catalogue as the chooser shows it, with the two prices of GDD section 116.
 *
 * Both figures come from `realBuildingCost`: the structure alone, which is what the player
 * pays on land already owned (GDD section 117), and the literal formula with the footprint
 * included, which is planning help (plan section 2.2, ADR-0011). The reference terrain is
 * the buildable one of the configuration and never a literal.
 */
const catalogue = computed(() => {
  const terrain = BUILDABLE_TERRAINS[0] ?? TerrainType.GRASS;
  return BUILDING_TYPE_ORDER.map((type) => {
    const cost = realBuildingCost(type, { landAlreadyOwned: true, terrain });
    const reading = capacityReadingOf(type);
    return {
      type,
      label: labelOfBuildingType(type),
      colour: colourOfBuildingType(type),
      footprint: footprintTextOf(type),
      capacityText: capacityTextOf(type),
      gddSection: reading.gddSection,
      structure: format.formatMoney(cost.total),
      withLand: format.formatMoney(cost.plannedCostWithLand),
    };
  });
});

/** Everything the panel paints per farm, derived once instead of inside the template. */
const farmViews = computed(() =>
  farms.all.map((farm) => ({
    farm,
    buildings: buildings.ofFarm(farm.id).map((building) => {
      const reading = capacityReadingOf(building.type);
      return {
        building,
        label: labelOfBuildingType(building.type),
        colour: colourOfBuildingType(building.type),
        footprint: footprintTextOf(building.type),
        occupancy:
          reading.kind === 'MACHINES' || reading.kind === 'WORKERS'
            ? `${building.occupancy} / ${building.capacity} plazas`
            : reading.kind === 'STORAGE'
              ? format.formatQuantity(building.capacity, reading.displayDivisor, reading.unit)
              : (reading.note ?? 'Sin capacidad'),
        resale: format.formatMoney(fromWireMoney(building.resaleValue)),
      };
    }),
    wheat: {
      ...storageBars(farm.wheat),
      text: storageText(farm.wheat, StorageResource.WHEAT_LITERS),
    },
    wood: { ...storageBars(farm.wood), text: storageText(farm.wood, StorageResource.WOOD_M3) },
  })),
);

function inspect(buildingId: string): void {
  shell.openSidePanel('building-inspector', { buildingId });
}
</script>

<template>
  <div class="fw-farms">
    <UiCard title="Granjas" :subtitle="`${farms.count} en la explotacion`">
      <div class="fw-farms__new">
        <label class="fw-farms__field">
          <span>Nombre de la granja nueva</span>
          <input
            v-model="newFarmName"
            type="text"
            maxlength="64"
            placeholder="Granja del norte"
            class="fw-farms__input"
          />
        </label>
        <UiButton
          variant="secondary"
          :disabled="!newFarmValid || creating"
          :busy="creating"
          :reason="nameReason"
          @click="createFarm"
        >
          Fundar granja
        </UiButton>
      </div>
      <p class="fw-farms__note">
        Fundar una granja no cuesta nada ni ocupa suelo: lo que ocupa celdas son los edificios (§23,
        §24, §31).
      </p>
      <p v-if="createFailure !== ''" class="fw-farms__failure">{{ createFailure }}</p>
    </UiCard>

    <UiEmptyState
      v-if="farms.count === 0"
      title="Todavia no hay ninguna granja"
      detail="Funda una granja y despues construye su garaje, su silo y su vivienda."
    />

    <UiCard
      v-for="view in farmViews"
      :key="view.farm.id"
      :title="view.farm.name"
      :subtitle="`${view.farm.buildingCount} edificios`"
    >
      <template #header>
        <UiBadge :tone="view.farm.hasWorkshop ? 'accent' : 'neutral'">
          {{ view.farm.hasWorkshop ? 'Con taller' : 'Sin taller' }}
        </UiBadge>
      </template>

      <FarmFootprint :buildings="view.buildings.map((row) => row.building)" />

      <div class="fw-farms__stats">
        <UiStat
          label="Garaje"
          :value="`${view.farm.machineSlots.used} / ${view.farm.machineSlots.total}`"
          hint="Plazas de maquinaria (GDD §96)"
        />
        <UiStat
          label="Vivienda"
          :value="`${view.farm.workerSlots.used} / ${view.farm.workerSlots.total}`"
          hint="Plazas de trabajador (GDD §108)"
        />
      </div>

      <div class="fw-farms__meters">
        <UiMeter
          label="Silo (§27)"
          :value-bp="view.wheat.valueBp"
          :reserved-bp="view.wheat.reservedBp"
          :warn-above-bp="9000"
        />
        <p class="fw-farms__meterline">{{ view.wheat.text }}</p>
        <UiMeter
          label="Almacen de madera (§136)"
          :value-bp="view.wood.valueBp"
          :reserved-bp="view.wood.reservedBp"
          :warn-above-bp="9000"
        />
        <p class="fw-farms__meterline">{{ view.wood.text }}</p>
      </div>

      <ul v-if="view.buildings.length > 0" class="fw-farms__buildings">
        <li v-for="row in view.buildings" :key="row.building.id" class="fw-farms__building">
          <span class="fw-farms__swatch" :style="{ background: row.colour }" aria-hidden="true" />
          <span class="fw-farms__buildinglabel">
            {{ row.label }}
            <span class="fw-farms__muted">{{ row.footprint }}</span>
          </span>
          <span class="fw-farms__muted">{{ row.occupancy }}</span>
          <span class="fw-mono">{{ row.resale }}</span>
          <UiButton size="sm" variant="ghost" @click="inspect(row.building.id)">
            Inspeccionar
          </UiButton>
        </li>
      </ul>
      <p v-else class="fw-farms__note">
        Sin edificios. Un garaje (§26) y una vivienda (§28) son la primera fase de §30.
      </p>

      <template #footer>
        <div v-if="buildFarmId !== view.farm.id" class="fw-farms__actions">
          <UiButton variant="primary" @click="startBuild(view.farm.id)">
            Construir edificio
          </UiButton>
        </div>

        <div v-else class="fw-farms__flow">
          <ol class="fw-farms__steps">
            <li :class="{ 'fw-farms__step--on': step === 1 }">1. Elegir tipo</li>
            <li :class="{ 'fw-farms__step--on': step === 2 }">2. Colocar en el mapa</li>
            <li :class="{ 'fw-farms__step--on': step === 3 }">3. Confirmar el coste</li>
          </ol>

          <div v-if="step === 1" class="fw-farms__catalogue">
            <button
              v-for="entry in catalogue"
              :key="entry.type"
              type="button"
              class="fw-farms__type"
              @click="chooseType(entry.type)"
            >
              <span class="fw-farms__typehead">
                <span
                  class="fw-farms__swatch"
                  :style="{ background: entry.colour }"
                  aria-hidden="true"
                />
                {{ entry.label }}
              </span>
              <span class="fw-mono">{{ entry.structure }}</span>
              <span class="fw-farms__muted">
                {{ entry.footprint }} · {{ entry.capacityText }}
                <span class="fw-farms__section">§{{ entry.gddSection }}</span>
              </span>
              <span class="fw-farms__muted fw-mono">con suelo {{ entry.withLand }}</span>
            </button>
          </div>

          <div v-else-if="step === 2" class="fw-farms__place">
            <p class="fw-farms__note">
              {{ buildType === null ? '' : labelOfBuildingType(buildType) }} ·
              {{ buildType === null ? '' : footprintTextOf(buildType) }}
            </p>
            <p class="fw-farms__note">
              El modo de colocacion lleva la huella del catalogo bajo el cursor. Colocar no cobra
              nada: el coste se confirma en el paso tres (§24).
            </p>
            <div class="fw-farms__actions">
              <UiButton v-if="!placementArmed" variant="primary" @click="armPlacement">
                Activar modo de colocacion
              </UiButton>
              <UiBadge v-else tone="info">Modo activo: elige el punto en el mapa</UiBadge>
              <UiButton variant="ghost" @click="changeType">Cambiar tipo</UiButton>
            </div>
          </div>

          <BuildingPlacementPanel
            v-else
            embedded
            :farm-id="view.farm.id"
            :type="buildType"
            @placed="onPlaced"
            @cancelled="cancelBuild"
          />

          <div class="fw-farms__actions">
            <UiButton variant="ghost" @click="cancelBuild">Salir de la construccion</UiButton>
          </div>
        </div>
      </template>
    </UiCard>
  </div>
</template>

<style scoped>
.fw-farms {
  display: flex;
  flex-direction: column;
  gap: var(--fw-gap, 8px);
}

.fw-farms__new {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.fw-farms__field {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-farms__input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-sunken, #101318);
  color: var(--fw-text, #e6e9ee);
  font: inherit;
}

.fw-farms__note,
.fw-farms__meterline,
.fw-farms__muted {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-farms__note,
.fw-farms__meterline {
  margin: 6px 0 0;
}

.fw-farms__failure {
  margin: 6px 0 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-farms__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  margin-top: 10px;
}

.fw-farms__meters {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}

.fw-farms__buildings {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.fw-farms__building {
  display: grid;
  grid-template-columns: 10px 1fr auto auto auto;
  gap: 8px;
  align-items: center;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-farms__buildinglabel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.fw-farms__swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.fw-farms__section {
  margin-left: 4px;
}

.fw-farms__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.fw-farms__flow {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fw-farms__steps {
  display: flex;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-farms__step--on {
  color: var(--fw-accent-strong, #85c07f);
  font-weight: 600;
}

.fw-farms__catalogue {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fw-farms__type {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 10px;
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-raised, #242932);
  color: var(--fw-text, #e6e9ee);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fw-farms__type:hover {
  border-color: var(--fw-text-muted, #9aa4b2);
}

.fw-farms__typehead {
  display: flex;
  gap: 6px;
  align-items: center;
  font-weight: 600;
}

.fw-farms__place {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
