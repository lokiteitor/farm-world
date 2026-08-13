// Where an entity that is doing nothing stands.
//
// Owner: workflow W5-D (canvas entities). The visual half of GDD sections 96, 105 and
// 108: a machine belongs to a garage and a worker to a home because those are the
// buildings that limit how many of each there can be, and a worker who finishes a task is
// not reassigned.

import { describe, expect, it } from 'vitest';
import {
  ordinalOf,
  parkedMachineSpot,
  parkingGrid,
  restingWorkerSpot,
  type FootprintRect,
} from '../idle';
import { BUILDING_CATALOGUE } from '~/shared/config/buildings';

const GARAGE: FootprintRect = {
  originCellX: 10,
  originCellY: 10,
  widthCells: BUILDING_CATALOGUE.GARAGE.widthCells,
  heightCells: BUILDING_CATALOGUE.GARAGE.heightCells,
};

const HOME: FootprintRect = {
  originCellX: 20,
  originCellY: 30,
  widthCells: BUILDING_CATALOGUE.WORKER_HOME.widthCells,
  heightCells: BUILDING_CATALOGUE.WORKER_HOME.heightCells,
};

describe('parkingGrid', () => {
  it('the catalogue garage has at least as many drawing slots as machines', () => {
    // The grid comes from the geometry and the capacity from the balance (GDD section
    // 96). They have to be compatible, and this is the assertion that says so.
    const grid = parkingGrid(GARAGE);
    expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(
      BUILDING_CATALOGUE.GARAGE.capacity ?? 0,
    );
  });

  it('a tiny footprint still keeps one slot', () => {
    const grid = parkingGrid({
      originCellX: 0,
      originCellY: 0,
      widthCells: 1,
      heightCells: 1,
    });
    expect(grid).toEqual({ columns: 1, rows: 1 });
  });
});

describe('parkedMachineSpot', () => {
  it('always parks inside the footprint of the garage', () => {
    for (let ordinal = 0; ordinal < 20; ordinal += 1) {
      const spot = parkedMachineSpot(GARAGE, ordinal);
      expect(spot.cellX).toBeGreaterThan(GARAGE.originCellX);
      expect(spot.cellY).toBeGreaterThan(GARAGE.originCellY);
      expect(spot.cellX).toBeLessThan(GARAGE.originCellX + GARAGE.widthCells);
      expect(spot.cellY).toBeLessThan(GARAGE.originCellY + GARAGE.heightCells);
    }
  });

  it('gives every machine its own slot until the grid is full', () => {
    const grid = parkingGrid(GARAGE);
    const spots = new Set<string>();
    for (let ordinal = 0; ordinal < grid.columns * grid.rows; ordinal += 1) {
      const spot = parkedMachineSpot(GARAGE, ordinal);
      spots.add(`${spot.cellX},${spot.cellY}`);
    }
    expect(spots.size).toBe(grid.columns * grid.rows);
  });

  it('reuses the slots past the grid instead of leaving the footprint', () => {
    const grid = parkingGrid(GARAGE);
    expect(parkedMachineSpot(GARAGE, grid.columns * grid.rows)).toEqual(
      parkedMachineSpot(GARAGE, 0),
    );
  });

  it('faces the doors, which the garage sprite itself draws on the south side', () => {
    expect(parkedMachineSpot(GARAGE, 0).headingRad).toBeCloseTo(Math.PI / 2, 12);
  });

  it('tolerates a negative or fractional ordinal without leaving the footprint', () => {
    const spot = parkedMachineSpot(GARAGE, -3.7);
    expect(spot).toEqual(parkedMachineSpot(GARAGE, 0));
  });
});

describe('restingWorkerSpot', () => {
  it('leaves the worker outside the home and to the south of it', () => {
    for (let ordinal = 0; ordinal < HOME.widthCells; ordinal += 1) {
      const spot = restingWorkerSpot(HOME, ordinal);
      expect(spot.cellY).toBeGreaterThan(HOME.originCellY + HOME.heightCells);
      expect(spot.cellX).toBeGreaterThanOrEqual(HOME.originCellX);
      expect(spot.cellX).toBeLessThan(HOME.originCellX + HOME.widthCells);
    }
  });

  it('spreads the staff across the width before opening a second row', () => {
    const first = restingWorkerSpot(HOME, 0);
    const last = restingWorkerSpot(HOME, HOME.widthCells - 1);
    expect(last.cellX).toBeGreaterThan(first.cellX);
    expect(last.cellY).toBeCloseTo(first.cellY, 12);
    const wrapped = restingWorkerSpot(HOME, HOME.widthCells);
    expect(wrapped.cellX).toBeCloseTo(first.cellX, 12);
    expect(wrapped.cellY).toBeGreaterThan(first.cellY);
  });

  it('does not stack two workers on one cell within the capacity', () => {
    const spots = new Set<string>();
    for (let ordinal = 0; ordinal < (BUILDING_CATALOGUE.WORKER_HOME.capacity ?? 4); ordinal += 1) {
      const spot = restingWorkerSpot(HOME, ordinal);
      spots.add(`${spot.cellX},${spot.cellY}`);
    }
    expect(spots.size).toBe(BUILDING_CATALOGUE.WORKER_HOME.capacity ?? 4);
  });
});

describe('ordinalOf', () => {
  it('does not depend on the order the list arrived in', () => {
    const ids = ['m-c', 'm-a', 'm-b'];
    expect(ordinalOf(ids, 'm-a')).toBe(0);
    expect(ordinalOf([...ids].reverse(), 'm-a')).toBe(0);
    expect(ordinalOf(ids, 'm-c')).toBe(2);
  });

  it('keeps the slot of the survivors when a sibling is sold', () => {
    // Selling `m-b` must not make `m-c` change slot in a way that also moves `m-a`.
    expect(ordinalOf(['m-a', 'm-b', 'm-c'], 'm-a')).toBe(0);
    expect(ordinalOf(['m-a', 'm-c'], 'm-a')).toBe(0);
  });

  it('answers zero for an identifier that is not in the list', () => {
    expect(ordinalOf(['m-a'], 'm-z')).toBe(0);
  });

  it('does not touch the list it receives', () => {
    const ids = ['m-c', 'm-a'];
    ordinalOf(ids, 'm-a');
    expect(ids).toEqual(['m-c', 'm-a']);
  });
});
