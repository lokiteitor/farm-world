<script setup lang="ts">
// The companion of the placement mode: footprint, live cost, reasons and confirmation.
//
// Owner: W4-F. Panel `building-placement` of the frozen registry.
//
// The panel is the second half of the flow plan section 9.5 describes: the canvas carries
// the rectangle of the catalogue under the cursor and confirming there mutates nothing, and
// this panel is where the authoritative budget is shown and the request is sent. The
// footprint size is never a literal: it comes from `BUILDING_CATALOGUE` through
// `footprintOf` of the selection tool, so the ghost the player sees and the rectangle the
// panel prices are the same cells (GDD sections 26 to 29 and 136).
//
// The cost distinguishes the two cases of land ownership, which is how the server charges
// it (GDD sections 115, 116 and 117, plan section 2.2 and ADR-0011): the price of the
// structure alone when the plot is already the player's, and the structure plus the cells
// actually bought when it is not. `placementPlan.ts` computes both with the same functions
// of `shared/rules/pricing.ts` the server uses.
//
// Every reason a footprint is refused comes from `validateSelection` and its message from
// `VALIDATION_MESSAGES`, so a disabled button is disabled for the code the server would
// answer with (plan section 8).
import { computed, ref } from 'vue';
import {
  footprintFromOrigin,
  footprintSizeOf,
  originOfCells,
  planBuildingPlacement,
} from '~/components/panels/building-placement/placementPlan';
import {
  capacityReadingOf,
  footprintTextOf,
  labelOfBuildingType,
} from '~/components/panels/farm-overview/buildingPresentation';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { footprintCells as ghostFootprintCells, footprintOf } from '~/game/selection/ghost';
import { isApiClientError } from '~/net/errors';
import {
  Money,
  SelectionPurpose,
  fromWireMoney,
  toWireMoney,
  type BuildingType,
  type CellCoordWire,
  type PlaceBuildingResult,
} from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useWorldStore } from '~/stores/world';

// Every optional prop defaults to null rather than to `undefined`. With
// `exactOptionalPropertyTypes` a caller cannot bind `undefined` to an optional prop, and
// the callers of this panel legitimately hold "not chosen yet" as a value.
const props = withDefaults(
  defineProps<{
    /** Farm the building belongs to. Null falls back to the first holding. */
    farmId?: string | null;
    /** Building being placed. Null falls back to the type the selection intent carries. */
    type?: BuildingType | null;
    /** Fixed anchor, for a caller that already knows where the footprint goes. */
    originCellX?: number | null;
    originCellY?: number | null;
    /** Rendered as the third step of the farm panel, without the outer border. */
    embedded?: boolean;
  }>(),
  { farmId: null, type: null, originCellX: null, originCellY: null, embedded: false },
);

const emit = defineEmits<{
  placed: [result: PlaceBuildingResult];
  cancelled: [];
}>();

const farms = useFarmsStore();
const world = useWorldStore();
const player = usePlayerStore();
const selection = useSelectionStore();
const pending = usePendingStore();
const api = useApi();
const bridge = useGameBridge();
const format = useFormatting();

/** Whether the request also buys the cells of the footprint that are not owned yet. */
const purchaseFootprintLand = ref(true);
const failureMessage = ref('');
const result = ref<PlaceBuildingResult | null>(null);

const activeType = computed<BuildingType | null>(
  () => props.type ?? selection.intent?.buildingType ?? null,
);

const farmId = computed<string | null>(() => props.farmId ?? farms.primary?.id ?? null);

/**
 * The footprint being priced.
 *
 * Three sources, in order of authority: the anchor a caller fixed, the set the selection
 * tool is publishing, and nothing. The panel never invents a rectangle of its own.
 */
const cells = computed<readonly CellCoordWire[]>(() => {
  const type = activeType.value;
  if (type === null) {
    return [];
  }
  if (props.originCellX !== null && props.originCellY !== null) {
    return footprintFromOrigin(type, { cellX: props.originCellX, cellY: props.originCellY });
  }
  return selection.cells;
});

const plan = computed(() => {
  const type = activeType.value;
  // `world.revision` is read so that the plan is recomputed when a chunk lands: the chunk
  // cache is a plain Map outside the reactivity graph and the counter is its only signal.
  void world.revision;
  if (type === null) {
    return null;
  }
  return planBuildingPlacement({
    type,
    cells: cells.value,
    purchaseFootprintLand: purchaseFootprintLand.value,
    settledBalance: player.settledBalance,
    resolveCell: (cellX, cellY) => world.selectionCellAt(cellX, cellY, player.id),
  });
});

const size = computed(() => (activeType.value === null ? null : footprintSizeOf(activeType.value)));
const capacity = computed(() =>
  activeType.value === null ? null : capacityReadingOf(activeType.value),
);

const busy = computed(() => pending.isRouteBusy('POST /api/farms/:farmId/buildings'));
const hasAnchor = computed(() => cells.value.length > 0);

/**
 * Why the confirmation is refused, empty when it is not.
 *
 * The reason is the message of the first issue whenever there is one, so that the tooltip
 * of the button and the error the server would answer with are the same sentence of
 * `VALIDATION_MESSAGES`. The two literals below describe states of the client that no code
 * of the contract names, because in them no request can be formed at all.
 */
const blockingReason = computed<string>(() => {
  if (activeType.value === null) {
    return 'Ningun tipo de edificio elegido.';
  }
  if (farmId.value === null) {
    return 'No hay ninguna granja a la que asignar el edificio.';
  }
  const current = plan.value;
  if (current === null) {
    return '';
  }
  const first = current.issues[0];
  if (first !== undefined) {
    return first.message;
  }
  if (current.unresolvedCount > 0) {
    return 'El veredicto es provisional: hay celdas cuyo chunk no se ha cargado.';
  }
  return '';
});

const canConfirm = computed(
  () => plan.value?.ok === true && farmId.value !== null && !busy.value && result.value === null,
);

/** The reference figure of GDD section 116, shown only when it differs from the charge. */
const showsPlanningCost = computed(() => {
  const current = plan.value;
  return current !== null && Money.compare(current.plannedCostWithLand, current.totalPaid) !== 0;
});

const balanceAfter = computed(() => {
  const current = plan.value;
  return current === null ? null : Money.sub(player.settledBalance, current.totalPaid);
});

/** What the server charged, once it answered. Wire amounts become `Money` here. */
const paid = computed(() => {
  const current = result.value;
  if (current === null) {
    return null;
  }
  return {
    building: fromWireMoney(current.buildingPaid),
    land: fromWireMoney(current.landPaid),
    total: fromWireMoney(current.totalPaid),
    balanceAfter: fromWireMoney(current.balanceAfter),
    landCells: current.landPurchasedCells,
  };
});

function jumpTo(cell: CellCoordWire | null): void {
  if (cell === null) {
    return;
  }
  bridge.emit('camera:goto', { cellX: cell.cellX, cellY: cell.cellY, smooth: true });
}

/**
 * Follows the pointer while the mode is active.
 *
 * The scene publishes `canvas:pick` on every click, in every mode, and the footprint is
 * centred on the picked cell with the very function the ghost of the selection tool draws
 * with (`game/selection/ghost.ts`), so the rectangle the player sees and the one this panel
 * prices cannot drift apart. Skipped when the caller fixed an anchor of its own.
 */
bridge.on('canvas:pick', (pick) => {
  const type = activeType.value;
  if (type === null || props.originCellX !== null || result.value !== null) {
    return;
  }
  selection.replaceCells(ghostFootprintCells(pick.cell, footprintOf(type)));
});

function cancel(): void {
  selection.cancel();
  bridge.emit('selection:mode', { purpose: null });
  emit('cancelled');
}

async function confirm(): Promise<void> {
  const current = plan.value;
  const farm = farmId.value;
  const type = activeType.value;
  if (current === null || farm === null || type === null || !current.ok) {
    return;
  }
  const origin = originOfCells(current.cells);
  if (origin === null) {
    return;
  }
  failureMessage.value = '';
  try {
    const reply = await api.mutate('POST /api/farms/:farmId/buildings', {
      params: { farmId: farm },
      body: {
        type,
        originCellX: origin.cellX,
        originCellY: origin.cellY,
        purchaseFootprintLand: purchaseFootprintLand.value,
        expectedTotal: toWireMoney(current.totalPaid),
      },
      subjectKind: 'FARM',
      subjectId: farm,
    });
    result.value = reply.result;
    selection.cancel();
    bridge.emit('selection:mode', { purpose: null });
    emit('placed', reply.result);
  } catch (error) {
    // The message comes from the shared table through `ApiClientError`, so the text the
    // panel shows and the code the server answered with are the same thing.
    failureMessage.value = isApiClientError(error)
      ? error.message
      : 'La peticion no pudo completarse.';
  }
}

/** Re-arms the mode for another building of the same type. */
function placeAnother(): void {
  result.value = null;
  failureMessage.value = '';
  const type = activeType.value;
  if (type === null) {
    return;
  }
  const footprint = footprintOf(type);
  selection.begin({ purpose: SelectionPurpose.BUILDING, buildingType: type });
  bridge.emit('selection:mode', {
    purpose: SelectionPurpose.BUILDING,
    fixedWidthCells: footprint.widthCells,
    fixedHeightCells: footprint.heightCells,
  });
}
</script>

<template>
  <UiCard
    title="Colocar edificio"
    subtitle="Huella del catalogo, coste real y compra del suelo"
    :flat="props.embedded"
  >
    <UiEmptyState
      v-if="activeType === null"
      title="Ningun edificio en colocacion"
      detail="Elige un tipo de edificio en el panel de granja para empezar."
    />

    <div v-else class="fw-place">
      <div class="fw-place__head">
        <div>
          <p class="fw-place__title">{{ labelOfBuildingType(activeType) }}</p>
          <p class="fw-place__sub">
            Huella {{ footprintTextOf(activeType) }}
            <template v-if="size !== null">
              · {{ size.widthCells * size.heightCells }} celdas
            </template>
          </p>
        </div>
        <UiBadge v-if="result !== null" tone="accent">Construido</UiBadge>
        <UiBadge v-else-if="!hasAnchor" tone="info">Elige ubicacion</UiBadge>
        <UiBadge v-else-if="plan?.ok === true" tone="accent">Colocacion valida</UiBadge>
        <UiBadge v-else tone="warning">Colocacion no valida</UiBadge>
      </div>

      <p v-if="capacity !== null" class="fw-place__capacity">
        Capacidad:
        <template v-if="capacity.value === null">{{ capacity.note ?? 'sin capacidad' }}</template>
        <template v-else>
          {{ format.formatQuantity(capacity.storedUnits, capacity.displayDivisor, capacity.unit) }}
        </template>
        <span class="fw-place__section">§{{ capacity.gddSection }}</span>
      </p>

      <!-- What the server actually charged. -->
      <dl v-if="paid !== null" class="fw-place__cost">
        <dt>Edificio</dt>
        <dd class="fw-mono">{{ format.formatMoney(paid.building) }}</dd>
        <dt>Suelo ({{ paid.landCells }} celdas)</dt>
        <dd class="fw-mono">{{ format.formatMoney(paid.land) }}</dd>
        <dt class="fw-place__total">Total cobrado</dt>
        <dd class="fw-mono fw-place__total">{{ format.formatMoney(paid.total) }}</dd>
        <dt>Saldo</dt>
        <dd class="fw-mono">{{ format.formatMoney(paid.balanceAfter) }}</dd>
      </dl>

      <template v-else-if="plan !== null">
        <p v-if="!hasAnchor" class="fw-place__hint">
          Haz clic en el mapa para situar la huella. El rectangulo lo fija el catalogo.
        </p>

        <template v-else>
          <p class="fw-place__hint">
            Origen
            <span class="fw-mono">
              ({{ plan.origin === null ? '—' : plan.origin.cellX }},
              {{ plan.origin === null ? '—' : plan.origin.cellY }})
            </span>
            · {{ plan.ownedCells }} de {{ plan.cells.length }} celdas ya son tuyas
          </p>

          <label class="fw-place__toggle">
            <input v-model="purchaseFootprintLand" type="checkbox" />
            Comprar el suelo que falta al precio de §115
          </label>

          <dl class="fw-place__cost">
            <dt>Edificio (§116)</dt>
            <dd class="fw-mono">{{ format.formatMoney(plan.buildingPaid) }}</dd>
            <dt>Suelo ({{ plan.cellsToBuy.length }} celdas, §115)</dt>
            <dd class="fw-mono">{{ format.formatMoney(plan.landPaid) }}</dd>
            <dt class="fw-place__total">Coste total</dt>
            <dd class="fw-mono fw-place__total">{{ format.formatMoney(plan.totalPaid) }}</dd>
            <dt>Saldo tras la operacion</dt>
            <dd class="fw-mono" :class="{ 'fw-place__negative': !plan.affordable }">
              {{ balanceAfter === null ? '—' : format.formatMoney(balanceAfter) }}
            </dd>
          </dl>

          <p v-if="showsPlanningCost" class="fw-place__planning">
            Referencia de planificacion de §116, suelo siempre incluido:
            <span class="fw-mono">{{ format.formatMoney(plan.plannedCostWithLand) }}</span>
          </p>

          <p v-if="plan.unresolvedCount > 0" class="fw-place__pendingcells">
            {{ plan.unresolvedCount }} celdas sin cargar. El veredicto es provisional y la
            confirmacion queda bloqueada.
          </p>

          <ul v-if="plan.issues.length > 0" class="fw-place__issues">
            <li v-for="issue in plan.issues" :key="issue.code">
              <span class="fw-place__code fw-mono">{{ issue.code }}</span>
              <span>{{ issue.message }}</span>
              <span v-if="issue.cellCount > 0" class="fw-place__count">
                {{ issue.cellCount }} celdas
              </span>
              <UiButton
                v-if="issue.firstCell !== null"
                size="sm"
                variant="ghost"
                @click="jumpTo(issue.firstCell)"
              >
                Ir al conflicto
              </UiButton>
            </li>
          </ul>
        </template>
      </template>

      <p v-if="failureMessage !== ''" class="fw-place__failure">{{ failureMessage }}</p>

      <div class="fw-place__actions">
        <template v-if="result === null">
          <UiButton
            variant="primary"
            :disabled="!canConfirm"
            :busy="busy"
            :reason="blockingReason"
            @click="confirm"
          >
            Confirmar construccion
          </UiButton>
          <UiButton variant="ghost" @click="cancel">Cancelar</UiButton>
        </template>
        <template v-else>
          <UiButton variant="secondary" @click="placeAnother">Colocar otro</UiButton>
          <UiButton variant="ghost" @click="cancel">Terminar</UiButton>
        </template>
      </div>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-place {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fw-place__head {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
}

.fw-place__title {
  margin: 0;
  font-weight: 600;
}

.fw-place__sub,
.fw-place__hint,
.fw-place__planning,
.fw-place__capacity {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-place__section {
  margin-left: 6px;
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-place__toggle {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-place__cost {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 12px;
  margin: 0;
  padding: 8px;
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-sunken, #101318);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-place__cost dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-place__cost dd {
  margin: 0;
  text-align: right;
}

.fw-place__total {
  color: var(--fw-text, #e6e9ee);
  font-weight: 600;
}

.fw-place__negative {
  color: var(--fw-danger, #b4544a);
}

.fw-place__pendingcells {
  margin: 0;
  color: var(--fw-select-pending, #4fc3d9);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-place__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-place__issues {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-place__issues li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.fw-place__code {
  color: var(--fw-warning, #c9a227);
}

.fw-place__count {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-place__actions {
  display: flex;
  gap: 8px;
}
</style>
