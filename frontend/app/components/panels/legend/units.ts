// The scale of the world, as the interface states it.
//
// Owner: W4-E.
//
// It lives beside the legend on purpose. The legend is where the scale is published to
// the player -- "una celda son 10 x 10 m" -- and a surface computed anywhere else would
// be free to disagree with the line the legend prints. Plan section 2.2 fixes the scale
// (a cell is 10 x 10 m, a chunk 320 m, 16 px per cell at zoom 1) and `CELL_SIZE_M` of
// `shared/config/world.ts` is the only place the number itself lives: nothing here
// restates it, and the size of the cell arrives as a parameter so that a world whose
// `world/info` reports another one is shown correctly rather than plausibly.
//
// Rounding happens here and only here, at the last possible moment, and no rounded value
// is ever fed back into a calculation (plan section 5.2).

import { CELL_SIZE_M } from '~/shared/index';

/** Square metres in a hectare. The unit the GDD uses for a field (GDD section 119). */
export const SQUARE_METRES_PER_HECTARE = 10_000;

/**
 * Below this many hectares a surface is shown in square metres.
 *
 * A single cell is 0.01 ha, and "0,01 ha" is a figure nobody can picture; 100 m2 is.
 */
export const MIN_HECTARE_DISPLAY = 0.1;

/** Surface of one cell, in square metres. */
export function cellAreaM2(cellSizeM: number = CELL_SIZE_M): number {
  return cellSizeM * cellSizeM;
}

/** Surface of a set of cells, in square metres. */
export function areaM2(cellCount: number, cellSizeM: number = CELL_SIZE_M): number {
  return cellCount * cellAreaM2(cellSizeM);
}

/** Surface of a set of cells, in hectares (GDD sections 16 and 119). */
export function areaHectares(cellCount: number, cellSizeM: number = CELL_SIZE_M): number {
  return areaM2(cellCount, cellSizeM) / SQUARE_METRES_PER_HECTARE;
}

/** A surface in hectares, with two decimals. */
export function formatHectares(cellCount: number, cellSizeM: number = CELL_SIZE_M): string {
  const hectares = areaHectares(cellCount, cellSizeM);
  return `${hectares.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ha`;
}

/** A surface in square metres, with no decimals. */
export function formatSquareMetres(cellCount: number, cellSizeM: number = CELL_SIZE_M): string {
  return `${Math.round(areaM2(cellCount, cellSizeM)).toLocaleString('es-ES')} m2`;
}

/**
 * A surface in the unit that can be pictured: square metres for anything under a tenth
 * of a hectare, hectares above it.
 */
export function formatArea(cellCount: number, cellSizeM: number = CELL_SIZE_M): string {
  return areaHectares(cellCount, cellSizeM) < MIN_HECTARE_DISPLAY
    ? formatSquareMetres(cellCount, cellSizeM)
    : formatHectares(cellCount, cellSizeM);
}

/** The sentence the legend prints so that every hectare in the interface is readable. */
export function scaleStatement(cellSizeM: number = CELL_SIZE_M): string {
  return `Una celda son ${cellSizeM} x ${cellSizeM} m, es decir ${cellAreaM2(
    cellSizeM,
  )} m2. Cien celdas son una hectarea.`;
}
