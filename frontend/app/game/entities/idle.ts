// Where an entity that is doing nothing stands.
//
// Owner: workflow W5-D (canvas entities). Pure arithmetic over a footprint, so the
// placement is a test and not a screenshot.
//
// This is the visual half of two hard restrictions of the domain (GDD sections 96 and
// 108) and of one consequence of them (GDD section 105). A machine belongs to a garage
// because the garage is what limits how many machines there can be, and a worker belongs
// to a home for the same reason; when a task finishes, the worker is not reassigned and
// stays idle, which is exactly what feeds the return summary of GDD section 68. Drawing
// idle machines inside their garage and idle workers beside their home makes both
// readable on the canvas rather than only in a panel: the player sees the garage that
// is full and the four workers standing about being paid.
//
// The placement is deterministic in the ordinal, which the layer derives from a stable
// sort of the identifiers, so a machine does not hop between slots when a sibling is
// sold.

import {
  PARKED_HEADING_RAD,
  PARKING_INSET_CELLS,
  PARKING_SLOT_CELLS,
  RESTING_HEADING_RAD,
  RESTING_ROW_GAP_CELLS,
} from './config';

/** A footprint, exactly as the contract reports a building. */
export interface FootprintRect {
  readonly originCellX: number;
  readonly originCellY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

/** Where an idle entity stands, in fractional cell coordinates of its centre. */
export interface IdleSpot {
  readonly cellX: number;
  readonly cellY: number;
  readonly headingRad: number;
}

/** How many parking slots a footprint holds, along each axis. */
export interface ParkingGrid {
  readonly columns: number;
  readonly rows: number;
}

/**
 * The parking grid of a footprint.
 *
 * Derived from the footprint and from the size of a machine sprite, never from the
 * capacity of the catalogue. The two are related but they are not the same fact: the
 * capacity is a balance decision (four machines per garage, GDD sections 96 and 116) and
 * the grid is a question of how many 32 px sprites fit inside 6 x 8 cells. Deriving the
 * grid from the capacity would put a machine outside the walls the day the balance
 * changes; deriving it from the geometry cannot.
 *
 * A garage is 6 x 8 cells, so the grid is 2 x 3 and holds six, comfortably above the
 * four the catalogue allows. The overflow of a footprint too small to hold its own
 * capacity is handled by `parkedMachineSpot`, which wraps.
 */
export function parkingGrid(footprint: FootprintRect): ParkingGrid {
  const usableWidth = Math.max(1, footprint.widthCells - 2 * PARKING_INSET_CELLS);
  const usableHeight = Math.max(1, footprint.heightCells - 2 * PARKING_INSET_CELLS);
  return {
    columns: Math.max(1, Math.floor(usableWidth / PARKING_SLOT_CELLS.width)),
    rows: Math.max(1, Math.floor(usableHeight / PARKING_SLOT_CELLS.height)),
  };
}

/**
 * Where the machine with this ordinal parks inside the footprint.
 *
 * Always inside, which its test asserts on every ordinal up to twice the grid: a sprite
 * drawn half outside the garage would read as a machine that is not in it, and the
 * whole point of drawing it there is that the garage is the constraint.
 */
export function parkedMachineSpot(footprint: FootprintRect, ordinal: number): IdleSpot {
  const grid = parkingGrid(footprint);
  const slot = Math.max(0, Math.trunc(ordinal)) % (grid.columns * grid.rows);
  const column = slot % grid.columns;
  const row = Math.floor(slot / grid.columns) % grid.rows;
  return {
    cellX:
      footprint.originCellX +
      PARKING_INSET_CELLS +
      column * PARKING_SLOT_CELLS.width +
      PARKING_SLOT_CELLS.width / 2,
    cellY:
      footprint.originCellY +
      PARKING_INSET_CELLS +
      row * PARKING_SLOT_CELLS.height +
      PARKING_SLOT_CELLS.height / 2,
    headingRad: PARKED_HEADING_RAD,
  };
}

/**
 * Where the worker with this ordinal stands beside the home.
 *
 * Outside the footprint and along its south edge, which its test asserts: a worker drawn
 * inside the house is a worker the player cannot see, and the reading the interface owes
 * is "these people are idle and are being paid" (GDD sections 68 and 107).
 *
 * Beyond the width of the home the row wraps southwards, so a home whose capacity was
 * raised does not stack every worker on one cell.
 */
export function restingWorkerSpot(footprint: FootprintRect, ordinal: number): IdleSpot {
  const perRow = Math.max(1, footprint.widthCells);
  const index = Math.max(0, Math.trunc(ordinal));
  const column = index % perRow;
  const row = Math.floor(index / perRow);
  return {
    cellX: footprint.originCellX + column + 0.5,
    cellY:
      footprint.originCellY +
      footprint.heightCells +
      RESTING_ROW_GAP_CELLS +
      row * RESTING_ROW_GAP_CELLS,
    headingRad: RESTING_HEADING_RAD,
  };
}

/**
 * Ordinal of an identifier inside a group, by ascending identifier.
 *
 * Stable under insertion, which is the property that matters: the ordinal decides the
 * parking slot, and a slot that changed whenever the reply happened to list the machines
 * in another order would make an idle fleet shuffle on every refresh.
 */
export function ordinalOf(ids: readonly string[], id: string): number {
  const sorted = [...ids].sort();
  const index = sorted.indexOf(id);
  return index < 0 ? 0 : index;
}
