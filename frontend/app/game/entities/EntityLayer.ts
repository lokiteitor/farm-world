// The entity layer: buildings, machinery, workers and trees on the world canvas.
//
// Owner: workflow W5-D (canvas entities). It plugs into the scenes of W4-D rather than
// owning one, exactly as the selection tool of W4-G does: the sprites have to sit in the
// world camera so that they scroll and zoom with the ground they stand on, and the
// progress bars have to sit on the overlay camera so that they do not (plan section 9.2).
// Both scenes already exist; this module registers one `Layer` in the first and a handful
// of anchored items in the second.
//
// Four rules the module exists to hold:
//
//   1. It only reads. Everything that comes in arrives through `EntitySource`, and the
//      zone rule of `eslint.config.js` makes sure no store can be reached from here.
//   2. Every decision is in `plan.ts` and is pure. What is left in this file is
//      allocation: acquiring an image, assigning it a texture, moving it. That is the
//      part a unit test cannot say anything useful about, and it is deliberately the
//      only part that lives here.
//   3. Two rates, one truth. The structural pass runs ten times a second and decides
//      which entities exist and where the idle ones are; the frame pass moves only what
//      a task is moving. Both derive the pose from `taskPoses`, so they cannot disagree.
//   4. Nothing is destroyed that will be needed again. Sprites are recycled per chunk
//      through a pool with a ceiling (`pool.ts`), because the streaming ring already
//      computes "this chunk stopped being relevant" ten times a second and a flat list
//      would have to rediscover it.

import Phaser from 'phaser';
import {
  type OverlayLabel,
  type OverlayProgress,
  type OverlayScene,
} from '../overlay/OverlayScene';
import { chunkRectOfCells, expandChunkRect, type ChunkRect } from '../world/viewport';
import { type WorldScene } from '../world/WorldScene';
import {
  DEPTH_RESORT_EPSILON_PX,
  ENTITY_LAYER_DEPTH,
  ENTITY_RING_CHUNKS,
  ENTITY_TICK_MS,
  EntityKind,
  MAX_POOLED_SPRITES_PER_KEY,
  MAX_SPRITES_PER_CHUNK_GROUP,
  PROGRESS_BAR_OFFSET_PX,
} from './config';
import { depthKeyOf } from './depth';
import {
  createTaskPathCache,
  planEntities,
  taskPoses,
  type EntityPlan,
  type SpritePlacement,
} from './plan';
import { ChunkEntityGroup, groupKeyOf, SpritePool } from './pool';
import { EMPTY_ENTITY_SOURCE, type EntityHit, type EntitySource } from './port';
import { CELL_PX, CHUNK_SIZE } from '~/shared/config/world';

/** What the counter of the measurement route reads off the layer. */
export interface EntityLayerStats {
  readonly sprites: number;
  readonly groups: number;
  readonly pooled: number;
  readonly pools: number;
  readonly treesDrawn: number;
  readonly treesSkipped: number;
  readonly overlays: number;
  /** Sprites a full group refused, since the layer was attached. */
  readonly dropped: number;
  /** Images built and images destroyed, which is what recycling is measured by. */
  readonly created: number;
  readonly destroyed: number;
  readonly depthSorts: number;
  readonly lastRebuildMs: number;
  readonly lastFrameMs: number;
}

export interface EntityLayerDeps {
  /** The world scene the sprites are registered on. */
  readonly world: WorldScene;
  /** The overlay the progress bars and labels are anchored on. Optional in a harness. */
  readonly overlay?: OverlayScene | null;
  readonly source?: EntitySource;
}

/** One live sprite and the properties the frame pass has to know about it. */
interface LiveSprite {
  readonly image: Phaser.GameObjects.Image;
  readonly textureKey: string;
  groupKey: string;
  depthKey: number;
  worldX: number;
  worldY: number;
  rotationRad: number;
  scale: number;
  tint: number | null;
}

export class EntityLayer {
  private readonly deps: EntityLayerDeps;

  private readonly source: EntitySource;

  private readonly paths = createTaskPathCache();

  private layer: Phaser.GameObjects.Layer | null = null;

  /** One pool per texture key: recycling across keys would scatter the batch. */
  private readonly pools = new Map<string, SpritePool<Phaser.GameObjects.Image>>();

  private readonly groups = new Map<string, ChunkEntityGroup<Phaser.GameObjects.Image>>();

  private readonly live = new Map<string, LiveSprite>();

  private readonly progress = new Map<string, OverlayProgress>();

  private readonly labels = new Map<string, OverlayLabel>();

  private occupancy: ReadonlyMap<string, EntityHit> = new Map();

  private sinceTickMs = 0;

  private lastRevision = -1;

  private lastRectSignature = '';

  private treesDrawn = 0;

  private treesSkipped = 0;

  private droppedCount = 0;

  private depthSortCount = 0;

  private lastRebuildMs = 0;

  private lastFrameMs = 0;

  private attached = false;

  private destroyed = false;

  private readonly detachers: (() => void)[] = [];

  constructor(deps: EntityLayerDeps) {
    this.deps = deps;
    this.source = deps.source ?? EMPTY_ENTITY_SOURCE;
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
  // Wiring
  // -------------------------------------------------------------------------

  private attach(): void {
    if (this.attached || this.destroyed) {
      return;
    }
    this.attached = true;
    const world = this.deps.world;
    this.layer = world.add.layer().setDepth(ENTITY_LAYER_DEPTH);

    const onUpdate = (_time: number, delta: number): void => {
      this.step(delta);
    };
    world.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    this.detachers.push(() => {
      world.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    });

    world.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.destroy();
    });

    // One pass before the first frame, so a farm that is already on screen is not blank
    // for a tenth of a second after the scene appears.
    this.rebuild();
  }

  /** True once the layer has a display list to draw on. */
  get isAttached(): boolean {
    return this.attached;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private step(deltaMs: number): void {
    const started = performance.now();
    this.sinceTickMs += deltaMs;
    const rectChanged = this.rectSignature() !== this.lastRectSignature;
    const revisionChanged = this.source.revision() !== this.lastRevision;
    if (this.sinceTickMs >= ENTITY_TICK_MS || rectChanged || revisionChanged) {
      this.sinceTickMs = 0;
      this.rebuild();
      this.lastFrameMs = performance.now() - started;
      return;
    }
    this.advance();
    this.lastFrameMs = performance.now() - started;
  }

  /**
   * The structural pass: which entities exist, where the idle ones are, which trees the
   * zoom admits, and the depth order of all of it.
   */
  rebuild(): void {
    const layer = this.layer;
    if (layer === null || this.destroyed) {
      return;
    }
    const started = performance.now();
    const rect = this.chunkRect();
    const camera = this.deps.world.worldCameraHandle;
    const view = camera?.viewRect();
    const cellPx = this.cellPx();

    const plan = planEntities({
      buildings: this.source.buildings(),
      machines: this.source.machines(),
      workers: this.source.workers(),
      trees: this.source.trees(),
      tasks: this.source.activeTasks(),
      rect,
      chunkSize: this.chunkSize(),
      cellPx,
      zoom: camera?.zoom ?? 1,
      nowGameMs: this.source.nowGameMs(),
      centreCellX: view === undefined ? 0 : (view.minCellX + view.maxCellX) / 2,
      centreCellY: view === undefined ? 0 : (view.minCellY + view.maxCellY) / 2,
      pathOf: (task) => this.paths.pathOf(task),
    });

    this.applyPlan(plan, layer);
    this.lastRevision = this.source.revision();
    this.lastRectSignature = this.rectSignature();
    this.lastRebuildMs = performance.now() - started;
  }

  private applyPlan(plan: EntityPlan, layer: Phaser.GameObjects.Layer): void {
    // What survives, grouped by chunk, so a group can be swept in one pass.
    const keepByGroup = new Map<string, Set<string>>();
    for (const placement of plan.sprites) {
      const groupKey = groupKeyOf(placement.chunkX, placement.chunkY);
      const held = keepByGroup.get(groupKey);
      if (held === undefined) {
        keepByGroup.set(groupKey, new Set([placement.id]));
      } else {
        held.add(placement.id);
      }
    }

    // Groups whose chunk left the ring go back to the pool whole; the rest keep only
    // what the plan still names.
    for (const [groupKey, group] of [...this.groups]) {
      const keep = keepByGroup.get(groupKey);
      for (const [id] of group.entries()) {
        if (keep === undefined || !keep.has(id)) {
          this.live.delete(id);
        }
      }
      if (keep === undefined) {
        group.releaseAll(this.releaser);
        this.groups.delete(groupKey);
        continue;
      }
      group.retainOnly(keep, this.releaser);
    }

    // The order of `plan.sprites` is the draw order, so adding in that order gives the
    // layer a correct list even before the depth sort runs.
    for (const placement of plan.sprites) {
      this.place(placement, layer);
    }

    this.syncOverlays(plan);
    this.occupancy = plan.occupancy;
    this.treesDrawn = plan.treesDrawn;
    this.treesSkipped = plan.treesSkipped;
    this.requestDepthSort();
  }

  /**
   * Puts one placement on screen, reusing the sprite that is already there.
   *
   * The fast path is the point of the method and not an optimisation added later. In the
   * load case this workflow is measured against, two thousand of the two and a half
   * thousand sprites are trees, and a tree does not move, does not turn and does not
   * change texture between two rebuilds. Assigning it its texture, its origin, its
   * position, its rotation, its scale, its depth and its tint ten times a second is seven
   * property writes and seven dirty flags per tree for nothing, and it measured as the
   * dominant cost of the structural pass before the comparison below existed.
   *
   * Reuse is decided by the texture and by the chunk, not by identity alone: a tree that
   * crossed a growth boundary needs another sprite, because retexturing the one it has
   * would scatter the multi texture batch that keeps the whole layer inside two draw
   * calls, and a machine that drove into the next chunk belongs to another group.
   */
  private place(placement: SpritePlacement, layer: Phaser.GameObjects.Layer): void {
    const groupKey = groupKeyOf(placement.chunkX, placement.chunkY);
    const held = this.live.get(placement.id);
    if (
      held !== undefined &&
      held.textureKey === placement.textureKey &&
      held.groupKey === groupKey
    ) {
      this.refresh(held, placement);
      return;
    }
    if (held !== undefined) {
      this.release(placement.id);
    }

    let group = this.groups.get(groupKey);
    if (group === undefined) {
      group = new ChunkEntityGroup(placement.chunkX, placement.chunkY, MAX_SPRITES_PER_CHUNK_GROUP);
      this.groups.set(groupKey, group);
    }

    const before = group.dropped;
    const image = group.claim(placement.id, () => this.poolOf(placement.textureKey).acquire());
    if (image === null) {
      this.droppedCount += group.dropped - before;
      return;
    }
    if (!layer.exists(image)) {
      layer.add(image);
    }
    image.setTexture(placement.textureKey);
    image.setOrigin(placement.originX, placement.originY);
    image.setPosition(placement.worldX, placement.worldY);
    image.setRotation(placement.rotationRad);
    image.setScale(placement.scale);
    image.setDepth(placement.depthKey);
    image.setVisible(true);
    if (placement.tint === null) {
      image.clearTint();
    } else {
      image.setTint(placement.tint);
    }
    this.live.set(placement.id, {
      image,
      textureKey: placement.textureKey,
      groupKey,
      depthKey: placement.depthKey,
      worldX: placement.worldX,
      worldY: placement.worldY,
      rotationRad: placement.rotationRad,
      scale: placement.scale,
      tint: placement.tint,
    });
  }

  /** Applies to a live sprite only the properties that actually changed. */
  private refresh(held: LiveSprite, placement: SpritePlacement): void {
    if (held.worldX !== placement.worldX || held.worldY !== placement.worldY) {
      held.image.setPosition(placement.worldX, placement.worldY);
      held.worldX = placement.worldX;
      held.worldY = placement.worldY;
    }
    if (held.rotationRad !== placement.rotationRad) {
      held.image.setRotation(placement.rotationRad);
      held.rotationRad = placement.rotationRad;
    }
    if (held.scale !== placement.scale) {
      held.image.setScale(placement.scale);
      held.scale = placement.scale;
    }
    if (held.depthKey !== placement.depthKey) {
      held.image.setDepth(placement.depthKey);
      held.depthKey = placement.depthKey;
    }
    if (held.tint !== placement.tint) {
      if (placement.tint === null) {
        held.image.clearTint();
      } else {
        held.image.setTint(placement.tint);
      }
      held.tint = placement.tint;
    }
  }

  /**
   * The frame pass: only what a task is moving.
   *
   * A handful of sprites, which is why it can run every frame where the structural pass
   * cannot. A machine that leaves its chunk between two structural passes keeps drawing
   * in the right place; it is re-homed at the next one, which is a tenth of a second.
   */
  private advance(): void {
    const cellPx = this.cellPx();
    const now = this.source.nowGameMs();
    let resort = false;
    for (const task of this.source.activeTasks()) {
      const poses = taskPoses(task, this.paths.pathOf(task), now, cellPx);
      if (poses === null) {
        continue;
      }
      for (const entry of poses.machines) {
        const moved = this.moveTo(
          `machine:${entry.machineId}`,
          EntityKind.MACHINE,
          entry.pose,
          cellPx,
        );
        resort = moved || resort;
      }
      if (poses.worker !== null) {
        const moved = this.moveTo(
          `worker:${poses.worker.workerId}`,
          EntityKind.WORKER,
          poses.worker.pose,
          cellPx,
        );
        resort = moved || resort;
      }
      const bar = this.progress.get(`progress:${task.id}`);
      if (bar !== undefined) {
        bar.setRatio(poses.ratio);
        bar.move({
          cellX: poses.leadCellX,
          cellY: poses.leadCellY,
          offsetY: PROGRESS_BAR_OFFSET_PX,
        });
      }
    }
    if (resort) {
      this.requestDepthSort();
    }
  }

  /** Moves one live sprite. Returns whether the move is worth a depth sort. */
  private moveTo(
    id: string,
    kind: EntityKind,
    pose: { readonly cellX: number; readonly cellY: number; readonly headingRad: number },
    cellPx: number,
  ): boolean {
    const held = this.live.get(id);
    if (held === undefined) {
      return false;
    }
    const worldX = pose.cellX * cellPx;
    const worldY = pose.cellY * cellPx;
    held.image.setPosition(worldX, worldY);
    held.image.setRotation(pose.headingRad);
    held.worldX = worldX;
    held.rotationRad = pose.headingRad;
    // A depth sort of a few thousand children is cheap but it is not free, and paying it
    // for a tractor that moved a tenth of a pixel is paying it for nothing.
    if (Math.abs(worldY - held.worldY) < DEPTH_RESORT_EPSILON_PX) {
      return false;
    }
    held.worldY = worldY;
    const depthKey = depthKeyOf({ kind, worldY });
    held.depthKey = depthKey;
    held.image.setDepth(depthKey);
    return true;
  }

  private requestDepthSort(): void {
    const layer = this.layer;
    if (layer === null) {
      return;
    }
    this.depthSortCount += 1;
    layer.queueDepthSort();
  }

  // -------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------

  /**
   * Progress bars and labels, delegated to the overlay scene of W4-D.
   *
   * Nothing about anchoring, projection or visibility is reimplemented here: `addLabel`
   * and `addProgress` return a handle with `move`, `setVisible` and `remove`, and that
   * is the whole of the contract this layer needs from it.
   */
  private syncOverlays(plan: EntityPlan): void {
    const overlay = this.deps.overlay ?? null;
    if (overlay === null) {
      return;
    }
    const seenProgress = new Set<string>();
    const seenLabels = new Set<string>();
    for (const item of plan.overlays) {
      const anchor = { cellX: item.cellX, cellY: item.cellY, offsetY: item.offsetY };
      if (item.kind === 'PROGRESS') {
        seenProgress.add(item.id);
        const held = this.progress.get(item.id);
        if (held === undefined) {
          this.progress.set(item.id, overlay.addProgress(anchor, item.ratio));
          continue;
        }
        held.move(anchor);
        held.setRatio(item.ratio);
        continue;
      }
      seenLabels.add(item.id);
      const held = this.labels.get(item.id);
      if (held === undefined) {
        this.labels.set(item.id, overlay.addLabel(anchor, item.text));
        continue;
      }
      held.move(anchor);
      held.setText(item.text);
    }
    for (const [id, bar] of this.progress) {
      if (!seenProgress.has(id)) {
        bar.remove();
        this.progress.delete(id);
      }
    }
    for (const [id, label] of this.labels) {
      if (!seenLabels.has(id)) {
        label.remove();
        this.labels.delete(id);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * The entity a cell is occupied by, or null.
   *
   * Published rather than emitted. `canvas:pick` is emitted by the world scene, which
   * owns the pointer, and a second emitter of the same event would fire it twice; the
   * `MACHINE` and `WORKER` subject kinds the bridge already declares are filled in by
   * whoever joins the two, which is the integration of W7 and not this layer.
   */
  entityAt(cellX: number, cellY: number): EntityHit | null {
    return this.occupancy.get(`${cellX},${cellY}`) ?? null;
  }

  stats(): EntityLayerStats {
    let pooled = 0;
    let created = 0;
    let destroyed = 0;
    for (const pool of this.pools.values()) {
      pooled += pool.idleCount;
      created += pool.churn.created;
      destroyed += pool.churn.destroyed;
    }
    return {
      sprites: this.live.size,
      groups: this.groups.size,
      pooled,
      pools: this.pools.size,
      treesDrawn: this.treesDrawn,
      treesSkipped: this.treesSkipped,
      overlays: this.progress.size + this.labels.size,
      dropped: this.droppedCount,
      created,
      destroyed,
      depthSorts: this.depthSortCount,
      lastRebuildMs: this.lastRebuildMs,
      lastFrameMs: this.lastFrameMs,
    };
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private chunkSize(): number {
    return this.deps.world.source.chunkSize || CHUNK_SIZE;
  }

  private cellPx(): number {
    return this.deps.world.source.cellPx || CELL_PX;
  }

  private chunkRect(): ChunkRect {
    const camera = this.deps.world.worldCameraHandle;
    if (camera === null) {
      return { minChunkX: 0, minChunkY: 0, maxChunkX: -1, maxChunkY: -1 };
    }
    return expandChunkRect(
      chunkRectOfCells(camera.viewRect(), this.chunkSize()),
      ENTITY_RING_CHUNKS,
    );
  }

  private rectSignature(): string {
    const rect = this.chunkRect();
    return `${rect.minChunkX}:${rect.minChunkY}:${rect.maxChunkX}:${rect.maxChunkY}`;
  }

  private poolOf(textureKey: string): SpritePool<Phaser.GameObjects.Image> {
    const held = this.pools.get(textureKey);
    if (held !== undefined) {
      return held;
    }
    const scene = this.deps.world;
    const created = new SpritePool<Phaser.GameObjects.Image>(
      {
        create: () => scene.add.image(0, 0, textureKey).setVisible(false),
        recycle: (image) => {
          image.setVisible(false);
          image.clearTint();
          image.setRotation(0);
          image.setScale(1);
        },
        destroy: (image) => {
          image.destroy();
        },
      },
      MAX_POOLED_SPRITES_PER_KEY,
    );
    this.pools.set(textureKey, created);
    return created;
  }

  /**
   * Where a group sends a sprite it no longer holds.
   *
   * One group holds sprites of several textures and there is one pool per texture key,
   * so the destination is read off the image itself. Bound once and reused, so a sweep
   * of a few hundred sprites does not allocate a closure per group.
   */
  private readonly releaser = (image: Phaser.GameObjects.Image): void => {
    this.poolOf(image.texture.key).release(image);
  };

  /** Releases one live sprite back to its pool and out of its group. */
  private release(id: string): void {
    const held = this.live.get(id);
    if (held === undefined) {
      return;
    }
    this.groups.get(held.groupKey)?.remove(id, this.releaser);
    this.live.delete(id);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.attached = false;
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers.length = 0;
    for (const bar of this.progress.values()) {
      bar.remove();
    }
    this.progress.clear();
    for (const label of this.labels.values()) {
      label.remove();
    }
    this.labels.clear();
    this.live.clear();
    this.groups.clear();
    for (const pool of this.pools.values()) {
      pool.clear();
    }
    this.pools.clear();
    this.paths.clear();
    this.layer?.destroy();
    this.layer = null;
  }
}

/** Creates the layer. A named function, because a page calls it once and keeps it. */
export function createEntityLayer(deps: EntityLayerDeps): EntityLayer {
  return new EntityLayer(deps);
}
