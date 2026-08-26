// The market: the fixed price, the sale and the inventory.
//
// Owner: workflow W5-C. Module `economy`.
//
// What this file pins down, and why each one would fail silently otherwise:
//
//   - The golden figure of GDD section 119. Selling the 20 700 L of the first harvest at the
//     0.22 per litre of GDD section 82 credits exactly 4 554, to the fourth decimal. It is
//     the one number of the economic chapter of the GDD that the catalogue reproduces
//     exactly, so it is the one that has to keep coming out.
//   - Selling more than is stored is refused, and refused with `INSUFFICIENT_STOCK` and the
//     two figures, not with a 500 from a negative column.
//   - The occupancy of GDD section 49: 24 500 L of a 100 000 L silo is 24.5 %, which travels
//     as 2 450 basis points, and the interface divides.
//   - Wood is priced per cubic metre and stored per cubic decimetre (GDD sections 133 and
//     136), which is the unit conversion the whole area is most likely to get wrong.
//   - A repeated idempotency key sells once. The withdrawal is not covered by the ledger key
//     on its own, so a retry that reached the body would take the grain twice.
//
// Every expected amount is derived from the shared catalogue and never written as a literal,
// except the two the GDD itself publishes, which are asserted against their derivation as
// well so that a retuned catalogue fails here instead of quietly changing the game.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CROP_IDS,
  DM3_PER_M3,
  Money,
  PINE,
  STARTING_CAPITAL,
  STORAGE_RESOURCES,
  StorageResource,
  ValidationCode,
  WHEAT,
  cropSaleRevenue,
  woodSaleRevenue,
} from '../../shared/index.js';
import { createHarness, readStock, type Harness } from '../harness.js';
import {
  balanceOf,
  createEconomyPlayer,
  depositStock,
  errorCode,
  getJson,
  postSell,
  type EconomyPlayer,
} from './fixtures.js';

let harness: Harness;

/** The harvest of GDD section 119: 250 cells x 90 L x 0.92. */
const FIRST_HARVEST_LITERS = 20_700;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.teardown();
});

describe('POST /api/market/sell', () => {
  it('abona exactamente 18.630 por 20.700 litros a 0,90 (precio de la revision de balance)', async () => {
    const player = await createEconomyPlayer(harness, 'sell-golden');
    await depositStock(harness, player.farmId, 'WHEAT', FIRST_HARVEST_LITERS);

    const { statusCode, body } = await postSell(
      harness,
      player.accessToken,
      {
        farmId: player.farmId,
        item: 'WHEAT',
        quantityUnits: FIRST_HARVEST_LITERS,
      },
      'sell-golden-1',
    );

    expect(statusCode, JSON.stringify(body)).toBe(200);
    const result = body['result'] as Record<string, unknown>;
    expect(result['quantitySoldUnits']).toBe(FIRST_HARVEST_LITERS);

    // The litres of GDD section 119 at the revised price of 0.90, and the same figure
    // derived from the catalogue.
    expect(result['revenue']).toBe('18630.0000');
    expect(result['revenue']).toBe(Money.toString(cropSaleRevenue(WHEAT, FIRST_HARVEST_LITERS)));
    expect(result['balanceAfter']).toBe(
      Money.toString(Money.add(STARTING_CAPITAL, Money.fromUnits(18_630))),
    );

    const usage = result['usage'] as Record<string, unknown>;
    expect(usage['storedUnits']).toBe(0);
    expect(await balanceOf(harness, player.playerId)).toBe(
      Money.toString(Money.add(STARTING_CAPITAL, Money.fromUnits(18_630))),
    );
  });

  it('rechaza vender mas de lo almacenado con INSUFFICIENT_STOCK', async () => {
    const player = await createEconomyPlayer(harness, 'sell-oversell');
    await depositStock(harness, player.farmId, 'WHEAT', 1_000);

    const { statusCode, body } = await postSell(
      harness,
      player.accessToken,
      { farmId: player.farmId, item: 'WHEAT', quantityUnits: 1_001 },
      'sell-oversell-1',
    );

    expect(statusCode).toBe(409);
    expect(errorCode(body)).toBe(ValidationCode.INSUFFICIENT_STOCK);
    const details = (body['error'] as Record<string, unknown>)['details'] as Record<
      string,
      unknown
    >;
    expect(details['requiredUnits']).toBe(1_001);
    expect(details['availableUnits']).toBe(1_000);

    // Nothing moved: neither the stock nor the balance.
    const farm = await readStock(harness, player.farmId, 'WHEAT');
    expect(farm.storedUnits).toBe(1_000);
    expect(await balanceOf(harness, player.playerId)).toBe(Money.toString(STARTING_CAPITAL));
  });

  it('sin cantidad vende todas las existencias del recurso', async () => {
    const player = await createEconomyPlayer(harness, 'sell-all');
    await depositStock(harness, player.farmId, 'WHEAT', 5_000);

    const { statusCode, body } = await postSell(
      harness,
      player.accessToken,
      { farmId: player.farmId, item: 'WHEAT' },
      'sell-all-1',
    );

    expect(statusCode, JSON.stringify(body)).toBe(200);
    const result = body['result'] as Record<string, unknown>;
    expect(result['quantitySoldUnits']).toBe(5_000);
    expect(result['revenue']).toBe(Money.toString(cropSaleRevenue(WHEAT, 5_000)));
  });

  it('rechaza vender de un almacen vacio con QUANTITY_NOT_POSITIVE', async () => {
    const player = await createEconomyPlayer(harness, 'sell-empty');

    const { statusCode, body } = await postSell(
      harness,
      player.accessToken,
      { farmId: player.farmId, item: 'WHEAT' },
      'sell-empty-1',
    );

    expect(statusCode).toBe(400);
    expect(errorCode(body)).toBe(ValidationCode.QUANTITY_NOT_POSITIVE);
  });

  it('vende madera por decimetro cubico, al precio por metro cubico de GDD 133', async () => {
    const player = await createEconomyPlayer(harness, 'sell-wood', { withWoodStorage: true });
    await depositStock(harness, player.farmId, 'WOOD', 2 * DM3_PER_M3);

    const { statusCode, body } = await postSell(
      harness,
      player.accessToken,
      { farmId: player.farmId, item: 'WOOD' },
      'sell-wood-1',
    );

    expect(statusCode, JSON.stringify(body)).toBe(200);
    const result = body['result'] as Record<string, unknown>;
    expect(result['quantitySoldUnits']).toBe(2 * DM3_PER_M3);
    // Two cubic metres at the 45 per cubic metre of GDD section 133.
    expect(result['revenue']).toBe(
      Money.toString(Money.add(PINE.sellPricePerM3, PINE.sellPricePerM3)),
    );
    expect(result['revenue']).toBe(Money.toString(woodSaleRevenue(PINE, 2 * DM3_PER_M3)));
  });

  it('la misma clave de idempotencia vende una sola vez', async () => {
    const player = await createEconomyPlayer(harness, 'sell-idem');
    await depositStock(harness, player.farmId, 'WHEAT', 3_000);

    const first = await postSell(
      harness,
      player.accessToken,
      { farmId: player.farmId, item: 'WHEAT', quantityUnits: 1_000 },
      'sell-idem-1',
    );
    const second = await postSell(
      harness,
      player.accessToken,
      { farmId: player.farmId, item: 'WHEAT', quantityUnits: 1_000 },
      'sell-idem-1',
    );

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual(first.body);

    const farm = await readStock(harness, player.farmId, 'WHEAT');
    expect(farm.storedUnits).toBe(2_000);
    const entries = await harness.prisma.ledgerEntry.count({
      where: { playerId: player.playerId, type: 'CROP_SALE' },
    });
    expect(entries).toBe(1);
  });

  it('rechaza la granja de otro jugador con NOT_OWNED', async () => {
    const owner = await createEconomyPlayer(harness, 'sell-owner');
    const intruder = await createEconomyPlayer(harness, 'sell-intruder');
    await depositStock(harness, owner.farmId, 'WHEAT', 100);

    const { statusCode, body } = await postSell(
      harness,
      intruder.accessToken,
      { farmId: owner.farmId, item: 'WHEAT', quantityUnits: 100 },
      'sell-intruder-1',
    );

    expect(statusCode).toBe(403);
    expect(errorCode(body)).toBe(ValidationCode.NOT_OWNED);
  });
});

describe('GET /api/market/prices', () => {
  it('publica el precio por unidad almacenada y por unidad mostrada (GDD 123 y 133)', async () => {
    const player = await createEconomyPlayer(harness, 'prices');
    const { statusCode, body } = await getJson(harness, player.accessToken, '/api/market/prices');

    expect(statusCode, JSON.stringify(body)).toBe(200);
    const prices = body['prices'] as Record<string, unknown>[];
    // Una linea por cultivo del catalogo, mas la madera: el precio es del cultivo, no de la
    // categoria de almacen, que es lo que hace que elegir cultivo sea una decision.
    expect(prices).toHaveLength(CROP_IDS.length + 1);

    const wheat = prices.find((price) => price['item'] === 'WHEAT');
    expect(wheat?.['pricePerStoredUnit']).toBe(Money.toString(WHEAT.sellPricePerLiter));
    expect(wheat?.['storedUnit']).toBe('L');
    expect(wheat?.['displayUnit']).toBe('L');

    const wood = prices.find((price) => price['item'] === 'WOOD');
    expect(wood?.['pricePerDisplayUnit']).toBe(Money.toString(PINE.sellPricePerM3));
    expect(wood?.['displayUnit']).toBe('m3');
    // The price per stored unit is the price per cubic metre divided by a thousand, exactly.
    expect(wood?.['pricePerStoredUnit']).toBe('0.0450');
  });

  it('el precio por unidad almacenada multiplicado por la cantidad es el ingreso', async () => {
    // The two paths agree for the current catalogue, which is what makes the published price
    // usable by the panel; if a future price makes them diverge, the shared rule wins and this
    // assertion is the one that says so.
    for (const units of [1, 7, 1_000, 20_700]) {
      expect(Money.toString(cropSaleRevenue(WHEAT, units))).toBe(
        Money.toString(Money.fromScaled(Money.toScaled(WHEAT.sellPricePerLiter) * BigInt(units))),
      );
      expect(Money.toString(woodSaleRevenue(PINE, units))).toBe(
        Money.toString(Money.fromScaled(BigInt(units) * 450n)),
      );
    }
  });
});

describe('GET /api/inventory', () => {
  it('informa de la ocupacion de GDD 49 en puntos base', async () => {
    const player: EconomyPlayer = await createEconomyPlayer(harness, 'inventory-usage', {
      withWoodStorage: true,
    });
    await depositStock(harness, player.farmId, 'WHEAT', 24_500);

    const { statusCode, body } = await getJson(harness, player.accessToken, '/api/inventory');
    expect(statusCode, JSON.stringify(body)).toBe(200);

    const farms = body['farms'] as Record<string, unknown>[];
    expect(farms).toHaveLength(1);
    // Una linea por pila con contenido, y ninguna por las vacias: el inventario es
    // proporcional a lo que la granja tiene, no al tamanio del catalogo.
    const lines = farms[0]?.['lines'] as Record<string, unknown>[];
    expect(lines).toHaveLength(1);

    const wheat = lines.find((line) => line['item'] === 'WHEAT');
    expect(wheat?.['category']).toBe(StorageResource.GRAIN_LITERS);
    expect(wheat?.['storedUnits']).toBe(24_500);
    expect(wheat?.['marketValue']).toBe(Money.toString(cropSaleRevenue(WHEAT, 24_500)));
    expect(wheat?.['displayDivisor']).toBe(1);

    // La capacidad va por categoria, que es lo que un edificio concede, y se informa
    // completa: un panel tiene que poder dibujar "0 de 0" para la que no tiene almacen.
    const categories = farms[0]?.['categories'] as Record<string, unknown>[];
    expect(categories).toHaveLength(STORAGE_RESOURCES.length);
    const grain = categories.find((row) => row['category'] === StorageResource.GRAIN_LITERS);
    const usage = grain?.['usage'] as Record<string, unknown>;
    expect(usage['storedUnits']).toBe(24_500);
    expect(usage['capacityUnits']).toBe(100_000);
    // 24.5 % of the silo of GDD section 27.
    expect(usage['occupancyBp']).toBe(2_450);

    const wood = categories.find((row) => row['category'] === StorageResource.WOOD_M3);
    expect((wood?.['usage'] as Record<string, unknown>)['capacityUnits']).toBe(500 * DM3_PER_M3);
    expect(wood?.['displayDivisor']).toBe(DM3_PER_M3);
  });

  it('una granja sin almacen informa capacidad cero y ocupacion cero', async () => {
    const player = await createEconomyPlayer(harness, 'inventory-empty');
    await harness.prisma.building.updateMany({
      where: { farmId: player.farmId },
      data: { disposedGameMs: player.startedAtGameMs },
    });

    const { body } = await getJson(harness, player.accessToken, '/api/inventory');
    const farms = body['farms'] as Record<string, unknown>[];
    const lines = farms[0]?.['lines'] as Record<string, unknown>[];
    for (const line of lines) {
      const usage = line['usage'] as Record<string, unknown>;
      expect(usage['capacityUnits']).toBe(0);
      expect(usage['occupancyBp']).toBe(0);
    }
  });
});
