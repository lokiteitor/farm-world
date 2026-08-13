// How a panel reads the world grid, and how it asks the canvas for a selection.
//
// Owner: W4-E. Read by the cell inspector, the land purchase panel, the field creation
// panel and the field edit panel.
//
// It lives beside the cell inspector because the concept it owns is "what a cell is": the
// inspector is the panel that answers that question for one cell, and the other three
// answer it for a set. Everything else it does is delegation, and that is the point of the
// module: none of the rules below is written here.
//
//   - Resolving a coordinate into a cell is `resolveCell` of `game/selection/cells.ts`,
//     which W4-G wrote against the same chunk cache the renderer draws from. A panel that
//     read the patch map itself would be a second decoder of the modification layer.
//   - Judging a selection is `validateToolSelection` of `game/selection/rules.ts`, which is
//     `validateSelection` of `shared/rules` for seven of the nine modes and a documented
//     composition of the same primitives for the other two. The client highlight and the
//     400 of the server are therefore the same code (plan section 8).
//   - Loading a chunk is `POST /api/world/chunks` fed into `applyChunkResult` of the world
//     store, which is the same entry point the streamer of W4-D uses. A panel needs it
//     because a verdict about a cell whose chunk never arrived is not a verdict:
//     `unresolvedCount` above zero means the selection is undecided and must not be sent
//     (docs/handoff/NOTES-w4g.md, section 2.4).
//
// Nothing here writes a domain store. The selection store is presentation state driven by
// the pointer, and it is the one store a panel legitimately writes: the tool feeds it the
// cells and the panel feeds it the intent, which is the split `stores/selection.ts` and
// `game/selection/port.ts` were designed around.

import { type GameBridge } from '~/composables/useGameBridge';
import { resolveCell, resolveCells, type CellReader, type ToolCell } from '~/game/selection/cells';
import {
  SelectionToolMode,
  SELECTION_TOOL_MODES,
  bridgePurposeOfMode,
} from '~/game/selection/modes';
import { type SelectionToolIntent } from '~/game/selection/port';
import { validateToolSelection } from '~/game/selection/rules';
import { type WorldChunkView } from '~/game/world/source';
import {
  BUILDING_CATALOGUE,
  MAX_CHUNKS_PER_REQUEST,
  apiErrorMessage,
  cellKey,
  chunkOf,
  chunksCovering,
  type ApiErrorCode,
  type CellCoordWire,
  type ChunkCoordWire,
  type ChunkResult,
  type SelectionCell,
  type SelectionValidation,
  type SelectionPurpose,
} from '~/shared/index';

// ---------------------------------------------------------------------------
// Reading the grid
// ---------------------------------------------------------------------------

/**
 * The part of `stores/world.ts` a panel reads, declared structurally.
 *
 * Structural and not an import of the store for the same reason `WorldSource` of W4-D is:
 * the shape is what matters, a renamed method stops the compilation at the call site, and
 * a test drives the helpers with three lines of object literal instead of a Pinia
 * instance.
 */
export interface PanelWorldGrid {
  readonly chunkSize: number;
  readonly revision: number;
  getChunk(chunkX: number, chunkY: number): WorldChunkView | undefined;
  heldVersion(chunkX: number, chunkY: number): number | undefined;
  applyChunkResult(result: ChunkResult, atRealMs: number): void;
}

/**
 * A `CellReader` over the world store.
 *
 * Every member is a getter or a call, never a value captured at construction: a Pinia
 * setup store unwraps its computed refs on the proxy, so reading `grid.chunkSize` again
 * is what gives the current value.
 */
export function panelCellReader(
  grid: PanelWorldGrid,
  viewerPlayerId: () => string | null,
): CellReader {
  return {
    get chunkSize(): number {
      return grid.chunkSize;
    },
    chunk: (chunkX, chunkY) => grid.getChunk(chunkX, chunkY),
    viewerPlayerId,
  };
}

/** The cell at a coordinate, or null while its chunk is not loaded. */
export function readCell(reader: CellReader, cell: CellCoordWire): ToolCell | null {
  return resolveCell(reader, cell.cellX, cell.cellY);
}

/** A whole set of coordinates in one pass, keeping the unresolved ones apart. */
export function readCells(
  reader: CellReader,
  cells: readonly CellCoordWire[],
): { readonly cells: readonly ToolCell[]; readonly unresolvedCount: number } {
  const resolved = resolveCells(
    reader,
    cells.map((cell) => cellKey(cell.cellX, cell.cellY)),
  );
  return { cells: resolved.cells, unresolvedCount: resolved.unresolved.length };
}

// ---------------------------------------------------------------------------
// Loading a chunk a panel needs
// ---------------------------------------------------------------------------

/** Issues `POST /api/world/chunks`. Injected so a test needs no transport. */
export type ChunkFetcher = (
  chunks: readonly { chunkX: number; chunkY: number; rev?: number }[],
) => Promise<readonly ChunkResult[]>;

/**
 * Ensures the chunks covering a rectangle of cells are in the cache.
 *
 * Bounded twice: by `MAX_CHUNKS_PER_REQUEST` of the contract, and by skipping nothing,
 * because a chunk already held travels with its `rev` and the server answers `unchanged`,
 * which is what makes revisiting free (shared/api/schemas/world.ts). Returns the number of
 * chunks actually requested, so a caller can tell "nothing to do" from "one round trip".
 */
export async function ensureChunksFor(
  grid: PanelWorldGrid,
  fetcher: ChunkFetcher,
  cells: readonly CellCoordWire[],
  atRealMs: number,
): Promise<number> {
  const wanted = new Map<string, ChunkCoordWire>();
  for (const cell of cells) {
    const chunk = chunkOf(cell.cellX, cell.cellY, grid.chunkSize);
    wanted.set(`${chunk.chunkX}:${chunk.chunkY}`, chunk);
  }
  const missing = [...wanted.values()].filter(
    (chunk) => grid.getChunk(chunk.chunkX, chunk.chunkY) === undefined,
  );
  if (missing.length === 0) {
    return 0;
  }
  const batch = missing.slice(0, MAX_CHUNKS_PER_REQUEST).map((chunk) => {
    const rev = grid.heldVersion(chunk.chunkX, chunk.chunkY);
    return rev === undefined
      ? { chunkX: chunk.chunkX, chunkY: chunk.chunkY }
      : { chunkX: chunk.chunkX, chunkY: chunk.chunkY, rev };
  });
  const results = await fetcher(batch);
  for (const result of results) {
    grid.applyChunkResult(result, atRealMs);
  }
  return batch.length;
}

/** The part of `stores/fields.ts` the geometry loader touches. Structural, as above. */
export interface PanelFieldGeometry {
  cellsOf(fieldId: string): readonly CellCoordWire[];
  applyCells(fieldId: string, cells: readonly CellCoordWire[]): void;
}

/**
 * Makes sure the geometry of a field is known, fetching the detail when it is not.
 *
 * The cells of a field travel in the snapshot and in the `FIELD_UPSERTED` frame, and never in
 * the listing: a player with many fields would otherwise download the whole geometry of the
 * holding on every refresh (shared/api/schemas/fields.ts). So a panel that needs the shape --
 * the edit panel, which validates against it, and the inspector, which centres the camera on
 * it -- can legitimately find none, and `GET /api/fields/:fieldId` is the route whose whole
 * purpose is to answer that.
 *
 * It writes the geometry map of the store with the reply of the server, which is the same call
 * the reducer makes for the same payload. Nothing is invented here.
 */
export async function ensureFieldGeometry(
  fields: PanelFieldGeometry,
  fetchDetail: (fieldId: string) => Promise<{ readonly cells: readonly CellCoordWire[] }>,
  fieldId: string,
): Promise<void> {
  if (fields.cellsOf(fieldId).length > 0) {
    return;
  }
  const detail = await fetchDetail(fieldId);
  fields.applyCells(fieldId, detail.cells);
}

/** Chunks a rectangle of cells covers, for a caller that wants to count them first. */
export function chunksOfCells(
  grid: PanelWorldGrid,
  from: CellCoordWire,
  to: CellCoordWire,
): readonly ChunkCoordWire[] {
  return chunksCovering(from.cellX, from.cellY, to.cellX, to.cellY, grid.chunkSize);
}

// ---------------------------------------------------------------------------
// Asking the canvas for a selection
// ---------------------------------------------------------------------------

/** The part of `stores/selection.ts` a panel reads and writes. Structural, as above. */
export interface PanelSelection {
  readonly purpose: SelectionPurpose | null;
  readonly count: number;
  begin(
    intent: { purpose: SelectionPurpose; fieldId?: string; forestPlotId?: string },
    touching?: readonly CellCoordWire[],
  ): void;
  cancel(): void;
  clearCells(): void;
}

/**
 * Puts the canvas into a selection mode and records the intent on the client.
 *
 * Two publications and not one, because the two sides need different things. The bridge
 * event `selection:mode` is what the tool of W4-G listens to and what makes the camera
 * release the primary button, and it can only carry a `SelectionPurpose`: the split of GDD
 * section 21 and the felling of GDD section 135 have none, which is recorded in
 * `docs/handoff/NOTES-w4g.md`, section 1.2. The store intent is what the rest of the
 * client reads, and it is set only when the shared rules have a purpose for the mode; for
 * the two that do not, the panel keeps the verdict itself with `judgeSelection`, which is
 * the function that knows about them.
 *
 * A selection already composed for this same purpose is kept. It matters because of the flow
 * of plan section 9.5: the player drags on the canvas, confirms, and the confirmation opens
 * the panel that owns the request. A panel that began a fresh selection on mount would throw
 * away the very cells it was opened to confirm.
 */
export function startSelectionMode(
  deps: { readonly bridge: GameBridge; readonly selection: PanelSelection },
  intent: SelectionToolIntent,
  touching: readonly CellCoordWire[] = [],
): void {
  const rule = SELECTION_TOOL_MODES[intent.mode];
  const purpose = bridgePurposeOfMode(intent.mode);
  const footprint =
    intent.mode === SelectionToolMode.BUILDING && intent.buildingType != null
      ? BUILDING_CATALOGUE[intent.buildingType]
      : null;
  // The subject travels with the mode. `purpose` alone cannot name the two modes the shared
  // rules have no purpose for, and for a felling the nearest purpose is `CLEAR_LAND`, whose per
  // cell rule demands exactly the opposite: a cell with no standing tree. Sending `mode` and the
  // three identifiers is what lets the tool paint the right verdict during the drag instead of
  // the verdict of a clearing (docs/handoff/NOTES-w6w.md 4.3).
  deps.bridge.emit('selection:mode', {
    purpose,
    mode: intent.mode,
    fieldId: intent.fieldId ?? null,
    forestPlotId: intent.forestPlotId ?? null,
    buildingType: intent.buildingType ?? null,
    ...(footprint === null
      ? {}
      : { fixedWidthCells: footprint.widthCells, fixedHeightCells: footprint.heightCells }),
  });
  if (rule.purpose !== null) {
    if (deps.selection.purpose === rule.purpose && deps.selection.count > 0) {
      return;
    }
    deps.selection.begin(
      {
        purpose: rule.purpose,
        ...(intent.fieldId == null ? {} : { fieldId: intent.fieldId }),
        ...(intent.forestPlotId == null ? {} : { forestPlotId: intent.forestPlotId }),
      },
      touching,
    );
    return;
  }
  // A mode the shared rules have no purpose for leaves the set alone unless another mode was
  // holding it: the cells belong to the tool, and the panel judges them with `judgeSelection`.
  if (deps.selection.purpose !== null) {
    deps.selection.cancel();
  }
}

/** Returns the canvas to inspection and drops the client side intent. */
export function stopSelectionMode(deps: {
  readonly bridge: GameBridge;
  readonly selection: PanelSelection;
}): void {
  deps.bridge.emit('selection:mode', { purpose: null });
  deps.selection.cancel();
}

/** Moves the camera to a cell. Used by every "jump to the conflict" of these panels. */
export function jumpToCell(bridge: GameBridge, cell: CellCoordWire, smooth = true): void {
  bridge.emit('camera:goto', { cellX: cell.cellX, cellY: cell.cellY, smooth });
}

// ---------------------------------------------------------------------------
// Judging a selection
// ---------------------------------------------------------------------------

export interface SelectionVerdict {
  readonly validation: SelectionValidation;
  /** Cells whose chunk has not arrived. Above zero the verdict is provisional. */
  readonly unresolvedCount: number;
  /** True when the verdict is green and complete, which is the only case that may be sent. */
  readonly sendable: boolean;
  readonly firstConflict: CellCoordWire | null;
}

/**
 * The verdict of a set of cells for one intent.
 *
 * A green verdict with cells still unresolved is not a licence to send: the client is a
 * cache and cannot make a claim about a cell it does not hold (plan section 7). That is
 * why `sendable` is a separate field and not `validation.ok`.
 */
export function judgeSelection(
  reader: CellReader,
  intent: SelectionToolIntent,
  cells: readonly CellCoordWire[],
): SelectionVerdict {
  const resolved = readCells(reader, cells);
  const validation = validateToolSelection({ intent, cells: resolved.cells });
  let firstConflict: CellCoordWire | null = null;
  for (const issue of validation.issues) {
    if (issue.firstCell !== null) {
      firstConflict = { cellX: issue.firstCell.cellX, cellY: issue.firstCell.cellY };
      break;
    }
  }
  return {
    validation,
    unresolvedCount: resolved.unresolvedCount,
    sendable: validation.ok && resolved.unresolvedCount === 0 && cells.length > 0,
    firstConflict,
  };
}

// ---------------------------------------------------------------------------
// Reasons, as the interface shows them
// ---------------------------------------------------------------------------

export interface ReasonLine {
  readonly code: ApiErrorCode;
  /** The message of the shared table, never a text written here. */
  readonly message: string;
  readonly cellCount: number;
  readonly firstCell: CellCoordWire | null;
}

/**
 * The issues of a verdict as lines the panel prints.
 *
 * The message comes from `VALIDATION_MESSAGES` through the issue itself, which is what the
 * shared module already put there; `apiErrorMessage` is the fallback for a code that
 * reached the panel from an error body rather than from a rule. One line per code and
 * never one per cell: two hundred identical complaints are not a reason, they are a wall.
 */
export function reasonLines(validation: SelectionValidation | null): readonly ReasonLine[] {
  return (validation?.issues ?? []).map((issue) => ({
    code: issue.code,
    message: issue.message.length > 0 ? issue.message : apiErrorMessage(issue.code),
    cellCount: issue.cellCount,
    firstCell:
      issue.firstCell === null
        ? null
        : { cellX: issue.firstCell.cellX, cellY: issue.firstCell.cellY },
  }));
}

/** Aggregates blocked cells of a land quote by their reason, keeping the first of each. */
export function groupByReason(
  cells: readonly {
    readonly cellX: number;
    readonly cellY: number;
    readonly blockedBy: ApiErrorCode | null;
  }[],
): readonly ReasonLine[] {
  const perCode = new Map<ApiErrorCode, { count: number; firstCell: CellCoordWire }>();
  for (const cell of cells) {
    if (cell.blockedBy === null) {
      continue;
    }
    const existing = perCode.get(cell.blockedBy);
    if (existing === undefined) {
      perCode.set(cell.blockedBy, {
        count: 1,
        firstCell: { cellX: cell.cellX, cellY: cell.cellY },
      });
    } else {
      existing.count += 1;
    }
  }
  return [...perCode].map(([code, entry]) => ({
    code,
    message: apiErrorMessage(code),
    cellCount: entry.count,
    firstCell: entry.firstCell,
  }));
}

/** The shared shape the selection rules take, for a caller that already has a `ToolCell`. */
export function asSelectionCell(cell: ToolCell): SelectionCell {
  return {
    cellX: cell.cellX,
    cellY: cell.cellY,
    terrain: cell.terrain,
    ownership: cell.ownership,
    landUse: cell.landUse,
    hasStandingTree: cell.hasStandingTree,
  };
}
