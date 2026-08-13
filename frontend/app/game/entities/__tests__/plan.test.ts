// What the layer draws: visibility, the two ceilings, the idle placement and the order.
//
// Owner: workflow W5-D (canvas entities). The planner is the whole of the decision making
// of the layer, so this is where the brief of the workflow is checked: trees only above a
// zoom, machines parked inside their garage, workers beside their home with a badge, the
// progress bar over the machine that works, and a stable depth order.

import { describe, expect, it } from 'vitest';
import { machineTextureKey, TEXTURE_KEYS, treeTextureKey } from '../../textures/keys';
import { LABEL_MIN_ZOOM, MAX_TREES_DRAWN, PROGRESS_BAR_OFFSET_PX, TREE_MIN_ZOOM } from '../config';
import { createTaskPathCache, planEntities, taskPoses, type PlanInput } from '../plan';
import { pathSeed, serpentinePath } from '../serpentine';
import {
  CELL_PX_TEST,
  CHUNK_SIZE_TEST,
  chunkRect,
  garage,
  home,
  machine,
  rectCells,
  task,
  tree,
  worker,
} from './fixtures';

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    buildings: [],
    machines: [],
    workers: [],
    trees: [],
    tasks: [],
    rect: chunkRect(0, 3),
    chunkSize: CHUNK_SIZE_TEST,
    cellPx: CELL_PX_TEST,
    zoom: 1,
    nowGameMs: 0n,
    centreCellX: 48,
    centreCellY: 48,
    ...overrides,
  };
}

function idOf(sprites: readonly { readonly id: string }[]): readonly string[] {
  return sprites.map((sprite) => sprite.id);
}

describe('planEntities: buildings', () => {
  it('anchors a building on the north west cell of its footprint', () => {
    const plan = planEntities(input({ buildings: [garage()] }));
    const sprite = plan.sprites.find((item) => item.id === 'building:building-garage');
    expect(sprite).toBeDefined();
    expect(sprite?.worldX).toBe(10 * CELL_PX_TEST);
    expect(sprite?.worldY).toBe(10 * CELL_PX_TEST);
    expect(sprite?.originX).toBe(0);
    expect(sprite?.originY).toBe(0);
  });

  it('sorts a building by where it meets the ground and not by its origin', () => {
    // A tractor driving past the south wall of a garage has to pass in front of it.
    const plan = planEntities(
      input({
        buildings: [garage()],
        trees: [tree({ id: 'tree-north', cellX: 11, cellY: 14 })],
      }),
    );
    expect(idOf(plan.sprites)).toEqual(['tree:tree-north', 'building:building-garage']);
  });

  it('marks every cell of the footprint as occupied, for the pointer', () => {
    const plan = planEntities(input({ buildings: [garage()] }));
    expect(plan.occupancy.get('10,10')).toEqual({ kind: 'BUILDING', id: 'building-garage' });
    expect(plan.occupancy.get('15,17')).toEqual({ kind: 'BUILDING', id: 'building-garage' });
    expect(plan.occupancy.get('16,18')).toBeUndefined();
  });

  it('leaves out a building whose chunk is outside the rectangle', () => {
    const plan = planEntities(
      input({ buildings: [garage({ originCellX: 500, originCellY: 500 })] }),
    );
    expect(plan.sprites).toHaveLength(0);
  });
});

describe('planEntities: idle machinery and staff (GDD sections 96, 105 and 108)', () => {
  it('parks an idle machine inside the footprint of its garage', () => {
    const plan = planEntities(input({ buildings: [garage()], machines: [machine()] }));
    const sprite = plan.sprites.find((item) => item.id === 'machine:machine-1');
    expect(sprite?.textureKey).toBe(machineTextureKey('TRACTOR'));
    expect(sprite?.cellX).toBeGreaterThanOrEqual(10);
    expect(sprite?.cellX).toBeLessThan(16);
    expect(sprite?.cellY).toBeGreaterThanOrEqual(10);
    expect(sprite?.cellY).toBeLessThan(18);
  });

  it('draws nothing for a machine with no garage to be in', () => {
    const plan = planEntities(input({ machines: [machine({ garageId: null })] }));
    expect(plan.sprites).toHaveLength(0);
  });

  it('gives each machine of a garage its own slot', () => {
    const plan = planEntities(
      input({
        buildings: [garage()],
        machines: [machine({ id: 'm-a' }), machine({ id: 'm-b' }), machine({ id: 'm-c' })],
      }),
    );
    const spots = new Set(
      plan.sprites
        .filter((item) => item.kind === 'MACHINE')
        .map((item) => `${item.worldX},${item.worldY}`),
    );
    expect(spots.size).toBe(3);
  });

  it('stands an idle worker beside the home, with a badge and at rest', () => {
    const plan = planEntities(input({ buildings: [home()], workers: [worker()] }));
    const figure = plan.sprites.find((item) => item.id === 'worker:worker-1');
    const badge = plan.sprites.find((item) => item.id === 'worker-badge:worker-1');
    expect(figure?.textureKey).toBe(TEXTURE_KEYS.worker);
    expect(figure?.cellY).toBeGreaterThanOrEqual(home().originCellY + home().heightCells);
    expect(badge).toBeDefined();
    expect(badge?.scale).toBeGreaterThan(1);
  });

  it('draws a parked machine over the garage that covers it', () => {
    // Sorting the machine by its own position would put it under the roof, and a garage
    // the player cannot see inside says nothing about the capacity it exists to limit.
    const plan = planEntities(input({ buildings: [garage()], machines: [machine()] }));
    expect(idOf(plan.sprites)).toEqual(['building:building-garage', 'machine:machine-1']);
  });

  it('names the idle staff of a home once, with a count', () => {
    // Four workers stand one cell apart, and four names one cell apart overlap into an
    // unreadable smear; the reading GDD section 68 asks for is a count.
    const plan = planEntities(
      input({
        buildings: [home()],
        workers: [
          worker({ id: 'w-1' }),
          worker({ id: 'w-2' }),
          worker({ id: 'w-3' }),
          worker({ id: 'w-4' }),
        ],
      }),
    );
    const labels = plan.overlays.filter((item) => item.kind === 'LABEL');
    expect(labels).toHaveLength(1);
    expect(labels[0]?.text).toBe('4 ociosos');
  });

  it('names an idle worker only from the zoom the label is legible at', () => {
    const near = planEntities(
      input({ buildings: [home()], workers: [worker()], zoom: LABEL_MIN_ZOOM }),
    );
    expect(near.overlays.map((item) => item.text)).toContain('Ana');
    const far = planEntities(
      input({ buildings: [home()], workers: [worker()], zoom: LABEL_MIN_ZOOM - 0.1 }),
    );
    expect(far.overlays).toHaveLength(0);
  });

  it('draws nothing for a worker whose home is unknown', () => {
    const plan = planEntities(input({ workers: [worker()] }));
    expect(plan.sprites).toHaveLength(0);
  });
});

describe('planEntities: cosmetic movement (GDD section 92)', () => {
  const world = {
    buildings: [garage(), home()],
    machines: [machine({ id: 'machine-1' }), machine({ id: 'machine-2', type: 'PLOW' as const })],
    workers: [worker()],
    tasks: [task()],
  };

  it('takes a machine on a task out of the garage and onto the route', () => {
    const plan = planEntities(input({ ...world, nowGameMs: 1_800_000n }));
    const sprite = plan.sprites.find((item) => item.id === 'machine:machine-1');
    const path = serpentinePath(task().cells, pathSeed('task-1'));
    const cells = new Set(path.map((cell) => `${cell.cellX},${cell.cellY}`));
    expect(cells.has(`${sprite?.cellX},${sprite?.cellY}`)).toBe(true);
  });

  it('trails the implement behind the machine that tows it', () => {
    const plan = planEntities(input({ ...world, nowGameMs: 1_800_000n }));
    const powered = plan.sprites.find((item) => item.id === 'machine:machine-1');
    const implement = plan.sprites.find((item) => item.id === 'machine:machine-2');
    expect(powered).toBeDefined();
    expect(implement).toBeDefined();
    const distance = Math.hypot(
      (powered?.worldX ?? 0) - (implement?.worldX ?? 0),
      (powered?.worldY ?? 0) - (implement?.worldY ?? 0),
    );
    expect(distance).toBeGreaterThan(0);
    expect(implement?.rotationRad).toBeCloseTo(powered?.rotationRad ?? 0, 12);
  });

  it('shows the worker of the task with the tool up and beside the machine', () => {
    const plan = planEntities(input({ ...world, nowGameMs: 1_800_000n }));
    const figure = plan.sprites.find((item) => item.id === 'worker:worker-1');
    expect(figure?.textureKey).toBe(TEXTURE_KEYS.workerBusy);
    expect(plan.sprites.find((item) => item.id === 'worker-badge:worker-1')).toBeUndefined();
  });

  it('puts a progress bar over the machine that works, with the elapsed fraction', () => {
    const plan = planEntities(input({ ...world, nowGameMs: 1_800_000n }));
    const bar = plan.overlays.find((item) => item.id === 'progress:task-1');
    expect(bar?.kind).toBe('PROGRESS');
    expect(bar?.ratio).toBeCloseTo(0.5, 6);
    expect(bar?.offsetY).toBe(PROGRESS_BAR_OFFSET_PX);
  });

  it('advances the machine as the clock advances, and never backwards', () => {
    let lastProgress = -1;
    for (let step = 0; step <= 20; step += 1) {
      const now = BigInt(step * 180_000);
      const poses = taskPoses(task(), serpentinePath(task().cells, pathSeed('task-1')), now, 16);
      const progress = poses?.ratio ?? 0;
      expect(progress).toBeGreaterThanOrEqual(lastProgress);
      lastProgress = progress;
    }
    expect(lastProgress).toBe(1);
  });

  it('survives a reload: the same task and clock give the same placement', () => {
    const first = planEntities(input({ ...world, nowGameMs: 2_400_000n }));
    const second = planEntities(input({ ...world, nowGameMs: 2_400_000n }));
    expect(second.sprites).toEqual(first.sprites);
    expect(second.overlays).toEqual(first.overlays);
  });
});

describe('planEntities: trees', () => {
  const forest = Array.from({ length: 40 }, (_unused, index) =>
    tree({ id: `tree-${index}`, cellX: 40 + (index % 8), cellY: 40 + Math.floor(index / 8) }),
  );

  it('leaves the trees to the land use layer below the zoom threshold', () => {
    const plan = planEntities(input({ trees: forest, zoom: TREE_MIN_ZOOM - 0.1 }));
    expect(plan.treesDrawn).toBe(0);
    expect(plan.treesSkipped).toBe(forest.length);
    expect(plan.sprites).toHaveLength(0);
  });

  it('draws them one by one from the threshold up', () => {
    const plan = planEntities(input({ trees: forest, zoom: TREE_MIN_ZOOM }));
    expect(plan.treesDrawn).toBe(forest.length);
    expect(plan.treesSkipped).toBe(0);
  });

  it('picks the sprite of the stage and the rotation variant', () => {
    const plan = planEntities(
      input({ trees: [tree({ stage: 'OLD_GROWTH', variant: 6 })], zoom: 1 }),
    );
    expect(plan.sprites[0]?.textureKey).toBe(treeTextureKey('OLD_GROWTH', 2));
  });

  it('anchors the trunk on the south edge of the cell', () => {
    const plan = planEntities(input({ trees: [tree({ cellX: 40, cellY: 41 })], zoom: 1 }));
    expect(plan.sprites[0]?.worldX).toBe(40.5 * CELL_PX_TEST);
    expect(plan.sprites[0]?.worldY).toBe(42 * CELL_PX_TEST);
    expect(plan.sprites[0]?.originY).toBe(1);
  });

  it('drops the furthest ones past the ceiling and never a random subset', () => {
    const many = Array.from({ length: MAX_TREES_DRAWN + 500 }, (_unused, index) =>
      tree({
        id: `tree-${index}`,
        cellX: index % 100,
        cellY: Math.floor(index / 100),
      }),
    );
    const plan = planEntities(input({ trees: many, zoom: 1, centreCellX: 0, centreCellY: 0 }));
    expect(plan.treesDrawn).toBe(MAX_TREES_DRAWN);
    expect(plan.treesSkipped).toBe(500);
    // The nearest tree survives and the furthest does not.
    expect(plan.occupancy.get('0,0')).toBeDefined();
    expect(plan.occupancy.get('99,34')).toBeUndefined();
  });

  it('leaves out a tree whose chunk is outside the rectangle', () => {
    const plan = planEntities(input({ trees: [tree({ cellX: 900, cellY: 900 })], zoom: 1 }));
    expect(plan.treesDrawn).toBe(0);
  });
});

describe('planEntities: order', () => {
  it('draws from north to south, so nothing hides what is in front of it', () => {
    const plan = planEntities(
      input({
        zoom: 1,
        trees: [
          tree({ id: 'far', cellX: 40, cellY: 40 }),
          tree({ id: 'near', cellX: 41, cellY: 60 }),
          tree({ id: 'middle', cellX: 42, cellY: 50 }),
        ],
      }),
    );
    expect(idOf(plan.sprites)).toEqual(['tree:far', 'tree:middle', 'tree:near']);
  });

  it('is stable, so a row of trees does not flicker between two frames', () => {
    const row = Array.from({ length: 30 }, (_unused, index) =>
      tree({ id: `tree-${index}`, cellX: 40 + index, cellY: 44 }),
    );
    const first = planEntities(input({ trees: row, zoom: 1 }));
    const second = planEntities(input({ trees: row, zoom: 1 }));
    expect(idOf(second.sprites)).toEqual(idOf(first.sprites));
    expect(idOf(first.sprites)).toEqual(row.map((item) => `tree:${item.id}`));
  });
});

describe('createTaskPathCache', () => {
  it('answers the same route without recomputing it', () => {
    const cache = createTaskPathCache();
    const subject = task();
    const first = cache.pathOf(subject);
    expect(cache.pathOf(subject)).toBe(first);
    expect(cache.size).toBe(1);
  });

  it('recomputes when the target changed size, so the route is never stale', () => {
    const cache = createTaskPathCache();
    const before = cache.pathOf(task());
    const after = cache.pathOf(task({ cells: rectCells(30, 30, 10, 8) }));
    expect(after).not.toBe(before);
    expect(after).toHaveLength(80);
    expect(cache.size).toBe(2);
  });

  it('forgets everything when cleared', () => {
    const cache = createTaskPathCache();
    cache.pathOf(task());
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
