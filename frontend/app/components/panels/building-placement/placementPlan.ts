// Where a building may stand and what standing there costs, computed on the client.
//
// Owner: W4-F. Used by `building-placement` and, through it, by `farm-overview`.
//
// This module mirrors `planPlacement` of `backend/src/modules/farms/placement.ts` statement
// by statement and calls the same functions of `shared/rules`. That is the requirement of
// plan section 8 and of ADR-0030: the reason the confirm button is disabled and the reason
// the server answers 409 are one rule with two callers, so a footprint the panel paints as
// admissible cannot come back refused.
//
// Three differences with the server, all of them consequences of the client being a cache
// and not an authority (plan section 7):
//
//   1. Every reason is reported, not only the first. The server throws the first because a
//      transaction has to stop somewhere; the panel has to explain the whole footprint.
//   2. A cell whose chunk has not been downloaded is undecided, never invalid. It is not
//      counted as an issue and it does block the confirmation, which is the same reading
//      the selection tool takes (docs/handoff/NOTES-w4g.md, section 5.5). Painting it red
//      would be an assertion the client is not in a position to make.
//   3. Affordability is evaluated against the settled balance the client last saw. The
//      authoritative check runs inside the server transaction against the balance settled
//      there; this one exists so that the refusal is stated before the round trip.
//
// THE PRICE is the point where GDD section 116 and GDD section 117 contradict each other,
// and the resolution is the one of plan section 2.2 and ADR-0011: the formula
// `purchasePrice + footprint x cellPrice` is planning help, and the transactional price is
// `purchasePrice` plus only the cells this request actually buys, at the price of GDD
// section 115. A partly owned footprint is charged for the part that is bought and no more,
// which is the case the literal formula cannot express (docs/handoff/NOTES-w4b.md, 4.1).

import {
  BUILDABLE_TERRAINS,
  BUILDING_CATALOGUE,
  CellOwnership,
  LandUse,
  Money,
  SelectionPurpose,
  TerrainType,
  VALIDATION_MESSAGES,
  ValidationCode,
  landPurchasePrice,
  realBuildingCost,
  validateBuildingFootprint,
  validateSelection,
  type BuildingType,
  type CellCoordWire,
  type SelectionCell,
  type SelectionIssue,
} from '~/shared/index';

/** Size of a footprint, in cells. Always the rectangle of the catalogue. */
export interface FootprintSize {
  readonly widthCells: number;
  readonly heightCells: number;
}

export function footprintSizeOf(type: BuildingType): FootprintSize {
  const definition = BUILDING_CATALOGUE[type];
  return { widthCells: definition.widthCells, heightCells: definition.heightCells };
}

/**
 * North west corner of a set of cells, which is the anchor the route names.
 *
 * The request carries an origin and not a set (`shared/api/schemas/farms.ts`), so the
 * panel has to reduce the ghost the player moved to the one cell the server understands.
 */
export function originOfCells(cells: readonly CellCoordWire[]): CellCoordWire | null {
  const first = cells[0];
  if (first === undefined) {
    return null;
  }
  let cellX = first.cellX;
  let cellY = first.cellY;
  for (const cell of cells) {
    cellX = Math.min(cellX, cell.cellX);
    cellY = Math.min(cellY, cell.cellY);
  }
  return { cellX, cellY };
}

/** The cells of a footprint anchored at its north west corner, row major. */
export function footprintFromOrigin(
  type: BuildingType,
  origin: CellCoordWire,
): readonly CellCoordWire[] {
  const size = footprintSizeOf(type);
  const cells: CellCoordWire[] = [];
  for (let row = 0; row < size.heightCells; row += 1) {
    for (let column = 0; column < size.widthCells; column += 1) {
      cells.push({ cellX: origin.cellX + column, cellY: origin.cellY + row });
    }
  }
  return cells;
}

export interface BuildingPlacementInput {
  readonly type: BuildingType;
  /** The footprint as the ghost placed it. Empty while the player has chosen no anchor. */
  readonly cells: readonly CellCoordWire[];
  /** Whether the request also buys the cells of the footprint that are not owned yet. */
  readonly purchaseFootprintLand: boolean;
  /** Settled balance, which is the figure an affordability check compares against. */
  readonly settledBalance: Money;
  /** Resolves a cell against the chunk cache. Null means the chunk is not loaded. */
  readonly resolveCell: (cellX: number, cellY: number) => SelectionCell | null;
}

export interface BuildingPlacementPlan {
  readonly type: BuildingType;
  readonly size: FootprintSize;
  readonly origin: CellCoordWire | null;
  readonly cells: readonly CellCoordWire[];
  /** Cells whose chunk is loaded, which are the only ones a verdict covers. */
  readonly resolvedCells: readonly SelectionCell[];
  /** Cells whose chunk is not loaded. Greater than zero makes the verdict provisional. */
  readonly unresolvedCount: number;
  readonly ownedCells: number;
  /** Cells this request would acquire. Empty when the plot is already the player's. */
  readonly cellsToBuy: readonly CellCoordWire[];
  readonly landAlreadyOwned: boolean;
  /** Effective terrain of the footprint, or null when it is empty or not uniform. */
  readonly terrain: TerrainType | null;
  /** The catalogue price of the structure (GDD section 116). */
  readonly buildingPaid: Money;
  /** The cells actually bought, at the price of GDD section 115. Zero when none are. */
  readonly landPaid: Money;
  readonly totalPaid: Money;
  /** The literal formula of GDD section 116, land always included. Planning help only. */
  readonly plannedCostWithLand: Money;
  /** Every reason the footprint is refused, one per code, in the order of the server. */
  readonly issues: readonly SelectionIssue[];
  /** True when the request can be sent: no issue, no unresolved cell, funds available. */
  readonly ok: boolean;
  readonly affordable: boolean;
}

function issueOf(
  code: ValidationCode,
  cellCount: number,
  firstCell: CellCoordWire | null,
): SelectionIssue {
  return { code, message: VALIDATION_MESSAGES[code], cellCount, firstCell };
}

/**
 * The footprint as it would be once the request has bought what it asked to buy.
 *
 * A projection and not a second rule, exactly as the server states it: only ownership and
 * use move, and the effective terrain and the standing tree are left as loaded, so
 * `canBuildOn` still decides. Without it the shared rule would refuse an unowned cell the
 * same request is about to acquire, and a player who owns nothing could never place a
 * first building at all.
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
 * Effective terrain of the footprint, or null when it is empty or mixed.
 *
 * Only one terrain is buildable today, so a footprint that passes validation is uniform
 * and the first cell speaks for all of them. Stated as a lookup rather than assumed, so
 * that a second buildable terrain becomes a visible decision instead of a wrong price.
 */
function terrainOfFootprint(cells: readonly SelectionCell[]): TerrainType | null {
  const first = cells[0];
  if (first === undefined) {
    return null;
  }
  for (const cell of cells) {
    if (cell.terrain !== first.terrain) {
      return null;
    }
  }
  return first.terrain;
}

/**
 * Translation of one aggregated reason into the code the contract reserves for it.
 *
 * `CELL_IN_USE` on a building selection means a cell of the rectangle already belongs to a
 * field, a plot or another building, which is the exclusivity of GDD section 15; the
 * contract names that situation `BUILDING_FOOTPRINT_OVERLAPS` and the server translates it
 * the same way. The rest keep their own name, because "you do not own that cell" and
 * "there is a building there" lead the player to different actions.
 */
function translate(issue: SelectionIssue): SelectionIssue {
  if (issue.code !== ValidationCode.CELL_IN_USE) {
    return issue;
  }
  return {
    ...issue,
    code: ValidationCode.BUILDING_FOOTPRINT_OVERLAPS,
    message: VALIDATION_MESSAGES[ValidationCode.BUILDING_FOOTPRINT_OVERLAPS],
  };
}

/** Appends an issue unless its code is already reported, keeping one entry per code. */
function push(issues: SelectionIssue[], issue: SelectionIssue): void {
  const translated = translate(issue);
  if (issues.some((held) => held.code === translated.code)) {
    return;
  }
  issues.push(translated);
}

export function planBuildingPlacement(input: BuildingPlacementInput): BuildingPlacementPlan {
  const definition = BUILDING_CATALOGUE[input.type];
  const size = footprintSizeOf(input.type);

  const resolvedCells: SelectionCell[] = [];
  for (const cell of input.cells) {
    const resolved = input.resolveCell(cell.cellX, cell.cellY);
    if (resolved !== null) {
      resolvedCells.push(resolved);
    }
  }
  const unresolvedCount = input.cells.length - resolvedCells.length;

  const unowned = resolvedCells.filter((cell) => cell.ownership === CellOwnership.UNOWNED);
  const cellsToBuy = input.purchaseFootprintLand
    ? unowned.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY }))
    : [];
  const landAlreadyOwned = cellsToBuy.length === 0;
  const terrain = terrainOfFootprint(resolvedCells);

  // The reference terrain of the planning figure. Taken from the configuration and not
  // written as a literal, so that the day a second terrain becomes buildable this line is
  // where the choice has to be made.
  const referenceTerrain = terrain ?? BUILDABLE_TERRAINS[0] ?? TerrainType.GRASS;
  const breakdown = realBuildingCost(input.type, { landAlreadyOwned, terrain: referenceTerrain });
  const landPaid = landAlreadyOwned
    ? Money.ZERO
    : landPurchasePrice(unowned.map((cell) => cell.terrain)).total;
  const totalPaid = Money.add(breakdown.purchasePrice, landPaid);

  const issues: SelectionIssue[] = [];

  if (input.cells.length === 0) {
    push(issues, issueOf(ValidationCode.SELECTION_EMPTY, 0, null));
  } else if (input.cells.length !== definition.footprintCells) {
    // A footprint of the wrong size is a malformed request and not a cell level problem,
    // which is how `validateBuildingFootprint` reports it as well.
    push(issues, issueOf(ValidationCode.VALIDATION_FAILED, input.cells.length, null));
  }

  if (resolvedCells.length > 0) {
    // The building rule first, over the footprint as it would be once the purchase has
    // run. The order is the server's and it is not arbitrary: a cell of water is both
    // unbuyable and unbuildable, and `TERRAIN_NOT_BUILDABLE` tells the placement panel to
    // move, whereas `TERRAIN_NOT_PURCHASABLE` would send it to the land tool for a cell no
    // amount of buying would fix.
    const projected = projectAfterPurchase(resolvedCells, input.purchaseFootprintLand);
    const footprint =
      unresolvedCount === 0
        ? // The entry point the server calls, size check included.
          validateBuildingFootprint({ type: input.type, cells: projected })
        : // With cells still undecided the size of the footprint cannot be asserted yet, so
          // only the per cell half of the same rule is evaluated.
          validateSelection({ purpose: SelectionPurpose.BUILDING, cells: projected });
    for (const issue of footprint.issues) {
      push(issues, issue);
    }

    // Then the purchase half. Every buildable terrain is purchasable today, so this pass
    // refuses nothing the first one let through; it is kept because that inclusion is a
    // property of two lists of `shared/config/transitions.ts` and not a law.
    if (input.purchaseFootprintLand && unowned.length > 0) {
      const purchase = validateSelection({ purpose: SelectionPurpose.PURCHASE, cells: unowned });
      for (const issue of purchase.issues) {
        push(issues, issue);
      }
    }

    if (terrain === null) {
      const mixed = resolvedCells[0];
      push(
        issues,
        issueOf(
          ValidationCode.TERRAIN_NOT_BUILDABLE,
          resolvedCells.length,
          mixed === undefined ? null : { cellX: mixed.cellX, cellY: mixed.cellY },
        ),
      );
    }
  }

  // Affordability. Raising a building is discretionary spending, which a negative settled
  // balance blocks (plan section 6.6); selling and assigning tasks stay available, because
  // they are the only way out of debt.
  const inDebt = Money.isNegative(input.settledBalance);
  const affordable = !inDebt && Money.compare(input.settledBalance, totalPaid) >= 0;
  if (input.cells.length > 0) {
    if (inDebt) {
      push(issues, issueOf(ValidationCode.SPENDING_BLOCKED_IN_DEBT, input.cells.length, null));
    } else if (!affordable) {
      push(issues, issueOf(ValidationCode.INSUFFICIENT_FUNDS, input.cells.length, null));
    }
  }

  return {
    type: input.type,
    size,
    origin: originOfCells(input.cells),
    cells: input.cells,
    resolvedCells,
    unresolvedCount,
    ownedCells: resolvedCells.length - unowned.length,
    cellsToBuy,
    landAlreadyOwned,
    terrain,
    buildingPaid: breakdown.purchasePrice,
    landPaid,
    totalPaid,
    plannedCostWithLand: breakdown.plannedCostWithLand,
    issues,
    ok: issues.length === 0 && unresolvedCount === 0 && input.cells.length > 0,
    affordable,
  };
}
