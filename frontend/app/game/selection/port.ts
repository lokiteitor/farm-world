// The port through which the selection tool talks to the world outside the canvas.
//
// Owner: workflow W4-G (selection tool).
//
// Same reason `game/world/source.ts` exists: the zone rule of `eslint.config.js` forbids
// `frontend/app/game` from importing `frontend/app/stores`, and it is the mechanical half
// of the pillar of plan section 9. The tool declares what it publishes as an interface
// and whoever mounts the canvas binds it to `stores/selection.ts` and to the panel host.
//
// What the tool never does is mutate domain state. Confirming publishes a snapshot and
// nothing else: the panel that receives it is the one that asks the server, with the
// authoritative budget the server answers with (plan section 9.5). The optimistic state
// of the client is a decoration and never a write (ADR-0019).

import { type SelectionToolMode } from './modes';
import { type BuildingType, type CellCoordWire, type SelectionValidation } from '~/shared/index';

/** What the current selection will become once the player confirms it. */
export interface SelectionToolIntent {
  readonly mode: SelectionToolMode;
  /** Field being extended (GDD section 20) or split (GDD section 21). */
  readonly fieldId?: string | null;
  /** Forest plot the felling happens in (GDD section 135), or the cells are leaving. */
  readonly forestPlotId?: string | null;
  /** Building being placed, whose footprint fixes the cell count (GDD section 116). */
  readonly buildingType?: BuildingType | null;
  /**
   * Cells of the subject the selection acts against: the cells of the field being
   * extended, which the selection must touch, or the cells of the field being split,
   * which it must be a proper subset of.
   */
  readonly targetCells?: readonly CellCoordWire[];
}

/** The state of the tool after a change. Everything a panel needs, and nothing else. */
export interface SelectionSnapshot {
  readonly intent: SelectionToolIntent;
  /** The set, in the order the cells were added, which is the order the issues report. */
  readonly cells: readonly CellCoordWire[];
  /** The aggregated verdict, or null while the mode draws no set. */
  readonly validation: SelectionValidation | null;
  /** Cells that fail their per cell rule. */
  readonly invalidCellCount: number;
  /**
   * Cells whose chunk is not loaded, and about which no verdict can be given. Greater
   * than zero means the verdict is provisional and a green result is not a licence to
   * send, exactly as `stores/selection.ts` documents.
   */
  readonly unresolvedCount: number;
  /** True when the drag stopped growing because it reached the shared ceiling. */
  readonly capped: boolean;
  /** First cell that caused a rejection, for the jump to the conflict. */
  readonly firstConflict: CellCoordWire | null;
}

/**
 * What the binding outside the canvas provides.
 *
 * Every member is optional so a harness can drive the tool with none of them, which is
 * what the unit tests do.
 */
export interface SelectionPort {
  /** Called on every change of the set. Only on a cell boundary crossing, never per pixel. */
  readonly onChanged?: (snapshot: SelectionSnapshot) => void;
  /**
   * Called when the player confirms. It mutates nothing: the handler opens the panel that
   * owns the request (plan section 9.5).
   */
  readonly onConfirm?: (snapshot: SelectionSnapshot) => void;
  /** Called when the player cancels, which also returns the tool to inspection. */
  readonly onCancel?: () => void;
}
