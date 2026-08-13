// The world scene.
//
// Owner: workflow W4-D (world rendering). Third of the four scenes of plan section 9.2
// and the one the preload scene hands over to. It owns the camera, the chunk streaming,
// the two levels of detail, the grid and the outlines, and it owns nothing else: the
// entities and the selection tool of W5 register their own objects on the same scene
// through the bridge and through the runtime this module publishes.
//
// Three things live at scene level and not per chunk, exactly as plan section 9.3 puts
// them, and each for a concrete reason:
//
//   - The grid is one `TileSprite`. Per chunk it would be one object and one draw call
//     per chunk for a decoration; as a `Graphics` redrawn on every camera move it would
//     be a full path rebuild per frame.
//   - The outlines are one `Graphics`, rebuilt only when the visible set or a chunk
//     version changes. Per chunk they would be wrong as well as slower: a field that
//     spans two chunks would show a seam where its halves meet.
//   - The statistics are sampled here, because the draw call probe is a property of the
//     renderer and not of any object.
//
// Phaser never writes domain state (plan section 9). Everything this scene knows comes
// through `WorldSource`, and everything it has to say goes out on the bridge.

import Phaser from 'phaser';
import { SCENE_KEYS } from '../boot/scenes';
import { TEXTURE_KEYS } from '../textures/keys';
import { WorldCamera } from './camera';
import { ChunkView } from './chunkView';
import { DEPTH, LevelOfDetail, NEAR_LOD_MIN_ZOOM, STREAM_TICK_MS } from './config';
import { attachDrawCallProbe, type DrawCallProbe } from './drawCalls';
import {
  OUTLINE_COLOUR,
  OUTLINE_WIDTH,
  collectOutlineGroups,
  countSegments,
  type OutlineGroup,
} from './outlines';
import { type WorldChunkView, type WorldSource } from './source';
import { ChunkStreamer, type StreamTickStats } from './streamer';
import { type ThumbnailContext } from './thumbnail';
import { type UsageContext } from './tiles';
import { chunkRectContains } from './viewport';
import { worldPointOfScreen } from './zoom';
import type {
  CanvasPick,
  GameBridge,
  RenderPreferences,
  RenderStats,
} from '~/composables/useGameBridge';
import { CELL_PX, cellIndex, chunkOf, type ChunkCellPatch } from '~/shared/index';

/** Everything the debug counter and the measurement route read. */
export interface WorldStats {
  readonly fps: number;
  readonly drawCalls: number;
  readonly quads: number;
  readonly zoom: number;
  readonly levelOfDetail: LevelOfDetail;
  readonly liveChunks: number;
  readonly visibleChunks: number;
  readonly inFlightRequests: number;
  readonly outlineSegments: number;
  /** Milliseconds the last streaming tick took, loads included. */
  readonly lastTickMs: number;
  /** Milliseconds the last chunk build took, both representations included. */
  readonly lastChunkBuildMs: number;
  /** Milliseconds the last outline rebuild took. */
  readonly lastOutlineMs: number;
}

export interface WorldSceneOptions {
  readonly source: WorldSource;
  /** The bridge of the shell. Optional, so a harness can drive the scene with none. */
  readonly bridge?: GameBridge | undefined;
  /** Whether the debug counter starts visible. F3 toggles it (plan section 9.5). */
  readonly debug?: boolean | undefined;
  /** Cell the camera opens on and the one "back to the farm" returns to. */
  readonly home?: { readonly cellX: number; readonly cellY: number } | undefined;
  /**
   * Rendering preferences the scene starts with.
   *
   * A parameter as well as a bridge event because the two answer different questions:
   * the event is "the player changed a setting" and this is "what the setting was when
   * the canvas was built". Without it the first frames would be drawn with the defaults
   * and then corrected, which is visible as a grid that appears and disappears.
   */
  readonly preferences?: RenderPreferences | undefined;
}

/** The preferences of the canvas, with the defaults of the renderer. */
export const DEFAULT_RENDER_PREFERENCES: RenderPreferences = {
  gridVisible: true,
  outlinesVisible: true,
  lodThresholdZoom: NEAR_LOD_MIN_ZOOM,
  zoomSensitivity: 1,
  reducedMotion: false,
};

/** Distance in screen pixels under which a pointer up still counts as a click. */
const CLICK_SLOP_PX = 4;

/** How often the statistics reach the bridge. Four times a second is a readable rate. */
const STATS_INTERVAL_MS = 250;

export class WorldScene extends Phaser.Scene {
  readonly source: WorldSource;

  private readonly bridge: GameBridge | null;

  private readonly homeCell: { cellX: number; cellY: number };

  private worldCamera: WorldCamera | null = null;

  private streamer: ChunkStreamer | null = null;

  private grid: Phaser.GameObjects.TileSprite | null = null;

  private outlines: Phaser.GameObjects.Graphics | null = null;

  private probe: DrawCallProbe | null = null;

  private level: LevelOfDetail = LevelOfDetail.NEAR;

  private sinceTickMs = 0;

  private sinceStatsMs = 0;

  private outlineSignature = '';

  private outlineSegmentCount = 0;

  private lastTick: StreamTickStats | null = null;

  private lastTickMs = 0;

  private tickCount = 0;

  private tickTotalMs = 0;

  private tickMaxMs = 0;

  private lastChunkBuildMs = 0;

  private buildCount = 0;

  private buildTotalMs = 0;

  private buildMaxMs = 0;

  private lodBuildCount = 0;

  /**
   * Frames the engine has actually stepped.
   *
   * Counted here and not derived from `requestAnimationFrame` by the measurement route,
   * because the two can disagree: a browser that stops delivering animation frames to a
   * window it considers hidden leaves the route measuring its own fallback timer and
   * reporting a frame rate the renderer never produced. Comparing this counter with the
   * wall clock is what makes such a run visible instead of plausible.
   */
  private frameCount = 0;

  private lastOutlineMs = 0;

  private drawCalls = 0;

  private hoverCellKey = '';

  private pointerDownX = 0;

  private pointerDownY = 0;

  /** Whether the debug counter of the overlay is on. Toggled with F3. */
  debugVisible: boolean;

  private preferences: RenderPreferences;

  private created = false;

  private readonly detachers: (() => void)[] = [];

  constructor(options: WorldSceneOptions) {
    super({ key: SCENE_KEYS.WORLD });
    this.source = options.source;
    this.bridge = options.bridge ?? null;
    this.debugVisible = options.debug ?? false;
    this.homeCell = { cellX: options.home?.cellX ?? 0, cellY: options.home?.cellY ?? 0 };
    this.preferences = options.preferences ?? DEFAULT_RENDER_PREFERENCES;
  }

  // -------------------------------------------------------------------------
  // Life cycle
  // -------------------------------------------------------------------------

  create(): void {
    this.worldCamera = new WorldCamera({
      scene: this,
      cellPx: this.source.cellPx || CELL_PX,
      onChanged: (view) => {
        this.bridge?.emit('camera:changed', view);
      },
    });
    this.worldCamera.setHome(this.homeCell.cellX, this.homeCell.cellY);
    this.worldCamera.goto({ cellX: this.homeCell.cellX, cellY: this.homeCell.cellY });

    this.grid = this.add
      .tileSprite(0, 0, 1, 1, TEXTURE_KEYS.grid)
      .setOrigin(0, 0)
      .setDepth(DEPTH.GRID);
    this.outlines = this.add.graphics().setDepth(DEPTH.OUTLINES);

    this.streamer = new ChunkStreamer(
      {
        source: this.source,
        createView: (chunk) => this.buildChunkView(chunk),
        onFetchError: (error) => {
          // Not silent and not fatal: the chunk keeps showing its generated terrain and
          // the next tick asks again. A thrown error here would kill the render loop.
          console.warn('[world] a chunk batch failed', error);
        },
      },
      this.level,
    );

    this.probe = attachDrawCallProbe(this.game);

    // The preferences the page published before this scene existed, when there are any:
    // the bridge retains the last payload of `settings:changed` precisely because this
    // method runs after the boot and preload scenes have had their turn.
    this.setRenderPreferences(this.bridge?.latest('settings:changed') ?? this.preferences);

    this.attachBridge();
    this.attachScaleAndInput();

    // The overlay runs beside the world and not on top of it as a scene stack of one:
    // it needs its own camera, which does not scroll (plan section 9.2).
    if (this.scene.manager.keys[SCENE_KEYS.OVERLAY] !== undefined) {
      this.scene.launch(SCENE_KEYS.OVERLAY);
    }

    // One tick before the first frame, so the world is not empty for 100 ms.
    this.streamTick();

    this.created = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.teardown();
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.teardown();
    });
  }

  /** True once `create` has run, so a caller outside the engine can wait for it. */
  get isReady(): boolean {
    return this.created;
  }

  // -------------------------------------------------------------------------
  // Client preferences
  // -------------------------------------------------------------------------

  /**
   * Applies the rendering preferences of the player.
   *
   * Three of the five belong to this scene and two to the camera, and none of them is
   * stored here: the panel persists them and the page republishes them, so there is one
   * copy and the canvas never writes it. Changing the level of detail threshold can move
   * the level without the zoom moving, which is why the level is re-read here and not
   * left to the next frame.
   */
  setRenderPreferences(next: RenderPreferences): void {
    this.preferences = next;
    const camera = this.worldCamera;
    if (camera !== null) {
      camera.setLodThreshold(next.lodThresholdZoom);
      camera.setZoomSensitivity(next.zoomSensitivity);
      camera.setReducedMotion(next.reducedMotion);
      const level = camera.levelOfDetail;
      if (level !== this.level) {
        this.level = level;
        this.streamer?.setLevelOfDetail(level);
      }
    }
    // Forces the next comparison to miss, so turning the outlines back on redraws them
    // instead of waiting for the visible set to change.
    this.outlineSignature = '';
    this.drawGrid();
    this.rebuildOutlinesIfNeeded();
  }

  /** The preferences in force. Read by the debug counter and by the tests. */
  renderPreferences(): RenderPreferences {
    return this.preferences;
  }

  private teardown(): void {
    this.created = false;
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers.length = 0;
    this.streamer?.destroy();
    this.streamer = null;
    this.worldCamera?.destroy();
    this.worldCamera = null;
    this.probe?.dispose();
    this.probe = null;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  override update(_time: number, delta: number): void {
    const camera = this.worldCamera;
    if (camera === null) {
      return;
    }
    this.frameCount += 1;
    camera.update(delta);

    const level = camera.levelOfDetail;
    if (level !== this.level) {
      this.level = level;
      // Only visibility changes here (plan section 9.3). Whatever half is missing is
      // built by the streaming tick, for visible chunks and a bounded number at a time.
      this.streamer?.setLevelOfDetail(level);
    }

    this.sinceTickMs += delta;
    if (this.sinceTickMs >= STREAM_TICK_MS) {
      this.sinceTickMs = 0;
      this.streamTick();
    }

    this.drawGrid();

    this.drawCalls = this.probe?.sample() ?? 0;
    this.sinceStatsMs += delta;
    if (this.sinceStatsMs >= STATS_INTERVAL_MS) {
      this.sinceStatsMs = 0;
      this.bridge?.emit('render:stats', this.renderStats());
    }
  }

  /** One streaming tick and, when the visible set changed, one outline rebuild. */
  streamTick(): void {
    const camera = this.worldCamera;
    const streamer = this.streamer;
    if (camera === null || streamer === null) {
      return;
    }
    const start = performance.now();
    this.lastTick = streamer.tick(camera.viewRect());
    this.lastTickMs = performance.now() - start;
    this.lodBuildCount += this.lastTick.upgraded;
    this.tickCount += 1;
    this.tickTotalMs += this.lastTickMs;
    this.tickMaxMs = Math.max(this.tickMaxMs, this.lastTickMs);
    this.rebuildOutlinesIfNeeded();
  }

  /** One tick, returning how many chunks it loaded. Used by the memory sweep. */
  streamTickCounted(): number {
    this.streamTick();
    return this.lastTick?.loaded ?? 0;
  }

  /** Whether the draw call counter is a real measurement and not a fallback of zero. */
  get drawCallsMeasured(): boolean {
    return this.probe?.active ?? false;
  }

  // -------------------------------------------------------------------------
  // Chunks
  // -------------------------------------------------------------------------

  private usageContext(): UsageContext & ThumbnailContext {
    const source = this.source;
    return {
      viewerPlayerId: source.viewerPlayerId(),
      fieldState: (fieldId) => source.fieldState(fieldId),
      pending: source.pendingCells(),
    };
  }

  private buildChunkView(chunk: WorldChunkView): ChunkView {
    const start = performance.now();
    const view = new ChunkView(
      {
        scene: this,
        seed: this.source.seed,
        chunkSize: this.source.chunkSize,
        cellPx: this.source.cellPx || CELL_PX,
        context: () => this.usageContext(),
      },
      chunk,
    );
    // Visibility only. The engine object of the level is built by the streaming tick and
    // only for the chunks the camera can actually see, which is what keeps a tick that
    // loads thirty two chunks from creating thirty two GPU textures for a prefetch ring
    // nobody is looking at. What that costs is measured as the duration of the tick.
    view.setLevelOfDetail(this.level);
    const elapsed = performance.now() - start;
    this.lastChunkBuildMs = elapsed;
    this.buildCount += 1;
    this.buildTotalMs += elapsed;
    this.buildMaxMs = Math.max(this.buildMaxMs, elapsed);
    return view;
  }

  /**
   * Cost of the chunk builds since the last reset.
   *
   * Accumulated here and not derived from `lastChunkBuildMs` by the measurement route,
   * because a route that samples once per frame sees one build in thirty and would
   * report the cheapest ones.
   */
  buildSamples(): { readonly count: number; readonly meanMs: number; readonly maxMs: number } {
    return {
      count: this.buildCount,
      meanMs: this.buildCount === 0 ? 0 : this.buildTotalMs / this.buildCount,
      maxMs: this.buildMaxMs,
    };
  }

  resetBuildSamples(): void {
    this.buildCount = 0;
    this.buildTotalMs = 0;
    this.buildMaxMs = 0;
    this.tickCount = 0;
    this.tickTotalMs = 0;
    this.tickMaxMs = 0;
  }

  /**
   * Cost of the streaming ticks since the last reset.
   *
   * This is the number a player feels: a tick loads chunks, builds the level of detail
   * of the ones that became visible, drops what left the ring and rebuilds the outlines,
   * all inside one frame. A per chunk figure alone would hide that.
   */
  tickSamples(): { readonly count: number; readonly meanMs: number; readonly maxMs: number } {
    return {
      count: this.tickCount,
      meanMs: this.tickCount === 0 ? 0 : this.tickTotalMs / this.tickCount,
      maxMs: this.tickMaxMs,
    };
  }

  /**
   * Visible chunks that had to build the half of a level of detail they had never been
   * drawn at, since the scene started.
   *
   * It is what makes the claim of plan section 9.3 measurable. Once the visible chunks of
   * a camera position have been drawn at both levels, crossing the threshold there again
   * adds nothing to this counter, because a half is never destroyed while its chunk
   * lives.
   */
  lodBuilds(): number {
    return this.lodBuildCount;
  }

  /** Frames the engine has stepped since the scene started. */
  engineFrames(): number {
    return this.frameCount;
  }

  // -------------------------------------------------------------------------
  // Grid and outlines
  // -------------------------------------------------------------------------

  /**
   * The grid, as one `TileSprite` covering the visible world rectangle.
   *
   * It is a world object with the default scroll factor and a tile position equal to
   * the world point at the top left corner, so the pattern is aligned to the world
   * origin and the camera zoom scales it like everything else. Below the near
   * threshold it is hidden: a line every four screen pixels is not a grid, it is noise.
   */
  private drawGrid(): void {
    const grid = this.grid;
    const camera = this.worldCamera;
    if (grid === null || camera === null) {
      return;
    }
    if (this.level !== LevelOfDetail.NEAR || !this.preferences.gridVisible) {
      grid.setVisible(false);
      return;
    }
    const size = camera.viewportSize;
    const zoom = camera.zoom;
    const topLeft = worldPointOfScreen(camera.scrollPoint, size, zoom, 0, 0);
    grid.setVisible(true);
    grid.setPosition(topLeft.worldX, topLeft.worldY);
    grid.setSize(size.width / zoom, size.height / zoom);
    grid.setTilePosition(topLeft.worldX, topLeft.worldY);
  }

  /**
   * Rebuilds the outlines when, and only when, the visible set or a chunk version
   * changed (plan section 9.3).
   *
   * The signature is the visible rectangle plus the revision of the source, which is
   * bumped by every cache change. Comparing the two is one string comparison per tick
   * against an extraction that walks every visible cell.
   */
  private rebuildOutlinesIfNeeded(): void {
    const tick = this.lastTick;
    const graphics = this.outlines;
    if (tick === null || graphics === null) {
      return;
    }
    if (!this.preferences.outlinesVisible) {
      // A preference and not a level of detail, so it has its own signature: without one
      // the next tick would find the visible set unchanged and leave the outlines drawn.
      if (this.outlineSignature !== 'off') {
        this.outlineSignature = 'off';
        graphics.clear();
        this.outlineSegmentCount = 0;
      }
      return;
    }
    if (this.level !== LevelOfDetail.NEAR) {
      // At the far level of detail a cell is four pixels: an outline per field would be
      // a solid wash and would cost the extraction of every visible cell for it.
      if (this.outlineSignature !== 'far') {
        this.outlineSignature = 'far';
        graphics.clear();
        this.outlineSegmentCount = 0;
      }
      return;
    }
    const rect = tick.visibleRect;
    const signature = `${rect.minChunkX}:${rect.minChunkY}:${rect.maxChunkX}:${rect.maxChunkY}:${this.source.revision()}:${this.source.viewerPlayerId() ?? ''}`;
    if (signature === this.outlineSignature) {
      return;
    }
    this.outlineSignature = signature;

    const start = performance.now();
    const visible: WorldChunkView[] = [];
    for (let chunkY = rect.minChunkY; chunkY <= rect.maxChunkY; chunkY += 1) {
      for (let chunkX = rect.minChunkX; chunkX <= rect.maxChunkX; chunkX += 1) {
        const chunk = this.source.chunk(chunkX, chunkY);
        if (chunk !== undefined) {
          visible.push(chunk);
        }
      }
    }
    const groups = collectOutlineGroups(
      visible,
      this.source.chunkSize,
      this.source.viewerPlayerId(),
    );
    this.drawOutlines(groups);
    this.outlineSegmentCount = countSegments(groups);
    this.lastOutlineMs = performance.now() - start;
  }

  private drawOutlines(groups: readonly OutlineGroup[]): void {
    const graphics = this.outlines;
    if (graphics === null) {
      return;
    }
    const cellPx = this.source.cellPx || CELL_PX;
    graphics.clear();
    for (const group of groups) {
      graphics.lineStyle(OUTLINE_WIDTH[group.kind], OUTLINE_COLOUR[group.kind], 0.9);
      graphics.beginPath();
      for (const segment of group.segments) {
        graphics.moveTo(segment.fromCornerX * cellPx, segment.fromCornerY * cellPx);
        graphics.lineTo(segment.toCornerX * cellPx, segment.toCornerY * cellPx);
      }
      graphics.strokePath();
    }
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  stats(): WorldStats {
    const camera = this.worldCamera;
    const tick = this.lastTick;
    let quads = 0;
    if (this.streamer !== null) {
      for (const view of this.streamer.live()) {
        const count = view.quads();
        quads += count.terrain + count.usage + count.thumbnail;
      }
    }
    return {
      fps: this.game.loop.actualFps,
      drawCalls: this.drawCalls,
      quads,
      zoom: camera?.zoom ?? 1,
      levelOfDetail: this.level,
      liveChunks: this.streamer?.liveCount ?? 0,
      visibleChunks: tick?.visibleChunks ?? 0,
      inFlightRequests: this.streamer?.requestsInFlight ?? 0,
      outlineSegments: this.outlineSegmentCount,
      lastTickMs: this.lastTickMs,
      lastChunkBuildMs: this.lastChunkBuildMs,
      lastOutlineMs: this.lastOutlineMs,
    };
  }

  private renderStats(): RenderStats {
    const stats = this.stats();
    return {
      fps: stats.fps,
      drawCalls: stats.drawCalls,
      quads: stats.quads,
      loadedChunks: stats.liveChunks,
      levelOfDetail: stats.levelOfDetail,
    };
  }

  /** The camera, for the overlay and for the measurement route. */
  get worldCameraHandle(): WorldCamera | null {
    return this.worldCamera;
  }

  get streamerHandle(): ChunkStreamer | null {
    return this.streamer;
  }

  // -------------------------------------------------------------------------
  // Bridge and input
  // -------------------------------------------------------------------------

  private attachBridge(): void {
    const bridge = this.bridge;
    if (bridge === null) {
      return;
    }
    this.detachers.push(
      bridge.on('camera:goto', (order) => {
        this.worldCamera?.goto(order);
      }),
      bridge.on('input:enabled', (payload) => {
        this.worldCamera?.setInputEnabled(payload.enabled);
      }),
      bridge.on('viewport:resized', (payload) => {
        this.worldCamera?.setViewportSize(payload.width, payload.height);
      }),
      bridge.on('selection:mode', (mode) => {
        // While a selection mode is on, the primary button belongs to the selection
        // tool of W5 and the camera is panned with the middle or right button.
        this.worldCamera?.setPanWithPrimary(mode.purpose === null);
      }),
      bridge.on('chunks:invalidated', () => {
        this.streamer?.invalidateAll();
      }),
      bridge.on('world:reload', () => {
        this.streamer?.invalidateAll();
        this.outlineSignature = '';
      }),
      bridge.on('settings:changed', (preferences) => {
        this.setRenderPreferences(preferences);
      }),
    );
  }

  private attachScaleAndInput(): void {
    const onResize = (gameSize: Phaser.Structs.Size): void => {
      this.worldCamera?.setViewportSize(gameSize.width, gameSize.height);
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.detachers.push(() => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });

    const onPointerDown = (pointer: Phaser.Input.Pointer): void => {
      this.pointerDownX = pointer.x;
      this.pointerDownY = pointer.y;
    };
    const onPointerUp = (pointer: Phaser.Input.Pointer): void => {
      const moved =
        Math.abs(pointer.x - this.pointerDownX) + Math.abs(pointer.y - this.pointerDownY);
      if (moved > CLICK_SLOP_PX) {
        return;
      }
      this.emitPick(pointer);
    };
    const onPointerMove = (pointer: Phaser.Input.Pointer): void => {
      this.emitHover(pointer);
    };
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onPointerDown);
    this.input.on(Phaser.Input.Events.POINTER_UP, onPointerUp);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onPointerMove);
    this.detachers.push(() => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onPointerDown);
      this.input.off(Phaser.Input.Events.POINTER_UP, onPointerUp);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onPointerMove);
    });

    const keyboard = this.input.keyboard;
    if (keyboard !== null) {
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'F3') {
          event.preventDefault();
          this.debugVisible = !this.debugVisible;
        }
      };
      keyboard.on('keydown', onKey);
      this.detachers.push(() => {
        keyboard.off('keydown', onKey);
      });
    }
  }

  /** The modification record under a cell, or undefined for untouched ground. */
  patchAt(cellX: number, cellY: number): ChunkCellPatch | undefined {
    const size = this.source.chunkSize;
    const chunk = chunkOf(cellX, cellY, size);
    const held = this.source.chunk(chunk.chunkX, chunk.chunkY);
    return held?.patches.get(cellIndex(cellX, cellY, size));
  }

  private emitHover(pointer: Phaser.Input.Pointer): void {
    const camera = this.worldCamera;
    if (camera === null || this.bridge === null) {
      return;
    }
    const cell = camera.cellAt(pointer.x, pointer.y);
    const key = `${cell.cellX},${cell.cellY}`;
    if (key === this.hoverCellKey) {
      // Only on crossing a cell border, which is what keeps this at 60 frames per
      // second: a per pixel event would push a reactive update on every mouse move.
      return;
    }
    this.hoverCellKey = key;
    this.bridge.emit('canvas:hover', { cell: { cellX: cell.cellX, cellY: cell.cellY } });
  }

  private emitPick(pointer: Phaser.Input.Pointer): void {
    const camera = this.worldCamera;
    if (camera === null || this.bridge === null) {
      return;
    }
    const cell = camera.cellAt(pointer.x, pointer.y);
    const patch = this.patchAt(cell.cellX, cell.cellY);
    const subject: {
      readonly kind: CanvasPick['subjectKind'];
      readonly id: string | null;
    } =
      patch?.fieldId != null
        ? { kind: 'FIELD', id: patch.fieldId }
        : patch?.buildingId != null
          ? { kind: 'BUILDING', id: patch.buildingId }
          : patch?.forestPlotId != null
            ? { kind: 'FOREST_PLOT', id: patch.forestPlotId }
            : { kind: 'CELL', id: null };
    const modifiers = pointer.event as { shiftKey?: boolean; altKey?: boolean };
    this.bridge.emit('canvas:pick', {
      cell: { cellX: cell.cellX, cellY: cell.cellY },
      subjectKind: subject.kind,
      subjectId: subject.id,
      // The modifiers that turn a drag into a union or a subtraction (GDD section 17).
      // Read from the DOM event, because Phaser does not carry them on the pointer.
      additive: modifiers.shiftKey === true,
      subtractive: modifiers.altKey === true,
    });
  }

  /** True when a chunk is inside the visible rectangle of the last tick. */
  isChunkVisible(chunkX: number, chunkY: number): boolean {
    const rect = this.lastTick?.visibleRect;
    return rect === undefined ? false : chunkRectContains(rect, chunkX, chunkY);
  }
}
