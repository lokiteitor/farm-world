// Building catalogue.
//
// Owner: workflow W2 (vocabulary).
//
// The four buildings of GDD section 116 plus the wood store of GDD section 136, which
// is modelled as a separate building and not as a flag on the silo, because they are
// conceptually separate infrastructure investments (GDD section 3.5).
//
// On the price: GDD section 116 defines
// `realBuildingCost = purchasePrice + footprint x cellPrice`. Applied literally that
// charges the land twice for a player who already owns the plot, so plan section 2.2
// resolves it this way: the formula is planning help, shown by the interface, while the
// transactional price is `purchasePrice` when the land is already owned and
// `purchasePrice` plus the cells at the price of GDD section 115 when it is not.

import { BuildingType, type StorageResource } from '../domain/enums.js';
import { Money } from '../domain/money.js';
import { DM3_PER_M3 } from '../domain/units.js';

/** What the capacity of a building counts. */
export type BuildingCapacityKind = 'MACHINES' | 'WORKERS' | 'STORAGE' | 'NONE';

/**
 * Unit each fungible resource is stored in, and how the interface presents it.
 *
 * Stock is always an integer in the stored unit, so wood is counted in cubic
 * decimetres: the volumes of GDD section 131 are multiples of 0.05 m³ and adding
 * thousands of them as floating point numbers would make the result depend on the
 * order of the sum.
 */
export const STORAGE_RESOURCE_UNITS: Readonly<
  Record<
    StorageResource,
    { readonly storedUnit: string; readonly displayUnit: string; readonly displayDivisor: number }
  >
> = {
  WHEAT_LITERS: { storedUnit: 'L', displayUnit: 'L', displayDivisor: 1 },
  WOOD_M3: { storedUnit: 'dm3', displayUnit: 'm3', displayDivisor: DM3_PER_M3 },
};

export interface BuildingDefinition {
  readonly type: BuildingType;
  readonly purchasePrice: Money;
  readonly widthCells: number;
  readonly heightCells: number;
  /** `widthCells x heightCells`. The coherence test checks the product. */
  readonly footprintCells: number;
  readonly capacityKind: BuildingCapacityKind;
  /** Capacity in the unit implied by `capacityKind`, or null when there is none. */
  readonly capacity: number | null;
  readonly capacityResource: StorageResource | null;
  /** Whether the building grants access to repair (GDD sections 29 and 93). */
  readonly providesRepair: boolean;
}

export const BUILDING_CATALOGUE: Readonly<Record<BuildingType, BuildingDefinition>> = {
  // GDD sections 26 and 116.
  GARAGE: {
    type: BuildingType.GARAGE,
    purchasePrice: Money.fromUnits(8_000),
    widthCells: 6,
    heightCells: 8,
    footprintCells: 48,
    capacityKind: 'MACHINES',
    capacity: 4,
    capacityResource: null,
    providesRepair: false,
  },
  // GDD sections 27 and 116.
  SILO: {
    type: BuildingType.SILO,
    purchasePrice: Money.fromUnits(10_000),
    widthCells: 4,
    heightCells: 4,
    footprintCells: 16,
    capacityKind: 'STORAGE',
    capacity: 100_000,
    capacityResource: 'WHEAT_LITERS',
    providesRepair: false,
  },
  // GDD sections 28 and 116.
  WORKER_HOME: {
    type: BuildingType.WORKER_HOME,
    purchasePrice: Money.fromUnits(5_000),
    widthCells: 4,
    heightCells: 4,
    footprintCells: 16,
    capacityKind: 'WORKERS',
    capacity: 4,
    capacityResource: null,
    providesRepair: false,
  },
  // GDD sections 29 and 116.
  WORKSHOP: {
    type: BuildingType.WORKSHOP,
    purchasePrice: Money.fromUnits(9_000),
    widthCells: 5,
    heightCells: 5,
    footprintCells: 25,
    capacityKind: 'NONE',
    capacity: null,
    capacityResource: null,
    providesRepair: true,
  },
  // GDD section 136, which gives price and capacity but no footprint. The 6 x 8 of the
  // garage is used, which is an invented figure justified by the shape of the activity:
  // stacked logs need yard space, so the wood store is the largest footprint of the
  // catalogue together with the garage. The capacity is the 500 m³ of GDD section 136,
  // expressed in the stored unit.
  WOOD_STORAGE: {
    type: BuildingType.WOOD_STORAGE,
    purchasePrice: Money.fromUnits(12_000),
    widthCells: 6,
    heightCells: 8,
    footprintCells: 48,
    capacityKind: 'STORAGE',
    capacity: 500 * DM3_PER_M3,
    capacityResource: 'WOOD_M3',
    providesRepair: false,
  },
};

/**
 * Footprint of the minimum farm of GDD section 117: garage, silo and worker home. The
 * GDD rounds it to 80 cells while the catalogue adds up to 48 + 16 + 16 = 80, so the
 * two agree exactly. Kept as a constant because the starting guide and the balance
 * report both cite it.
 */
export const MINIMUM_FARM_FOOTPRINT_CELLS =
  BUILDING_CATALOGUE.GARAGE.footprintCells +
  BUILDING_CATALOGUE.SILO.footprintCells +
  BUILDING_CATALOGUE.WORKER_HOME.footprintCells;
