// Constants of the entity layer.
//
// Owner: workflow W5-D (canvas entities). Every number the layer obeys is declared
// here, with the clause of the plan or the section of the GDD that fixes it, for the
// same reason `game/world/config.ts` exists: a budget that is spread over five modules
// as literals cannot be argued about in one place.
//
// The load case this layer has to survive is the one the brief fixes: two hundred
// machines and two thousand trees on screen at once. Machines and workers are few and
// move; trees are many and never move. The two ceilings below are the operational form
// of that asymmetry.

import { DEPTH } from '../world/config';
import { CELLS_PER_CHUNK, CELL_PX } from '~/shared/config/world';

/**
 * Depth of the whole layer inside the world scene.
 *
 * Derived from the two neighbours instead of being written as 25, because
 * `game/world/config.ts` is the file that owns the depth order and it states that the
 * entities of this workflow go between the land use layer and the grid. A literal here
 * would be a second declaration of the same fact.
 */
export const ENTITY_LAYER_DEPTH = (DEPTH.USAGE + DEPTH.GRID) / 2;

/**
 * Kinds of entity the layer draws, in the order they resolve a depth tie.
 *
 * A building and a tree that share a row draw in that order because a building is
 * ground furniture and a tree has a canopy that overhangs it; a machine and a worker
 * draw last because they are what the player is looking for.
 */
export const EntityKind = {
  BUILDING: 'BUILDING',
  TREE: 'TREE',
  MACHINE: 'MACHINE',
  WORKER: 'WORKER',
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

/** Rank of each kind inside a depth tie. Lower draws first, that is behind. */
export const ENTITY_KIND_RANK: Readonly<Record<EntityKind, number>> = {
  BUILDING: 0,
  TREE: 1,
  MACHINE: 2,
  WORKER: 3,
};

/**
 * Weight of the kind rank inside the depth key.
 *
 * A sixteenth of a world pixel: small enough that it can never reorder two entities
 * that are genuinely at different depths, large enough to be exact in binary floating
 * point, which a decimal like 0.001 would not be.
 */
export const DEPTH_KIND_STEP = 1 / 16;

/**
 * Zoom at or above which trees are drawn one by one (plan section 9.5, brief of this
 * workflow).
 *
 * Below it the land use layer and the chunk thumbnail already say that a cell carries a
 * standing tree, which is the whole of the information a 4 px cell can carry, and two
 * thousand sprites would be paying for a canopy nobody can resolve.
 *
 * The value sits between two zoom steps and on none of them (`ZOOM_STEPS` of
 * `game/world/config.ts` has 0.5 and 0.7 around it), for the reason that file gives for
 * `NEAR_LOD_MIN_ZOOM`: crossing the threshold has to be a real change of step and never
 * a coin toss on a float comparison.
 */
export const TREE_MIN_ZOOM = 0.6;

/**
 * Zoom at or above which an anchored label is worth drawing.
 *
 * Above the tree threshold on purpose: a label is legible at any zoom, because the
 * overlay camera does not scale it, so what limits it is not readability but density.
 * At zoom 0.7 a screen holds some 16 000 cells and a name over every idle worker is
 * still a handful of labels; below it the same names would pile onto each other.
 */
export const LABEL_MIN_ZOOM = 0.7;

/**
 * Individually drawn trees at any one time.
 *
 * The brief fixes two thousand as the load case; the ceiling is above it so the case is
 * measured and not clipped, and it exists so a forest of a hundred thousand trees
 * degrades by drawing the nearest ones instead of by stopping the frame. Trees beyond
 * it are represented exactly as they are below the zoom threshold, by the land use
 * layer.
 */
export const MAX_TREES_DRAWN = 3_000;

/**
 * Sprites one chunk group may hold.
 *
 * A chunk is `CELLS_PER_CHUNK` cells and a cell holds at most one tree (GDD section
 * 130), so the tree half of a group cannot exceed it by construction. The ceiling is
 * therefore not a guess about the domain: it is that invariant made enforceable, so a
 * source that reports two trees on one cell costs a dropped sprite and not an unbounded
 * group.
 */
export const MAX_SPRITES_PER_CHUNK_GROUP = CELLS_PER_CHUNK;

/**
 * Sprites the pool keeps warm per texture key once nobody is using them.
 *
 * Recycling exists because creating a `Phaser.GameObjects.Image` allocates and because
 * the streaming ring hands the layer whole chunks at a time; retaining without a
 * ceiling would turn a pan across a forest into a permanent high water mark of every
 * chunk ever visited. Beyond the ceiling a released sprite is destroyed.
 */
export const MAX_POOLED_SPRITES_PER_KEY = 256;

/**
 * Chunks beyond the visible rectangle the layer populates.
 *
 * One ring, matching `PREFETCH_RING_CHUNKS` of the world renderer, and it is not
 * decoration: a building is anchored by its north west cell and is up to eight cells
 * tall, so a farm whose origin has just left the viewport still has most of its
 * footprint inside it.
 */
export const ENTITY_RING_CHUNKS = 1;

/** Milliseconds between two structural rebuilds. Ten a second, like the streamer. */
export const ENTITY_TICK_MS = 100;

// ---------------------------------------------------------------------------
// Cosmetic movement (GDD section 92, plan section 9.5)
// ---------------------------------------------------------------------------

/**
 * Distance an implement trails behind the machine that tows it, in world pixels.
 *
 * The machine sprite is 32 px wide and drawn facing east with its drawbar at the west
 * edge (`game/textures/shapes.ts`), so a whole sprite width puts the drawbar of the
 * implement where the hitch of the tractor is.
 */
export const IMPLEMENT_TRAIL_PX = 30;

/**
 * Offset of the worker from the machine it operates, perpendicular to the heading.
 *
 * The worker walks beside the machine rather than sitting inside it. Drawing the worker
 * under the machine would be more literal and would hide the entity the player is
 * looking for, which is the one whose wages are being paid.
 */
export const WORKER_ESCORT_OFFSET_PX = 14;

/** Screen pixels the task progress bar sits above the machine it belongs to. */
export const PROGRESS_BAR_OFFSET_PX = -22;

/** Screen pixels a worker label sits above the worker it names. */
export const LABEL_OFFSET_PX = -14;

/**
 * World pixels a moving entity has to travel in `y` before the layer asks for another
 * depth sort.
 *
 * A stable sort of a few thousand children costs little, but paying it on every frame
 * for a tractor that moved a tenth of a pixel is paying it for nothing. Half a cell is
 * the granularity at which an overlap actually changes.
 */
export const DEPTH_RESORT_EPSILON_PX = CELL_PX / 2;

// ---------------------------------------------------------------------------
// Idle placement (GDD sections 96, 105 and 108)
// ---------------------------------------------------------------------------

/** Cells one parked machine occupies inside a garage footprint. Two by two at 16 px. */
export const PARKING_SLOT_CELLS = { width: 2, height: 2 } as const;

/** Cells of margin left inside a footprint before the first parking slot. */
export const PARKING_INSET_CELLS = 1;

/** Heading of a parked machine: south, facing the doors the garage sprite draws. */
export const PARKED_HEADING_RAD = Math.PI / 2;

/** Heading of a worker standing outside a home. South, so the figure faces the player. */
export const RESTING_HEADING_RAD = Math.PI / 2;

/** Cells below the south edge of a home where its idle workers stand. */
export const RESTING_ROW_GAP_CELLS = 0.75;

/** Scale applied to the badge sprite that marks an idle worker. */
export const IDLE_BADGE_SCALE = 3;

/** Screen independent offset of the badge above the worker, in world pixels. */
export const IDLE_BADGE_OFFSET_PX = -12;
