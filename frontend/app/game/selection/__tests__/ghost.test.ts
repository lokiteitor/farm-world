// The building ghost: size from the catalogue, centred on the cursor.
//
// Owner: workflow W4-G. GDD section 116 gives every building its footprint, so the sizes
// are asserted against `BUILDING_CATALOGUE` and never against a literal (ADR-0011).

import { describe, expect, it } from 'vitest';
import { footprintCells, footprintOf, footprintOrigin } from '../ghost';
import { BUILDING_CATALOGUE, BuildingType } from '~/shared/index';

describe('footprintOf', () => {
  it('takes the size of every building from the shared catalogue', () => {
    for (const type of Object.values(BuildingType)) {
      const definition = BUILDING_CATALOGUE[type];
      const size = footprintOf(type);
      expect(size.widthCells).toBe(definition.widthCells);
      expect(size.heightCells).toBe(definition.heightCells);
      expect(size.widthCells * size.heightCells).toBe(definition.footprintCells);
    }
  });
});

describe('footprintOrigin', () => {
  it('centres an odd footprint exactly on the cursor', () => {
    const origin = footprintOrigin({ cellX: 10, cellY: 10 }, { widthCells: 5, heightCells: 5 });
    expect(origin).toEqual({ cellX: 8, cellY: 8 });
  });

  it('leans the extra cell of an even footprint to the south east', () => {
    const origin = footprintOrigin({ cellX: 10, cellY: 10 }, { widthCells: 6, heightCells: 8 });
    expect(origin).toEqual({ cellX: 8, cellY: 7 });
  });

  it('is stable: the same cursor cell always yields the same origin', () => {
    const first = footprintOrigin({ cellX: -4, cellY: 3 }, { widthCells: 4, heightCells: 4 });
    const second = footprintOrigin({ cellX: -4, cellY: 3 }, { widthCells: 4, heightCells: 4 });
    expect(first).toEqual(second);
  });
});

describe('footprintCells', () => {
  it('produces exactly the cells of the catalogue, row major', () => {
    const cells = footprintCells({ cellX: 0, cellY: 0 }, { widthCells: 3, heightCells: 2 });
    expect(cells).toEqual([
      { cellX: -1, cellY: 0 },
      { cellX: 0, cellY: 0 },
      { cellX: 1, cellY: 0 },
      { cellX: -1, cellY: 1 },
      { cellX: 0, cellY: 1 },
      { cellX: 1, cellY: 1 },
    ]);
  });

  it('has as many cells as the catalogue says, for every building', () => {
    for (const type of Object.values(BuildingType)) {
      const cells = footprintCells({ cellX: 100, cellY: -100 }, footprintOf(type));
      expect(cells).toHaveLength(BUILDING_CATALOGUE[type].footprintCells);
    }
  });

  it('moves with the cursor by exactly one cell', () => {
    const size = { widthCells: 4, heightCells: 4 };
    const here = footprintCells({ cellX: 5, cellY: 5 }, size);
    const there = footprintCells({ cellX: 6, cellY: 5 }, size);
    expect(there.map((cell) => cell.cellX - 1)).toEqual(here.map((cell) => cell.cellX));
  });
});
