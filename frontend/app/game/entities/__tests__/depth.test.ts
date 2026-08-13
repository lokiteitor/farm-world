// Depth ordering: south draws last, and equals keep their order.
//
// Owner: workflow W5-D (canvas entities).

import { describe, expect, it } from 'vitest';
import { DEPTH_KIND_STEP, EntityKind } from '../config';
import { depthKeyOf, orderByDepth, type DepthSubject } from '../depth';

interface Item extends DepthSubject {
  readonly id: string;
}

function order(items: readonly Item[]): readonly string[] {
  return orderByDepth(items, (item) => depthKeyOf(item)).map((item) => item.id);
}

describe('depthKeyOf', () => {
  it('orders from north to south, so what is further south draws on top', () => {
    expect(
      order([
        { id: 'south', kind: EntityKind.TREE, worldY: 320 },
        { id: 'north', kind: EntityKind.TREE, worldY: 16 },
        { id: 'middle', kind: EntityKind.TREE, worldY: 160 },
      ]),
    ).toEqual(['north', 'middle', 'south']);
  });

  it('breaks a tie by kind: furniture, canopy, machine, worker', () => {
    expect(
      order([
        { id: 'worker', kind: EntityKind.WORKER, worldY: 100 },
        { id: 'machine', kind: EntityKind.MACHINE, worldY: 100 },
        { id: 'tree', kind: EntityKind.TREE, worldY: 100 },
        { id: 'building', kind: EntityKind.BUILDING, worldY: 100 },
      ]),
    ).toEqual(['building', 'tree', 'machine', 'worker']);
  });

  it('never lets the kind tie break reorder two entities at different depths', () => {
    // A whole pixel of separation has to beat the tie break, whatever the two kinds are.
    const north = depthKeyOf({ kind: EntityKind.WORKER, worldY: 100 });
    const south = depthKeyOf({ kind: EntityKind.BUILDING, worldY: 101 });
    expect(north).toBeLessThan(south);
    expect(DEPTH_KIND_STEP * 4).toBeLessThan(1);
  });
});

describe('orderByDepth', () => {
  it('is stable: two equals keep the order they arrived in', () => {
    const items: readonly Item[] = [
      { id: 'a', kind: EntityKind.TREE, worldY: 50 },
      { id: 'b', kind: EntityKind.TREE, worldY: 50 },
      { id: 'c', kind: EntityKind.TREE, worldY: 50 },
      { id: 'd', kind: EntityKind.TREE, worldY: 50 },
    ];
    expect(order(items)).toEqual(['a', 'b', 'c', 'd']);
    expect(order([...items].reverse())).toEqual(['d', 'c', 'b', 'a']);
  });

  it('stays stable with many ties, which is a forest plot in one row', () => {
    const row: Item[] = [];
    for (let index = 0; index < 200; index += 1) {
      row.push({ id: `t${index}`, kind: EntityKind.TREE, worldY: 640 });
    }
    expect(order(row)).toEqual(row.map((item) => item.id));
  });

  it('does not touch its input', () => {
    const items: readonly Item[] = [
      { id: 'south', kind: EntityKind.TREE, worldY: 320 },
      { id: 'north', kind: EntityKind.TREE, worldY: 16 },
    ];
    order(items);
    expect(items.map((item) => item.id)).toEqual(['south', 'north']);
  });

  it('answers an empty list with no entities', () => {
    expect(orderByDepth([], () => 0)).toEqual([]);
  });
});
