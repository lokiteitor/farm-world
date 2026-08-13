<script setup lang="ts">
// The cell inspector: everything the grid says about one cell, and the only action a
// single cell admits.
//
// Owner: W4-E. Surface: side panel of the world tab.
//
// What it answers is the question GDD sections 7, 8, 14 and 15 make the player ask on
// every click: what is this ground, whose is it, what is it being used for, and what would
// it cost. The price is `cellPrice` of `shared/rules/pricing.ts`, that is GDD section 115
// evaluated by the same function the server charges with, and the purchase is refused for
// exactly the code `canPurchase` of `shared/rules/selection.ts` returns, so a greyed out
// button and a 409 say the same thing.
//
// Which cell it shows, in order of precedence: the one the panel was opened with, the last
// one the canvas reported through `canvas:pick`, and the spawn cell of the world. The last
// fallback is not a nicety: the camera opens at the spawn (plan section 2), so it is the
// cell the player is looking at before touching anything, and a panel whose first state is
// "nothing selected" teaches nothing.
//
// It ignores `canvas:pick` while a selection mode is active. The scene emits the pick
// anyway (docs/handoff/NOTES-w4g.md, section 2.3), and following it would make the
// inspector jump around under a drag that is composing a purchase.
import { computed, onMounted, ref, watch } from 'vue';
import {
  ensureChunksFor,
  jumpToCell,
  panelCellReader,
  readCell,
  startSelectionMode,
} from '~/components/panels/cell-inspector/worldAccess';
import { formatArea } from '~/components/panels/legend/units';
import {
  BUILDING_LABELS,
  LAND_USE_LABELS,
  OWNERSHIP_LABELS,
  TERRAIN_LABELS,
  landUseColour,
  ownershipColour,
  terrainColour,
} from '~/components/panels/legend/vocabulary';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { SelectionToolMode } from '~/game/selection/modes';
import { isApiClientError } from '~/net/errors';
import {
  LandUse,
  Money,
  ValidationCode,
  VALIDATION_MESSAGES,
  apiErrorMessage,
  canPurchase,
  cellIndex,
  cellPrice,
  chunkOf,
  toWireMoney,
  type CellCoordWire,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useFieldsStore } from '~/stores/fields';
import { useForestryStore } from '~/stores/forestry';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useWorldStore } from '~/stores/world';

const props = defineProps<{ cellX?: number; cellY?: number }>();

const world = useWorldStore();
const player = usePlayerStore();
const fields = useFieldsStore();
const buildings = useBuildingsStore();
const forestry = useForestryStore();
const selection = useSelectionStore();
const pending = usePendingStore();
const shell = useShellUi();
const bridge = useGameBridge();
const api = useApi();
const format = useFormatting();

const picked = ref<CellCoordWire | null>(null);
const failure = ref<string | null>(null);
const busy = ref(false);

bridge.on('canvas:pick', (payload) => {
  if (selection.active) {
    return;
  }
  picked.value = { cellX: payload.cell.cellX, cellY: payload.cell.cellY };
});

const target = computed<CellCoordWire | null>(() => {
  if (props.cellX !== undefined && props.cellY !== undefined) {
    return { cellX: props.cellX, cellY: props.cellY };
  }
  return picked.value ?? world.spawnCell;
});

const reader = panelCellReader(world, () => player.id);

/**
 * The cell as the shared rules see it, or null while its chunk has not arrived.
 *
 * `world.revision` is read on purpose: the chunk cache is a plain `Map` outside the
 * reactivity graph and the counter is the only dependency that says "a chunk landed".
 */
const cell = computed(() => {
  void world.revision;
  const at = target.value;
  return at === null ? null : readCell(reader, at);
});

const chunk = computed(() => {
  const at = target.value;
  return at === null ? null : chunkOf(at.cellX, at.cellY, world.chunkSize);
});

const indexInChunk = computed(() => {
  const at = target.value;
  return at === null ? null : cellIndex(at.cellX, at.cellY, world.chunkSize);
});

const price = computed(() => (cell.value === null ? null : cellPrice(cell.value.terrain)));

/** The field, plot or building the cell belongs to, resolved into something clickable. */
const field = computed(() =>
  cell.value?.fieldId == null ? null : (fields.get(cell.value.fieldId) ?? null),
);
const plot = computed(() =>
  cell.value?.forestPlotId == null ? null : (forestry.get(cell.value.forestPlotId) ?? null),
);
const building = computed(() =>
  cell.value?.buildingId == null ? null : (buildings.get(cell.value.buildingId) ?? null),
);

/**
 * Why the purchase is refused, or null when it is admissible.
 *
 * The order is the order the server evaluates in: the rule of the cell first, because it
 * is the one that is about the cell and not about the player, then the debt gate of plan
 * section 6.6, and last the balance.
 */
const blockedBy = computed<string | null>(() => {
  const current = cell.value;
  if (current === null) {
    return 'El chunk de esta celda todavia no ha llegado.';
  }
  const code = canPurchase(current);
  if (code !== null) {
    return VALIDATION_MESSAGES[code];
  }
  if (player.inDebt) {
    return VALIDATION_MESSAGES[ValidationCode.SPENDING_BLOCKED_IN_DEBT];
  }
  const amount = price.value;
  if (amount !== null && Money.compare(amount, player.settledBalance) > 0) {
    return VALIDATION_MESSAGES[ValidationCode.INSUFFICIENT_FUNDS];
  }
  return null;
});

const canBuy = computed(() => blockedBy.value === null && !busy.value);

/**
 * The `reason` prop of the button, or nothing.
 *
 * A bound object and not `blockedBy ?? undefined`: `exactOptionalPropertyTypes` is on in
 * `tsconfig`, so passing `undefined` to an optional prop is an error, and it is the right
 * setting to keep -- "absent" and "present and undefined" are genuinely different here.
 */
const reasonProps = computed(() => (blockedBy.value === null ? {} : { reason: blockedBy.value }));
const purchaseBusy = computed(() => busy.value || pending.isRouteBusy('POST /api/land/purchase'));

/**
 * Makes sure the chunk of the inspected cell is in the cache.
 *
 * It goes through the same route and the same store entry point the streamer of W4-D uses,
 * so there is no second decoder of the modification layer; what changes is who asks. The
 * panel has to ask because a cell whose chunk never arrived has no verdict at all, and the
 * canvas only streams what the camera is looking at.
 */
async function ensureChunk(): Promise<void> {
  const at = target.value;
  if (at === null || readCell(reader, at) !== null) {
    return;
  }
  try {
    await ensureChunksFor(
      world,
      async (chunks) =>
        (
          await api.query('POST /api/world/chunks', {
            body: { chunks: chunks.map((c) => ({ ...c })) },
          })
        ).chunks,
      [at],
      Date.now(),
    );
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo cargar el chunk de esta celda.';
  }
}

onMounted(ensureChunk);
watch(target, ensureChunk);

async function buy(): Promise<void> {
  const at = target.value;
  const amount = price.value;
  if (at === null || amount === null || !canBuy.value) {
    return;
  }
  busy.value = true;
  failure.value = null;
  try {
    await api.mutate('POST /api/land/purchase', {
      body: { cells: [at], expectedTotal: toWireMoney(amount), allowPartial: false },
      subjectKind: 'CELL',
      subjectId: `${at.cellX}:${at.cellY}`,
    });
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo completar la compra.';
  } finally {
    busy.value = false;
  }
}

/** Hands the cell over to the area purchase, which is where a real purchase happens. */
function buyByArea(): void {
  startSelectionMode({ bridge, selection }, { mode: SelectionToolMode.PURCHASE });
  shell.openSidePanel('land-purchase');
}

function centre(): void {
  const at = target.value;
  if (at !== null) {
    jumpToCell(bridge, at);
  }
}

function openField(): void {
  const current = field.value;
  if (current !== null) {
    shell.openSidePanel('field-inspector', { fieldId: current.id });
  }
}
</script>

<template>
  <UiCard
    title="Inspector de celda"
    :subtitle="
      target === null
        ? 'Sin celda seleccionada'
        : `Celda ${target.cellX}, ${target.cellY} · ${formatArea(1, world.cellSizeM)}`
    "
  >
    <template #header>
      <UiButton size="sm" variant="ghost" :disabled="target === null" @click="centre">
        Centrar
      </UiButton>
    </template>

    <UiEmptyState
      v-if="target === null"
      title="Ninguna celda inspeccionada"
      detail="Haz clic sobre el mapa para leer una celda."
    />

    <template v-else>
      <UiEmptyState
        v-if="cell === null"
        title="Celda sin cargar"
        detail="El chunk que contiene esta celda todavia no ha llegado. El cliente es una cache y no afirma nada sobre lo que no tiene."
      />

      <dl v-else class="fw-cell">
        <dt>Terreno</dt>
        <dd>
          <span class="fw-cell__swatch" :style="{ background: terrainColour(cell.terrain) }" />
          {{ TERRAIN_LABELS[cell.terrain] }}
        </dd>

        <dt>Propiedad</dt>
        <dd>
          <span class="fw-cell__swatch" :style="{ background: ownershipColour(cell.ownership) }" />
          {{ OWNERSHIP_LABELS[cell.ownership] }}
        </dd>

        <dt>Uso</dt>
        <dd>
          <span class="fw-cell__swatch" :style="{ background: landUseColour(cell.landUse) }" />
          {{ LAND_USE_LABELS[cell.landUse] }}
        </dd>

        <dt>Pertenece a</dt>
        <dd>
          <UiButton v-if="field !== null" size="sm" variant="ghost" @click="openField">
            {{ field.name }}
          </UiButton>
          <span v-else-if="plot !== null">{{ plot.name }}</span>
          <span v-else-if="building !== null">{{ BUILDING_LABELS[building.type] }}</span>
          <span v-else class="fw-muted">Nada</span>
        </dd>

        <dt>Arbolado</dt>
        <dd>
          <UiBadge :tone="cell.hasStandingTree ? 'accent' : 'neutral'">
            {{ cell.hasStandingTree ? 'Arbol en pie' : 'Sin arbol' }}
          </UiBadge>
        </dd>

        <dt>Chunk</dt>
        <dd class="fw-mono">
          {{ chunk?.chunkX }}, {{ chunk?.chunkY }} · indice {{ indexInChunk }}
        </dd>

        <dt>Precio</dt>
        <dd class="fw-mono">
          {{ price === null ? 'No comprable' : format.formatMoney(price) }}
        </dd>

        <dt>Saldo</dt>
        <dd class="fw-mono">{{ format.formatMoney(player.settledBalance) }}</dd>
      </dl>

      <p v-if="cell !== null && cell.landUse === LandUse.NONE" class="fw-small fw-muted">
        Comprar una celda suelta es admisible, pero el presupuesto y la compra por area muestran el
        desglose y el motivo por celda antes de cobrar.
      </p>

      <p v-if="failure !== null" class="fw-cell__failure fw-small">{{ failure }}</p>
    </template>

    <template #footer>
      <div class="fw-cell__actions">
        <UiButton
          variant="primary"
          size="sm"
          :disabled="!canBuy"
          :busy="purchaseBusy"
          v-bind="reasonProps"
          @click="buy"
        >
          Comprar esta celda
        </UiButton>
        <UiButton size="sm" @click="buyByArea">Comprar por area</UiButton>
      </div>
      <p v-if="blockedBy !== null" class="fw-cell__reason fw-small fw-muted">{{ blockedBy }}</p>
      <p v-else-if="price !== null" class="fw-small fw-muted">
        Se enviara {{ format.formatMoney(price) }} como total esperado, de modo que un presupuesto
        caducado se rechaza en lugar de cobrarse en silencio.
      </p>
    </template>
  </UiCard>
</template>

<style scoped>
.fw-cell {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-cell dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-cell dd {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0;
}

.fw-cell__swatch {
  width: 10px;
  height: 10px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: 2px;
}

.fw-cell__actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.fw-cell__reason {
  margin: 6px 0 0;
}

.fw-cell__failure {
  margin: 8px 0 0;
  color: var(--fw-danger, #b4544a);
}
</style>
