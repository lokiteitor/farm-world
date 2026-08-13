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
  clampQuantity,
  sellBlockingCode,
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
  type StorageResource,
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

function availableOf(resource: StorageResource): number {
  return activeFarmId.value === ''
    ? 0
    : (inventory.usageOf(activeFarmId.value, resource)?.storedUnits ?? 0);
}

function quantityOf(resource: StorageResource): number {
  return clampQuantity(quantities[resource] ?? availableOf(resource), availableOf(resource));
}

function setQuantity(resource: StorageResource, value: number | string): void {
  quantities[resource] = clampQuantity(Number(value), availableOf(resource));
}

function sellAll(resource: StorageResource): void {
  quantities[resource] = availableOf(resource);
}

const lines = computed(() =>
  STORAGE_RESOURCES.map((resource) => {
    const units = STORAGE_RESOURCE_UNITS[resource];
    const usage =
      activeFarmId.value === '' ? null : inventory.usageOf(activeFarmId.value, resource);
    const line =
      activeFarmId.value === '' ? undefined : inventory.lineOf(activeFarmId.value, resource);
    const price = market.priceOf(resource);
    const available = usage?.storedUnits ?? 0;
    const quantity = quantityOf(resource);
    const code = sellBlockingCode({ quantityUnits: quantity, availableUnits: available });
    const storedBp =
      usage === null || usage.capacityUnits === 0
        ? 0
        : Math.round((usage.storedUnits / usage.capacityUnits) * 10_000);
    return {
      resource,
      label: STORAGE_RESOURCE_LABELS[resource],
      section: STORAGE_RESOURCE_SECTIONS[resource],
      units,
      usage,
      available,
      quantity,
      storedBp,
      reservedBp: usage === null ? 0 : Math.max(0, usage.occupancyBp - storedBp),
      hasCapacity: (usage?.capacityUnits ?? 0) > 0,
      storedText: format.formatQuantity(available, units.displayDivisor, units.displayUnit),
      capacityText: format.formatQuantity(
        usage?.capacityUnits ?? 0,
        units.displayDivisor,
        units.displayUnit,
      ),
      quantityText: format.formatQuantity(quantity, units.displayDivisor, units.displayUnit),
      pricePerDisplayUnit: price === undefined ? null : fromWireMoney(price.pricePerDisplayUnit),
      displayUnit: units.displayUnit,
      marketValue: line === undefined ? null : fromWireMoney(line.marketValue),
      // The shared rule, not the quoted price multiplied here (GDD sections 123 and 133).
      revenue: market.revenueOf(resource, quantity),
      reason: code === null ? '' : VALIDATION_MESSAGES[code],
      canSell: code === null,
    };
  }),
);

/** Value of everything in store at the fixed price, as the server computed it per line. */
const totalMarketValue = computed(() =>
  Money.sum(
    lines.value.map((line) => line.marketValue).filter((value): value is Money => value !== null),
  ),
);

const busy = computed(() => pending.isRouteBusy('POST /api/market/sell'));

async function sell(resource: StorageResource): Promise<void> {
  const holding = farm.value;
  if (holding === null) {
    return;
  }
  const quantity = quantityOf(resource);
  failure.value = '';
  lastSale.value = null;
  try {
    const reply = await api.mutate('POST /api/market/sell', {
      body: { farmId: holding.id, resource, quantityUnits: quantity },
      subjectKind: 'FARM',
      subjectId: holding.id,
    });
    const units = STORAGE_RESOURCE_UNITS[resource];
    lastSale.value = `Vendidos ${format.formatQuantity(
      reply.result.quantitySoldUnits,
      units.displayDivisor,
      units.displayUnit,
    )} por ${format.formatMoney(fromWireMoney(reply.result.revenue))}`;
    delete quantities[resource];
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
      detail="Las existencias son de la granja: el grano y la madera se agregan por explotacion."
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
        El precio es fijo y no fluctua (§123). Posponer la venta conserva el grano, no mejora el
        precio, y ocupa silo que una cosecha necesitara.
      </p>

      <p v-if="lastSale !== null" class="fw-market__done">{{ lastSale }}</p>
      <p v-if="failure !== ''" class="fw-market__failure">{{ failure }}</p>

      <section v-for="line in lines" :key="line.resource" class="fw-market__row">
        <div class="fw-market__rowhead">
          <span class="fw-market__name"
            >{{ line.label }} <small>§{{ line.section }}</small></span
          >
          <span class="fw-market__muted">
            <template v-if="line.pricePerDisplayUnit === null">Precio no disponible</template>
            <template v-else>
              {{ format.formatMoney(line.pricePerDisplayUnit) }} / {{ line.displayUnit }}
            </template>
          </span>
        </div>

        <UiMeter
          label="Ocupacion del almacen"
          :value-bp="line.storedBp"
          :reserved-bp="line.reservedBp"
          :warn-above-bp="9000"
        />
        <p class="fw-market__muted">
          {{ line.storedText }} de {{ line.capacityText }}
          <template v-if="line.marketValue !== null">
            · valor {{ format.formatMoney(line.marketValue) }}
          </template>
        </p>

        <template v-if="line.available > 0">
          <label class="fw-market__field">
            <span>Cantidad</span>
            <input
              type="range"
              min="0"
              :max="line.available"
              step="1"
              :value="line.quantity"
              @input="setQuantity(line.resource, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="fw-market__field">
            <span>{{ line.units.storedUnit }}</span>
            <input
              type="number"
              min="0"
              :max="line.available"
              step="1"
              :value="line.quantity"
              @input="setQuantity(line.resource, ($event.target as HTMLInputElement).value)"
            />
            <UiButton size="sm" variant="ghost" @click="sellAll(line.resource)">Todo</UiButton>
          </label>

          <p class="fw-market__preview">
            {{ line.quantityText }} ·
            <span class="fw-mono">{{ format.formatMoney(line.revenue) }}</span>
          </p>
        </template>
        <p v-else class="fw-market__muted">Sin existencias que vender.</p>

        <div class="fw-market__actions">
          <UiButton
            size="sm"
            variant="primary"
            :disabled="!line.canSell"
            :busy="busy"
            :reason="line.reason"
            @click="sell(line.resource)"
          >
            Vender
          </UiButton>
          <span v-if="line.reason !== ''" class="fw-market__blocked">{{ line.reason }}</span>
        </div>
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
