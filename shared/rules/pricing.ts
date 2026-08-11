// Prices: land, buildings, sales and liquidation value.
//
// Owner: workflow W2 (pure rules).
//
// Two points where this module deliberately departs from a literal reading of the
// GDD, both resolved by plan section 2.2:
//
//   - GDD section 116 defines `realBuildingCost = purchasePrice + footprint x cellPrice`.
//     Applied literally it charges the land twice for a player who already owns the
//     plot, which is precisely the case GDD section 117 describes. The formula is
//     therefore planning help, shown by the interface, while the transactional price
//     charges the land only when it is not already owned. The parameter
//     `landAlreadyOwned` makes the difference explicit at every call site.
//   - The GDD defines no resale price at all. `RESALE_FACTOR_BP` is an invented
//     value, justified in shared/config, and for machinery it is additionally scaled
//     by condition, which is the formula this module implements.

import { BUILDING_CATALOGUE, type BuildingDefinition } from '../config/buildings.js';
import { type CropDefinition } from '../config/crops.js';
import {
  ACCESSIBILITY_MULTIPLIER_BP,
  BASE_PRICE_BY_TERRAIN,
  LOCATION_MULTIPLIER_BP,
  RESALE_FACTOR_BP,
} from '../config/economy.js';
import { type TreeSpeciesDefinition } from '../config/forestry.js';
import { MACHINE_CATALOGUE, type MachineDefinition } from '../config/machines.js';
import { type BuildingType, type MachineType, type TerrainType } from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { DM3_PER_M3, type Bp } from '../domain/units.js';

/** Multipliers of the land price, fixed at 1.0 in the MVP (GDD sections 115, 126). */
export interface LandPriceConfig {
  readonly basePriceByTerrain: Readonly<Record<TerrainType, Money | null>>;
  readonly locationMultiplierBp: Bp;
  readonly accessibilityMultiplierBp: Bp;
}

export const DEFAULT_LAND_PRICE_CONFIG: LandPriceConfig = {
  basePriceByTerrain: BASE_PRICE_BY_TERRAIN,
  locationMultiplierBp: LOCATION_MULTIPLIER_BP,
  accessibilityMultiplierBp: ACCESSIBILITY_MULTIPLIER_BP,
};

/** Multiplies an amount by a whole count, exactly and without re-parsing. */
export function multiplyByCount(amount: Money, count: number): Money {
  const whole = count > 0 ? Math.floor(count) : 0;
  return Money.fromScaled(Money.toScaled(amount) * BigInt(whole));
}

/**
 * Price of one cell (GDD section 115):
 * `basePriceByTerrain x locationMultiplier x accessibilityMultiplier`.
 *
 * Null for terrain that cannot be bought. Mountain and water are expressed as the
 * absence of a price rather than as a flag, so there is one source of that truth.
 */
export function cellPrice(
  terrain: TerrainType,
  config: LandPriceConfig = DEFAULT_LAND_PRICE_CONFIG,
): Money | null {
  const base = config.basePriceByTerrain[terrain];
  if (base === null) {
    return null;
  }
  return Money.mulBp(
    Money.mulBp(base, config.locationMultiplierBp),
    config.accessibilityMultiplierBp,
  );
}

export interface LandPriceBreakdown {
  readonly total: Money;
  /** Cells that were priced, that is the purchasable ones. */
  readonly pricedCells: number;
  /** Cells whose terrain has no price (GDD sections 8, 11 and 12). */
  readonly notPurchasableCells: number;
}

/**
 * Price of a selection of cells, described by their terrain (GDD section 115).
 *
 * The unpurchasable cells are counted rather than priced: the selection rules reject
 * them with `TERRAIN_NOT_PURCHASABLE`, and the interface still needs to show a
 * budget for the part of the drag that is valid.
 */
export function landPurchasePrice(
  terrains: readonly TerrainType[],
  config: LandPriceConfig = DEFAULT_LAND_PRICE_CONFIG,
): LandPriceBreakdown {
  const counts = new Map<TerrainType, number>();
  let notPurchasableCells = 0;
  for (const terrain of terrains) {
    counts.set(terrain, (counts.get(terrain) ?? 0) + 1);
  }
  let total = Money.ZERO;
  let pricedCells = 0;
  for (const [terrain, count] of counts) {
    const price = cellPrice(terrain, config);
    if (price === null) {
      notPurchasableCells += count;
      continue;
    }
    total = Money.add(total, multiplyByCount(price, count));
    pricedCells += count;
  }
  return { total, pricedCells, notPurchasableCells };
}

export interface BuildingCostBreakdown {
  /** The catalogue price of the structure (GDD section 116). */
  readonly purchasePrice: Money;
  /** Price of the footprint, zero when the land is already owned. */
  readonly landCost: Money;
  /** What the player is actually charged. */
  readonly total: Money;
  readonly footprintCells: number;
  /**
   * The literal formula of GDD section 116, always including the land. It is what
   * the planning panel shows, and it differs from `total` exactly when the player
   * already owns the plot.
   */
  readonly plannedCostWithLand: Money;
}

/**
 * Cost of erecting a building (GDD sections 116 and 117).
 *
 * `landAlreadyOwned` decides whether the footprint is charged, which is the
 * resolution of GDD section 116 against GDD section 117: the setup of GDD section
 * 117 buys the 330 cells once and then pays only the structures.
 */
export function realBuildingCost(
  type: BuildingType,
  input: {
    readonly landAlreadyOwned: boolean;
    /** Terrain of the footprint. A building sits on one kind of terrain. */
    readonly terrain: TerrainType;
  },
  options: {
    readonly catalogue?: Readonly<Record<BuildingType, BuildingDefinition>>;
    readonly landPrice?: LandPriceConfig;
  } = {},
): BuildingCostBreakdown {
  const definition = (options.catalogue ?? BUILDING_CATALOGUE)[type];
  const perCell = cellPrice(input.terrain, options.landPrice ?? DEFAULT_LAND_PRICE_CONFIG);
  const footprintPrice =
    perCell === null ? Money.ZERO : multiplyByCount(perCell, definition.footprintCells);
  const landCost = input.landAlreadyOwned ? Money.ZERO : footprintPrice;
  return {
    purchasePrice: definition.purchasePrice,
    landCost,
    total: Money.add(definition.purchasePrice, landCost),
    footprintCells: definition.footprintCells,
    plannedCostWithLand: Money.add(definition.purchasePrice, footprintPrice),
  };
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/**
 * Revenue of a grain sale (GDD sections 82, 119 and 123): a fixed price per litre,
 * with no fluctuation in the MVP.
 */
export function cropSaleRevenue(crop: CropDefinition, liters: number): Money {
  return multiplyByCount(crop.sellPricePerLiter, liters);
}

/**
 * Revenue of a wood sale (GDD sections 133 and 138). The stock is held in cubic
 * decimetres, so the price per cubic metre is divided by a thousand exactly, using
 * the scaled integer representation of the amount rather than a floating point
 * division.
 */
export function woodSaleRevenue(species: TreeSpeciesDefinition, volumeDm3: number): Money {
  const volume = volumeDm3 > 0 ? Math.floor(volumeDm3) : 0;
  const scaled = Money.toScaled(species.sellPricePerM3) * BigInt(volume);
  const perM3 = BigInt(DM3_PER_M3);
  // Half away from zero on the last stored decimal, matching the Money convention.
  const quotient = scaled / perM3;
  const remainder = scaled % perM3;
  const rounded = remainder * 2n >= perM3 ? quotient + 1n : quotient;
  return Money.fromScaled(rounded);
}

// ---------------------------------------------------------------------------
// Liquidation value
// ---------------------------------------------------------------------------

/** Resale parameters. Invented values; the GDD defines no resale price. */
export interface ResaleConfig {
  readonly resaleFactorBp: Bp;
}

export const DEFAULT_RESALE_CONFIG: ResaleConfig = { resaleFactorBp: RESALE_FACTOR_BP };

/**
 * What a machine fetches when it is sold back. The resale factor is scaled by
 * condition, so a worn machine is worth less: without it, buying and immediately
 * reselling would be a free option and the garage capacity of GDD section 96 would
 * stop being a real decision.
 */
export function machineResaleValue(
  machine: { readonly purchasePrice: Money; readonly conditionBp: Bp },
  config: ResaleConfig = DEFAULT_RESALE_CONFIG,
): Money {
  return Money.mulBp(
    Money.mulBp(machine.purchasePrice, config.resaleFactorBp),
    machine.conditionBp,
  );
}

/** What a building fetches when it is demolished and sold back. */
export function buildingResaleValue(
  type: BuildingType,
  options: {
    readonly catalogue?: Readonly<Record<BuildingType, BuildingDefinition>>;
    readonly resale?: ResaleConfig;
  } = {},
): Money {
  const definition = (options.catalogue ?? BUILDING_CATALOGUE)[type];
  return Money.mulBp(
    definition.purchasePrice,
    (options.resale ?? DEFAULT_RESALE_CONFIG).resaleFactorBp,
  );
}

/** What a cell fetches when the land is sold back. */
export function landResaleValue(
  terrain: TerrainType,
  cells: number,
  options: { readonly landPrice?: LandPriceConfig; readonly resale?: ResaleConfig } = {},
): Money {
  const perCell = cellPrice(terrain, options.landPrice ?? DEFAULT_LAND_PRICE_CONFIG);
  if (perCell === null) {
    return Money.ZERO;
  }
  return Money.mulBp(
    multiplyByCount(perCell, cells),
    (options.resale ?? DEFAULT_RESALE_CONFIG).resaleFactorBp,
  );
}

/** Everything a forced liquidation could turn into cash (plan section 6.6). */
export interface LiquidatableHolding {
  readonly machines: readonly {
    readonly type: MachineType;
    readonly purchasePrice: Money;
    readonly conditionBp: Bp;
  }[];
  readonly buildings: readonly BuildingType[];
  /** Owned cells with no field, forest plot or building on them, by terrain. */
  readonly unusedLandCells: readonly TerrainType[];
  readonly storedWheatLiters: number;
  readonly storedWoodDm3: number;
}

export interface LiquidationValueBreakdown {
  readonly inventory: Money;
  readonly machines: Money;
  readonly buildings: Money;
  readonly land: Money;
  readonly total: Money;
}

/**
 * Liquidatable value of a holding, in the order of the steps of
 * `LIQUIDATION_STEPS`. It is the denominator of the debt threshold of plan section
 * 6.6: forced liquidation triggers when the debt passes a fraction of this value.
 *
 * Stock is valued at the market price, since GDD section 123 fixes it and selling
 * grain destroys no capability; every other asset is valued at its resale price.
 */
export function liquidationValue(
  holding: LiquidatableHolding,
  options: {
    readonly crop?: CropDefinition;
    readonly species?: TreeSpeciesDefinition;
    readonly catalogue?: Readonly<Record<BuildingType, BuildingDefinition>>;
    readonly machineCatalogue?: Readonly<Record<MachineType, MachineDefinition>>;
    readonly landPrice?: LandPriceConfig;
    readonly resale?: ResaleConfig;
  } = {},
): LiquidationValueBreakdown {
  const resale = options.resale ?? DEFAULT_RESALE_CONFIG;
  const machineCatalogue = options.machineCatalogue ?? MACHINE_CATALOGUE;

  const inventory = Money.add(
    options.crop === undefined
      ? Money.ZERO
      : cropSaleRevenue(options.crop, holding.storedWheatLiters),
    options.species === undefined
      ? Money.ZERO
      : woodSaleRevenue(options.species, holding.storedWoodDm3),
  );

  const machines = Money.sum(
    holding.machines.map((machine) =>
      machineResaleValue(
        {
          // A machine whose purchase price was not recorded falls back to the
          // catalogue price, which is what a seeded machine has.
          purchasePrice: Money.isZero(machine.purchasePrice)
            ? machineCatalogue[machine.type].purchasePrice
            : machine.purchasePrice,
          conditionBp: machine.conditionBp,
        },
        resale,
      ),
    ),
  );

  const buildings = Money.sum(
    holding.buildings.map((type) =>
      buildingResaleValue(type, {
        ...(options.catalogue === undefined ? {} : { catalogue: options.catalogue }),
        resale,
      }),
    ),
  );

  const landCounts = new Map<TerrainType, number>();
  for (const terrain of holding.unusedLandCells) {
    landCounts.set(terrain, (landCounts.get(terrain) ?? 0) + 1);
  }
  let land = Money.ZERO;
  for (const [terrain, count] of landCounts) {
    land = Money.add(
      land,
      landResaleValue(terrain, count, {
        ...(options.landPrice === undefined ? {} : { landPrice: options.landPrice }),
        resale,
      }),
    );
  }

  return {
    inventory,
    machines,
    buildings,
    land,
    total: Money.sum([inventory, machines, buildings, land]),
  };
}
