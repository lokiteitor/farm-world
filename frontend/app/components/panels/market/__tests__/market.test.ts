// The market panel: the fixed price, the quantity and the revenue it previews.
//
// Owner: W5-F.
//
// The two refusals and the clamp are pure and are asserted directly. On the component the
// suite checks the three things the panel decides on its own: that the price shown is the
// one of the catalogue rather than a figure of its own, that the preview of the revenue is
// the shared rule of GDD sections 123 and 133 and therefore the amount the ledger will
// record, and that selling credits exactly that amount.
//
// One limit of the harness is worth stating rather than working around: the stock of the
// inventory travels only in the `INVENTORY_UPSERTED` frame and never in the result of the
// mutation, by the explicit decision of the reducer (`stores/sync.ts`), so a client with no
// live socket does not see its store shrink. What the sale does move here is the balance,
// which is what `balanceAfter` carries, and that is what the suite asserts.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import MarketPanel from '~/components/panels/market/MarketPanel.vue';
import {
  STORAGE_RESOURCE_LABELS,
  clampQuantity,
  sellBlockingCode,
} from '~/components/panels/market/sale';
import { formatMoney, formatQuantity } from '~/composables/useFormatting';
import { MOCK_FARM_ID } from '~/mock/world';
import {
  CROPS,
  CROP_IDS,
  CropId,
  Money,
  STORAGE_RESOURCES,
  STORAGE_RESOURCE_UNITS,
  StorageResource,
  ValidationCode,
  cropSaleRevenue,
  multiplyByCount,
} from '~/shared/index';
import { useInventoryStore } from '~/stores/inventory';
import { useMarketStore } from '~/stores/market';
import { usePlayerStore } from '~/stores/player';

describe('la decision de vender', () => {
  it('pedir cero o menos no es una venta (§123)', () => {
    expect(sellBlockingCode({ quantityUnits: 0, availableUnits: 100 })).toBe(
      ValidationCode.QUANTITY_NOT_POSITIVE,
    );
    expect(sellBlockingCode({ quantityUnits: -5, availableUnits: 100 })).toBe(
      ValidationCode.QUANTITY_NOT_POSITIVE,
    );
    expect(sellBlockingCode({ quantityUnits: Number.NaN, availableUnits: 100 })).toBe(
      ValidationCode.QUANTITY_NOT_POSITIVE,
    );
  });

  it('pedir mas de lo almacenado es falta de existencias', () => {
    expect(sellBlockingCode({ quantityUnits: 101, availableUnits: 100 })).toBe(
      ValidationCode.INSUFFICIENT_STOCK,
    );
    expect(sellBlockingCode({ quantityUnits: 100, availableUnits: 100 })).toBeNull();
  });

  it('la cantidad se acota a un entero dentro de las existencias', () => {
    expect(clampQuantity(12.7, 100)).toBe(12);
    expect(clampQuantity(500, 100)).toBe(100);
    expect(clampQuantity(-1, 100)).toBe(0);
    expect(clampQuantity(Number.NaN, 100)).toBe(0);
  });

  it('los dos recursos tienen etiqueta en castellano', () => {
    for (const resource of STORAGE_RESOURCES) {
      expect(STORAGE_RESOURCE_LABELS[resource]).not.toBe(resource);
    }
  });
});

describe('el panel de mercado', () => {
  beforeEach(async () => {
    await bootMockClient();
  });

  afterEach(() => {
    teardownMockClient();
  });

  it('lee el precio fijo del contrato y lo muestra por unidad de presentacion', async () => {
    const market = useMarketStore();
    const wrapper = mount(MarketPanel);
    await settle();

    // Una linea por cultivo del catalogo, mas la madera: el precio es del cultivo.
    expect(market.prices.length).toBe(CROP_IDS.length + 1);
    const wheat = market.priceOf('WHEAT');
    expect(wheat).toBeDefined();
    expect(wheat?.pricePerStoredUnit).toBe(Money.toString(CROPS[CropId.WHEAT].sellPricePerLiter));
    expect(wrapper.text()).toContain(STORAGE_RESOURCE_LABELS.GRAIN_LITERS);
    expect(wrapper.text()).toContain('§123');
    wrapper.unmount();
  });

  it('muestra existencias, capacidad y valor de mercado de la granja', async () => {
    const inventory = useInventoryStore();
    const wrapper = mount(MarketPanel);
    await settle();

    // La capacidad va por categoria y las existencias por pila: dos niveles, como el panel.
    const usage = inventory.usageOf(MOCK_FARM_ID, StorageResource.GRAIN_LITERS);
    expect(usage).not.toBeNull();
    const pile = inventory.lineOf(MOCK_FARM_ID, 'WHEAT');
    expect(pile).toBeDefined();
    const units = STORAGE_RESOURCE_UNITS.GRAIN_LITERS;
    expect(wrapper.text()).toContain(
      formatQuantity(pile?.storedUnits ?? 0, units.displayDivisor, units.displayUnit),
    );
    expect(wrapper.text()).toContain(
      formatMoney(multiplyByCount(CROPS.WHEAT.sellPricePerLiter, pile?.storedUnits ?? 0)),
    );
    wrapper.unmount();
  });

  it('la previsualizacion del ingreso es la regla compartida y no el precio multiplicado a mano', async () => {
    const wrapper = mount(MarketPanel);
    await settle();

    const input = wrapper.find('input[type="number"]');
    await input.setValue('1000');
    expect(wrapper.text()).toContain(formatMoney(cropSaleRevenue(CROPS[CropId.WHEAT], 1000)));
    wrapper.unmount();
  });

  it('vender abona exactamente el ingreso previsualizado', async () => {
    const player = usePlayerStore();
    const wrapper = mount(MarketPanel);
    await settle();

    const before = player.settledBalance;
    await wrapper.find('input[type="number"]').setValue('1000');
    const sell = wrapper.findAll('button').find((button) => button.text() === 'Vender');
    await sell?.trigger('click');
    await settle();

    const revenue = cropSaleRevenue(CROPS[CropId.WHEAT], 1000);
    expect(player.settledBalance).toBe(Money.add(before, revenue));
    expect(wrapper.text()).toContain(`por ${formatMoney(revenue)}`);
    wrapper.unmount();
  });

  it('sin existencias el boton dice que la cantidad no es positiva', async () => {
    const inventory = useInventoryStore();
    const wrapper = mount(MarketPanel);
    await settle();

    // El mundo de muestra no tiene madera ni almacen de madera, asi que esa categoria es el
    // caso vacio: se dibuja su medidor, pero no tiene ninguna pila que vender.
    expect(inventory.usageOf(MOCK_FARM_ID, StorageResource.WOOD_M3)?.storedUnits).toBe(0);
    expect(inventory.lineOf(MOCK_FARM_ID, 'WOOD')).toBeUndefined();

    // Un boton por pila con contenido, no por categoria: solo el trigo se puede vender.
    const buttons = wrapper.findAll('button').filter((button) => button.text() === 'Vender');
    expect(buttons).toHaveLength(1);

    // Y las categorias vacias lo dicen en vez de ofrecer una venta imposible.
    expect(wrapper.text()).toContain('Sin almacen construido para esta categoria.');
    wrapper.unmount();
  });
});
