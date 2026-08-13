<script setup lang="ts">
// The return summary: what happened while the player was away.
//
// Owner: W6-D. Panel `welcome-back` of the frozen registry. Surface: modal, opened once by
// `pages/game.vue` when the server says a summary is pending.
//
// This is the panel that makes GDD section 52 legible. The simulation runs while the player
// is disconnected, so on return the world has moved: money was accrued, fields advanced,
// tasks finished, and — with the values of the catalogue unadjusted, which ADR-0039 measures
// — assets may have been sold to cover a debt. None of that is visible on the map. GDD
// section 68 asks for the summary and GDD section 124 gives its exact economic form, and the
// panel is the difference between a game that explains itself and one where the balance is
// simply lower than it was.
//
// Three obligations, in order of how badly they fail when they are not met.
//
// The lines must add up. `summary.ts` checks the two reconciliations — the five aggregates
// against the net change, and the balance before plus the net change against the balance
// after — and the panel says so when they do not. ADR-0009 stored `balanceAfter` on every
// entry so that a discrepancy would be detectable; the summary is where a player would first
// meet one, and five numbers that quietly disagree are worse than an admission.
//
// A forced liquidation must be explained. ADR-0039 writes one ledger entry per asset sold
// precisely so that this panel can name what went and why, and the "why" is the step of the
// published order: the engine walks `LIQUIDATION_STEPS` and stops as soon as the balance
// stops being negative, so the step a sale belongs to is the reason it was chosen. A
// liquidation reported as a single number would be exactly the information the absent player
// does not have.
//
// The links must move the camera. GDD section 68 lists a field ready to harvest and an idle
// worker as the two things worth acting on, and a summary that names them without taking the
// player there makes him search a map for a field he was just told about. The order goes out
// on `camera:goto` of the bridge, through `jumpToCell`, which is the same path every "jump to
// the conflict" of the earlier panels uses (ADR-0031).
//
// Acknowledging is explicit and carries the instant. The summary mark is distinct from the
// login mark so that reloading the page does not erase a summary that was never read (plan
// section 6.7), and `throughGameMs` is the end of the interval the panel actually showed, so
// a summary read ten minutes later does not silently discard what happened in between.
import { computed, onMounted, ref } from 'vue';
import { jumpToCell } from '~/components/panels/cell-inspector/worldAccess';
import {
  CROP_STATE_LABELS,
  OPERATION_LABELS,
  TREE_STAGE_LABELS,
} from '~/components/panels/legend/vocabulary';
import {
  MACHINE_TYPE_LABELS,
  labelOfMachineType,
} from '~/components/panels/machinery/machineryPresentation';
import { woodM3 } from '~/components/panels/shared/forestPresentation';
import {
  balanceReconciles,
  economyLines,
  hasEvents,
  liquidationGroups,
  liquidationTotal,
  linesReconcile,
  typeLines,
  type LiquidationAsset,
} from '~/components/panels/welcome-back/summary';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { isApiClientError } from '~/net/errors';
import {
  CropCycleState,
  Money,
  STORAGE_RESOURCE_UNITS,
  type StorageResource,
  apiErrorMessage,
  fromWireMoney,
  type CellCoordWire,
  type MachineType,
  type TreeGrowthStage,
  type WelcomeBackReply,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFieldsStore } from '~/stores/fields';
import { useMachinesStore } from '~/stores/machines';
import { useWorkersStore } from '~/stores/workers';

const props = withDefaults(
  defineProps<{
    /** A summary already fetched, for a caller that has one. Otherwise it is requested. */
    reply?: WelcomeBackReply | null;
  }>(),
  { reply: null },
);

const fields = useFieldsStore();
const workers = useWorkersStore();
const machines = useMachinesStore();
const buildings = useBuildingsStore();
const shell = useShellUi();
const bridge = useGameBridge();
const api = useApi();
const format = useFormatting();

const fetched = ref<WelcomeBackReply | null>(props.reply);
/**
 * True from the first render when the panel is going to fetch, and not only once it does.
 *
 * `onMounted` runs after the first render, so a flag raised inside `load` leaves one frame
 * in which there is no summary and nothing is being read, which the template can only draw
 * as "Sin resumen · No hay nada que contar de la ausencia": the modal would open by
 * claiming the absence was uneventful and correct itself a tick later. Distinguishing an
 * empty summary from an unread one is the whole reason the three branches exist.
 */
const loading = ref(props.reply === null);
const failure = ref('');
const acking = ref(false);

const summary = computed(() => fetched.value);

onMounted(() => {
  if (fetched.value === null) {
    void load();
  }
});

async function load(): Promise<void> {
  loading.value = true;
  failure.value = '';
  try {
    fetched.value = await api.query('GET /api/session/welcome-back');
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo leer el resumen de regreso.';
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------------------
// The economy of GDD section 124
// ---------------------------------------------------------------------------

const lines = computed(() => (summary.value === null ? [] : economyLines(summary.value.economy)));
const netChange = computed(() =>
  summary.value === null ? Money.ZERO : fromWireMoney(summary.value.economy.netChange),
);
const reconciles = computed(
  () =>
    summary.value !== null &&
    linesReconcile(summary.value.economy) &&
    balanceReconciles(summary.value.economy),
);
const breakdown = computed(() => (summary.value === null ? [] : typeLines(summary.value.economy)));

// ---------------------------------------------------------------------------
// The events of GDD section 68
// ---------------------------------------------------------------------------

const events = computed(() => summary.value !== null && hasEvents(summary.value));

/** Fields that reached `READY_TO_HARVEST` while the player was away, which is the call to act. */
const readyFields = computed(() =>
  (summary.value?.fieldTransitions ?? []).filter(
    (transition) => transition.toState === CropCycleState.READY_TO_HARVEST,
  ),
);

const liquidations = computed(() =>
  summary.value === null ? [] : liquidationGroups(summary.value),
);
const liquidated = computed(() =>
  summary.value === null ? Money.ZERO : liquidationTotal(summary.value),
);

/**
 * What one forced sale took, named.
 *
 * `detail` is what the engine recorded next to the entry —the machine type, the resource or
 * the name of the worker— and it is the answer whenever it travels. The two fallbacks stay
 * because they cost nothing and they cover an entry written before the field existed: the
 * client often still holds the row, since the removal frame and the summary race, and when it
 * does not, the kind plus the identifier is still an answer to "what went"
 * (docs/handoff/NOTES-w6t.md 1.1, ADR-0039).
 */
function assetName(asset: LiquidationAsset): string {
  if (asset.detail !== null && asset.detail !== '') {
    // For a machine the detail is the type of the catalogue, which has a label in Spanish.
    // Anything else —a resource, the name of a worker— is already prose.
    const machineLabel =
      asset.subjectType === 'MACHINE'
        ? MACHINE_TYPE_LABELS[asset.detail as MachineType]
        : undefined;
    return machineLabel ?? asset.detail;
  }
  if (asset.subjectId !== null) {
    const machine = machines.get(asset.subjectId);
    if (machine !== undefined) {
      return labelOfMachineType(machine.type);
    }
    const worker = workers.get(asset.subjectId);
    if (worker !== undefined) {
      return worker.name;
    }
  }
  return asset.subjectId === null ? asset.label : `${asset.label} ${asset.subjectId}`;
}

function stateLabel(state: string): string {
  return CROP_STATE_LABELS[state as CropCycleState] ?? state;
}

function stageLabel(stage: string): string {
  return TREE_STAGE_LABELS[stage as TreeGrowthStage] ?? stage;
}

function operationLabel(operation: string): string {
  return OPERATION_LABELS[operation as keyof typeof OPERATION_LABELS] ?? operation;
}

function wastedLabel(resource: string, units: number): string {
  const key = resource as StorageResource;
  const unit = STORAGE_RESOURCE_UNITS[key];
  if (unit === undefined) {
    return `${format.formatCount(units)} ${resource}`;
  }
  return format.formatQuantity(units, unit.displayDivisor, unit.displayUnit);
}

// ---------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------

/**
 * Centre of a field, as the first of its cells.
 *
 * The first cell and not the centroid: the geometry of GDD section 17 is arbitrary, so the
 * centroid of an L shaped field can fall outside it, which would leave the camera looking at
 * something that is not the field it was asked for. The cells travel in the snapshot and in
 * the `FIELD_UPSERTED` frame, so an empty answer means the geometry has not arrived and the
 * link is simply not offered.
 */
function cellOfField(fieldId: string): CellCoordWire | null {
  const cells = fields.cellsOf(fieldId);
  const first = cells[0];
  return first === undefined ? null : { cellX: first.cellX, cellY: first.cellY };
}

/** Where an idle worker is: his home, which is the building GDD section 108 ties him to. */
function cellOfWorker(workerId: string): CellCoordWire | null {
  const worker = workers.get(workerId);
  if (worker === undefined) {
    return null;
  }
  const home = buildings.get(worker.homeId);
  return home === undefined ? null : { cellX: home.originCellX, cellY: home.originCellY };
}

function goToField(fieldId: string): void {
  const cell = cellOfField(fieldId);
  if (cell !== null) {
    jumpToCell(bridge, cell);
  }
  shell.openSidePanel('field-inspector', { fieldId });
}

function goToWorker(workerId: string): void {
  const cell = cellOfWorker(workerId);
  if (cell !== null) {
    jumpToCell(bridge, cell);
  }
  shell.openSidePanel('workers');
}

// ---------------------------------------------------------------------------
// Acknowledging
// ---------------------------------------------------------------------------

/**
 * Confirms the summary and closes it.
 *
 * The instant sent is the end of the interval this panel showed, so the next summary starts
 * exactly where this one ended. Closing without acknowledging is deliberate and legitimate:
 * the summary stays pending and reappears, which is what the separate mark of plan section
 * 6.7 exists to allow.
 */
async function acknowledge(): Promise<void> {
  const current = summary.value;
  if (current === null || acking.value) {
    shell.closeTopModal();
    return;
  }
  acking.value = true;
  try {
    await api.mutate('POST /api/session/welcome-back/ack', {
      body: { throughGameMs: current.toGameMs },
    });
    shell.closeTopModal();
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'El resumen no pudo confirmarse.';
  } finally {
    acking.value = false;
  }
}
</script>

<template>
  <UiCard flat>
    <p v-if="loading" class="fw-welcome__muted">Leyendo lo ocurrido…</p>

    <UiEmptyState
      v-else-if="summary === null"
      title="Sin resumen"
      :detail="failure !== '' ? failure : 'No hay nada que contar de la ausencia.'"
    />

    <UiEmptyState
      v-else-if="!summary.hasContent"
      title="No ha pasado nada"
      detail="No hubo movimientos economicos ni sucesos durante la ausencia."
    />

    <div v-else class="fw-welcome">
      <p class="fw-welcome__muted">
        {{ summary.elapsedGameHours.toFixed(1) }} horas de juego de ausencia.
      </p>

      <!-- The economy, exactly as GDD section 124 states it. -->
      <section>
        <h3 class="fw-welcome__heading">Economia <span>§124</span></h3>
        <dl class="fw-welcome__lines">
          <template v-for="line in lines" :key="line.key">
            <dt>
              {{ line.label }} <span class="fw-welcome__section">§{{ line.gddSection }}</span>
            </dt>
            <dd :class="{ 'fw-welcome__negative': Money.isNegative(line.amount) }">
              {{ format.formatMoney(line.amount) }}
            </dd>
          </template>
          <dt class="fw-welcome__net">Neto</dt>
          <dd
            class="fw-welcome__net"
            :class="{ 'fw-welcome__negative': Money.isNegative(netChange) }"
          >
            {{ format.formatMoney(netChange) }}
          </dd>
        </dl>

        <div class="fw-welcome__stats">
          <UiStat
            label="Saldo antes"
            :value="format.formatMoney(fromWireMoney(summary.economy.balanceBefore))"
            tone="muted"
          />
          <UiStat
            label="Saldo ahora"
            :value="format.formatMoney(fromWireMoney(summary.economy.balanceAfter))"
            :tone="
              Money.isNegative(fromWireMoney(summary.economy.balanceAfter)) ? 'danger' : 'neutral'
            "
          />
        </div>

        <p v-if="!reconciles" class="fw-welcome__failure">
          Las lineas no cuadran con el neto o con el saldo. El detalle por tipo de asiento es el
          dato fiable; conviene revisar el libro mayor.
        </p>

        <details v-if="breakdown.length > 0" class="fw-welcome__details">
          <summary>Detalle por tipo de asiento</summary>
          <ul class="fw-welcome__list">
            <li v-for="entry in breakdown" :key="entry.type">
              <span class="fw-welcome__label">{{ entry.label }}</span>
              <span class="fw-welcome__muted">{{ format.formatCount(entry.entryCount) }}</span>
              <span :class="{ 'fw-welcome__negative': Money.isNegative(entry.value) }">
                {{ format.formatMoney(entry.value) }}
              </span>
            </li>
          </ul>
        </details>
      </section>

      <!-- A forced liquidation: what was sold and why (ADR-0039). -->
      <section v-if="liquidations.length > 0" class="fw-welcome__liquidation">
        <h3 class="fw-welcome__heading">Liquidacion forzosa <span>§107 · plan 6.6</span></h3>
        <p class="fw-welcome__warning">
          El saldo llego a negativo por el coste continuo de posesion y operacion, y se vendieron
          activos hasta cubrirlo. Se recaudaron
          {{ format.formatMoney(liquidated) }} en el orden publicado, que se detiene en cuanto el
          saldo deja de ser negativo.
        </p>
        <ul class="fw-welcome__list">
          <template v-for="group in liquidations" :key="group.step">
            <li>
              <span class="fw-welcome__label">{{ group.label }}</span>
              <span class="fw-welcome__muted">
                {{ format.formatCount(group.assetCount) }} activos
              </span>
              <span>{{ format.formatMoney(group.total) }}</span>
            </li>
            <!-- One line per asset: the step says why, and this says what (ADR-0039). -->
            <li v-for="asset in group.assets" :key="`${group.step}-${asset.subjectId}`">
              <span class="fw-welcome__label fw-welcome__asset">
                {{ assetName(asset) }}
              </span>
              <span>{{ format.formatMoney(asset.amount) }}</span>
            </li>
          </template>
        </ul>
      </section>

      <!-- The events of GDD section 68, with the two that lead somewhere. -->
      <section v-if="events">
        <h3 class="fw-welcome__heading">Sucesos <span>§68</span></h3>

        <ul class="fw-welcome__events">
          <li v-for="transition in summary.fieldTransitions" :key="transition.fieldId">
            <UiBadge :tone="readyFields.includes(transition) ? 'accent' : 'neutral'">
              {{ stateLabel(transition.toState) }}
            </UiBadge>
            {{ transition.name }} paso de {{ stateLabel(transition.fromState) }} a
            {{ stateLabel(transition.toState) }}.
            <UiButton size="sm" variant="ghost" @click="goToField(transition.fieldId)">
              Ir al campo
            </UiButton>
          </li>

          <li v-for="task in summary.tasksClosed" :key="task.taskId">
            <UiBadge tone="neutral">{{ operationLabel(task.operation) }}</UiBadge>
            {{ task.targetName ?? 'Objetivo' }} ·
            {{ task.status === 'CANCELED' ? 'cancelada' : 'completada' }}
            <template v-if="task.producedUnits !== null">
              · {{ format.formatCount(task.producedUnits) }} unidades
            </template>
          </li>

          <li v-for="worker in summary.idleWorkers" :key="worker.workerId">
            <UiBadge tone="warning">Ocioso</UiBadge>
            {{ worker.name }} esta sin tarea y sigue cobrando salario (§107).
            <UiButton size="sm" variant="ghost" @click="goToWorker(worker.workerId)">
              Ir al trabajador
            </UiButton>
          </li>

          <li v-for="repair in summary.repairsCompleted" :key="repair.machineId">
            <UiBadge tone="neutral">Reparada</UiBadge>
            Una maquina salio del taller al {{ format.formatBp(repair.conditionBp) }}.
          </li>

          <li
            v-for="change in summary.treeStageChanges"
            :key="`${change.forestPlotId}-${change.stage}`"
          >
            <UiBadge tone="neutral">{{ stageLabel(change.stage) }}</UiBadge>
            {{ format.formatCount(change.count) }} arboles alcanzaron la fase.
          </li>

          <li v-for="waste in summary.wasted" :key="`${waste.farmId}-${waste.resource}`">
            <UiBadge tone="danger">Desperdicio</UiBadge>
            No cupieron {{ wastedLabel(waste.resource, waste.units) }} y se perdieron (§83 y §97).
          </li>

          <li v-for="notice in summary.notices" :key="`${notice.kind}-${notice.atGameMs}`">
            <UiBadge :tone="notice.severity === 'WARNING' ? 'warning' : 'neutral'"> Aviso </UiBadge>
            {{ notice.message }}
          </li>
        </ul>

        <!-- Storage, which is the last line of the sketch of GDD section 68. -->
        <ul v-if="summary.storage.length > 0" class="fw-welcome__list">
          <li v-for="store in summary.storage" :key="`${store.farmId}-${store.resource}`">
            <span class="fw-welcome__label">
              {{ store.resource === 'WOOD_M3' ? 'Almacen de madera' : 'Silo' }}
            </span>
            <span class="fw-welcome__muted">{{ format.formatBp(store.occupancyBp) }}</span>
            <span>
              {{
                store.resource === 'WOOD_M3'
                  ? `${woodM3(store.storedUnits).toFixed(2)} m3`
                  : `${format.formatCount(store.storedUnits)} L`
              }}
            </span>
          </li>
        </ul>
      </section>

      <p v-if="failure !== ''" class="fw-welcome__failure">{{ failure }}</p>

      <div class="fw-welcome__actions">
        <UiButton variant="primary" :busy="acking" @click="acknowledge">Entendido</UiButton>
        <UiButton variant="ghost" @click="shell.closeTopModal()">Cerrar sin confirmar</UiButton>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-welcome {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fw-welcome__heading {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 0 6px;
  font-size: var(--fw-font-size, 14px);
}

.fw-welcome__heading span {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-welcome__lines {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 12px;
  margin: 0 0 8px;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-welcome__lines dd {
  margin: 0;
  font-family: var(--fw-font-mono, monospace);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.fw-welcome__section {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-welcome__net {
  padding-top: 4px;
  border-top: 1px solid var(--fw-border, #333a45);
  font-weight: 600;
}

.fw-welcome__negative {
  color: var(--fw-danger, #b4544a);
}

.fw-welcome__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-welcome__details {
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-welcome__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-welcome__list li {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.fw-welcome__label {
  flex: 1 1 auto;
}

.fw-welcome__asset {
  padding-left: 12px;
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-welcome__events {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-welcome__events li {
  display: flex;
  gap: 6px;
  align-items: baseline;
  flex-wrap: wrap;
}

.fw-welcome__liquidation {
  padding: 8px;
  border: 1px solid var(--fw-warning, #c9a227);
  border-radius: var(--fw-radius, 4px);
}

.fw-welcome__warning {
  margin: 0;
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-welcome__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-welcome__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-welcome__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
</style>
