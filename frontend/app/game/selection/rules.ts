// Validity of a selection, computed with the rules the server validates with.
//
// Owner: workflow W4-G (selection tool).
//
// The point of this module is that it contains almost no rules. Seven of the nine modes
// delegate entirely to `validateSelection` and `validateBuildingFootprint` of
// `shared/rules/selection.ts`, which is the same code the endpoints call before mutating
// anything (plan section 8): that is what makes it impossible for a set the client
// painted green to come back as a rejection, and it is why the reasons arrive aggregated
// by code with a first offending cell, so the panel can say "two hundred cells already
// have an owner" and move the camera to the first of them.
//
// The two modes that are composed here rather than delegated, and why:
//
//   - `FIELD_SPLIT` (GDD section 21). `SelectionPurpose` has no value for it, and it
//     could not reuse `canBeFieldCell` even if it did: every cell of a split already has
//     `landUse = FIELD`, which that rule refuses with `CELL_IN_USE`. The composition
//     below mirrors `splitField` of `backend/src/modules/fields/service.ts` statement for
//     statement: every cell has to belong to the field, both halves have to be non empty
//     and both have to be contiguous, all of it reported as `FIELD_SPLIT_INCOMPLETE`. The
//     contiguity is `isContiguous` of shared/rules/geometry.ts, the same function on both
//     sides, so the client and the server cannot disagree about what contiguous means.
//   - `FELL_AREA` (GDD section 135). Also absent from `SelectionPurpose`. Felling is not
//     clearing: `canClearCell` requires the cell to be free of standing trees, which is
//     precisely the opposite of what felling selects. The cells have to belong to the
//     target plot, and the selection has to contain at least one standing tree, which is
//     what `NO_FELLABLE_TREES` of the shared vocabulary already says.
//
// Both compositions use the shared codes and the shared message table, so no message of
// this directory is written by hand. Recorded in `docs/handoff/NOTES-w4g.md`, section 2.

import { type ToolCell } from './cells';
import { SELECTION_TOOL_MODES, SelectionToolMode } from './modes';
import { type SelectionToolIntent } from './port';
import {
  CellOwnership,
  DEFAULT_SELECTION_CONFIG,
  LandUse,
  Money,
  SELECTION_PURPOSE_RULES,
  SelectionPurpose,
  VALIDATION_MESSAGES,
  ValidationCode,
  cellKey,
  isContiguous,
  validateBuildingFootprint,
  validateSelection,
  type CellCoord,
  type CellCoordWire,
  type SelectionConfig,
  type SelectionIssue,
  type SelectionValidation,
} from '~/shared/index';

/** The per cell verdict of a mode. Null means the cell passes. */
export type ToolCellRule = (cell: ToolCell) => ValidationCode | null;

export interface ToolValidationInput {
  readonly intent: SelectionToolIntent;
  readonly cells: readonly ToolCell[];
  readonly config?: SelectionConfig;
}

/** An empty verdict, for a mode that draws no set. */
export const NO_VALIDATION: SelectionValidation = {
  ok: false,
  cellCount: 0,
  validCellCount: 0,
  issues: [],
  price: Money.ZERO,
};

function issueOf(
  code: ValidationCode,
  cellCount: number,
  firstCell: CellCoord | null,
): SelectionIssue {
  return { code, message: VALIDATION_MESSAGES[code], cellCount, firstCell };
}

function keysOf(cells: readonly CellCoordWire[]): Set<number> {
  const keys = new Set<number>();
  for (const cell of cells) {
    keys.add(cellKey(cell.cellX, cell.cellY));
  }
  return keys;
}

/**
 * The per cell rule of a mode.
 *
 * Exposed because the fill of the highlight needs the verdict of each cell and
 * `validateSelection` only returns the aggregate. It is the very same function the
 * aggregate runs, taken from `SELECTION_PURPOSE_RULES`, so the green cells and the
 * counted ones cannot differ.
 */
export function cellRuleOf(
  intent: SelectionToolIntent,
  config: SelectionConfig = DEFAULT_SELECTION_CONFIG,
): ToolCellRule {
  const rule = SELECTION_TOOL_MODES[intent.mode];
  if (rule.purpose !== null) {
    const purposeRule = SELECTION_PURPOSE_RULES[rule.purpose];
    return (cell) => purposeRule.cellRule(cell, config);
  }
  if (intent.mode === SelectionToolMode.FIELD_SPLIT) {
    const target = keysOf(intent.targetCells ?? []);
    return (cell) =>
      target.has(cellKey(cell.cellX, cell.cellY)) ? null : ValidationCode.FIELD_SPLIT_INCOMPLETE;
  }
  if (intent.mode === SelectionToolMode.FELL_AREA) {
    const plotId = intent.forestPlotId ?? null;
    return (cell) => {
      if (cell.ownership !== CellOwnership.PLAYER) {
        return ValidationCode.CELL_NOT_OWNED;
      }
      if (cell.landUse !== LandUse.FOREST_PLOT) {
        return ValidationCode.TARGET_KIND_MISMATCH;
      }
      if (plotId !== null && cell.forestPlotId !== plotId) {
        return ValidationCode.TARGET_KIND_MISMATCH;
      }
      return null;
    };
  }
  return () => null;
}

/** Aggregates a per cell rule into one issue per code, as the shared module does. */
function aggregate(
  cells: readonly ToolCell[],
  rule: ToolCellRule,
): { readonly issues: readonly SelectionIssue[]; readonly validCellCount: number } {
  const perCode = new Map<ValidationCode, { count: number; firstCell: CellCoord }>();
  let validCellCount = 0;
  for (const cell of cells) {
    const code = rule(cell);
    if (code === null) {
      validCellCount += 1;
      continue;
    }
    const existing = perCode.get(code);
    if (existing === undefined) {
      perCode.set(code, { count: 1, firstCell: { cellX: cell.cellX, cellY: cell.cellY } });
    } else {
      existing.count += 1;
    }
  }
  const issues: SelectionIssue[] = [];
  for (const [code, entry] of perCode) {
    issues.push(issueOf(code, entry.count, entry.firstCell));
  }
  return { issues, validCellCount };
}

/**
 * The split of GDD section 21, mirroring `splitField` of the fields module.
 *
 * The remaining half is computed and checked too, which is the part a client that only
 * validated the moved cells would miss: a selection that carves a doughnut out of a field
 * leaves a ring that is contiguous and a hole that is not, and the server refuses it.
 */
function validateSplit(input: ToolValidationInput, config: SelectionConfig): SelectionValidation {
  const cells = input.cells;
  const issues: SelectionIssue[] = [];
  if (cells.length === 0) {
    return { ...NO_VALIDATION, issues: [issueOf(ValidationCode.SELECTION_EMPTY, 0, null)] };
  }
  if (cells.length > config.maxSelectionCells) {
    issues.push(issueOf(ValidationCode.SELECTION_TOO_LARGE, cells.length, null));
  }

  const target = input.intent.targetCells ?? [];
  const movedKeys = keysOf(cells);
  const remaining = target.filter((cell) => !movedKeys.has(cellKey(cell.cellX, cell.cellY)));
  const incomplete =
    target.length === 0 ||
    remaining.length === 0 ||
    !isContiguous(cells, config.maxSelectionCells) ||
    !isContiguous(remaining, config.maxSelectionCells);
  if (incomplete) {
    issues.push(issueOf(ValidationCode.FIELD_SPLIT_INCOMPLETE, cells.length, null));
  }

  const perCell = aggregate(cells, cellRuleOf(input.intent, config));
  issues.push(...perCell.issues);
  return {
    ok: issues.length === 0,
    cellCount: cells.length,
    validCellCount: perCell.validCellCount,
    issues,
    price: Money.ZERO,
  };
}

/** The felling by area of GDD section 135. */
function validateFell(input: ToolValidationInput, config: SelectionConfig): SelectionValidation {
  const cells = input.cells;
  const issues: SelectionIssue[] = [];
  if (cells.length === 0) {
    return { ...NO_VALIDATION, issues: [issueOf(ValidationCode.SELECTION_EMPTY, 0, null)] };
  }
  if (cells.length > config.maxSelectionCells) {
    issues.push(issueOf(ValidationCode.SELECTION_TOO_LARGE, cells.length, null));
  }
  // Contiguity is not required: GDD section 135 fells a batch of trees and never a
  // surface, and a plot with scattered saplings is a legitimate selection.
  const standing = cells.filter((cell) => cell.hasStandingTree);
  if (standing.length === 0) {
    issues.push(issueOf(ValidationCode.NO_FELLABLE_TREES, cells.length, null));
  }
  const perCell = aggregate(cells, cellRuleOf(input.intent, config));
  issues.push(...perCell.issues);
  return {
    ok: issues.length === 0,
    cellCount: cells.length,
    validCellCount: perCell.validCellCount,
    issues,
    price: Money.ZERO,
  };
}

/**
 * The verdict of the current selection.
 *
 * Seven of the nine modes are one call to the shared module and nothing else. The
 * building footprint goes through `validateBuildingFootprint`, which adds the one rule a
 * footprint has beyond its cells: it must have exactly the number of cells the catalogue
 * gives it (GDD section 116).
 */
export function validateToolSelection(input: ToolValidationInput): SelectionValidation {
  const config = input.config ?? DEFAULT_SELECTION_CONFIG;
  const intent = input.intent;
  const rule = SELECTION_TOOL_MODES[intent.mode];

  if (rule.purpose === SelectionPurpose.BUILDING && intent.buildingType != null) {
    return validateBuildingFootprint({ type: intent.buildingType, cells: input.cells }, { config });
  }
  if (rule.purpose !== null) {
    return validateSelection(
      {
        purpose: rule.purpose,
        cells: input.cells,
        adjacentTo:
          intent.targetCells === undefined || intent.targetCells.length === 0
            ? undefined
            : intent.targetCells,
      },
      config,
    );
  }
  if (intent.mode === SelectionToolMode.FIELD_SPLIT) {
    return validateSplit(input, config);
  }
  if (intent.mode === SelectionToolMode.FELL_AREA) {
    return validateFell(input, config);
  }
  return NO_VALIDATION;
}

/** First cell any issue points at, which is where the jump to the conflict goes. */
export function firstConflictOf(validation: SelectionValidation | null): CellCoordWire | null {
  for (const issue of validation?.issues ?? []) {
    if (issue.firstCell !== null) {
      return { cellX: issue.firstCell.cellX, cellY: issue.firstCell.cellY };
    }
  }
  return null;
}
