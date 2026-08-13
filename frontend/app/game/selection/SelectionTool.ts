// The selection tool: the interaction machine that draws a set of cells over the world.
//
// Owner: workflow W4-G (selection tool). It is the fifth piece of plan section 9.5, and
// it plugs into the scenes of W4-D rather than owning one: the highlight has to sit in
// the world camera so that it scrolls and zooms with the ground it marks, and the reading
// beside the cursor has to sit on the overlay camera so that it does not (plan section
// 9.2). Both already exist; this module registers one object in each.
//
// Four rules the module exists to hold:
//
//   1. The mode is set from outside, never from inside. A panel publishes it on the
//      bridge or calls `setIntent`, and the tool obeys. A canvas that decided on its own
//      what the player was about to buy would be the canvas owning domain state, which is
//      the line plan section 9 draws.
//   2. The update happens on the crossing of a cell boundary and never per pixel. That is
//      what keeps a drag over thousands of cells at sixty frames per second, and it is
//      the reason `boundary.ts` exists as its own module with its own test.
//   3. The verdict comes from `shared/rules/selection.ts`, the same code the endpoint
//      runs. The green fill and the 400 cannot diverge, and the ceiling of two thousand
//      cells is the same constant on both sides (ADR-0012): the drag stops growing with a
//      warning, and the server refuses with `SELECTION_TOO_LARGE`.
//   4. Confirming mutates nothing. It publishes a snapshot through the port, and the
//      panel that receives it is the one that asks the server for the authoritative
//      budget. No store is written from here; the zone rule of `eslint.config.js` makes
//      sure of it and the port is how the state gets out.
//
// The gestures, in one place so they can be argued about:
//
//   drag                a new rectangle, replacing the set
//   shift + drag        union with the set (GDD section 17)
//   alt + drag          subtraction from the set
//   control + click     toggles one cell
//   move (placement)    the footprint of the catalogue follows the cursor
//   click (placement)   confirms the placement
//   Enter               confirm
//   Escape              cancel, and back to inspection

import Phaser from 'phaser';
import { type OverlayLabel, type OverlayScene } from '../overlay/OverlayScene';
import { type WorldScene } from '../world/WorldScene';
import { createBoundaryThrottle, type BoundaryThrottle } from './boundary';
import { resolveCells, type ToolCell } from './cells';
import {
  READOUT_OFFSET,
  SELECTION_ALPHA,
  SELECTION_COLOUR,
  SELECTION_DEPTH,
  SELECTION_OUTLINE_WIDTH,
} from './config';
import { EMPTY_DRAW_PLAN, selectionDrawPlan, type CellRun, type SelectionDrawPlan } from './draw';
import { footprintCells, footprintOf, type FootprintSize } from './ghost';
import {
  SELECTION_TOOL_MODES,
  SelectionShape,
  SelectionToolMode,
  bridgePurposeOfMode,
  modeDrawsSelection,
  modeOfBridgePurpose,
} from './modes';
import { type SelectionPort, type SelectionSnapshot, type SelectionToolIntent } from './port';
import { readoutText } from './readout';
import { cellRuleOf, firstConflictOf, validateToolSelection, type ToolCellRule } from './rules';
import {
  EMPTY_CELL_SET,
  cellsOf,
  replaceCells,
  replaceWithRect,
  sameCells,
  subtractRect,
  toggleCell,
  unionRect,
  type CellSet,
} from './set';
import { type GameBridge } from '~/composables/useGameBridge';
import {
  CELL_PX,
  DEFAULT_SELECTION_CONFIG,
  type CellCoordWire,
  type SelectionConfig,
  type SelectionValidation,
} from '~/shared/index';

/** What a drag in progress is doing to the set. */
const DragOperation = {
  REPLACE: 'REPLACE',
  UNION: 'UNION',
  SUBTRACT: 'SUBTRACT',
} as const;
type DragOperation = (typeof DragOperation)[keyof typeof DragOperation];

interface DragState {
  readonly anchor: CellCoordWire;
  readonly operation: DragOperation;
  /** The set as it was when the drag began, so a moving corner recomposes from it. */
  readonly base: CellSet;
}

export interface SelectionToolDeps {
  /** The world scene the highlight is registered on. */
  readonly world: WorldScene;
  /** The overlay scene the readout is anchored on. Without it there is no readout. */
  readonly overlay?: OverlayScene | null;
  /** The bridge of the shell. Optional, so a harness can drive the tool with none. */
  readonly bridge?: GameBridge | null;
  /** Where the snapshots go. Optional for the same reason. */
  readonly port?: SelectionPort;
  /** Injected so a test can lower the ceiling without touching the shared catalogue. */
  readonly config?: SelectionConfig;
}

const INSPECT_INTENT: SelectionToolIntent = { mode: SelectionToolMode.INSPECT };

export class SelectionTool {
  private readonly deps: SelectionToolDeps;

  private readonly config: SelectionConfig;

  private readonly boundary: BoundaryThrottle = createBoundaryThrottle();

  private readonly detachers: (() => void)[] = [];

  private intentValue: SelectionToolIntent = INSPECT_INTENT;

  private footprint: FootprintSize | null = null;

  /** The committed set. A drag recomposes the effective set from this one. */
  private committed: CellSet = EMPTY_CELL_SET;

  private effective: CellSet = EMPTY_CELL_SET;

  private drag: DragState | null = null;

  private graphics: Phaser.GameObjects.Graphics | null = null;

  private readout: OverlayLabel | null = null;

  private resolved: readonly ToolCell[] = [];

  private unresolvedKeys: readonly number[] = [];

  private validationValue: SelectionValidation | null = null;

  private plan: SelectionDrawPlan = EMPTY_DRAW_PLAN;

  private inputEnabled = true;

  private lastRevision = -1;

  /** Set while this tool is publishing its own mode, so its own listener ignores the echo. */
  private suppressBridgeMode = false;

  private attached = false;

  private destroyed = false;

  constructor(deps: SelectionToolDeps) {
    this.deps = deps;
    this.config = deps.config ?? DEFAULT_SELECTION_CONFIG;
    if (deps.world.isReady) {
      this.attach();
      return;
    }
    // The scene has not run `create` yet, so there is no display list to register on.
    const onCreate = (): void => {
      this.attach();
    };
    deps.world.events.once(Phaser.Scenes.Events.CREATE, onCreate);
    this.detachers.push(() => {
      deps.world.events.off(Phaser.Scenes.Events.CREATE, onCreate);
    });
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  get intent(): SelectionToolIntent {
    return this.intentValue;
  }

  get mode(): SelectionToolMode {
    return this.intentValue.mode;
  }

  get validation(): SelectionValidation | null {
    return this.validationValue;
  }

  get cells(): readonly CellCoordWire[] {
    return cellsOf(this.effective);
  }

  /** The current state, exactly as it reaches the port. */
  snapshot(): SelectionSnapshot {
    return {
      intent: this.intentValue,
      cells: cellsOf(this.effective),
      validation: this.validationValue,
      invalidCellCount: this.plan.invalidCellCount,
      unresolvedCount: this.unresolvedKeys.length,
      capped: this.effective.capped,
      firstConflict: firstConflictOf(this.validationValue),
    };
  }

  /** The draw plan of the last redraw. Diagnostics and tests only. */
  drawPlan(): SelectionDrawPlan {
    return this.plan;
  }

  // -------------------------------------------------------------------------
  // Mode
  // -------------------------------------------------------------------------

  /**
   * Switches the mode and clears the set.
   *
   * It publishes `selection:mode` on the bridge as well, which is what makes the camera
   * release the primary button whichever way the mode was set: `WorldCamera` only listens
   * to that event, and a panel that called this method directly would otherwise leave the
   * camera panning under the drag.
   */
  setIntent(next: SelectionToolIntent): void {
    this.drag = null;
    this.intentValue = next;
    this.footprint = next.buildingType == null ? null : footprintOf(next.buildingType);
    this.committed = EMPTY_CELL_SET;
    this.effective = EMPTY_CELL_SET;
    this.boundary.reset();
    this.recompute({ notify: true });
    this.publishMode(next.mode);
  }

  private publishMode(mode: SelectionToolMode): void {
    const bridge = this.deps.bridge;
    if (bridge == null || this.suppressBridgeMode) {
      return;
    }
    this.suppressBridgeMode = true;
    try {
      bridge.emit('selection:mode', { purpose: bridgePurposeOfMode(mode) });
    } finally {
      this.suppressBridgeMode = false;
    }
  }

  /** Replaces the set from outside, for a panel that restores a saved geometry. */
  setCells(cells: readonly CellCoordWire[]): void {
    const next = replaceCells(cells, this.config.maxSelectionCells);
    this.committed = next;
    this.applySet(next, { notify: true });
  }

  /** Empties the set without leaving the mode. */
  clear(): void {
    this.committed = EMPTY_CELL_SET;
    this.drag = null;
    this.boundary.reset();
    this.applySet(EMPTY_CELL_SET, { notify: true });
  }

  /** Leaves the mode, empties the set and tells the port. */
  cancel(): void {
    if (this.intentValue.mode === SelectionToolMode.INSPECT && this.effective.keys.length === 0) {
      return;
    }
    this.setIntent(INSPECT_INTENT);
    this.deps.port?.onCancel?.();
  }

  /**
   * Confirms the selection.
   *
   * It mutates nothing and it does not clear the set: it publishes the snapshot, and the
   * panel that receives it opens with the authoritative budget of the server (plan
   * section 9.5). Refused while the verdict is not green or while cells remain unresolved,
   * because a confirmation the server will certainly reject is a round trip spent to learn
   * what the client already knew.
   */
  confirm(): boolean {
    if (!modeDrawsSelection(this.intentValue.mode)) {
      return false;
    }
    const snapshot = this.snapshot();
    if (snapshot.validation?.ok !== true || snapshot.unresolvedCount > 0) {
      return false;
    }
    this.deps.port?.onConfirm?.(snapshot);
    return true;
  }

  /** Moves the camera to the first cell any issue points at (plan section 9.5). */
  jumpToFirstConflict(): CellCoordWire | null {
    const conflict = firstConflictOf(this.validationValue);
    if (conflict === null) {
      return null;
    }
    this.deps.bridge?.emit('camera:goto', {
      cellX: conflict.cellX,
      cellY: conflict.cellY,
      smooth: true,
    });
    return conflict;
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  private attach(): void {
    if (this.attached || this.destroyed) {
      return;
    }
    this.attached = true;
    const world = this.deps.world;
    this.graphics = world.add.graphics().setDepth(SELECTION_DEPTH);

    const onPointerDown = (pointer: Phaser.Input.Pointer): void => {
      this.onPointerDown(pointer);
    };
    const onPointerMove = (pointer: Phaser.Input.Pointer): void => {
      this.onPointerMove(pointer);
    };
    const onPointerUp = (pointer: Phaser.Input.Pointer): void => {
      this.onPointerUp(pointer);
    };
    world.input.on(Phaser.Input.Events.POINTER_DOWN, onPointerDown);
    world.input.on(Phaser.Input.Events.POINTER_MOVE, onPointerMove);
    world.input.on(Phaser.Input.Events.POINTER_UP, onPointerUp);
    world.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onPointerUp);
    this.detachers.push(() => {
      world.input.off(Phaser.Input.Events.POINTER_DOWN, onPointerDown);
      world.input.off(Phaser.Input.Events.POINTER_MOVE, onPointerMove);
      world.input.off(Phaser.Input.Events.POINTER_UP, onPointerUp);
      world.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onPointerUp);
    });

    const keyboard = world.input.keyboard;
    if (keyboard !== null) {
      const onKeyDown = (event: KeyboardEvent): void => {
        this.onKeyDown(event);
      };
      keyboard.on('keydown', onKeyDown);
      this.detachers.push(() => {
        keyboard.off('keydown', onKeyDown);
      });
    }

    const bridge = this.deps.bridge;
    if (bridge != null) {
      this.detachers.push(
        bridge.on('selection:mode', (mode) => {
          if (this.suppressBridgeMode) {
            return;
          }
          this.setIntent({ ...this.intentValue, mode: modeOfBridgePurpose(mode.purpose) });
          if (mode.fixedWidthCells != null && mode.fixedHeightCells != null) {
            this.footprint = {
              widthCells: mode.fixedWidthCells,
              heightCells: mode.fixedHeightCells,
            };
          }
        }),
        bridge.on('input:enabled', (payload) => {
          this.inputEnabled = payload.enabled;
          if (!payload.enabled) {
            this.drag = null;
          }
        }),
      );
    }

    // One integer comparison per frame, which is what turns the cells of a chunk that
    // arrives during a drag from unknown into a verdict without anybody polling.
    const onUpdate = (): void => {
      this.pollRevision();
    };
    world.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    this.detachers.push(() => {
      world.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    });

    world.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.destroy();
    });
  }

  private pollRevision(): void {
    const revision = this.deps.world.source.revision();
    if (revision === this.lastRevision) {
      return;
    }
    this.lastRevision = revision;
    if (this.effective.keys.length === 0) {
      return;
    }
    // The set did not change, only what is known about it, so the port is told and the
    // gesture is not disturbed.
    this.recompute({ notify: true });
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  private modifiersOf(pointer: Phaser.Input.Pointer): {
    readonly additive: boolean;
    readonly subtractive: boolean;
    readonly toggling: boolean;
  } {
    // Read from the DOM event: Phaser does not carry the modifiers on the pointer, which
    // is the same thing `WorldScene.emitPick` has to do for its pick.
    const event = pointer.event as {
      shiftKey?: boolean;
      altKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
    };
    return {
      additive: event?.shiftKey === true,
      subtractive: event?.altKey === true,
      toggling: event?.ctrlKey === true || event?.metaKey === true,
    };
  }

  private cellAt(pointer: Phaser.Input.Pointer): CellCoordWire | null {
    const camera = this.deps.world.worldCameraHandle;
    if (camera === null) {
      return null;
    }
    const cell = camera.cellAt(pointer.x, pointer.y);
    return { cellX: cell.cellX, cellY: cell.cellY };
  }

  private get usable(): boolean {
    return this.inputEnabled && !this.destroyed && modeDrawsSelection(this.intentValue.mode);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.usable || !pointer.leftButtonDown()) {
      return;
    }
    const cell = this.cellAt(pointer);
    if (cell === null) {
      return;
    }
    if (SELECTION_TOOL_MODES[this.intentValue.mode].shape === SelectionShape.FIXED_FOOTPRINT) {
      // The ghost already sits where the cursor is, so a click on it is the confirmation.
      this.confirm();
      return;
    }
    const modifiers = this.modifiersOf(pointer);
    if (modifiers.toggling) {
      const next = toggleCell(this.committed, cell, this.config.maxSelectionCells);
      this.committed = next;
      this.boundary.reset();
      this.boundary.accept(cell.cellX, cell.cellY);
      this.applySet(next, { notify: true });
      return;
    }
    const drag: DragState = {
      anchor: cell,
      operation: modifiers.subtractive
        ? DragOperation.SUBTRACT
        : modifiers.additive
          ? DragOperation.UNION
          : DragOperation.REPLACE,
      base: this.committed,
    };
    this.drag = drag;
    this.boundary.reset();
    this.boundary.accept(cell.cellX, cell.cellY);
    this.applyDrag(cell);
    this.emitDrag(drag, 'START', cell);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.usable) {
      return;
    }
    const cell = this.cellAt(pointer);
    if (cell === null) {
      return;
    }
    // The whole cost of a drag hangs on this line: everything below runs once per cell
    // entered and not once per pixel of pointer movement (plan section 9.5).
    if (!this.boundary.accept(cell.cellX, cell.cellY)) {
      return;
    }
    this.moveReadout(cell);
    if (SELECTION_TOOL_MODES[this.intentValue.mode].shape === SelectionShape.FIXED_FOOTPRINT) {
      this.applyFootprint(cell);
      return;
    }
    const drag = this.drag;
    if (drag === null) {
      return;
    }
    this.applyDrag(cell);
    this.emitDrag(drag, 'MOVE', cell);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (drag === null) {
      return;
    }
    this.drag = null;
    // A press and release on one cell is a one cell rectangle, so "click the first cell
    // and then drag" and "click to take one cell" are the same gesture and not two.
    const cell = this.cellAt(pointer) ?? drag.anchor;
    this.committed = this.effective;
    this.emitDrag(drag, 'END', cell);
    this.deps.port?.onChanged?.(this.snapshot());
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.inputEnabled || this.destroyed) {
      return;
    }
    if (event.key === 'Enter') {
      if (this.confirm()) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'Escape' && modeDrawsSelection(this.intentValue.mode)) {
      // Only while a mode is on, so Escape keeps meaning "one step back" for the shell
      // when the canvas has nothing to cancel (NOTES-w3c, section 1.5).
      event.preventDefault();
      this.cancel();
    }
  }

  private emitDrag(drag: DragState, phase: 'START' | 'MOVE' | 'END', to: CellCoordWire): void {
    this.deps.bridge?.emit('canvas:drag', {
      from: drag.anchor,
      to,
      phase,
      additive: drag.operation === DragOperation.UNION,
      subtractive: drag.operation === DragOperation.SUBTRACT,
    });
  }

  // -------------------------------------------------------------------------
  // Set
  // -------------------------------------------------------------------------

  private applyDrag(current: CellCoordWire): void {
    const drag = this.drag;
    if (drag === null) {
      return;
    }
    const corners = { from: drag.anchor, to: current };
    const ceiling = this.config.maxSelectionCells;
    const next =
      drag.operation === DragOperation.SUBTRACT
        ? subtractRect(drag.base, corners)
        : drag.operation === DragOperation.UNION
          ? unionRect(drag.base, corners, ceiling)
          : replaceWithRect(corners, ceiling);
    this.applySet(next, { notify: true });
  }

  private applyFootprint(anchor: CellCoordWire): void {
    const size = this.footprint;
    if (size === null) {
      return;
    }
    const next = replaceCells(footprintCells(anchor, size), this.config.maxSelectionCells);
    this.committed = next;
    this.applySet(next, { notify: true });
  }

  private applySet(next: CellSet, options: { readonly notify: boolean }): void {
    if (sameCells(this.effective, next) && next.capped === this.effective.capped) {
      return;
    }
    this.effective = next;
    this.recompute(options);
  }

  /** Resolves, validates, redraws and publishes. The only path that touches the canvas. */
  private recompute(options: { readonly notify: boolean }): void {
    const intent = this.intentValue;
    if (!modeDrawsSelection(intent.mode) || this.effective.keys.length === 0) {
      this.resolved = [];
      this.unresolvedKeys = [];
      this.validationValue = null;
      this.plan = EMPTY_DRAW_PLAN;
      this.redraw();
      this.updateReadout();
      if (options.notify) {
        this.deps.port?.onChanged?.(this.snapshot());
      }
      return;
    }

    const resolution = resolveCells(this.deps.world.source, this.effective.keys);
    this.resolved = resolution.cells;
    this.unresolvedKeys = resolution.unresolved;
    this.validationValue = validateToolSelection({
      intent,
      cells: resolution.cells,
      config: this.config,
    });
    const rule: ToolCellRule = cellRuleOf(intent, this.config);
    this.plan = selectionDrawPlan({
      cells: resolution.cells,
      unresolved: resolution.unresolved,
      rule,
    });
    this.redraw();
    this.updateReadout();
    if (options.notify) {
      this.deps.port?.onChanged?.(this.snapshot());
    }
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private fillRuns(
    graphics: Phaser.GameObjects.Graphics,
    runs: readonly CellRun[],
    colour: number,
    alpha: number,
    cellPx: number,
  ): void {
    if (runs.length === 0) {
      return;
    }
    graphics.fillStyle(colour, alpha);
    for (const run of runs) {
      graphics.fillRect(run.cellX * cellPx, run.cellY * cellPx, run.widthCells * cellPx, cellPx);
    }
  }

  /** One `Graphics`, redrawn only from `recompute`, that is only on a change of the set. */
  private redraw(): void {
    const graphics = this.graphics;
    if (graphics === null) {
      return;
    }
    graphics.clear();
    const plan = this.plan;
    if (plan.outline.length === 0) {
      return;
    }
    const cellPx = this.deps.world.source.cellPx || CELL_PX;
    this.fillRuns(
      graphics,
      plan.unresolved,
      SELECTION_COLOUR.unresolved,
      SELECTION_ALPHA.unresolved,
      cellPx,
    );
    this.fillRuns(graphics, plan.valid, SELECTION_COLOUR.valid, SELECTION_ALPHA.valid, cellPx);
    this.fillRuns(
      graphics,
      plan.invalid,
      SELECTION_COLOUR.invalid,
      SELECTION_ALPHA.invalid,
      cellPx,
    );
    graphics.lineStyle(SELECTION_OUTLINE_WIDTH, SELECTION_COLOUR.outline, SELECTION_ALPHA.outline);
    graphics.beginPath();
    for (const segment of plan.outline) {
      graphics.moveTo(segment.fromCornerX * cellPx, segment.fromCornerY * cellPx);
      graphics.lineTo(segment.toCornerX * cellPx, segment.toCornerY * cellPx);
    }
    graphics.strokePath();
  }

  // -------------------------------------------------------------------------
  // Readout
  // -------------------------------------------------------------------------

  private overlayLabel(create: boolean): OverlayLabel | null {
    if (this.readout !== null) {
      return this.readout;
    }
    const overlay = this.deps.overlay ?? null;
    if (!create || overlay === null || !overlay.sys.isActive()) {
      return null;
    }
    const anchor = this.boundary.current ?? { cellX: 0, cellY: 0 };
    this.readout = overlay.addLabel({ ...anchor, ...READOUT_OFFSET }, '');
    return this.readout;
  }

  private moveReadout(cell: CellCoordWire): void {
    this.overlayLabel(false)?.move({ ...cell, ...READOUT_OFFSET });
  }

  private updateReadout(): void {
    const validation = this.validationValue;
    const text = readoutText({
      mode: this.intentValue.mode,
      cellCount: this.resolved.length,
      invalidCellCount: this.plan.invalidCellCount,
      unresolvedCount: this.unresolvedKeys.length,
      price: validation === null ? null : validation.price,
      capped: this.effective.capped,
    });
    // Created only when there is something to say, so inspection never puts an empty
    // label on the overlay.
    const label = this.overlayLabel(text.length > 0);
    if (label === null) {
      return;
    }
    label.setText(text);
    label.setVisible(text.length > 0);
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers.length = 0;
    this.readout?.remove();
    this.readout = null;
    this.graphics?.destroy();
    this.graphics = null;
    this.drag = null;
    this.effective = EMPTY_CELL_SET;
    this.committed = EMPTY_CELL_SET;
    this.validationValue = null;
    this.plan = EMPTY_DRAW_PLAN;
  }
}

/** Creates the tool and wires it to the scenes of W4-D. */
export function createSelectionTool(deps: SelectionToolDeps): SelectionTool {
  return new SelectionTool(deps);
}
