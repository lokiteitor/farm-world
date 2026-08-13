// The placement plan: the price of a building and the reasons a footprint is refused.
//
// Owner: W4-F.
//
// The suite exists to pin one property above all others: the breakdown the panel shows is
// the one `shared/rules/pricing.ts` produces, in both cases of land ownership, and neither
// figure is ever written as a literal here. A test that asserted `13760` would keep passing
// after somebody changed the catalogue and the panel started lying.
//
// The rest of the cases are the reasons a placement is refused, and each one is asserted by
// the `ValidationCode` of the contract rather than by its message, because the code is what
// the server answers with and the message is a lookup away.

import { describe, expect, it } from 'vitest';
import {
  footprintFromOrigin,
  originOfCells,
  planBuildingPlacement,
} from '~/components/panels/building-placement/placementPlan';
import {
  BUILDING_CATALOGUE,
  BuildingType,
  CellOwnership,
  LandUse,
  Money,
  TerrainType,
  ValidationCode,
  cellPrice,
  landPurchasePrice,
  multiplyByCount,
  realBuildingCost,
  type CellCoordWire,
  type SelectionCell,
} from '~/shared/index';

const ORIGIN: CellCoordWire = { cellX: 100, cellY: 100 };
const RICH = Money.fromUnits(200_000);

function key(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}

function owned(cell: CellCoordWire, over: Partial<SelectionCell> = {}): SelectionCell {
  return {
    cellX: cell.cellX,
    cellY: cell.cellY,
    terrain: TerrainType.GRASS,
    ownership: CellOwnership.PLAYER,
    landUse: LandUse.OWNED,
    hasStandingTree: false,
    ...over,
  };
}

function unowned(cell: CellCoordWire, over: Partial<SelectionCell> = {}): SelectionCell {
  return {
    cellX: cell.cellX,
    cellY: cell.cellY,
    terrain: TerrainType.GRASS,
    ownership: CellOwnership.UNOWNED,
    landUse: LandUse.NONE,
    hasStandingTree: false,
    ...over,
  };
}

function resolverOf(
  cells: readonly SelectionCell[],
): (x: number, y: number) => SelectionCell | null {
  const byKey = new Map(cells.map((cell) => [key(cell.cellX, cell.cellY), cell]));
  return (cellX, cellY) => byKey.get(key(cellX, cellY)) ?? null;
}

function codesOf(issues: readonly { code: ValidationCode }[]): readonly ValidationCode[] {
  return issues.map((issue) => issue.code);
}

describe('la huella', () => {
  it('toma el rectangulo del catalogo y no un literal', () => {
    const definition = BUILDING_CATALOGUE[BuildingType.GARAGE];
    const cells = footprintFromOrigin(BuildingType.GARAGE, ORIGIN);
    expect(cells).toHaveLength(definition.footprintCells);
    expect(cells).toHaveLength(definition.widthCells * definition.heightCells);
    expect(originOfCells(cells)).toEqual(ORIGIN);
  });

  it('devuelve la esquina noroeste sea cual sea el orden de las celdas', () => {
    const cells = [...footprintFromOrigin(BuildingType.SILO, ORIGIN)].reverse();
    expect(originOfCells(cells)).toEqual(ORIGIN);
  });
});

describe('el desglose de coste', () => {
  it('cobra solo la estructura cuando el suelo ya es del jugador', () => {
    const cells = footprintFromOrigin(BuildingType.GARAGE, ORIGIN);
    const plan = planBuildingPlacement({
      type: BuildingType.GARAGE,
      cells,
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: resolverOf(cells.map((cell) => owned(cell))),
    });

    const expected = realBuildingCost(BuildingType.GARAGE, {
      landAlreadyOwned: true,
      terrain: TerrainType.GRASS,
    });
    expect(plan.ok).toBe(true);
    expect(plan.landAlreadyOwned).toBe(true);
    expect(plan.cellsToBuy).toHaveLength(0);
    expect(plan.buildingPaid).toBe(expected.purchasePrice);
    expect(plan.landPaid).toBe(Money.ZERO);
    expect(plan.totalPaid).toBe(expected.total);
    // The planning figure of GDD section 116 keeps the land in, so the two differ exactly
    // in this case and that difference is what the panel shows as a reference.
    expect(plan.plannedCostWithLand).toBe(expected.plannedCostWithLand);
    expect(Money.compare(plan.plannedCostWithLand, plan.totalPaid)).toBe(1);
  });

  it('cobra estructura mas suelo de §115 cuando no lo es', () => {
    const cells = footprintFromOrigin(BuildingType.GARAGE, ORIGIN);
    const plan = planBuildingPlacement({
      type: BuildingType.GARAGE,
      cells,
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: resolverOf(cells.map((cell) => unowned(cell))),
    });

    const expected = realBuildingCost(BuildingType.GARAGE, {
      landAlreadyOwned: false,
      terrain: TerrainType.GRASS,
    });
    const land = landPurchasePrice(cells.map(() => TerrainType.GRASS)).total;
    expect(plan.ok).toBe(true);
    expect(plan.landAlreadyOwned).toBe(false);
    expect(plan.cellsToBuy).toHaveLength(BUILDING_CATALOGUE.GARAGE.footprintCells);
    expect(plan.landPaid).toBe(land);
    expect(plan.totalPaid).toBe(expected.total);
    // With the whole footprint bought, the transactional price and the literal formula of
    // GDD section 116 agree exactly, which is the property ADR-0011 states.
    expect(plan.totalPaid).toBe(plan.plannedCostWithLand);
  });

  it('con huella parcialmente poseida cobra solo las celdas que adquiere', () => {
    const cells = footprintFromOrigin(BuildingType.GARAGE, ORIGIN);
    const boughtCount = 18;
    const resolved = cells.map((cell, index) =>
      index < boughtCount ? unowned(cell) : owned(cell),
    );
    const plan = planBuildingPlacement({
      type: BuildingType.GARAGE,
      cells,
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: resolverOf(resolved),
    });

    const perCell = cellPrice(TerrainType.GRASS);
    expect(perCell).not.toBeNull();
    expect(plan.cellsToBuy).toHaveLength(boughtCount);
    expect(plan.ownedCells).toBe(BUILDING_CATALOGUE.GARAGE.footprintCells - boughtCount);
    expect(plan.landPaid).toBe(multiplyByCount(perCell ?? Money.ZERO, boughtCount));
    expect(plan.totalPaid).toBe(Money.add(BUILDING_CATALOGUE.GARAGE.purchasePrice, plan.landPaid));
    // Neither extreme of `realBuildingCost` expresses this case, which is why the land is
    // priced from the cells actually acquired (docs/handoff/NOTES-w4b.md, section 4.1).
    const asIfUnowned = realBuildingCost(BuildingType.GARAGE, {
      landAlreadyOwned: false,
      terrain: TerrainType.GRASS,
    });
    expect(Money.compare(plan.totalPaid, asIfUnowned.total)).toBe(-1);
  });

  it('no cobra suelo cuando la peticion no lo compra, y rechaza la colocacion', () => {
    const cells = footprintFromOrigin(BuildingType.SILO, ORIGIN);
    const plan = planBuildingPlacement({
      type: BuildingType.SILO,
      cells,
      purchaseFootprintLand: false,
      settledBalance: RICH,
      resolveCell: resolverOf(cells.map((cell) => unowned(cell))),
    });

    expect(plan.landPaid).toBe(Money.ZERO);
    expect(plan.totalPaid).toBe(BUILDING_CATALOGUE.SILO.purchasePrice);
    expect(codesOf(plan.issues)).toContain(ValidationCode.CELL_NOT_OWNED);
    expect(plan.ok).toBe(false);
  });
});

describe('los motivos de invalidez', () => {
  it('traduce una celda ocupada a la exclusividad de uso del suelo', () => {
    const cells = footprintFromOrigin(BuildingType.WORKER_HOME, ORIGIN);
    const resolved = cells.map((cell, index) =>
      index === 5 ? owned(cell, { landUse: LandUse.FIELD }) : owned(cell),
    );
    const plan = planBuildingPlacement({
      type: BuildingType.WORKER_HOME,
      cells,
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: resolverOf(resolved),
    });

    expect(codesOf(plan.issues)).toContain(ValidationCode.BUILDING_FOOTPRINT_OVERLAPS);
    expect(codesOf(plan.issues)).not.toContain(ValidationCode.CELL_IN_USE);
    expect(plan.issues[0]?.firstCell).toEqual({ cellX: cells[5]?.cellX, cellY: cells[5]?.cellY });
    expect(plan.ok).toBe(false);
  });

  it('rechaza un terreno no construible antes que uno no comprable', () => {
    const cells = footprintFromOrigin(BuildingType.WORKSHOP, ORIGIN);
    const resolved = cells.map((cell) => unowned(cell, { terrain: TerrainType.FOREST }));
    const plan = planBuildingPlacement({
      type: BuildingType.WORKSHOP,
      cells,
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: resolverOf(resolved),
    });

    expect(plan.issues[0]?.code).toBe(ValidationCode.TERRAIN_NOT_BUILDABLE);
    expect(plan.ok).toBe(false);
  });

  it('rechaza un arbol en pie sobre la huella', () => {
    const cells = footprintFromOrigin(BuildingType.SILO, ORIGIN);
    const resolved = cells.map((cell, index) =>
      index === 0 ? owned(cell, { hasStandingTree: true }) : owned(cell),
    );
    const plan = planBuildingPlacement({
      type: BuildingType.SILO,
      cells,
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: resolverOf(resolved),
    });

    expect(codesOf(plan.issues)).toContain(ValidationCode.CELL_HAS_STANDING_TREE);
  });

  it('trata una celda sin chunk cargado como indecisa y bloquea la confirmacion', () => {
    const cells = footprintFromOrigin(BuildingType.SILO, ORIGIN);
    // Half the footprint resolves; the other half has no chunk yet.
    const resolved = cells.slice(0, 8).map((cell) => owned(cell));
    const plan = planBuildingPlacement({
      type: BuildingType.SILO,
      cells,
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: resolverOf(resolved),
    });

    expect(plan.unresolvedCount).toBe(cells.length - resolved.length);
    expect(plan.issues).toHaveLength(0);
    expect(plan.ok).toBe(false);
  });

  it('rechaza una huella de tamano equivocado', () => {
    const cells = footprintFromOrigin(BuildingType.SILO, ORIGIN).slice(0, 4);
    const plan = planBuildingPlacement({
      type: BuildingType.SILO,
      cells,
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: resolverOf(cells.map((cell) => owned(cell))),
    });

    expect(codesOf(plan.issues)).toContain(ValidationCode.VALIDATION_FAILED);
    expect(plan.ok).toBe(false);
  });

  it('rechaza una seleccion vacia', () => {
    const plan = planBuildingPlacement({
      type: BuildingType.SILO,
      cells: [],
      purchaseFootprintLand: true,
      settledBalance: RICH,
      resolveCell: () => null,
    });

    expect(codesOf(plan.issues)).toEqual([ValidationCode.SELECTION_EMPTY]);
    expect(plan.ok).toBe(false);
  });
});

describe('la asequibilidad', () => {
  it('rechaza cuando el saldo liquidado no cubre el total', () => {
    const cells = footprintFromOrigin(BuildingType.GARAGE, ORIGIN);
    const plan = planBuildingPlacement({
      type: BuildingType.GARAGE,
      cells,
      purchaseFootprintLand: true,
      settledBalance: Money.fromUnits(100),
      resolveCell: resolverOf(cells.map((cell) => owned(cell))),
    });

    expect(plan.affordable).toBe(false);
    expect(codesOf(plan.issues)).toContain(ValidationCode.INSUFFICIENT_FUNDS);
  });

  it('bloquea el gasto discrecional con saldo negativo', () => {
    const cells = footprintFromOrigin(BuildingType.GARAGE, ORIGIN);
    const plan = planBuildingPlacement({
      type: BuildingType.GARAGE,
      cells,
      purchaseFootprintLand: true,
      settledBalance: Money.fromUnits(-1),
      resolveCell: resolverOf(cells.map((cell) => owned(cell))),
    });

    expect(codesOf(plan.issues)).toContain(ValidationCode.SPENDING_BLOCKED_IN_DEBT);
    expect(codesOf(plan.issues)).not.toContain(ValidationCode.INSUFFICIENT_FUNDS);
  });
});
