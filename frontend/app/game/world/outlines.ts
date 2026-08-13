// Outlines of ownership, field, farm footprint and forest plot.
//
// Owner: workflow W4-D (world rendering). Pure: cells in, edge segments out.
//
// Plan section 9.3 puts the outlines at scene level and not per chunk: they are edge
// segments extracted from the visible set of cells and drawn in a single `Graphics`,
// recomputed only when the visible set changes or a chunk changes version. Per chunk
// outlines would be wrong as well as slower, because a field that spans two chunks would
// be drawn with a seam down the middle where its two halves meet.
//
// The extraction itself is `borderSegments` of shared/rules/geometry.ts, the same
// function the server uses and the same one the selection tool of W5 will use. Writing a
// second edge walker here is how the highlight of a selection and the outline of the
// field it becomes end up one pixel apart.
//
// Grouping is the only decision this module makes, and it is forced: the outline of a
// set is the set of edges whose neighbour is outside it, so putting two adjacent fields
// in one set would erase the border between them. Ownership is one group, and each
// field, each building footprint and each forest plot is a group of its own.

import { PALETTE } from '../textures/palette';
import { type WorldChunkView } from './source';
import { LandUse, borderSegments, worldFromChunk, type EdgeSegment } from '~/shared/index';

/** The four outline families of plan section 9.3. */
export const OutlineKind = {
  /** Land of the viewer (GDD section 14). */
  OWNED: 'OWNED',
  /** One field (GDD sections 16 to 18). */
  FIELD: 'FIELD',
  /** Footprint of a building (GDD sections 24 and 116). */
  FARM: 'FARM',
  /** One forest plot (GDD section 130). */
  FOREST_PLOT: 'FOREST_PLOT',
} as const;
export type OutlineKind = (typeof OutlineKind)[keyof typeof OutlineKind];

/** Colour of each family, from the single palette module (ADR-0020). */
export const OUTLINE_COLOUR: Readonly<Record<OutlineKind, number>> = {
  OWNED: PALETTE.ui.outlineProperty,
  FIELD: PALETTE.ui.outlineField,
  FARM: PALETTE.ui.outlineFarm,
  FOREST_PLOT: PALETTE.ui.outlineForestPlot,
};

/**
 * Line width of each family in world pixels at zoom 1.
 *
 * Ownership is the thinnest because it is the most common and would otherwise dominate;
 * a farm footprint is the thickest because it is the smallest shape on screen.
 */
export const OUTLINE_WIDTH: Readonly<Record<OutlineKind, number>> = {
  OWNED: 1,
  FIELD: 2,
  FARM: 2,
  FOREST_PLOT: 1.5,
};

/** One outline: a family and the edges of one connected subject. */
export interface OutlineGroup {
  readonly kind: OutlineKind;
  /** Identifier of the subject, or null for the ownership group. */
  readonly subjectId: string | null;
  readonly segments: readonly EdgeSegment[];
}

/** A cell of the extraction, in absolute world coordinates. */
interface Cell {
  readonly cellX: number;
  readonly cellY: number;
}

function push(groups: Map<string, Cell[]>, key: string, cell: Cell): void {
  const held = groups.get(key);
  if (held === undefined) {
    groups.set(key, [cell]);
    return;
  }
  held.push(cell);
}

/**
 * Every outline of a set of chunks.
 *
 * Only the viewer's land produces an ownership outline. Land of another player is drawn
 * by its usage tile and gets no outline: an outline is a claim about a shape the player
 * can act on, and foreign land is not one (GDD section 14).
 */
export function collectOutlineGroups(
  chunks: Iterable<WorldChunkView>,
  chunkSize: number,
  viewerPlayerId: string | null,
): readonly OutlineGroup[] {
  const owned: Cell[] = [];
  const fields = new Map<string, Cell[]>();
  const farms = new Map<string, Cell[]>();
  const plots = new Map<string, Cell[]>();

  for (const chunk of chunks) {
    for (const [idx, patch] of chunk.patches) {
      const cell = worldFromChunk({ chunkX: chunk.chunkX, chunkY: chunk.chunkY }, idx, chunkSize);
      if (patch.ownerPlayerId !== null && patch.ownerPlayerId === viewerPlayerId) {
        owned.push(cell);
      }
      if (patch.landUse === LandUse.FIELD && patch.fieldId !== null) {
        push(fields, patch.fieldId, cell);
      } else if (patch.landUse === LandUse.BUILDING && patch.buildingId !== null) {
        push(farms, patch.buildingId, cell);
      } else if (patch.landUse === LandUse.FOREST_PLOT && patch.forestPlotId !== null) {
        push(plots, patch.forestPlotId, cell);
      }
    }
  }

  const groups: OutlineGroup[] = [];
  if (owned.length > 0) {
    groups.push({ kind: OutlineKind.OWNED, subjectId: null, segments: borderSegments(owned) });
  }
  const append = (kind: OutlineKind, source: Map<string, Cell[]>): void => {
    // Sorted by identifier, so two runs over the same visible set draw the same
    // geometry in the same order and a rendering test can compare literally.
    for (const subjectId of [...source.keys()].sort()) {
      const cells = source.get(subjectId);
      if (cells === undefined || cells.length === 0) {
        continue;
      }
      groups.push({ kind, subjectId, segments: borderSegments(cells) });
    }
  };
  append(OutlineKind.FIELD, fields);
  append(OutlineKind.FARM, farms);
  append(OutlineKind.FOREST_PLOT, plots);
  return groups;
}

/** Segments in a group set, for the debug counter and the tests. */
export function countSegments(groups: readonly OutlineGroup[]): number {
  let total = 0;
  for (const group of groups) {
    total += group.segments.length;
  }
  return total;
}
