import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOGUE } from '../../config/buildings.js';
import { WHEAT } from '../../config/crops.js';
import { RESALE_FACTOR_BP } from '../../config/economy.js';
import { PINE } from '../../config/forestry.js';
import { MACHINE_CATALOGUE } from '../../config/machines.js';
import { MachineType, type TerrainType } from '../../domain/enums.js';
import { Money } from '../../domain/money.js';
import { BP_ONE, bp } from '../../domain/units.js';
import {
  buildingResaleValue,
  cellPrice,
  cropSaleRevenue,
  landPurchasePrice,
  landResaleValue,
  liquidationValue,
  machineResaleValue,
  multiplyByCount,
  realBuildingCost,
  woodSaleRevenue,
} from '../pricing.js';

// Prices of GDD sections 115, 116, 123 and 133, and the resale values plan section 6.6
// needs for forced liquidation.

describe('cellPrice (GDD section 115)', () => {
  it('returns the published base price with the multipliers at 1.0', () => {
    expect(cellPrice('GRASS')).toBe(Money.fromUnits(120));
    expect(cellPrice('FOREST')).toBe(Money.fromUnits(70));
  });

  it('returns null for terrain that cannot be bought (GDD sections 8, 11 and 12)', () => {
    expect(cellPrice('MOUNTAIN')).toBeNull();
    expect(cellPrice('WATER')).toBeNull();
  });

  it('applies the multipliers when they are not neutral', () => {
    const doubled = cellPrice('GRASS', {
      basePriceByTerrain: {
        GRASS: Money.fromUnits(120),
        FOREST: null,
        MOUNTAIN: null,
        WATER: null,
      },
      locationMultiplierBp: bp(15_000 - 5_000),
      accessibilityMultiplierBp: bp(5_000),
    });
    expect(doubled).toBe(Money.fromUnits(60));
  });
});

describe('landPurchasePrice (GDD section 115)', () => {
  it('prices the 330 cells of GDD section 117 at 39 600', () => {
    const terrains: TerrainType[] = Array.from({ length: 330 }, () => 'GRASS');
    const breakdown = landPurchasePrice(terrains);
    expect(breakdown.total).toBe(Money.fromUnits(39_600));
    expect(breakdown.pricedCells).toBe(330);
    expect(breakdown.notPurchasableCells).toBe(0);
  });

  it('mixes terrains and counts what cannot be bought apart', () => {
    const breakdown = landPurchasePrice(['GRASS', 'GRASS', 'FOREST', 'WATER', 'MOUNTAIN']);
    expect(breakdown.total).toBe(Money.fromUnits(310));
    expect(breakdown.pricedCells).toBe(3);
    expect(breakdown.notPurchasableCells).toBe(2);
  });

  it('is zero for an empty selection', () => {
    expect(landPurchasePrice([]).total).toBe(Money.ZERO);
  });

  it('multiplies exactly, without accumulating a floating point error over 2 000 cells', () => {
    const terrains: TerrainType[] = Array.from({ length: 2_000 }, () => 'FOREST');
    expect(landPurchasePrice(terrains).total).toBe(Money.fromUnits(140_000));
    expect(multiplyByCount(Money.fromString('0.0001'), 3)).toBe(Money.fromString('0.0003'));
    expect(multiplyByCount(Money.fromUnits(120), 0)).toBe(Money.ZERO);
    expect(multiplyByCount(Money.fromUnits(120), -4)).toBe(Money.ZERO);
  });
});

describe('realBuildingCost (GDD sections 116 and 117)', () => {
  it('charges only the structure when the land is already owned', () => {
    // Resolution of GDD section 116 against GDD section 117: applying the published
    // formula literally would charge the 330 cells of the setup twice.
    const owned = realBuildingCost('GARAGE', { landAlreadyOwned: true, terrain: 'GRASS' });
    expect(owned.purchasePrice).toBe(Money.fromUnits(8_000));
    expect(owned.landCost).toBe(Money.ZERO);
    expect(owned.total).toBe(Money.fromUnits(8_000));
  });

  it('charges the footprint when the land is not owned yet', () => {
    // 8 000 + 48 cells x 120 = 13 760.
    const unowned = realBuildingCost('GARAGE', { landAlreadyOwned: false, terrain: 'GRASS' });
    expect(unowned.landCost).toBe(Money.fromUnits(5_760));
    expect(unowned.total).toBe(Money.fromUnits(13_760));
  });

  it('always reports the literal formula of GDD section 116 as planning help', () => {
    const owned = realBuildingCost('SILO', { landAlreadyOwned: true, terrain: 'GRASS' });
    // 10 000 + 16 x 120 = 11 920, which is what the planning panel shows.
    expect(owned.plannedCostWithLand).toBe(Money.fromUnits(11_920));
    expect(owned.total).toBe(Money.fromUnits(10_000));
  });

  it('reproduces the 23 000 of buildings in GDD section 117 on owned land', () => {
    const total = Money.sum(
      (['GARAGE', 'SILO', 'WORKER_HOME'] as const).map(
        (type) => realBuildingCost(type, { landAlreadyOwned: true, terrain: 'GRASS' }).total,
      ),
    );
    expect(total).toBe(Money.fromUnits(23_000));
  });

  it('charges nothing for land on terrain that has no price', () => {
    const onWater = realBuildingCost('SILO', { landAlreadyOwned: false, terrain: 'WATER' });
    expect(onWater.landCost).toBe(Money.ZERO);
  });
});

describe('sales (GDD sections 123 and 133)', () => {
  it('sells grain at the fixed price per litre', () => {
    expect(cropSaleRevenue(WHEAT, 20_700)).toBe(Money.fromUnits(4_554));
    expect(cropSaleRevenue(WHEAT, 1)).toBe(Money.fromString('0.22'));
    expect(cropSaleRevenue(WHEAT, 0)).toBe(Money.ZERO);
    expect(cropSaleRevenue(WHEAT, -100)).toBe(Money.ZERO);
    // The 24 500 L of the interface example of GDD section 49.
    expect(cropSaleRevenue(WHEAT, 24_500)).toBe(Money.fromUnits(5_390));
  });

  it('sells wood per cubic metre from a stock held in cubic decimetres', () => {
    expect(woodSaleRevenue(PINE, 1_000)).toBe(Money.fromUnits(45));
    expect(woodSaleRevenue(PINE, 382_500)).toBe(Money.fromString('17212.50'));
    // One mature tree is 1.8 m³ (GDD section 131): 1.8 x 45 = 81.
    expect(woodSaleRevenue(PINE, 1_800)).toBe(Money.fromUnits(81));
    // A single cubic decimetre is 0.045, which the four decimal scale holds exactly.
    expect(woodSaleRevenue(PINE, 1)).toBe(Money.fromString('0.045'));
    expect(woodSaleRevenue(PINE, 0)).toBe(Money.ZERO);
  });

  it('fills one wood store to capacity at 22 500', () => {
    expect(woodSaleRevenue(PINE, BUILDING_CATALOGUE.WOOD_STORAGE.capacity ?? 0)).toBe(
      Money.fromUnits(22_500),
    );
  });
});

describe('resale and liquidation value (plan section 6.6)', () => {
  it('scales the machine resale value by the resale factor and by condition', () => {
    expect(RESALE_FACTOR_BP).toBe(6_000);
    // 18 000 x 0.6 x 1.0 = 10 800 for a new tractor.
    expect(
      machineResaleValue({ purchasePrice: Money.fromUnits(18_000), conditionBp: BP_ONE }),
    ).toBe(Money.fromUnits(10_800));
    // Half worn: 18 000 x 0.6 x 0.5 = 5 400.
    expect(
      machineResaleValue({ purchasePrice: Money.fromUnits(18_000), conditionBp: bp(5_000) }),
    ).toBe(Money.fromUnits(5_400));
    // A machine at zero condition is worth nothing, which is what keeps buy and resell
    // from being a free option.
    expect(machineResaleValue({ purchasePrice: Money.fromUnits(18_000), conditionBp: bp(0) })).toBe(
      Money.ZERO,
    );
  });

  it('scales buildings and land by the resale factor alone', () => {
    expect(buildingResaleValue('GARAGE')).toBe(Money.fromUnits(4_800));
    expect(landResaleValue('GRASS', 100)).toBe(Money.fromUnits(7_200));
    expect(landResaleValue('MOUNTAIN', 100)).toBe(Money.ZERO);
  });

  it('values a whole holding, with stock at the market price', () => {
    const breakdown = liquidationValue(
      {
        machines: [
          {
            type: MachineType.TRACTOR,
            purchasePrice: MACHINE_CATALOGUE.TRACTOR.purchasePrice,
            conditionBp: BP_ONE,
          },
          {
            type: MachineType.HARVESTER,
            purchasePrice: MACHINE_CATALOGUE.HARVESTER.purchasePrice,
            conditionBp: bp(5_000),
          },
        ],
        buildings: ['GARAGE', 'SILO'],
        unusedLandCells: Array.from({ length: 50 }, () => 'GRASS' as const),
        storedWheatLiters: 10_000,
        storedWoodDm3: 0,
      },
      { crop: WHEAT, species: PINE },
    );
    // Stock: 10 000 L x 0.22 = 2 200.
    expect(breakdown.inventory).toBe(Money.fromUnits(2_200));
    // Machines: 10 800 + 42 000 x 0.6 x 0.5 = 10 800 + 12 600 = 23 400.
    expect(breakdown.machines).toBe(Money.fromUnits(23_400));
    // Buildings: (8 000 + 10 000) x 0.6 = 10 800.
    expect(breakdown.buildings).toBe(Money.fromUnits(10_800));
    // Land: 50 x 120 x 0.6 = 3 600.
    expect(breakdown.land).toBe(Money.fromUnits(3_600));
    expect(breakdown.total).toBe(Money.fromUnits(40_000));
  });

  it('falls back to the catalogue price for a machine with no recorded price', () => {
    const breakdown = liquidationValue({
      machines: [{ type: MachineType.TRACTOR, purchasePrice: Money.ZERO, conditionBp: BP_ONE }],
      buildings: [],
      unusedLandCells: [],
      storedWheatLiters: 0,
      storedWoodDm3: 0,
    });
    expect(breakdown.machines).toBe(Money.fromUnits(10_800));
  });

  it('is zero for an empty holding', () => {
    expect(
      liquidationValue({
        machines: [],
        buildings: [],
        unusedLandCells: [],
        storedWheatLiters: 0,
        storedWoodDm3: 0,
      }).total,
    ).toBe(Money.ZERO);
  });
});
