<script setup lang="ts">
// Land purchase: the budget of a selection, why part of it is refused, and the purchase.
//
// Owner: W4-E. Surface: side panel of the world tab.
//
// The panel exists because GDD section 14 buys by area and GDD section 115 prices by
// terrain, so the player needs three numbers before committing: what the selection is made
// of, what it costs, and what part of it will not be sold. It shows all three and it takes
// none of them on trust.
//
// Two budgets and they are not redundant. The local one is `cellPrice` of
// `shared/rules/pricing.ts` applied to the cells the client holds, and it moves with the
// drag at no cost; the authoritative one is `POST /api/land/quote`, which is the only
// figure the purchase is allowed to be built on, because the client cannot know that
// somebody bought a cell of the selection a second ago. The confirmation sends that total
// back as `expectedTotal`, so a stale quote is refused instead of being charged in silence
// (shared/api/schemas/land.ts).
//
// Partial purchase is a decision of the player and never a default. `allowPartial` false is
// the safe behaviour of the contract: the whole request is refused if any cell is blocked.
// The flag exists because the server cannot know whether the player saw the quote, and
// this panel is the place where that becomes true.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  ensureChunksFor,
  groupByReason,
  jumpToCell,
  panelCellReader,
  readCells,
  startSelectionMode,
  stopSelectionMode,
} from '~/components/panels/cell-inspector/worldAccess';
import { formatArea } from '~/components/panels/legend/units';
import { TERRAIN_LABELS, terrainColour } from '~/components/panels/legend/vocabulary';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { SelectionToolMode } from '~/game/selection/modes';
import { isApiClientError } from '~/net/errors';
import {
  DEFAULT_LAND_PRICE_CONFIG,
  MAX_SELECTION_CELLS,
  Money,
  TERRAIN_TYPES,
  VALIDATION_MESSAGES,
  ValidationCode,
  apiErrorMessage,
  canPurchase,
  cellPrice,
  fromWireMoney,
  multiplyByCount,
  type LandQuoteReply,
  type TerrainType,
} from '~/shared/index';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useWorldStore } from '~/stores/world';

/** Real milliseconds a change of the selection waits before asking for a quote. */
const QUOTE_DEBOUNCE_REAL_MS = 250;

const world = useWorldStore();
const player = usePlayerStore();
const selection = useSelectionStore();
const pending = usePendingStore();
const bridge = useGameBridge();
const api = useApi();
const format = useFormatting();

const quote = ref<LandQuoteReply | null>(null);
const quoting = ref(false);
const failure = ref<string | null>(null);
const allowPartial = ref(false);
const purchased = ref<{ count: number; total: string } | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

const reader = panelCellReader(world, () => player.id);

const cells = computed(() => selection.cells);
const cellCount = computed(() => cells.value.length);

const resolved = computed(() => {
  void world.revision;
  return readCells(reader, cells.value);
});

/**
 * The selection broken down by terrain, with the price of GDD section 115.
 *
 * Only cells the player does not already own are priced, which is what `priceOf` of the
 * shared rules does too: a cell already in the holding costs nothing and would otherwise be
 * counted twice the day a selection crosses the boundary of the property.
 */
const breakdown = computed(() => {
  const counts = new Map<TerrainType, { purchasable: number; blocked: number }>();
  for (const cell of resolved.value.cells) {
    const entry = counts.get(cell.terrain) ?? { purchasable: 0, blocked: 0 };
    if (canPurchase(cell) === null) {
      entry.purchasable += 1;
    } else {
      entry.blocked += 1;
    }
    counts.set(cell.terrain, entry);
  }
  return [...counts]
    .map(([terrain, entry]) => {
      const unit = cellPrice(terrain);
      return {
        terrain,
        purchasable: entry.purchasable,
        blocked: entry.blocked,
        unit,
        subtotal: unit === null ? Money.ZERO : multiplyByCount(unit, entry.purchasable),
      };
    })
    .sort((left, right) => right.purchasable - left.purchasable);
});

const localTotal = computed(() => Money.sum(breakdown.value.map((entry) => entry.subtotal)));

/** The reasons the quote gives, one line per code and never one per cell. */
const reasons = computed(() => groupByReason(quote.value?.cells ?? []));

const quoteStale = computed(
  () => quote.value !== null && quote.value.cells.length !== cellCount.value,
);

/** The price table of the catalogue, shown while there is nothing selected yet. */
const catalogue = computed(() =>
  TERRAIN_TYPES.map((terrain) => ({
    terrain,
    price: DEFAULT_LAND_PRICE_CONFIG.basePriceByTerrain[terrain],
    effective: cellPrice(terrain),
  })),
);

/**
 * Why the purchase cannot be sent, or null when it can.
 *
 * The first three are properties of the selection and come from the shared codes; the last
 * two are the two gates of plan section 6.6 and of the affordability check. A cell whose
 * chunk has not arrived blocks the send even when everything else is green, because a
 * verdict about a cell the client does not hold is not a verdict at all
 * (docs/handoff/NOTES-w4g.md, section 2.4).
 */
const blockedBy = computed<string | null>(() => {
  if (cellCount.value === 0) {
    return VALIDATION_MESSAGES[ValidationCode.SELECTION_EMPTY];
  }
  if (cellCount.value > MAX_SELECTION_CELLS) {
    return VALIDATION_MESSAGES[ValidationCode.SELECTION_TOO_LARGE];
  }
  if (resolved.value.unresolvedCount > 0) {
    return `Faltan por cargar ${resolved.value.unresolvedCount} celdas de la seleccion.`;
  }
  const current = quote.value;
  if (current === null || quoting.value || quoteStale.value) {
    return 'El presupuesto del servidor todavia no esta disponible.';
  }
  if (current.purchasableCount === 0) {
    return VALIDATION_MESSAGES[ValidationCode.CELL_ALREADY_OWNED];
  }
  if (current.blockedCount > 0 && !allowPartial.value) {
    return 'La seleccion contiene celdas no comprables. Admite la compra parcial o corrige la seleccion.';
  }
  if (player.inDebt) {
    return VALIDATION_MESSAGES[ValidationCode.SPENDING_BLOCKED_IN_DEBT];
  }
  if (!current.affordable) {
    return VALIDATION_MESSAGES[ValidationCode.INSUFFICIENT_FUNDS];
  }
  return null;
});

const canConfirm = computed(() => blockedBy.value === null);
/** The `reason` prop of the button, or nothing: `exactOptionalPropertyTypes` is on. */
const reasonProps = computed(() => (blockedBy.value === null ? {} : { reason: blockedBy.value }));
const busy = computed(() => pending.isRouteBusy('POST /api/land/purchase'));

async function requestQuote(): Promise<void> {
  const body = cells.value.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY }));
  if (body.length === 0) {
    quote.value = null;
    return;
  }
  quoting.value = true;
  failure.value = null;
  try {
    await ensureChunksFor(
      world,
      async (chunks) =>
        (
          await api.query('POST /api/world/chunks', {
            body: { chunks: chunks.map((entry) => ({ ...entry })) },
          })
        ).chunks,
      body,
      Date.now(),
    );
    quote.value = await api.query('POST /api/land/quote', { body: { cells: body } });
  } catch (error) {
    quote.value = null;
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo obtener el presupuesto.';
  } finally {
    quoting.value = false;
  }
}

/**
 * The quote is asked for once the drag has settled and not on every crossing of a cell
 * boundary: the tool reports a change per cell entered, and a request per cell would put a
 * round trip inside the drag loop.
 */
watch(
  cells,
  (next) => {
    // The receipt of the last purchase survives the selection being emptied by that very
    // purchase, and is dropped only when the player starts composing a new one. Clearing it
    // unconditionally would hide the confirmation the instant it was earned.
    if (next.length > 0) {
      purchased.value = null;
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void requestQuote();
    }, QUOTE_DEBOUNCE_REAL_MS);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (timer !== null) {
    clearTimeout(timer);
  }
});

async function confirm(): Promise<void> {
  const current = quote.value;
  if (current === null || !canConfirm.value) {
    return;
  }
  failure.value = null;
  try {
    const reply = await api.mutate('POST /api/land/purchase', {
      body: {
        cells: cells.value.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
        expectedTotal: current.total,
        allowPartial: allowPartial.value,
      },
      subjectKind: 'SELECTION',
      subjectId: `${cellCount.value}`,
    });
    purchased.value = {
      count: reply.result.purchasedCount,
      total: reply.result.totalPaid,
    };
    selection.clearCells();
    quote.value = null;
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo completar la compra.';
  }
}

function activate(): void {
  startSelectionMode({ bridge, selection }, { mode: SelectionToolMode.PURCHASE });
}

function cancel(): void {
  stopSelectionMode({ bridge, selection });
  quote.value = null;
}

function goToConflict(): void {
  const target = quote.value?.firstBlockedCell ?? reasons.value[0]?.firstCell ?? null;
  if (target !== null) {
    jumpToCell(bridge, target);
  }
}
</script>

<template>
  <UiCard
    title="Compra de tierra"
    :subtitle="`${format.formatCount(cellCount)} celdas · ${formatArea(cellCount, world.cellSizeM)}`"
  >
    <template #header>
      <UiButton v-if="!selection.active" size="sm" @click="activate">Seleccionar</UiButton>
      <UiButton v-else size="sm" variant="ghost" @click="cancel">Cancelar</UiButton>
    </template>

    <template v-if="cellCount === 0">
      <p class="fw-small fw-muted">
        Arrastra sobre el mapa para componer la seleccion. Mayusculas une, alt resta y control
        conmuta una celda.
      </p>
      <table class="fw-land__table">
        <caption class="fw-small fw-muted">
          Precio por celda segun terreno (§115)
        </caption>
        <thead>
          <tr>
            <th scope="col">Terreno</th>
            <th scope="col">Base</th>
            <th scope="col">Efectivo</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in catalogue" :key="entry.terrain">
            <td>
              <span class="fw-land__swatch" :style="{ background: terrainColour(entry.terrain) }" />
              {{ TERRAIN_LABELS[entry.terrain] }}
            </td>
            <td class="fw-mono">
              {{ entry.price === null ? 'No comprable' : format.formatMoney(entry.price) }}
            </td>
            <td class="fw-mono">
              {{ entry.effective === null ? '—' : format.formatMoney(entry.effective) }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else>
      <table class="fw-land__table">
        <caption class="fw-small fw-muted">
          Desglose de la seleccion por terreno
        </caption>
        <thead>
          <tr>
            <th scope="col">Terreno</th>
            <th scope="col">Comprables</th>
            <th scope="col">Bloqueadas</th>
            <th scope="col">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in breakdown" :key="entry.terrain">
            <td>
              <span class="fw-land__swatch" :style="{ background: terrainColour(entry.terrain) }" />
              {{ TERRAIN_LABELS[entry.terrain] }}
            </td>
            <td class="fw-mono">{{ format.formatCount(entry.purchasable) }}</td>
            <td class="fw-mono">{{ format.formatCount(entry.blocked) }}</td>
            <td class="fw-mono">{{ format.formatMoney(entry.subtotal) }}</td>
          </tr>
        </tbody>
      </table>

      <dl class="fw-land__totals">
        <dt>Presupuesto local</dt>
        <dd class="fw-mono">{{ format.formatMoney(localTotal) }}</dd>
        <dt>Presupuesto del servidor</dt>
        <dd class="fw-mono">
          <span v-if="quoting">Calculando…</span>
          <span v-else-if="quote === null">—</span>
          <span v-else>{{ format.formatMoney(fromWireMoney(quote.total)) }}</span>
        </dd>
        <dt>Celdas comprables</dt>
        <dd class="fw-mono">
          {{ quote === null ? '—' : format.formatCount(quote.purchasableCount) }}
        </dd>
        <dt>Celdas bloqueadas</dt>
        <dd class="fw-mono">{{ quote === null ? '—' : format.formatCount(quote.blockedCount) }}</dd>
        <dt>Sin resolver</dt>
        <dd class="fw-mono">{{ format.formatCount(resolved.unresolvedCount) }}</dd>
        <dt>Saldo liquidado</dt>
        <dd class="fw-mono">
          {{
            quote === null
              ? format.formatMoney(player.settledBalance)
              : format.formatMoney(fromWireMoney(quote.balance))
          }}
        </dd>
      </dl>

      <section v-if="reasons.length > 0" class="fw-land__reasons">
        <h3 class="fw-small fw-muted">Motivos de invalidez</h3>
        <ul>
          <li v-for="reason in reasons" :key="reason.code">
            <UiBadge tone="danger">{{ format.formatCount(reason.cellCount) }}</UiBadge>
            {{ reason.message }}
          </li>
        </ul>
        <UiButton size="sm" variant="ghost" @click="goToConflict">Ir al primer conflicto</UiButton>
      </section>
    </template>

    <!-- Outside the two branches: the receipt of a purchase that emptied the selection has
         to survive the selection being empty, which is exactly the state it leaves. -->
    <p v-if="purchased !== null" class="fw-land__done fw-small">
      Compradas {{ format.formatCount(purchased.count) }} celdas por
      {{ format.formatMoney(fromWireMoney(purchased.total)) }}.
    </p>
    <p v-if="failure !== null" class="fw-land__failure fw-small">{{ failure }}</p>

    <template #footer>
      <label class="fw-land__partial fw-small">
        <input v-model="allowPartial" type="checkbox" />
        Comprar solo las celdas admisibles
      </label>
      <div class="fw-land__actions">
        <UiButton
          variant="primary"
          size="sm"
          :disabled="!canConfirm"
          :busy="busy"
          v-bind="reasonProps"
          @click="confirm"
        >
          Comprar
        </UiButton>
        <span v-if="quote !== null" class="fw-small fw-muted">
          Se enviara {{ format.formatMoney(fromWireMoney(quote.total)) }} como total esperado.
        </span>
      </div>
      <p v-if="blockedBy !== null" class="fw-small fw-muted">{{ blockedBy }}</p>
    </template>
  </UiCard>
</template>

<style scoped>
.fw-land__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-land__table caption {
  padding-bottom: 4px;
  text-align: left;
}

.fw-land__table th {
  padding: 2px 4px;
  color: var(--fw-text-muted, #9aa4b2);
  font-weight: 400;
  text-align: right;
}

.fw-land__table th:first-child {
  text-align: left;
}

.fw-land__table td {
  padding: 2px 4px;
  border-top: 1px solid var(--fw-border, #333a45);
  text-align: right;
}

.fw-land__table td:first-child {
  display: flex;
  gap: 6px;
  align-items: center;
  text-align: left;
}

.fw-land__swatch {
  width: 10px;
  height: 10px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: 2px;
}

.fw-land__totals {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  margin: 12px 0 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-land__totals dt {
  color: var(--fw-text-muted, #9aa4b2);
}

.fw-land__totals dd {
  margin: 0;
  text-align: right;
}

.fw-land__reasons {
  margin-top: 12px;
}

.fw-land__reasons h3 {
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fw-land__reasons ul {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0 0 6px;
  padding: 0;
  font-size: var(--fw-font-size-sm, 12px);
  list-style: none;
}

.fw-land__partial {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}

.fw-land__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.fw-land__done {
  margin: 8px 0 0;
  color: var(--fw-accent-strong, #85c07f);
}

.fw-land__failure {
  margin: 8px 0 0;
  color: var(--fw-danger, #b4544a);
}
</style>
