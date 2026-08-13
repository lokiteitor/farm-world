// Public surface of the selection tool.
//
// Owner: workflow W4-G (selection tool). One entry point, so the page that mounts the
// canvas writes three lines and does not have to know that the tool is a state machine, a
// set algebra, a boundary throttle and a draw plan:
//
// ```ts
// const scenes = createWorldScenes({ source, bridge });
// const handle = createGame({ host, worldScenes: scenes.scenes });
// const tool = createSelectionTool({
//   world: scenes.world,
//   overlay: scenes.overlay,
//   bridge: gameBridge(),
//   port: {
//     onChanged: (snapshot) => selection.replaceCells(snapshot.cells),
//     onConfirm: (snapshot) => shell.openPanel(panelOf(snapshot.intent.mode)),
//     onCancel: () => selection.cancel(),
//   },
// });
// ```
//
// The port is bound outside the canvas on purpose: `frontend/app/game` may not import
// `frontend/app/stores` (zone rule of `eslint.config.js`), which is the mechanical half of
// the pillar of plan section 9.

export { SelectionTool, createSelectionTool, type SelectionToolDeps } from './SelectionTool';
export { createBoundaryThrottle, type BoundaryThrottle } from './boundary';
export {
  resolveCell,
  resolveCells,
  type CellReader,
  type ResolvedSelection,
  type ToolCell,
} from './cells';
export {
  READOUT_OFFSET,
  SELECTION_ALPHA,
  SELECTION_COLOUR,
  SELECTION_DEPTH,
  SELECTION_OUTLINE_WIDTH,
} from './config';
export {
  EMPTY_DRAW_PLAN,
  mergeRuns,
  selectionDrawPlan,
  type CellRun,
  type DrawPlanInput,
  type SelectionDrawPlan,
} from './draw';
export { footprintCells, footprintOf, footprintOrigin, type FootprintSize } from './ghost';
export {
  SELECTION_TOOL_MODES,
  SelectionShape,
  SelectionToolMode,
  bridgePurposeOfMode,
  modeDrawsSelection,
  modeOfBridgePurpose,
  type SelectionToolModeRule,
} from './modes';
export { type SelectionPort, type SelectionSnapshot, type SelectionToolIntent } from './port';
export { readoutText, type ReadoutModel } from './readout';
export {
  NO_VALIDATION,
  cellRuleOf,
  firstConflictOf,
  validateToolSelection,
  type ToolCellRule,
  type ToolValidationInput,
} from './rules';
export {
  EMPTY_CELL_SET,
  cellsOf,
  rectCellCount,
  replaceCells,
  replaceWithRect,
  sameCells,
  subtractRect,
  toggleCell,
  unionRect,
  type CellRectCorners,
  type CellSet,
} from './set';
