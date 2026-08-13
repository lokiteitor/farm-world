// The world camera: drag, keyboard, discrete zoom anchored to the cursor.
//
// Owner: workflow W4-D (world rendering). It owns the scroll and the zoom in double
// precision and writes them to the Phaser camera once per frame. That indirection is
// not decoration: the renderer is configured with `roundPixels`, which makes Phaser
// floor `scrollX` and `scrollY` inside its own `preRender` and write the rounded value
// back. Keeping the authoritative value here means a sequence of zoom steps composes
// exactly, while what reaches the GPU is still snapped to the pixel and does not
// shimmer under nearest filtering.
//
// Plan section 9.5 asks for four things and each one is a method below: drag, keyboard,
// discrete zoom anchored to the cursor with a short transition, and no hard world bounds
// but a soft clamp against numerical drift, plus a way back to the farm.
//
// The anchoring is exact for the whole transition and not only at its ends. The world
// point under the pointer is captured when the step starts, and every frame recomputes
// the scroll that keeps that point under that pixel at the interpolated zoom. Lerping
// the scroll between two endpoints instead is the version where the world slides under
// the cursor and settles back, which reads as a wobble.

import Phaser from 'phaser';
import {
  CAMERA_FLIGHT_MS,
  DEFAULT_ZOOM,
  KEY_PAN_CELLS_PER_SECOND,
  NEAR_LOD_MIN_ZOOM,
  SOFT_SCROLL_BOUND_PX,
  ZOOM_TRANSITION_MS,
} from './config';
import { type CellRect } from './viewport';
import {
  cellOfScreen,
  levelOfDetail,
  scrollCenteredOnCell,
  snapZoom,
  softClampScroll,
  stepZoom,
  visibleCellRect,
  worldPointOfScreen,
  type ScrollPoint,
  type ViewportSize,
} from './zoom';
import type { CameraView } from '~/composables/useGameBridge';

/** Options of a camera order. */
export interface CameraGoto {
  readonly cellX: number;
  readonly cellY: number;
  readonly zoom?: number | undefined;
  readonly smooth?: boolean | undefined;
}

export interface WorldCameraDeps {
  readonly scene: Phaser.Scene;
  readonly cellPx: number;
  /** Published whenever the view changed, at most once per frame. */
  readonly onChanged: (view: CameraView) => void;
}

/** A zoom step in progress. */
interface ZoomTransition {
  readonly fromZoom: number;
  readonly toZoom: number;
  readonly anchorWorldX: number;
  readonly anchorWorldY: number;
  readonly anchorScreenX: number;
  readonly anchorScreenY: number;
  elapsedMs: number;
}

/** A flight to a cell. */
interface CameraFlight {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  elapsedMs: number;
}

/** Cubic ease out: fast at the start, settled at the end. */
function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

export class WorldCamera {
  private readonly deps: WorldCameraDeps;

  private scroll: ScrollPoint = { x: 0, y: 0 };

  private zoomValue: number = DEFAULT_ZOOM;

  private size: ViewportSize;

  private transition: ZoomTransition | null = null;

  private flight: CameraFlight | null = null;

  private dragging = false;

  private dragOriginX = 0;

  private dragOriginY = 0;

  private dragScroll: ScrollPoint = { x: 0, y: 0 };

  private inputEnabled = true;

  /** Whether the primary button pans. W5 turns it off while a selection mode is on. */
  private panWithPrimary = true;

  private homeCellX = 0;

  private homeCellY = 0;

  /** Zoom at or above which the near level of detail is used. A client preference. */
  private lodThreshold = NEAR_LOD_MIN_ZOOM;

  /** Discrete zoom steps a wheel notch is worth. A client preference. */
  private zoomSensitivity = 1;

  /** Whether the zoom transition and the camera flight are suppressed. */
  private reducedMotion = false;

  /**
   * Wheel notches accumulated but not yet spent.
   *
   * A sensitivity below one means a notch is worth less than a step, so the remainder has
   * to survive until the next notch; dropping it would make any value under one behave as
   * "no zoom at all" rather than as "slower zoom".
   */
  private wheelCredit = 0;

  private dirty = true;

  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};

  private readonly detachers: (() => void)[] = [];

  constructor(deps: WorldCameraDeps) {
    this.deps = deps;
    const gameSize = deps.scene.scale.gameSize;
    this.size = { width: gameSize.width, height: gameSize.height };
    this.attachInput();
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  get zoom(): number {
    return this.zoomValue;
  }

  get scrollPoint(): ScrollPoint {
    return this.scroll;
  }

  get viewportSize(): ViewportSize {
    return this.size;
  }

  /** The visible rectangle in cells, which is what the streamer plans against. */
  viewRect(): CellRect {
    return visibleCellRect(this.scroll, this.size, this.zoomValue, this.deps.cellPx);
  }

  view(): CameraView {
    const rect = this.viewRect();
    const centre = worldPointOfScreen(
      this.scroll,
      this.size,
      this.zoomValue,
      this.size.width / 2,
      this.size.height / 2,
    );
    return {
      centreCellX: Math.floor(centre.worldX / this.deps.cellPx),
      centreCellY: Math.floor(centre.worldY / this.deps.cellPx),
      zoom: this.zoomValue,
      minCellX: rect.minCellX,
      minCellY: rect.minCellY,
      maxCellX: rect.maxCellX,
      maxCellY: rect.maxCellY,
    };
  }

  /** The cell under a screen position, for the pick and hover events of the bridge. */
  cellAt(screenX: number, screenY: number): { readonly cellX: number; readonly cellY: number } {
    return cellOfScreen(this.scroll, this.size, this.zoomValue, this.deps.cellPx, screenX, screenY);
  }

  setViewportSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    this.size = { width, height };
    this.dirty = true;
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) {
      this.dragging = false;
    }
  }

  setPanWithPrimary(enabled: boolean): void {
    this.panWithPrimary = enabled;
  }

  /**
   * The three preferences of the player that the camera owns.
   *
   * Applied on the spot and never persisted here: `components/panels/settings` keeps them
   * in `localStorage` and the page republishes them on `settings:changed`, so the camera
   * has one source and no storage of its own.
   */
  setLodThreshold(zoom: number): void {
    if (Number.isFinite(zoom) && zoom > 0) {
      this.lodThreshold = zoom;
    }
  }

  setZoomSensitivity(multiplier: number): void {
    if (Number.isFinite(multiplier) && multiplier > 0) {
      this.zoomSensitivity = multiplier;
      this.wheelCredit = 0;
    }
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      // Whatever was in flight lands at once rather than being abandoned half way.
      this.settleMotion();
    }
  }

  /** The cell "back to the farm" returns to (plan section 9.5). */
  setHome(cellX: number, cellY: number): void {
    this.homeCellX = cellX;
    this.homeCellY = cellY;
  }

  goHome(smooth = true): void {
    this.goto({ cellX: this.homeCellX, cellY: this.homeCellY, smooth });
  }

  /** Centres on a cell, optionally with a short flight and a zoom. */
  goto(order: CameraGoto): void {
    const zoom = order.zoom === undefined ? this.zoomValue : snapZoom(order.zoom);
    const target = softClampScroll(
      scrollCenteredOnCell(this.size, this.deps.cellPx, order.cellX, order.cellY),
      SOFT_SCROLL_BOUND_PX,
    );
    this.zoomValue = zoom;
    this.transition = null;
    if (order.smooth !== true || this.reducedMotion) {
      this.flight = null;
      this.scroll = target;
      this.dirty = true;
      return;
    }
    this.flight = {
      fromX: this.scroll.x,
      fromY: this.scroll.y,
      toX: target.x,
      toY: target.y,
      elapsedMs: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  /**
   * One discrete zoom step, anchored at a screen position.
   *
   * Anchoring at the pointer is the only thing that makes a discrete zoom feel right
   * (plan section 9.5): the cell the player is pointing at stays exactly under the
   * pointer, so zooming in is "get closer to this" and not "get closer to the middle
   * and then find this again".
   */
  zoomStep(direction: number, screenX: number, screenY: number, steps = 1): void {
    const from = this.zoomValue;
    // Several steps compose into one transition rather than into several, because a
    // transition replaces the one before it: two calls inside a frame would move one step
    // and the sensitivity above one would silently do nothing.
    let to = from;
    for (let step = 0; step < Math.max(1, steps); step += 1) {
      to = stepZoom(to, direction);
    }
    if (to === from) {
      return;
    }
    const anchor = worldPointOfScreen(this.scroll, this.size, from, screenX, screenY);
    this.flight = null;
    if (this.reducedMotion) {
      this.transition = null;
      this.applyZoomAt(to, anchor.worldX, anchor.worldY, screenX, screenY);
      return;
    }
    this.transition = {
      fromZoom: from,
      toZoom: to,
      anchorWorldX: anchor.worldX,
      anchorWorldY: anchor.worldY,
      anchorScreenX: screenX,
      anchorScreenY: screenY,
      elapsedMs: 0,
    };
  }

  /**
   * The zoom applied at once, keeping a world point under a screen pixel.
   *
   * The same expression the interpolation uses on every frame, so an instant step and the
   * end of a transition land on exactly the same scroll.
   */
  private applyZoomAt(
    zoom: number,
    anchorWorldX: number,
    anchorWorldY: number,
    anchorScreenX: number,
    anchorScreenY: number,
  ): void {
    const halfWidth = this.size.width / 2;
    const halfHeight = this.size.height / 2;
    this.zoomValue = zoom;
    this.scroll = {
      x: anchorWorldX - halfWidth - (anchorScreenX - halfWidth) / zoom,
      y: anchorWorldY - halfHeight - (anchorScreenY - halfHeight) / zoom,
    };
    this.dirty = true;
  }

  /** Lands whatever motion is in flight, for the switch to reduced motion. */
  private settleMotion(): void {
    const transition = this.transition;
    if (transition !== null) {
      this.transition = null;
      this.applyZoomAt(
        transition.toZoom,
        transition.anchorWorldX,
        transition.anchorWorldY,
        transition.anchorScreenX,
        transition.anchorScreenY,
      );
    }
    const flight = this.flight;
    if (flight !== null) {
      this.flight = null;
      this.scroll = { x: flight.toX, y: flight.toY };
      this.dirty = true;
    }
  }

  /** The zoom that would result from a step, without applying it. For the debug panel. */
  peekZoom(direction: number): number {
    return stepZoom(this.zoomValue, direction);
  }

  /** True while a zoom step is being interpolated. */
  get transitioning(): boolean {
    return this.transition !== null;
  }

  /** The level of detail the current zoom asks for, at the threshold in force. */
  get levelOfDetail(): ReturnType<typeof levelOfDetail> {
    return levelOfDetail(this.zoomValue, this.lodThreshold);
  }

  /** The threshold in force, which the debug counter and a test read. */
  get lodThresholdZoom(): number {
    return this.lodThreshold;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  /** Advances the camera. Called once per frame by the scene. */
  update(deltaMs: number): void {
    this.stepKeyboard(deltaMs);
    this.stepTransition(deltaMs);
    this.stepFlight(deltaMs);
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    this.scroll = softClampScroll(this.scroll, SOFT_SCROLL_BOUND_PX);
    const camera = this.deps.scene.cameras.main;
    camera.setZoom(this.zoomValue);
    camera.setScroll(this.scroll.x, this.scroll.y);
    this.deps.onChanged(this.view());
  }

  private stepTransition(deltaMs: number): void {
    const transition = this.transition;
    if (transition === null) {
      return;
    }
    transition.elapsedMs += deltaMs;
    const ratio = easeOut(transition.elapsedMs / ZOOM_TRANSITION_MS);
    const zoom = transition.fromZoom + (transition.toZoom - transition.fromZoom) * ratio;
    // The scroll that keeps the captured world point under the captured pixel at this
    // zoom. Derived from the camera model of zoom.ts, not lerped.
    this.applyZoomAt(
      zoom,
      transition.anchorWorldX,
      transition.anchorWorldY,
      transition.anchorScreenX,
      transition.anchorScreenY,
    );
    if (transition.elapsedMs >= ZOOM_TRANSITION_MS) {
      this.zoomValue = transition.toZoom;
      this.transition = null;
    }
  }

  private stepFlight(deltaMs: number): void {
    const flight = this.flight;
    if (flight === null) {
      return;
    }
    flight.elapsedMs += deltaMs;
    const ratio = easeOut(flight.elapsedMs / CAMERA_FLIGHT_MS);
    this.scroll = {
      x: flight.fromX + (flight.toX - flight.fromX) * ratio,
      y: flight.fromY + (flight.toY - flight.fromY) * ratio,
    };
    this.dirty = true;
    if (flight.elapsedMs >= CAMERA_FLIGHT_MS) {
      this.scroll = { x: flight.toX, y: flight.toY };
      this.flight = null;
    }
  }

  private stepKeyboard(deltaMs: number): void {
    if (!this.inputEnabled) {
      return;
    }
    const left = this.isDown('LEFT') || this.isDown('A');
    const right = this.isDown('RIGHT') || this.isDown('D');
    const up = this.isDown('UP') || this.isDown('W');
    const down = this.isDown('DOWN') || this.isDown('S');
    const dx = (right ? 1 : 0) - (left ? 1 : 0);
    const dy = (down ? 1 : 0) - (up ? 1 : 0);
    if (dx === 0 && dy === 0) {
      return;
    }
    // Divided by the zoom, so the world moves at the same speed on screen whatever the
    // zoom is. Multiplying instead makes the keyboard useless when zoomed out, which is
    // exactly when it is needed.
    const step =
      ((KEY_PAN_CELLS_PER_SECOND * this.deps.cellPx) / this.zoomValue) * (deltaMs / 1000);
    this.flight = null;
    this.scroll = { x: this.scroll.x + dx * step, y: this.scroll.y + dy * step };
    this.dirty = true;
  }

  private isDown(name: string): boolean {
    return this.keys[name]?.isDown === true;
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private attachInput(): void {
    const input = this.deps.scene.input;

    const onPointerDown = (pointer: Phaser.Input.Pointer): void => {
      if (!this.inputEnabled) {
        return;
      }
      const pans = pointer.middleButtonDown() || pointer.rightButtonDown() || this.panWithPrimary;
      if (!pans) {
        return;
      }
      this.dragging = true;
      this.dragOriginX = pointer.x;
      this.dragOriginY = pointer.y;
      this.dragScroll = this.scroll;
    };
    const onPointerMove = (pointer: Phaser.Input.Pointer): void => {
      if (!this.dragging || !this.inputEnabled) {
        return;
      }
      // Divided by the zoom, because a drag moves the world under the pointer: one
      // screen pixel is one world pixel only at zoom 1.
      this.flight = null;
      this.scroll = {
        x: this.dragScroll.x - (pointer.x - this.dragOriginX) / this.zoomValue,
        y: this.dragScroll.y - (pointer.y - this.dragOriginY) / this.zoomValue,
      };
      this.dirty = true;
    };
    const onPointerUp = (): void => {
      this.dragging = false;
    };
    const onWheel = (
      pointer: Phaser.Input.Pointer,
      _over: unknown,
      _deltaX: number,
      deltaY: number,
    ): void => {
      if (!this.inputEnabled || deltaY === 0) {
        return;
      }
      const direction = deltaY < 0 ? 1 : -1;
      // The sensitivity is a multiplier over one step per notch, so a value below one
      // needs several notches to move one step and a value above one moves several. The
      // remainder is kept, and it is dropped when the direction changes so that a
      // reversal is immediate rather than having to work off the credit of the other way.
      if (direction * this.wheelCredit < 0) {
        this.wheelCredit = 0;
      }
      this.wheelCredit += direction * this.zoomSensitivity;
      const steps = Math.trunc(Math.abs(this.wheelCredit));
      if (steps === 0) {
        return;
      }
      this.wheelCredit -= direction * steps;
      this.zoomStep(direction, pointer.x, pointer.y, steps);
    };

    input.on(Phaser.Input.Events.POINTER_DOWN, onPointerDown);
    input.on(Phaser.Input.Events.POINTER_MOVE, onPointerMove);
    input.on(Phaser.Input.Events.POINTER_UP, onPointerUp);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onPointerUp);
    input.on(Phaser.Input.Events.GAMEOBJECT_WHEEL, onWheel);
    input.on('wheel', onWheel);
    this.detachers.push(() => {
      input.off(Phaser.Input.Events.POINTER_DOWN, onPointerDown);
      input.off(Phaser.Input.Events.POINTER_MOVE, onPointerMove);
      input.off(Phaser.Input.Events.POINTER_UP, onPointerUp);
      input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onPointerUp);
      input.off(Phaser.Input.Events.GAMEOBJECT_WHEEL, onWheel);
      input.off('wheel', onWheel);
    });

    const keyboard = input.keyboard;
    if (keyboard !== null) {
      this.keys = keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<
        string,
        Phaser.Input.Keyboard.Key
      >;
      const onKeyDown = (event: KeyboardEvent): void => {
        if (!this.inputEnabled) {
          return;
        }
        const centreX = this.size.width / 2;
        const centreY = this.size.height / 2;
        if (event.key === '+' || event.key === '=') {
          this.zoomStep(1, centreX, centreY);
        } else if (event.key === '-' || event.key === '_') {
          this.zoomStep(-1, centreX, centreY);
        } else if (event.key === 'Home') {
          this.goHome(true);
        }
      };
      keyboard.on('keydown', onKeyDown);
      this.detachers.push(() => {
        keyboard.off('keydown', onKeyDown);
      });
    }
  }

  destroy(): void {
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers.length = 0;
    this.keys = {};
  }
}
