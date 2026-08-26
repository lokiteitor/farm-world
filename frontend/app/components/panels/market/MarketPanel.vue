<script setup lang="ts">
// The market: what is in store, what it is worth, and how much of it to sell.
//
// Owner: W5-F. Panel `market` of the frozen registry. Surface: side panel of the economy
// tab.
//
// The price is fixed and does not fluctuate (GDD section 123), which decides the shape of
// this panel: there is no chart and no timing, only a quantity. What the player is actually
// choosing between is selling now and keeping the room in the silo, so the occupancy of GDD
// sections 27 and 49 is shown next to the price rather than in another panel.
//
// Selling stays available with a negative balance. It is the one income route the debt
// policy of plan section 6.6 leaves open, because blocking it would produce a permanent
// deadlock: the only way out of debt is to sell.
//
// Two unit conventions are respected here and nowhere bent. The quantity that travels is
// the stored unit — litres for wheat, cubic decimetres for wood — and the divisor to the
// display unit comes with the inventory line, so the interface divides and the server never
// does (plan section 5.2). And the revenue preview is `revenueOf` of the market store,
// which is the shared rule of GDD sections 123 and 133, not the quoted price multiplied by
// hand: the figure previewed is the figure the ledger will record.
import { computed, onMounted, reactive, ref } from 'vue';
import {
  STORAGE_RESOURCE_LABELS,
  STORAGE_RESOURCE_SECTIONS,
  categoryOfItem,
  clampQuantity,
  sellBlockingCode,
  stockItemLabel,
} from '~/components/panels/market/sale';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiMeter from '~/components/ui/UiMeter.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { isApiClientError } from '~/net/errors';
import {
  Money,
  STORAGE_RESOURCES,
  STORAGE_RESOURCE_UNITS,
  VALIDATION_MESSAGES,
  fromWireMoney,
  type StockItem,
} from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { useInventoryStore } from '~/stores/inventory';
import { useMarketStore } from '~/stores/market';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';

const props = withDefaults(defineProps<{ farmId?: string | null }>(), { farmId: null });

const farms = useFarmsStore();
const inventory = useInventoryStore();
const market = useMarketStore();
const player = usePlayerStore();
const pending = usePendingStore();
const api = useApi();
const format = useFormatting();

const chosenFarmId = ref<string | null>(null);
const failure = ref('');
const lastSale = ref<string | null>(null);
/** Quantity asked for, per resource, in the stored unit. Zero means "not chosen yet". */
const quantities = reactive<Record<string, number>>({});

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

/**
 * The price table is not part of the snapshot, because it is a constant of the world and
 * not state of the player, so this is the one request the panel makes on mount.
 */
onMounted(async () => {
  if (market.prices.length > 0) {
    return;
  }
  try {
    const reply = await api.query('GET /api/market/prices');
    market.applyPrices(reply);
  } catch (error) {
    failure.value = isApiClientError(error) ? error.message : 'No se pudo leer el precio.';
  }
});

function availableOf(item: StockItem): number {
  return activeFarmId.value === ''
    ? 0
    : (inventory.lineOf(activeFarmId.value, item)?.storedUnits ?? 0);
}

function quantityOf(item: StockItem): number {
  return clampQuantity(quantities[item] ?? availableOf(item), availableOf(item));
}

function setQuantity(item: StockItem, value: number | string): void {
  quantities[item] = clampQuantity(Number(value), availableOf(item));
}

function sellAll(item: StockItem): void {
  quantities[item] = availableOf(item);
}

/**
 * The panel in two levels, because the domain is in two levels.
 *
 * Capacity belongs to the storage category, which is what a building grants, so that is
 * what the meters draw. Value belongs to the crop, so a sellable row is one pile of one
 * crop. A farm holding wheat and barley has one grain meter and two rows under it.
 *
 * Categories with nothing in them keep their meter, since "0 of 0" in the cold store is
 * what tells the player a store has to be built before produce can be harvested at all.
 */
const categories = computed(() =>
  STORAGE_RESOURCES.map((category) => {
    const units = STORAGE_RESOURCE_UNITS[category];
    const usage =
      activeFarmId.value === '' ? null : inventory.categoryOf(activeFarmId.value, category)?.usage;
    const stored = usage?.storedUnits ?? 0;
    const capacity = usage?.capacityUnits ?? 0;
    const storedBp = capacity === 0 ? 0 : Math.round((stored / capacity) * 10_000);
    const piles = (activeFarmId.value === '' ? [] : inventory.linesOf(activeFarmId.value)).filter(
      (line) => line.category === category,
    );
    return {
      category,
      label: STORAGE_RESOURCE_LABELS[category],
      section: STORAGE_RESOURCE_SECTIONS[category],
      hasCapacity: capacity > 0,
      storedBp,
      reservedBp:
        usage === undefined || usage === null ? 0 : Math.max(0, usage.occupancyBp - storedBp),
      storedText: format.formatQuantity(stored, units.displayDivisor, units.displayUnit),
      capacityText: format.formatQuantity(capacity, units.displayDivisor, units.displayUnit),
      lines: piles.map((line) => {
        const available = line.storedUnits;
        const quantity = quantityOf(line.item);
        const code = sellBlockingCode({ quantityUnits: quantity, availableUnits: available });
        const price = market.priceOf(line.item);
        return {
          item: line.item,
          label: stockItemLabel(line.item),
          available,
          quantity,
          storedText: format.formatQuantity(available, line.displayDivisor, line.displayUnit),
          quantityText: format.formatQuantity(quantity, line.displayDivisor, line.displayUnit),
          pricePerDisplayUnit:
            price === undefined ? null : fromWireMoney(price.pricePerDisplayUnit),
          displayUnit: line.displayUnit,
          marketValue: fromWireMoney(line.marketValue),
          // The shared rule, not the quoted price multiplied here (GDD sections 123 and 133).
          revenue: market.revenueOf(line.item, quantity),
          reason: code === null ? '' : VALIDATION_MESSAGES[code],
          canSell: code === null,
        };
      }),
    };
  }),
);

/** Every sellable pile, flattened, which is what the total is computed over. */
const lines = computed(() => categories.value.flatMap((category) => category.lines));

/** Value of everything in store at the fixed price, as the server computed it per line. */
const totalMarketValue = computed(() => Money.sum(lines.value.map((line) => line.marketValue)));

const busy = computed(() => pending.isRouteBusy('POST /api/market/sell'));

async function sell(item: StockItem): Promise<void> {
  const holding = farm.value;
  if (holding === null) {
    return;
  }
  const quantity = quantityOf(item);
  failure.value = '';
  lastSale.value = null;
  try {
    const reply = await api.mutate('POST /api/market/sell', {
      body: { farmId: holding.id, item, quantityUnits: quantity },
      subjectKind: 'FARM',
      subjectId: holding.id,
    });
    const units = STORAGE_RESOURCE_UNITS[categoryOfItem(item)];
    lastSale.value = `Vendidos ${format.formatQuantity(
      reply.result.quantitySoldUnits,
      units.displayDivisor,
      units.displayUnit,
    )} de ${stockItemLabel(item)} por ${format.formatMoney(fromWireMoney(reply.result.revenue))}`;
    delete quantities[item];
  } catch (error) {
    failure.value = isApiClientError(error) ? error.message : 'La peticion no pudo completarse.';
  }
}
</script>

<template>
  <UiCard title="Mercado" subtitle="Precio fijo, existencias y venta">
    <UiEmptyState
      v-if="farm === null"
      title="Ninguna granja creada"
      detail="Las existencias son de la granja y se agregan por explotacion."
    />

    <div v-else class="fw-market">
      <label v-if="farms.count > 1" class="fw-market__field">
        <span>Granja</span>
        <select v-model="selectedFarmId">
          <option v-for="option in farms.all" :key="option.id" :value="option.id">
            {{ option.name }}
          </option>
        </select>
      </label>

      <div class="fw-market__stats">
        <UiStat
          label="Saldo"
          :value="format.formatMoney(player.projectedBalance)"
          :tone="player.inDebt ? 'danger' : 'neutral'"
        />
        <UiStat
          label="Valor de las existencias"
          :value="format.formatMoney(totalMarketValue)"
          tone="muted"
          hint="Al precio fijo de las secciones 123 y 133"
        />
      </div>

      <p class="fw-market__muted">
        El precio es fijo y no fluctua (&sect;123) y es del cultivo, no de la categoria. Posponer la
        venta no mejora el precio y ocupa almacen que una cosecha necesitara.
      </p>

      <p v-if="lastSale !== null" class="fw-market__done">{{ lastSale }}</p>
      <p v-if="failure !== ''" class="fw-market__failure">{{ failure }}</p>

      <section v-for="group in categories" :key="group.category" class="fw-market__row">
        <div class="fw-market__rowhead">
          <span class="fw-market__name"
            >{{ group.label }} <small>&sect;{{ group.section }}</small></span
          >
        </div>

        <UiMeter
          label="Ocupacion del almacen"
          :value-bp="group.storedBp"
          :reserved-bp="group.reservedBp"
          :warn-above-bp="9000"
        />
        <p class="fw-market__muted">{{ group.storedText }} de {{ group.capacityText }}</p>

        <p v-if="!group.hasCapacity" class="fw-market__muted">
          Sin almacen construido para esta categoria.
        </p>
        <p v-else-if="group.lines.length === 0" class="fw-market__muted">
          Sin existencias que vender.
        </p>

        <article v-for="line in group.lines" :key="line.item" class="fw-market__pile">
          <div class="fw-market__rowhead">
            <span class="fw-market__name">{{ line.label }}</span>
            <span class="fw-market__muted">
              <template v-if="line.pricePerDisplayUnit === null">Precio no disponible</template>
              <template v-else>
                {{ format.formatMoney(line.pricePerDisplayUnit) }} / {{ line.displayUnit }}
              </template>
            </span>
          </div>
          <p class="fw-market__muted">
            {{ line.storedText }} · valor {{ format.formatMoney(line.marketValue) }}
          </p>

          <label class="fw-market__field">
            <span>Cantidad</span>
            <input
              type="range"
              min="0"
              :max="line.available"
              step="1"
              :value="line.quantity"
              @input="setQuantity(line.item, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="fw-market__field">
            <span>{{ line.displayUnit }}</span>
            <input
              type="number"
              min="0"
              :max="line.available"
              step="1"
              :value="line.quantity"
              @input="setQuantity(line.item, ($event.target as HTMLInputElement).value)"
            />
            <UiButton size="sm" variant="ghost" @click="sellAll(line.item)">Todo</UiButton>
          </label>

          <p class="fw-market__preview">
            {{ line.quantityText }} ·
            <span class="fw-mono">{{ format.formatMoney(line.revenue) }}</span>
          </p>

          <div class="fw-market__actions">
            <UiButton
              size="sm"
              variant="primary"
              :disabled="!line.canSell"
              :busy="busy"
              :reason="line.reason"
              @click="sell(line.item)"
            >
              Vender
            </UiButton>
            <span v-if="line.reason !== ''" class="fw-market__blocked">{{ line.reason }}</span>
          </div>
        </article>
      </section>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-market {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fw-market__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-market__pile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0 0 12px;
  border-left: 2px solid var(--fw-border, #33383f);
}

.fw-market__row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-market__rowhead {
  display: flex;
  gap: 8px;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
}

.fw-market__name {
  font-weight: 600;
}

.fw-market__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-market__preview {
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-market__field {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-market__field input[type='range'] {
  flex: 1 1 auto;
  min-width: 0;
}

.fw-market__field input[type='number'] {
  width: 10ch;
}

.fw-market__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.fw-market__blocked {
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-market__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-market__done {
  margin: 0;
  color: var(--fw-accent-strong, #85c07f);
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
