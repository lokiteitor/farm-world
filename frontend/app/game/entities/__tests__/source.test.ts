// The binder: parsing, derivation and the resolution of a target into cells.
//
// Owner: workflow W5-D (canvas entities). The binder is the only place in this directory
// that knows the wire form, so it is the only place where a wrong instant or a stage
// derived twice could enter the renderer.

import { describe, expect, it } from 'vitest';
import {
  createStaticEntitySource,
  createStoreEntitySource,
  type StoreEntitySourceDeps,
  type TreeRowLike,
} from '../source';
import { PINE } from '~/shared/config/forestry';
import { gameMs } from '~/shared/domain/units';

const HOUR = 3_600_000;

function standingTree(overrides: Partial<TreeRowLike> = {}): TreeRowLike {
  return {
    id: 'tree-1',
    forestPlotId: 'plot-1',
    cellX: 5,
    cellY: 6,
    species: 'PINE',
    plantedAtGameMs: '0',
    status: 'STANDING',
    ...overrides,
  };
}

function deps(overrides: Partial<StoreEntitySourceDeps> = {}): StoreEntitySourceDeps {
  return {
    buildings: () => [],
    machines: () => [],
    workers: () => [],
    tasks: () => [],
    trees: () => [],
    fieldCells: () => [],
    nowGameMs: () => gameMs(0n),
    revision: () => 1,
    ...overrides,
  };
}

describe('createStoreEntitySource: trees', () => {
  it('derives the growth stage with the shared rule and never stores it', () => {
    // GDD section 131 and plan section 6.5: age, stage and volume are always derived.
    const at = gameMs(BigInt(PINE.stageStartGameHours.MATURE * HOUR));
    const source = createStoreEntitySource(
      deps({ trees: () => [standingTree()], nowGameMs: () => at }),
    );
    expect(source.trees()[0]?.stage).toBe('MATURE');
  });

  it('moves a tree on to the next stage as the clock advances', () => {
    let now = gameMs(0n);
    const source = createStoreEntitySource(
      deps({ trees: () => [standingTree()], nowGameMs: () => now }),
    );
    expect(source.trees()[0]?.stage).toBe('SAPLING');
    now = gameMs(BigInt(PINE.stageStartGameHours.YOUNG * HOUR));
    expect(source.trees()[0]?.stage).toBe('YOUNG');
  });

  it('leaves a felled tree out, which is a logical deletion (GDD section 132)', () => {
    const source = createStoreEntitySource(
      deps({
        trees: () => [standingTree(), standingTree({ id: 'tree-2', status: 'FELLED' })],
      }),
    );
    expect(source.trees().map((entry) => entry.id)).toEqual(['tree-1']);
  });

  it('gives the same tree the same rotation variant across two evaluations', () => {
    const source = createStoreEntitySource(deps({ trees: () => [standingTree()] }));
    expect(source.trees()[0]?.variant).toBe(source.trees()[0]?.variant);
    const other = createStoreEntitySource(
      deps({ trees: () => [standingTree({ id: 'tree-other' })] }),
    );
    expect(other.trees()[0]?.variant).not.toBe(source.trees()[0]?.variant);
  });
});

describe('createStoreEntitySource: tasks', () => {
  const row = {
    id: 'task-1',
    operation: 'PLOW' as const,
    status: 'IN_PROGRESS' as const,
    workerId: 'worker-1',
    machineIds: ['machine-1'],
    targetFieldId: 'field-1',
    targetForestPlotId: null,
    startGameMs: '1000',
    scheduledEndGameMs: '5000',
    endedGameMs: null,
  };

  it('parses the wire instants once, into the form the renderer wants', () => {
    const source = createStoreEntitySource(deps({ tasks: () => [row] }));
    const task = source.activeTasks()[0];
    expect(task?.startGameMs).toBe(1_000n);
    expect(task?.scheduledEndGameMs).toBe(5_000n);
    expect(task?.endedGameMs).toBeNull();
  });

  it('carries the real end of a cancelled task', () => {
    const source = createStoreEntitySource(
      deps({ tasks: () => [{ ...row, endedGameMs: '3000' }] }),
    );
    expect(source.activeTasks()[0]?.endedGameMs).toBe(3_000n);
  });

  it('draws rather than throws on a malformed instant', () => {
    const source = createStoreEntitySource(
      deps({ tasks: () => [{ ...row, startGameMs: 'not a number' }] }),
    );
    expect(source.activeTasks()[0]?.startGameMs).toBe(0n);
  });

  it('resolves the cells of a field target through the store', () => {
    const source = createStoreEntitySource(
      deps({
        tasks: () => [row],
        fieldCells: (fieldId) =>
          fieldId === 'field-1'
            ? [
                { cellX: 1, cellY: 1 },
                { cellX: 2, cellY: 1 },
              ]
            : [],
      }),
    );
    expect(source.activeTasks()[0]?.cells).toHaveLength(2);
  });

  it('falls back to the cells of the standing trees of a forest plot', () => {
    // The contract gives a plot a cell count and no geometry, and a felling works on the
    // trees (GDD section 132).
    const source = createStoreEntitySource(
      deps({
        tasks: () => [
          { ...row, operation: 'FELL', targetFieldId: null, targetForestPlotId: 'plot-1' },
        ],
        trees: () => [
          standingTree({ id: 't1', cellX: 3, cellY: 4 }),
          standingTree({ id: 't2', cellX: 3, cellY: 5 }),
          standingTree({ id: 't3', forestPlotId: 'plot-2', cellX: 90, cellY: 90 }),
        ],
      }),
    );
    expect(source.activeTasks()[0]?.cells).toEqual([
      { cellX: 3, cellY: 4 },
      { cellX: 3, cellY: 5 },
    ]);
  });

  it('prefers the geometry a caller supplies over the fallback', () => {
    const source = createStoreEntitySource(
      deps({
        tasks: () => [
          { ...row, operation: 'FELL', targetFieldId: null, targetForestPlotId: 'plot-1' },
        ],
        forestPlotCells: () => [{ cellX: 70, cellY: 70 }],
        trees: () => [standingTree()],
      }),
    );
    expect(source.activeTasks()[0]?.cells).toEqual([{ cellX: 70, cellY: 70 }]);
  });

  it('answers no cells for a target it cannot resolve', () => {
    const source = createStoreEntitySource(
      deps({ tasks: () => [{ ...row, targetFieldId: null }] }),
    );
    expect(source.activeTasks()[0]?.cells).toEqual([]);
  });
});

describe('createStaticEntitySource', () => {
  it('advances the clock without declaring a structural change', () => {
    // The clock moving is what the frame pass is for; treating it as a revision would
    // rebuild the whole plan sixty times a second.
    const source = createStaticEntitySource({ nowGameMs: 10n });
    const revision = source.revision();
    source.setNowGameMs(20n);
    expect(source.nowGameMs()).toBe(20n);
    expect(source.revision()).toBe(revision);
  });

  it('bumps the revision when the world is replaced', () => {
    const source = createStaticEntitySource();
    const revision = source.revision();
    source.replace({ machines: [] });
    expect(source.revision()).toBeGreaterThan(revision);
  });

  it('reports nothing by default, so a test states one fact', () => {
    const source = createStaticEntitySource();
    expect(source.buildings()).toEqual([]);
    expect(source.machines()).toEqual([]);
    expect(source.workers()).toEqual([]);
    expect(source.trees()).toEqual([]);
    expect(source.activeTasks()).toEqual([]);
  });
});
