// The modes of the selection tool, as a table.
//
// Owner: workflow W4-G (selection tool). Plan section 9.5 lists eight: inspection, land
// purchase, field creation, field extension, field split, forest plot creation, felling
// by area and building placement. A ninth is added here, land clearing, and the reason is
// not preference: `SelectionPurpose.CLEAR_LAND` of the shared rules and the route
// `POST /api/land/clear` of the contract both exist, and without a mode of its own the
// only shared purpose with no way to reach it would be that one. Felling and clearing are
// two different operations over the same ground (GDD section 10: fell the trees, then
// clear the stumps into arable land), and collapsing them into one mode would mean the
// tool highlights cells with standing trees as valid for an operation that refuses them.
//
// The mode is set by the panels through the bridge and never by the scene on its own,
// which is the half of plan section 9 that says Phaser owns the canvas and nothing else.
//
// A table and not a switch, for the reason ADR-0011 gives about the compatibility matrix
// of GDD section 90: a table is crossed with another table in a test, and two switches
// are crossed with nothing. Here the cross is with `SELECTION_PURPOSE_RULES` of
// shared/rules/selection.ts, so a purpose with no mode, or a mode claiming a purpose the
// shared rules do not define, is a failing test and not a wrong highlight.
//
// Two modes have no purpose in the shared rules, and that is recorded in
// `docs/handoff/NOTES-w4g.md`, section 2: `SelectionPurpose` covers neither the split of
// GDD section 21 nor the felling by area of GDD section 135. Their per cell rules are
// composed in `rules.ts` from the same primitives the shared module uses and mirror what
// the server already does, rather than being invented.

import { SelectionPurpose } from '~/shared/index';

/** What the tool is currently for. */
export const SelectionToolMode = {
  /** Pointing at cells to read them. The default, and the one a cancel returns to. */
  INSPECT: 'INSPECT',
  /** Buying land (GDD section 14). */
  PURCHASE: 'PURCHASE',
  /** Creating a field (GDD sections 17 and 19). */
  FIELD_CREATE: 'FIELD_CREATE',
  /** Extending a field with adjacent land (GDD section 20). */
  FIELD_EXTEND: 'FIELD_EXTEND',
  /** Splitting a field in two (GDD section 21). */
  FIELD_SPLIT: 'FIELD_SPLIT',
  /** Creating a forest plot (GDD sections 10 and 129). */
  FOREST_PLOT: 'FOREST_PLOT',
  /** Felling an area of a forest plot (GDD sections 131 and 135). */
  FELL_AREA: 'FELL_AREA',
  /** Clearing felled forest into arable land (GDD section 10). */
  CLEAR_LAND: 'CLEAR_LAND',
  /** Placing a building of the catalogue (GDD sections 24 and 116). */
  BUILDING: 'BUILDING',
} as const;
export type SelectionToolMode = (typeof SelectionToolMode)[keyof typeof SelectionToolMode];

/** How the pointer composes the set in a mode. */
export const SelectionShape = {
  /** Rectangles combined with union, subtraction and per cell toggling (GDD section 17). */
  RECTANGLES: 'RECTANGLES',
  /** A fixed rectangle from the catalogue that follows the cursor (GDD section 116). */
  FIXED_FOOTPRINT: 'FIXED_FOOTPRINT',
  /** No set at all. */
  NONE: 'NONE',
} as const;
export type SelectionShape = (typeof SelectionShape)[keyof typeof SelectionShape];

export interface SelectionToolModeRule {
  /**
   * Purpose of `shared/rules/selection.ts` this mode validates with, or null when the
   * shared rules have no purpose for it and `rules.ts` composes one.
   */
  readonly purpose: SelectionPurpose | null;
  readonly shape: SelectionShape;
  /** Whether the mode needs the field it extends or splits. */
  readonly requiresFieldId: boolean;
  /** Whether the mode needs the plot the felling happens in. */
  readonly requiresForestPlotId: boolean;
  /** Whether the mode needs the building type whose footprint fixes the shape. */
  readonly requiresBuildingType: boolean;
  /**
   * Whether the mode needs the cells of the subject it acts against: the field being
   * extended (GDD section 20) or the field being split (GDD section 21).
   */
  readonly requiresTargetCells: boolean;
  /** GDD sections that fix the rule of this mode, for the readout and the panels. */
  readonly gddSections: readonly number[];
}

const NONE: Omit<SelectionToolModeRule, 'purpose' | 'gddSections'> = {
  shape: SelectionShape.NONE,
  requiresFieldId: false,
  requiresForestPlotId: false,
  requiresBuildingType: false,
  requiresTargetCells: false,
};

const AREA: Omit<SelectionToolModeRule, 'purpose' | 'gddSections'> = {
  ...NONE,
  shape: SelectionShape.RECTANGLES,
};

export const SELECTION_TOOL_MODES: Readonly<Record<SelectionToolMode, SelectionToolModeRule>> = {
  INSPECT: { ...NONE, purpose: null, gddSections: [7, 61] },
  PURCHASE: { ...AREA, purpose: SelectionPurpose.PURCHASE, gddSections: [14, 115] },
  FIELD_CREATE: { ...AREA, purpose: SelectionPurpose.FIELD, gddSections: [17, 19] },
  FIELD_EXTEND: {
    ...AREA,
    purpose: SelectionPurpose.FIELD_EXTEND,
    requiresFieldId: true,
    requiresTargetCells: true,
    gddSections: [20],
  },
  FIELD_SPLIT: {
    ...AREA,
    purpose: null,
    requiresFieldId: true,
    requiresTargetCells: true,
    gddSections: [21],
  },
  FOREST_PLOT: { ...AREA, purpose: SelectionPurpose.FOREST_PLOT, gddSections: [10, 129] },
  FELL_AREA: { ...AREA, purpose: null, requiresForestPlotId: true, gddSections: [131, 135] },
  CLEAR_LAND: { ...AREA, purpose: SelectionPurpose.CLEAR_LAND, gddSections: [10, 137] },
  BUILDING: {
    ...AREA,
    purpose: SelectionPurpose.BUILDING,
    shape: SelectionShape.FIXED_FOOTPRINT,
    requiresBuildingType: true,
    gddSections: [24, 116],
  },
};

/** Whether a mode paints a set at all. */
export function modeDrawsSelection(mode: SelectionToolMode): boolean {
  return SELECTION_TOOL_MODES[mode].shape !== SelectionShape.NONE;
}

/**
 * The mode a `selection:mode` event of the bridge asks for.
 *
 * The bridge carries `SelectionPurpose | null` and two footprint dimensions, which
 * reaches seven of the nine modes: `FIELD_SPLIT` shares the purpose `FIELD` with
 * `FIELD_CREATE` and `FELL_AREA` has no purpose at all, so a panel that needs either of
 * those calls `SelectionTool.setIntent` directly, which is also the only way to pass the
 * field or the plot it acts on. Recorded in `docs/handoff/NOTES-w4g.md`, section 2.
 */
export function modeOfBridgePurpose(purpose: SelectionPurpose | null): SelectionToolMode {
  switch (purpose) {
    case SelectionPurpose.PURCHASE:
      return SelectionToolMode.PURCHASE;
    case SelectionPurpose.FIELD:
      return SelectionToolMode.FIELD_CREATE;
    case SelectionPurpose.FIELD_EXTEND:
      return SelectionToolMode.FIELD_EXTEND;
    case SelectionPurpose.FOREST_PLOT:
      return SelectionToolMode.FOREST_PLOT;
    case SelectionPurpose.CLEAR_LAND:
      return SelectionToolMode.CLEAR_LAND;
    case SelectionPurpose.BUILDING:
      return SelectionToolMode.BUILDING;
    case null:
    default:
      return SelectionToolMode.INSPECT;
  }
}

/**
 * The purpose a mode publishes back on the bridge.
 *
 * It is what makes `WorldCamera.setPanWithPrimary(false)` fire whichever way the mode was
 * set: the camera has to release the primary button for the tool, and it only listens to
 * `selection:mode`. The two modes without a shared purpose borrow the nearest one of
 * their own family, which is enough because the camera only reads whether it is null.
 */
export function bridgePurposeOfMode(mode: SelectionToolMode): SelectionPurpose | null {
  const rule = SELECTION_TOOL_MODES[mode];
  if (rule.purpose !== null) {
    return rule.purpose;
  }
  if (mode === SelectionToolMode.FIELD_SPLIT) {
    return SelectionPurpose.FIELD;
  }
  if (mode === SelectionToolMode.FELL_AREA) {
    return SelectionPurpose.CLEAR_LAND;
  }
  return null;
}
