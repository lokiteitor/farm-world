// What the entity layer draws this tick, as a value.
//
// Owner: workflow W5-D (canvas entities). Pure: it takes the read model, the visible
// rectangle, the zoom and the clock, and returns a list of placements. No engine, no
// side effect, no clock read from the ambient world.
//
// The split exists so the decisions are testable. Which entities are visible, where a
// parked machine sits, which sprite a tree of a given stage uses, whether trees are drawn
// at all at this zoom, what draws in front of what, and where a machine on a task is at
// this instant, are all decisions; creating a `Phaser.GameObjects.Image` and assigning it
// a texture is not. Everything above the line lives here and is asserted by a unit test;
// `EntityLayer` applies the result and does nothing else.

import {
  buildingTextureKey,
  machineTextureKey,
  particleTextureKey,
  ParticleKind,
  TEXTURE_KEYS,
  treeTextureKey,
  TREE_VARIANTS,
} from '../textures/keys';
import { PALETTE, workerTint } from '../textures/palette';
import { type ChunkRect } from '../world/viewport';
import {
  EntityKind,
  IDLE_BADGE_OFFSET_PX,
  IDLE_BADGE_SCALE,
  IMPLEMENT_TRAIL_PX,
  LABEL_MIN_ZOOM,
  LABEL_OFFSET_PX,
  MAX_TREES_DRAWN,
  PROGRESS_BAR_OFFSET_PX,
  TREE_MIN_ZOOM,
  WORKER_ESCORT_OFFSET_PX,
} from './config';
import { depthKeyOf, orderByDepth } from './depth';
import { ordinalOf, parkedMachineSpot, restingWorkerSpot, type IdleSpot } from './idle';
import {
  type EntityBuilding,
  type EntityHit,
  type EntityMachine,
  type EntityTask,
  type EntityTree,
  type EntityWorker,
} from './port';
import { pathSeed, poseAt, serpentinePath, taskProgressRatio, type PathCell } from './serpentine';
import { chunkOf } from '~/shared/rules/geometry';

/** One sprite the layer has to have on screen this tick. */
export interface SpritePlacement {
  /** Unique across every kind. A badge is a placement of its own, hence the suffix. */
  readonly id: string;
  readonly kind: EntityKind;
  /** Identifier of the domain entity, which is what `entityAt` answers with. */
  readonly subjectId: string;
  readonly textureKey: string;
  readonly chunkX: number;
  readonly chunkY: number;
  /** Position of the anchor of the sprite, in world pixels. */
  readonly worldX: number;
  readonly worldY: number;
  readonly originX: number;
  readonly originY: number;
  readonly rotationRad: number;
  readonly scale: number;
  readonly tint: number | null;
  readonly depthKey: number;
  /** Cell the entity is over, for the pointer index. */
  readonly cellX: number;
  readonly cellY: number;
}

/** One item the layer asks the overlay scene to keep anchored. */
export interface OverlayPlacement {
  readonly id: string;
  readonly kind: 'PROGRESS' | 'LABEL';
  readonly cellX: number;
  readonly cellY: number;
  readonly offsetY: number;
  /** Elapsed fraction, for a progress bar. */
  readonly ratio: number;
  /** Text, for a label. */
  readonly text: string;
}

/** The whole answer of one planning pass. */
export interface EntityPlan {
  /** In draw order: the first element is furthest from the camera. */
  readonly sprites: readonly SpritePlacement[];
  readonly overlays: readonly OverlayPlacement[];
  readonly treesDrawn: number;
  /** Trees inside the rectangle that the ceiling or the zoom left to the usage layer. */
  readonly treesSkipped: number;
  /** Cells occupied by something, for the pointer index. */
  readonly occupancy: ReadonlyMap<string, EntityHit>;
}

/** Everything a planning pass reads. */
export interface PlanInput {
  readonly buildings: readonly EntityBuilding[];
  readonly machines: readonly EntityMachine[];
  readonly workers: readonly EntityWorker[];
  readonly trees: readonly EntityTree[];
  readonly tasks: readonly EntityTask[];
  /** Chunks to populate: the visible rectangle already expanded by the ring. */
  readonly rect: ChunkRect;
  readonly chunkSize: number;
  readonly cellPx: number;
  readonly zoom: number;
  readonly nowGameMs: bigint;
  /** Centre of the camera, in cells. Decides which trees survive the ceiling. */
  readonly centreCellX: number;
  readonly centreCellY: number;
  /** Route of a task. Injected so the layer can memoise it across ticks. */
  readonly pathOf?: (task: EntityTask) => readonly PathCell[];
}

/** Whether a chunk falls inside a rectangle. Local, so the module stays independent. */
function containsChunk(rect: ChunkRect, chunkX: number, chunkY: number): boolean {
  return (
    chunkX >= rect.minChunkX &&
    chunkX <= rect.maxChunkX &&
    chunkY >= rect.minChunkY &&
    chunkY <= rect.maxChunkY
  );
}

/**
 * Route of a task, uncached.
 *
 * Exported so a caller with no cache still gets the right answer, and so the memoised
 * version of `EntityLayer` has something to delegate to.
 */
export function taskPath(task: EntityTask): readonly PathCell[] {
  return serpentinePath(task.cells, pathSeed(task.id));
}

/**
 * Route of a task, memoised on the identifier and the cell count.
 *
 * The route of a two thousand cell field is a sort of two thousand elements, and the
 * layer plans ten times a second. Recomputing it every tick would be the most expensive
 * thing the layer did, and it cannot change while the task lives: the cells of the
 * target are fixed when the task is created (`unitsAtStart` of the contract).
 */
export interface TaskPathCache {
  pathOf(task: EntityTask): readonly PathCell[];
  clear(): void;
  readonly size: number;
}

export function createTaskPathCache(): TaskPathCache {
  const held = new Map<string, readonly PathCell[]>();
  return {
    pathOf(task) {
      // The cell count is part of the key so a task whose target was extended between
      // two replies gets a new route instead of a stale one of the wrong length.
      const key = `${task.id}:${task.cells.length}`;
      const cached = held.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const computed = taskPath(task);
      held.set(key, computed);
      return computed;
    },
    clear() {
      held.clear();
    },
    get size() {
      return held.size;
    },
  };
}

/** Rotation variant of a tree, folded into the range the texture keys cover. */
function treeVariantOf(tree: EntityTree): number {
  const variant = Math.trunc(tree.variant);
  return ((variant % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS;
}

/** A machine or a worker that a task has placed somewhere on the route. */
export interface RoutePose {
  readonly cellX: number;
  readonly cellY: number;
  readonly headingRad: number;
}

/** Where a task has put everything it reserved, at one instant. */
export interface TaskPoses {
  readonly ratio: number;
  /** Cell the powered machine is over, which is what the progress bar is anchored to. */
  readonly leadCellX: number;
  readonly leadCellY: number;
  readonly machines: readonly { readonly machineId: string; readonly pose: RoutePose }[];
  readonly worker: { readonly workerId: string; readonly pose: RoutePose } | null;
}

/**
 * The poses of one task at one instant.
 *
 * Factored out of `planEntities` because the layer needs it twice at two different
 * rates: the structural pass runs ten times a second, which is right for deciding which
 * entities exist, and far too coarse for a tractor, which has to move on every frame.
 * Both call this, so there is no chance of the two rates disagreeing about where a
 * machine is.
 */
export function taskPoses(
  task: EntityTask,
  path: readonly PathCell[],
  nowGameMs: bigint,
  cellPx: number,
): TaskPoses | null {
  if (path.length === 0) {
    return null;
  }
  const ratio = taskProgressRatio(task, nowGameMs);
  const pose = poseAt(path, ratio);
  if (pose === null) {
    return null;
  }
  const forwardX = Math.cos(pose.headingRad);
  const forwardY = Math.sin(pose.headingRad);

  // The powered machine leads and every implement trails behind it, one sprite width at
  // a time, which is where the drawbar the sprite draws at its west edge would be.
  const machines = task.machineIds.map((machineId, position) => {
    const trail = (position * IMPLEMENT_TRAIL_PX) / cellPx;
    return {
      machineId,
      pose: {
        cellX: pose.cellX - forwardX * trail,
        cellY: pose.cellY - forwardY * trail,
        headingRad: pose.headingRad,
      },
    };
  });

  // The worker walks beside the machine, offset perpendicular to the heading.
  const escort = WORKER_ESCORT_OFFSET_PX / cellPx;
  return {
    ratio,
    leadCellX: Math.floor(pose.cellX),
    leadCellY: Math.floor(pose.cellY),
    machines,
    worker: {
      workerId: task.workerId,
      pose: {
        cellX: pose.cellX + forwardY * escort,
        cellY: pose.cellY - forwardX * escort,
        headingRad: pose.headingRad,
      },
    },
  };
}

/**
 * The plan of one tick.
 *
 * Reading order of the body: buildings, then the entities a task is moving, then the
 * idle ones, then the trees, then the depth sort. Movement is resolved before idleness on
 * purpose: an entity a task has claimed is never also parked, and deciding it in that
 * order means the idle branch needs no second check.
 */
export function planEntities(input: PlanInput): EntityPlan {
  const cellPx = input.cellPx;
  const chunkSize = input.chunkSize;
  const sprites: SpritePlacement[] = [];
  const overlays: OverlayPlacement[] = [];
  const occupancy = new Map<string, EntityHit>();

  const buildingById = new Map<string, EntityBuilding>();
  for (const building of input.buildings) {
    buildingById.set(building.id, building);
  }

  // --- buildings ----------------------------------------------------------
  //
  // A building is anchored by its north west cell and its sprite is exactly its
  // footprint, so it is drawn whenever the chunk of its origin is in the rectangle. The
  // rectangle already carries a ring of one chunk, which is what keeps a garage eight
  // cells tall on screen while its origin is just off it.
  for (const building of input.buildings) {
    const chunk = chunkOf(building.originCellX, building.originCellY, chunkSize);
    if (!containsChunk(input.rect, chunk.chunkX, chunk.chunkY)) {
      continue;
    }
    const southEdgeY = (building.originCellY + building.heightCells) * cellPx;
    sprites.push({
      id: `building:${building.id}`,
      kind: EntityKind.BUILDING,
      subjectId: building.id,
      textureKey: buildingTextureKey(building.type),
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      worldX: building.originCellX * cellPx,
      worldY: building.originCellY * cellPx,
      originX: 0,
      originY: 0,
      rotationRad: 0,
      scale: 1,
      tint: null,
      // The south edge and not the origin: a building is sorted by where it meets the
      // ground, which is what decides whether a tractor passes in front of it or behind.
      depthKey: depthKeyOf({ kind: EntityKind.BUILDING, worldY: southEdgeY }),
      cellX: building.originCellX,
      cellY: building.originCellY,
    });
    for (let dy = 0; dy < building.heightCells; dy += 1) {
      for (let dx = 0; dx < building.widthCells; dx += 1) {
        occupancy.set(`${building.originCellX + dx},${building.originCellY + dy}`, {
          kind: EntityKind.BUILDING,
          id: building.id,
        });
      }
    }
  }

  // --- entities a task is moving ------------------------------------------
  const pathOf = input.pathOf ?? taskPath;
  const posedMachines = new Map<string, RoutePose>();
  const posedWorkers = new Map<string, RoutePose>();

  for (const task of input.tasks) {
    const poses = taskPoses(task, pathOf(task), input.nowGameMs, cellPx);
    if (poses === null) {
      continue;
    }
    for (const entry of poses.machines) {
      posedMachines.set(entry.machineId, entry.pose);
    }
    if (poses.worker !== null) {
      posedWorkers.set(poses.worker.workerId, poses.worker.pose);
    }

    // The progress bar goes over the machine that works, delegated to the layer of
    // labels that already exists (`game/overlay`), so nothing is rescaled per frame.
    const lead = chunkOf(poses.leadCellX, poses.leadCellY, chunkSize);
    if (containsChunk(input.rect, lead.chunkX, lead.chunkY)) {
      overlays.push({
        id: `progress:${task.id}`,
        kind: 'PROGRESS',
        cellX: poses.leadCellX,
        cellY: poses.leadCellY,
        offsetY: PROGRESS_BAR_OFFSET_PX,
        ratio: poses.ratio,
        text: '',
      });
    }
  }

  // --- machines -----------------------------------------------------------
  //
  // Parking ordinals are computed per garage and from the sorted identifiers, so a
  // machine keeps its slot when a sibling is sold (`ordinalOf`).
  const machinesByGarage = new Map<string, string[]>();
  for (const machine of input.machines) {
    if (machine.garageId === null || posedMachines.has(machine.id)) {
      continue;
    }
    const held = machinesByGarage.get(machine.garageId);
    if (held === undefined) {
      machinesByGarage.set(machine.garageId, [machine.id]);
    } else {
      held.push(machine.id);
    }
  }

  for (const machine of input.machines) {
    const posed = posedMachines.get(machine.id);
    const parked =
      posed === undefined ? parkedSpotOf(machine, buildingById, machinesByGarage) : null;
    const spot = posed ?? parked?.spot ?? null;
    if (spot === null) {
      continue;
    }
    const cellX = Math.floor(spot.cellX);
    const cellY = Math.floor(spot.cellY);
    const chunk = chunkOf(cellX, cellY, chunkSize);
    if (!containsChunk(input.rect, chunk.chunkX, chunk.chunkY)) {
      continue;
    }
    // A parked machine sorts by the south edge of the building it is inside and not by
    // its own position. Sorting it by its own would put it behind the roof that covers
    // it, and a garage the player cannot see inside is a garage that says nothing about
    // the capacity it is there to limit (GDD section 96).
    const depthWorldY =
      parked === null
        ? spot.cellY * cellPx
        : (parked.building.originCellY + parked.building.heightCells) * cellPx;
    sprites.push({
      id: `machine:${machine.id}`,
      kind: EntityKind.MACHINE,
      subjectId: machine.id,
      textureKey: machineTextureKey(machine.type),
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      worldX: spot.cellX * cellPx,
      worldY: spot.cellY * cellPx,
      originX: 0.5,
      originY: 0.5,
      rotationRad: spot.headingRad,
      scale: 1,
      tint: null,
      depthKey: depthKeyOf({ kind: EntityKind.MACHINE, worldY: depthWorldY }),
      cellX,
      cellY,
    });
    occupancy.set(`${cellX},${cellY}`, { kind: EntityKind.MACHINE, id: machine.id });
  }

  // --- workers ------------------------------------------------------------
  const workersByHome = new Map<string, string[]>();
  for (const worker of input.workers) {
    if (posedWorkers.has(worker.id)) {
      continue;
    }
    const held = workersByHome.get(worker.homeId);
    if (held === undefined) {
      workersByHome.set(worker.homeId, [worker.id]);
    } else {
      held.push(worker.id);
    }
  }

  /** Idle workers grouped by home, so the layer draws one label and not four. */
  const idleByHome = new Map<
    string,
    { count: number; readonly name: string; readonly cellX: number; cellY: number }
  >();

  for (const worker of input.workers) {
    const posed = posedWorkers.get(worker.id);
    const spot = posed ?? restingSpotOf(worker, buildingById, workersByHome);
    if (spot === null) {
      continue;
    }
    const cellX = Math.floor(spot.cellX);
    const cellY = Math.floor(spot.cellY);
    const chunk = chunkOf(cellX, cellY, chunkSize);
    if (!containsChunk(input.rect, chunk.chunkX, chunk.chunkY)) {
      continue;
    }
    const busy = posed !== undefined;
    const depthKey = depthKeyOf({ kind: EntityKind.WORKER, worldY: spot.cellY * cellPx });
    sprites.push({
      id: `worker:${worker.id}`,
      kind: EntityKind.WORKER,
      subjectId: worker.id,
      // Two poses and not eight tints of one: the raised tool is what makes "working"
      // legible with no label, which matters because labels are hidden when zoomed out.
      textureKey: busy ? TEXTURE_KEYS.workerBusy : TEXTURE_KEYS.worker,
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      worldX: spot.cellX * cellPx,
      worldY: spot.cellY * cellPx,
      originX: 0.5,
      originY: 0.5,
      rotationRad: busy ? spot.headingRad : 0,
      scale: 1,
      tint: workerTint(worker.id),
      depthKey,
      cellX,
      cellY,
    });
    occupancy.set(`${cellX},${cellY}`, { kind: EntityKind.WORKER, id: worker.id });

    if (busy) {
      continue;
    }
    // The badge of the idle worker: the visual half of GDD sections 68 and 105, where a
    // worker who finished a task is not reassigned and keeps drawing wages. One extra
    // quad over an existing generated texture, so it batches with everything else.
    sprites.push({
      id: `worker-badge:${worker.id}`,
      kind: EntityKind.WORKER,
      subjectId: worker.id,
      textureKey: particleTextureKey(ParticleKind.SPARK),
      chunkX: chunk.chunkX,
      chunkY: chunk.chunkY,
      worldX: spot.cellX * cellPx,
      worldY: spot.cellY * cellPx + IDLE_BADGE_OFFSET_PX,
      originX: 0.5,
      originY: 0.5,
      rotationRad: 0,
      scale: IDLE_BADGE_SCALE,
      tint: PALETTE.ui.cursorNeutral,
      depthKey,
      cellX,
      cellY,
    });
    const held = idleByHome.get(worker.homeId);
    if (held === undefined) {
      idleByHome.set(worker.homeId, { count: 1, name: worker.name, cellX, cellY });
    } else {
      held.count += 1;
      // The northernmost of the group, so the label sits above the row and not inside it.
      if (cellY < held.cellY) {
        held.cellY = cellY;
      }
    }
  }

  // One label per home and not one per worker. Four workers of a home stand one cell
  // apart, and four names one cell apart overlap into an unreadable smear at any zoom
  // the labels are drawn at; what the player needs is the reading of GDD section 68,
  // "somebody is idle here and is being paid", which is a count.
  if (input.zoom >= LABEL_MIN_ZOOM) {
    for (const [homeId, group] of idleByHome) {
      overlays.push({
        id: `idle-home:${homeId}`,
        kind: 'LABEL',
        cellX: group.cellX,
        cellY: group.cellY,
        offsetY: LABEL_OFFSET_PX,
        ratio: 0,
        text: group.count === 1 ? group.name : `${group.count} ociosos`,
      });
    }
  }

  // --- trees --------------------------------------------------------------
  //
  // Below the zoom threshold nothing is drawn: the land use layer and the chunk
  // thumbnail already carry "there is a standing tree here", which is the whole of what
  // a four pixel cell can say (plan section 9.3, brief of this workflow).
  let treesDrawn = 0;
  let treesSkipped = 0;
  if (input.zoom >= TREE_MIN_ZOOM) {
    const visible: EntityTree[] = [];
    for (const tree of input.trees) {
      const chunk = chunkOf(tree.cellX, tree.cellY, chunkSize);
      if (containsChunk(input.rect, chunk.chunkX, chunk.chunkY)) {
        visible.push(tree);
      }
    }
    // The ceiling drops the furthest, never a random subset: a forest that thins out at
    // the edge of the screen reads as distance, one that thins out at random reads as a
    // bug.
    if (visible.length > MAX_TREES_DRAWN) {
      visible.sort(
        (a, b) =>
          squaredCellDistance(a, input.centreCellX, input.centreCellY) -
          squaredCellDistance(b, input.centreCellX, input.centreCellY),
      );
      treesSkipped = visible.length - MAX_TREES_DRAWN;
      visible.length = MAX_TREES_DRAWN;
    }
    for (const tree of visible) {
      const chunk = chunkOf(tree.cellX, tree.cellY, chunkSize);
      sprites.push({
        id: `tree:${tree.id}`,
        kind: EntityKind.TREE,
        subjectId: tree.id,
        textureKey: treeTextureKey(tree.stage, treeVariantOf(tree)),
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
        // Trunk at the bottom centre of the canvas, placed on the south edge of the
        // cell, which is what makes a row of trees overlap correctly
        // (`game/textures/shapes.ts`).
        worldX: (tree.cellX + 0.5) * cellPx,
        worldY: (tree.cellY + 1) * cellPx,
        originX: 0.5,
        originY: 1,
        rotationRad: 0,
        scale: 1,
        tint: null,
        depthKey: depthKeyOf({ kind: EntityKind.TREE, worldY: (tree.cellY + 1) * cellPx }),
        cellX: tree.cellX,
        cellY: tree.cellY,
      });
      occupancy.set(`${tree.cellX},${tree.cellY}`, { kind: EntityKind.TREE, id: tree.id });
      treesDrawn += 1;
    }
  } else {
    treesSkipped = input.trees.length;
  }

  return {
    sprites: orderByDepth(sprites, (sprite) => sprite.depthKey),
    overlays,
    treesDrawn,
    treesSkipped,
    occupancy,
  };
}

function squaredCellDistance(tree: EntityTree, centreCellX: number, centreCellY: number): number {
  const dx = tree.cellX - centreCellX;
  const dy = tree.cellY - centreCellY;
  return dx * dx + dy * dy;
}

/** Slot of an idle machine inside its garage, or null when it has no place to be. */
function parkedSpotOf(
  machine: EntityMachine,
  buildingById: ReadonlyMap<string, EntityBuilding>,
  machinesByGarage: ReadonlyMap<string, readonly string[]>,
): { readonly spot: IdleSpot; readonly building: EntityBuilding } | null {
  if (machine.garageId === null) {
    return null;
  }
  const garage = buildingById.get(machine.garageId);
  if (garage === undefined) {
    return null;
  }
  const siblings = machinesByGarage.get(machine.garageId) ?? [machine.id];
  return { spot: parkedMachineSpot(garage, ordinalOf(siblings, machine.id)), building: garage };
}

/** Where an idle worker stands beside the home, or null when the home is unknown. */
function restingSpotOf(
  worker: EntityWorker,
  buildingById: ReadonlyMap<string, EntityBuilding>,
  workersByHome: ReadonlyMap<string, readonly string[]>,
): IdleSpot | null {
  const home = buildingById.get(worker.homeId);
  if (home === undefined) {
    return null;
  }
  const siblings = workersByHome.get(worker.homeId) ?? [worker.id];
  return restingWorkerSpot(home, ordinalOf(siblings, worker.id));
}
