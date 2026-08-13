// Shared fixtures of the entity layer suites.
//
// Owner: workflow W5-D (canvas entities). Builders and not constants: every suite states
// the one fact it is about and inherits a coherent world for everything else, which is
// what keeps a test that is about the tree ceiling from also asserting a garage.

import { type ChunkRect } from '../../world/viewport';
import {
  type EntityBuilding,
  type EntityCell,
  type EntityMachine,
  type EntityTask,
  type EntityTree,
  type EntityWorker,
} from '../port';
import { CELL_PX, CHUNK_SIZE } from '~/shared/config/world';

export const CELL_PX_TEST = CELL_PX;
export const CHUNK_SIZE_TEST = CHUNK_SIZE;

/** A rectangle of chunks, inclusive on both corners. */
export function chunkRect(min: number, max: number): ChunkRect {
  return { minChunkX: min, minChunkY: min, maxChunkX: max, maxChunkY: max };
}

/** Every cell of an axis aligned rectangle, in row major order. */
export function rectCells(
  originCellX: number,
  originCellY: number,
  widthCells: number,
  heightCells: number,
): readonly EntityCell[] {
  const cells: EntityCell[] = [];
  for (let dy = 0; dy < heightCells; dy += 1) {
    for (let dx = 0; dx < widthCells; dx += 1) {
      cells.push({ cellX: originCellX + dx, cellY: originCellY + dy });
    }
  }
  return cells;
}

/** A garage, at the size the shared catalogue gives it (GDD sections 96 and 116). */
export function garage(overrides: Partial<EntityBuilding> = {}): EntityBuilding {
  return {
    id: 'building-garage',
    farmId: 'farm-1',
    type: 'GARAGE',
    originCellX: 10,
    originCellY: 10,
    widthCells: 6,
    heightCells: 8,
    ...overrides,
  };
}

/** A worker home, at the size the shared catalogue gives it (GDD section 108). */
export function home(overrides: Partial<EntityBuilding> = {}): EntityBuilding {
  return {
    id: 'building-home',
    farmId: 'farm-1',
    type: 'WORKER_HOME',
    originCellX: 20,
    originCellY: 10,
    widthCells: 4,
    heightCells: 4,
    ...overrides,
  };
}

export function machine(overrides: Partial<EntityMachine> = {}): EntityMachine {
  return {
    id: 'machine-1',
    farmId: 'farm-1',
    garageId: 'building-garage',
    type: 'TRACTOR',
    status: 'IDLE',
    currentTaskId: null,
    ...overrides,
  };
}

export function worker(overrides: Partial<EntityWorker> = {}): EntityWorker {
  return {
    id: 'worker-1',
    name: 'Ana',
    farmId: 'farm-1',
    homeId: 'building-home',
    status: 'IDLE',
    currentTaskId: null,
    ...overrides,
  };
}

export function tree(overrides: Partial<EntityTree> = {}): EntityTree {
  return {
    id: 'tree-1',
    cellX: 40,
    cellY: 40,
    stage: 'MATURE',
    variant: 0,
    ...overrides,
  };
}

/** A plowing task over a field, in progress. */
export function task(overrides: Partial<EntityTask> = {}): EntityTask {
  return {
    id: 'task-1',
    operation: 'PLOW',
    status: 'IN_PROGRESS',
    workerId: 'worker-1',
    machineIds: ['machine-1', 'machine-2'],
    startGameMs: 0n,
    scheduledEndGameMs: 3_600_000n,
    endedGameMs: null,
    cells: rectCells(30, 30, 10, 6),
    ...overrides,
  };
}
