// Where a building may stand, and what standing there costs.
//
// Owner: workflow W4-B. Module `farms`.
//
// A farm is a physical entity that occupies real cells and not a menu (GDD sections 23 and
// 24), so placing a building is a geometry problem before it is an economic one. The
// footprint is the rectangle of `shared/config/buildings.ts` — 6 x 8 for a garage (GDD
// section 26), 4 x 4 for a silo and for a worker home (GDD sections 27 and 28), 5 x 5 for a
// workshop (GDD section 29) and 6 x 8 for the wood store (GDD section 136) — anchored at
// the north west corner the request names.
//
// Every rule that decides whether the rectangle is admissible comes from
// `shared/rules/selection.ts` and from nowhere else. That is the requirement of plan
// section 8: the green highlight the client paints while dragging and the refusal the
// server returns are the same function, so they cannot diverge. This module adds the two
// things a pure rule cannot know — what the cells currently are, which `world/service.ts`
// loads, and what the player asked to buy — and translates the aggregated verdict into the
// error of the contract.
//
// THE PRICE, which is where GDD section 116 and GDD section 117 contradict each other.
// Section 116 defines `realBuildingCost = purchasePrice + footprint x cellPrice`; applied
// literally it charges the land twice for the player of section 117, who has already bought
// the 330 cells. Plan section 2.2 resolves it and ADR-0011 records it: the formula is
// planning help, shown by the interface, and the transactional price is `purchasePrice`
// plus the cells of the footprint that this request actually acquires, at the price of GDD
// section 115. `realBuildingCost` takes `landAlreadyOwned` precisely so that the difference
// is explicit at the call site, and this module is the call site.
//
// Partial ownership is the case the literal formula cannot express at all: a footprint of
// forty eight cells of which thirty are already the player's. The land charged is therefore
// computed from the cells actually acquired, with `landPurchasePrice`, which is the same
// GDD section 115 rule `realBuildingCost` uses internally. When every cell is bought the
// two agree exactly, and a test pins that down.

import {
  ApiError,
  BUILDING_CATALOGUE,
  CellOwnership,
  LandUse,
  MAX_ABSOLUTE_CELL_COORDINATE,
  Money,
  SelectionPurpose,
  ValidationCode,
  landPurchasePrice,
  realBuildingCost,
  validateBuildingFootprint,
  validateSelection,
  type BuildingType,
  type CellCoord,
  type SelectionCell,
  type SelectionIssue,
  type TerrainType,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * The cells of a footprint, in row major order from its north west corner.
 *
 * The rectangle comes from the catalogue and not from the request, so a client cannot ask
 * for a garage of one cell. Contiguity is therefore implied and never checked: a rectangle
 * of positive sides is connected by construction.
 */
export function footprintCells(
  type: BuildingType,
  originCellX: number,
  originCellY: number,
): readonly CellCoord[] {
  const definition = BUILDING_CATALOGUE[type];
  assertKeyable(originCellX, originCellY);
  assertKeyable(originCellX + definition.widthCells - 1, originCellY + definition.heightCells - 1);
  const cells: CellCoord[] = [];
  for (let dy = 0; dy < definition.heightCells; dy += 1) {
    for (let dx = 0; dx < definition.widthCells; dx += 1) {
      cells.push({ cellX: originCellX + dx, cellY: originCellY + dy });
    }
  }
  return cells;
}

/**
 * Refuses a footprint whose far corner falls outside the range a cell key covers.
 *
 * `cellKey` throws a `RangeError` there, and a `RangeError` escaping a handler is a 500. A
 * coordinate the schema accepts but the grid cannot address is a malformed request, so it
 * is answered as one.
 */
function assertKeyable(cellX: number, cellY: number): void {
  if (
    Math.abs(cellX) > MAX_ABSOLUTE_CELL_COORDINATE ||
    Math.abs(cellY) > MAX_ABSOLUTE_CELL_COORDINATE
  ) {
    throw new ApiError(ValidationCode.VALIDATION_FAILED, {
      field: 'body.originCellX',
      cells: [{ cellX, cellY }],
    });
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * The footprint as it would be once the request has bought what it asked to buy.
 *
 * It is a projection and not a second rule: only ownership and use are moved, and every
 * other property of the cell — its effective terrain, whether a tree stands on it — is left
 * exactly as loaded, so `canBuildOn` still decides. Without it the shared rule would refuse
 * an unowned cell that the very same transaction is about to acquire, and a first time
 * player, who owns nothing, could never place a building at all.
 */
export function projectAfterPurchase(
  cells: readonly SelectionCell[],
  purchase: boolean,
): readonly SelectionCell[] {
  if (!purchase) {
    return cells;
  }
  return cells.map((cell) =>
    cell.ownership === CellOwnership.UNOWNED && cell.landUse === LandUse.NONE
      ? { ...cell, ownership: CellOwnership.PLAYER, landUse: LandUse.OWNED }
      : cell,
  );
}

/**
 * Translates the first reason a footprint was refused into the error of the contract.
 *
 * One translation is not mechanical and is worth stating. `CELL_IN_USE` from a building
 * selection means a cell of the rectangle already belongs to a field, a forest plot or
 * another building, which is exactly the exclusivity of GDD section 15; the contract has a
 * code that names that situation, `BUILDING_FOOTPRINT_OVERLAPS`, and it is more useful to
 * the placement panel than the generic one. The cell level codes keep their own name,
 * because "you do not own that cell" and "there is a building there" lead the player to
 * different actions.
 */
export function placementError(issue: SelectionIssue): ApiError {
  const cells = issue.firstCell === null ? undefined : [issue.firstCell];
  const code =
    issue.code === ValidationCode.CELL_IN_USE
      ? ValidationCode.BUILDING_FOOTPRINT_OVERLAPS
      : issue.code;
  return new ApiError(code, {
    cellCount: issue.cellCount,
    ...(cells === undefined ? {} : { cells }),
  });
}

export interface PlacementInput {
  readonly type: BuildingType;
  readonly originCellX: number;
  readonly originCellY: number;
  /** Whether the request also buys the cells of the footprint that are not owned yet. */
  readonly purchaseFootprintLand: boolean;
}

export interface PlacementPlan {
  readonly type: BuildingType;
  /** Every cell of the rectangle, in row major order. */
  readonly cells: readonly CellCoord[];
  /** The cells this request has to acquire before it can build. Empty when all are owned. */
  readonly cellsToBuy: readonly CellCoord[];
  /** Effective terrain of the footprint. Uniform: only one terrain is buildable. */
  readonly terrain: TerrainType;
  /** The catalogue price of the structure (GDD section 116). */
  readonly buildingPaid: Money;
  /** The cells of the footprint at the price of GDD section 115, or zero. */
  readonly landPaid: Money;
  readonly totalPaid: Money;
  /**
   * The literal formula of GDD section 116, land always included. It is what the planning
   * panel shows, and it differs from `totalPaid` exactly when the player already owns part
   * of the plot.
   */
  readonly plannedCostWithLand: Money;
}

/**
 * Validates a footprint against the loaded state of its cells and prices it.
 *
 * Pure: it takes the cells already loaded, so the same function serves a placement, a
 * dry run and a test that fixes the grid by hand. Throws the contract error of the first
 * rule the footprint fails, which is what lets the caller abandon the transaction from
 * anywhere without threading a result type through every layer.
 */
export function planPlacement(
  input: PlacementInput,
  loaded: readonly SelectionCell[],
): PlacementPlan {
  const definition = BUILDING_CATALOGUE[input.type];
  if (loaded.length !== definition.footprintCells) {
    // Unreachable through the routes: the caller builds the rectangle from the catalogue.
    throw new ApiError(ValidationCode.VALIDATION_FAILED, { field: 'body.type' });
  }

  const unowned = loaded.filter((cell) => cell.ownership === CellOwnership.UNOWNED);
  const cellsToBuy = input.purchaseFootprintLand
    ? unowned.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY }))
    : [];

  // The building rule first, over the footprint as it would be once the purchase has run.
  // The order is not arbitrary: a cell of water is both unbuyable and unbuildable, and
  // `TERRAIN_NOT_BUILDABLE` is the answer that tells the placement panel what to do,
  // whereas `TERRAIN_NOT_PURCHASABLE` would send it to the land tool for a cell no amount
  // of buying would fix.
  const footprint = validateBuildingFootprint({
    type: input.type,
    cells: projectAfterPurchase(loaded, input.purchaseFootprintLand),
  });
  const firstIssue = footprint.issues[0];
  if (firstIssue !== undefined) {
    throw placementError(firstIssue);
  }

  // Then the purchase half. Today every buildable terrain is also purchasable, so this pass
  // refuses nothing the first one let through; it is kept because that inclusion is a
  // property of two lists in `shared/config/transitions.ts` and not a law, and the day a
  // buildable terrain stops being on the market this is where it is caught.
  if (input.purchaseFootprintLand && unowned.length > 0) {
    const purchase = validateSelection({ purpose: SelectionPurpose.PURCHASE, cells: unowned });
    const first = purchase.issues[0];
    if (first !== undefined) {
      throw placementError(first);
    }
  }

  const terrain = terrainOfFootprint(loaded);
  const landAlreadyOwned = cellsToBuy.length === 0;
  // `realBuildingCost` is called with `landAlreadyOwned` explicit, which is the resolution
  // of GDD section 116 against GDD section 117 (ADR-0011). `landPaid` is computed from the
  // cells actually acquired so that a partly owned plot is charged for the part that is
  // bought and no more; when every cell is bought the two figures agree exactly.
  const breakdown = realBuildingCost(input.type, { landAlreadyOwned, terrain });
  const landPaid = landAlreadyOwned
    ? Money.ZERO
    : landPurchasePrice(unowned.map((cell) => cell.terrain)).total;

  return {
    type: input.type,
    cells: loaded.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    cellsToBuy,
    terrain,
    buildingPaid: breakdown.purchasePrice,
    landPaid,
    totalPaid: Money.add(breakdown.purchasePrice, landPaid),
    plannedCostWithLand: breakdown.plannedCostWithLand,
  };
}

/**
 * The terrain of a validated footprint.
 *
 * Only one terrain is buildable (`BUILDABLE_TERRAINS`), so a footprint that passed
 * validation is uniform and the first cell speaks for all of them. Stated as a lookup
 * rather than assumed, so that adding a second buildable terrain to the catalogue turns
 * this into a visible decision instead of a silently wrong price.
 */
function terrainOfFootprint(loaded: readonly SelectionCell[]): TerrainType {
  const first = loaded[0];
  if (first === undefined) {
    throw new ApiError(ValidationCode.SELECTION_EMPTY);
  }
  for (const cell of loaded) {
    if (cell.terrain !== first.terrain) {
      throw new ApiError(ValidationCode.TERRAIN_NOT_BUILDABLE, {
        cells: [{ cellX: cell.cellX, cellY: cell.cellY }],
      });
    }
  }
  return first.terrain;
}
