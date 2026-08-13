// The overlay scene: labels, progress bars and the debug counter.
//
// Owner: workflow W4-D (world rendering) for the anchoring machinery and the counter;
// the entity labels of W5-D plug into the same registry.
//
// Fourth of the four scenes of plan section 9.2, and it exists for one reason: its
// camera does not scroll and does not zoom. A label is therefore drawn once at its
// natural size and only its position is recomputed as the world camera moves, which is
// what makes a rotulo readable at zoom 0.25 and not gigantic at zoom 2.8 without
// rescaling every label on every frame.
//
// The registry is deliberately small. `addLabel` and `addProgress` return a handle with
// `move`, `set` and `remove`, and that is the whole contract W5 needs; anything richer
// would be guessing at what the entity layer wants and would have to be rewritten when
// it arrives.

import Phaser from 'phaser';
import { SCENE_KEYS } from '../boot/scenes';
import { PALETTE } from '../textures/palette';
import { type WorldScene, type WorldStats } from '../world/WorldScene';
import { projectAnchor, type WorldAnchor } from './anchors';
import { debugLines, isOverBudget } from './debugLines';

/** Geometry of a progress bar, in screen pixels. */
const BAR = { width: 42, height: 5 } as const;

/** Common controls of anything anchored to the world. */
export interface OverlayItem {
  /** Moves the anchor. Cheap: the projection happens on the next frame anyway. */
  move(anchor: WorldAnchor): void;
  setVisible(visible: boolean): void;
  remove(): void;
}

/** A text label anchored to a cell. */
export interface OverlayLabel extends OverlayItem {
  setText(text: string): void;
}

/** A progress bar anchored to a cell, from 0 to 1. */
export interface OverlayProgress extends OverlayItem {
  setRatio(ratio: number): void;
}

interface Anchored {
  anchor: WorldAnchor;
  visible: boolean;
  readonly place: (screenX: number, screenY: number) => void;
  readonly hide: () => void;
  readonly destroy: () => void;
}

export interface OverlaySceneOptions {
  /** The world scene this overlay follows. Injected, never fetched from the manager. */
  readonly world: () => WorldScene | null;
}

export class OverlayScene extends Phaser.Scene {
  private readonly options: OverlaySceneOptions;

  private readonly items = new Set<Anchored>();

  private debugText: Phaser.GameObjects.Text | null = null;

  private debugPanel: Phaser.GameObjects.Rectangle | null = null;

  constructor(options: OverlaySceneOptions) {
    super({ key: SCENE_KEYS.OVERLAY });
    this.options = options;
  }

  create(): void {
    // No scroll and no zoom: this is the whole point of the scene.
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(1);

    this.debugPanel = this.add
      .rectangle(8, 8, 320, 118, PALETTE.ui.canvasVoid, 0.72)
      .setOrigin(0, 0)
      .setVisible(false);
    this.debugText = this.add
      .text(16, 14, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        color: '#e6e9ee',
        lineSpacing: 3,
      })
      .setVisible(false);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clear();
    });
  }

  // -------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------

  /** A text label anchored to a cell. */
  addLabel(anchor: WorldAnchor, text: string): OverlayLabel {
    const object = this.add
      .text(0, 0, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        color: '#e6e9ee',
        backgroundColor: 'rgba(16,19,23,0.65)',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1);
    const item = this.register(object, anchor);
    return {
      move: (next) => {
        item.anchor = next;
      },
      setVisible: (visible) => {
        item.visible = visible;
      },
      setText: (next) => {
        object.setText(next);
      },
      remove: () => {
        this.unregister(item);
      },
    };
  }

  /** A progress bar anchored to a cell (GDD section 61: growth and task progress). */
  addProgress(anchor: WorldAnchor, ratio = 0): OverlayProgress {
    const container = this.add.container(0, 0);
    const back = this.add
      .rectangle(0, 0, BAR.width, BAR.height, PALETTE.ui.canvasVoid, 0.8)
      .setOrigin(0.5, 1);
    const fill = this.add
      .rectangle(-BAR.width / 2, 0, BAR.width, BAR.height, PALETTE.ui.cursorValid, 0.95)
      .setOrigin(0, 1);
    container.add([back, fill]);
    const apply = (value: number): void => {
      fill.width = BAR.width * Math.min(1, Math.max(0, value));
    };
    apply(ratio);
    const item = this.register(container, anchor);
    return {
      move: (next) => {
        item.anchor = next;
      },
      setVisible: (visible) => {
        item.visible = visible;
      },
      setRatio: apply,
      remove: () => {
        this.unregister(item);
      },
    };
  }

  private register(
    object: Phaser.GameObjects.Components.Visible & Phaser.GameObjects.Components.Transform,
    anchor: WorldAnchor,
  ): Anchored {
    const item: Anchored = {
      anchor,
      visible: true,
      place: (screenX, screenY) => {
        object.setPosition(screenX, screenY);
        object.setVisible(true);
      },
      hide: () => {
        object.setVisible(false);
      },
      destroy: () => {
        (object as unknown as Phaser.GameObjects.GameObject).destroy();
      },
    };
    this.items.add(item);
    return item;
  }

  private unregister(item: Anchored): void {
    if (this.items.delete(item)) {
      item.destroy();
    }
  }

  /** Drops every anchored object. Used on shutdown and by a full reload. */
  clear(): void {
    for (const item of this.items) {
      item.destroy();
    }
    this.items.clear();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  override update(): void {
    const world = this.options.world();
    const camera = world?.worldCameraHandle ?? null;
    if (world === null || camera === null) {
      return;
    }
    const scroll = camera.scrollPoint;
    const size = camera.viewportSize;
    const zoom = camera.zoom;
    const cellPx = world.source.cellPx;

    for (const item of this.items) {
      if (!item.visible) {
        item.hide();
        continue;
      }
      const point = projectAnchor(item.anchor, scroll, size, zoom, cellPx);
      if (!point.onScreen) {
        // Hidden and not destroyed: an entity that leaves the viewport comes back, and
        // rebuilding its label would cost a texture upload for a scroll of one pixel.
        item.hide();
        continue;
      }
      item.place(point.screenX, point.screenY);
    }

    this.renderDebug(world.debugVisible, world.stats());
  }

  private renderDebug(visible: boolean, stats: WorldStats): void {
    const text = this.debugText;
    const panel = this.debugPanel;
    if (text === null || panel === null) {
      return;
    }
    if (!visible) {
      text.setVisible(false);
      panel.setVisible(false);
      return;
    }
    const lines = debugLines(stats);
    text.setText(lines.join('\n'));
    text.setColor(isOverBudget(stats) ? '#f0a94a' : '#e6e9ee');
    panel.setSize(Math.max(300, text.width + 16), text.height + 12);
    text.setVisible(true);
    panel.setVisible(true);
  }
}
