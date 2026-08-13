// The building ghost: a fixed footprint that follows the cursor.
//
// Owner: workflow W4-G (selection tool). Pure arithmetic over cells.
//
// GDD section 116 gives every building a rectangular footprint and GDD section 24 makes
// its placement a decision about space, so the placement mode does not drag a rectangle:
// it carries the rectangle of the catalogue and the player chooses where it lands. The
// size comes from `BUILDING_CATALOGUE` and never from a literal, which is the same rule
// ADR-0011 states for every other balance number.
//
// Centred on the cursor and not anchored at its north west corner. With a six by eight
// garage, a corner anchor puts the building down and to the right of where the player is
// pointing, and the mismatch is a whole building wide at the moment of the click. The
// offset uses `floor((size - 1) / 2)`, so an even side leans the extra cell to the south
// east, which is stable: the same cursor cell always yields the same footprint.

import { BUILDING_CATALOGUE, type BuildingType, type CellCoordWire } from '~/shared/index';

/** Size of a footprint in cells. */
export interface FootprintSize {
  readonly widthCells: number;
  readonly heightCells: number;
}

/** The footprint of a building of the catalogue (GDD section 116). */
export function footprintOf(type: BuildingType): FootprintSize {
  const definition = BUILDING_CATALOGUE[type];
  return { widthCells: definition.widthCells, heightCells: definition.heightCells };
}

/** North west corner of a footprint centred on a cell. */
export function footprintOrigin(anchor: CellCoordWire, size: FootprintSize): CellCoordWire {
  return {
    cellX: anchor.cellX - Math.floor((size.widthCells - 1) / 2),
    cellY: anchor.cellY - Math.floor((size.heightCells - 1) / 2),
  };
}

/**
 * Cells of a footprint centred on a cell, row major.
 *
 * Row major, and that matters: it is the order the cells reach `validateSelection`, so
 * the first offending cell of an issue is the north west most one, which is where the
 * jump to the conflict takes the camera.
 */
export function footprintCells(
  anchor: CellCoordWire,
  size: FootprintSize,
): readonly CellCoordWire[] {
  const origin = footprintOrigin(anchor, size);
  const cells: CellCoordWire[] = [];
  for (let row = 0; row < size.heightCells; row += 1) {
    for (let column = 0; column < size.widthCells; column += 1) {
      cells.push({ cellX: origin.cellX + column, cellY: origin.cellY + row });
    }
  }
  return cells;
}
