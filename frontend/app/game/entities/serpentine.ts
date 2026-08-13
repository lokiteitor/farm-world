// The cosmetic route of a task: a deterministic serpentine over the cells of the target.
//
// Owner: workflow W5-D (canvas entities). Pure arithmetic, no engine, no clock read from
// the ambient world: everything below is a function of the cells, the task identifier and
// an instant that is passed in.
//
// Why the movement is derived and not transmitted (GDD section 92, plan section 9.5).
// The task is bound to the whole field and the visual movement of the machine between
// chunks is cosmetic with no effect on the simulation, which the GDD states outright. So
// the server never says where a tractor is, and this module answers the question instead.
// Three properties follow from deriving it rather than streaming it, and all three are
// the reason the plan asks for it this way:
//
//   - It consumes no traffic. A tractor that moves for four game hours costs zero frames
//     of network, where a position update at any useful rate would be a message per
//     second per machine.
//   - It survives a reload. The route is a function of the task identifier and the
//     position a function of the clock, and both outlive the page.
//   - It is identical in two tabs. Same task, same cells, same clock anchor, same pixel.
//     A client side random walk would be none of the three.
//
// The shape of the route is a boustrophedon, that is the way a field is actually worked:
// along one row, turn, back along the next. The identifier of the task picks which of the
// eight orientations is used, so two adjacent fields worked at the same time do not move
// in lockstep, and the same task always picks the same one.

import { cellKey } from '~/shared/rules/geometry';

/** A cell of the route. */
export interface PathCell {
  readonly cellX: number;
  readonly cellY: number;
}

/**
 * Seed of a route, from the identifier of the task.
 *
 * FNV-1a, the same mixer `game/textures/palette.ts` uses for the worker tint, and for
 * the same reason: it spreads short identifiers over a few slots in two operations per
 * character, and it is a pure function of the string, so there is no `Math.random`
 * anywhere on this path any more than there is in the terrain generator.
 */
export function pathSeed(taskId: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < taskId.length; index += 1) {
    hash ^= taskId.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/**
 * The three bits of the seed that the route uses.
 *
 * Eight orientations out of three independent choices, which is enough that two fields
 * being worked side by side do not look like one machine mirrored, and few enough that
 * every one of them is a route a farmer would actually drive.
 */
export interface SerpentineShape {
  /** Bands are columns instead of rows: the machine drives north-south. */
  readonly columnMajor: boolean;
  /** The bands are traversed from the last to the first. */
  readonly reverseBands: boolean;
  /** The first band is traversed backwards, and so every other one after it. */
  readonly reverseFirstBand: boolean;
}

export function serpentineShape(seed: number): SerpentineShape {
  const bits = seed >>> 0;
  return {
    columnMajor: (bits & 0b001) !== 0,
    reverseBands: (bits & 0b010) !== 0,
    reverseFirstBand: (bits & 0b100) !== 0,
  };
}

/**
 * The route over a set of cells.
 *
 * Two properties this function guarantees, and which its test asserts, because the whole
 * design rests on them:
 *
 *   - Every cell of the input appears exactly once. A route that skipped cells would
 *     show a machine finishing a field it never crossed.
 *   - The result depends on the *set* of cells and not on the order they arrived in.
 *     The cells of a field reach the client as a page of an API reply, and two clients
 *     that received them in a different order have to draw the same route.
 *
 * Duplicates in the input are collapsed on the cell key, which is the same key the
 * shared geometry rules use, so a source that lists a cell twice cannot make a machine
 * stall on it.
 */
export function serpentinePath(cells: Iterable<PathCell>, seed: number): readonly PathCell[] {
  const shape = serpentineShape(seed);

  const unique = new Map<number, PathCell>();
  for (const cell of cells) {
    unique.set(cellKey(cell.cellX, cell.cellY), { cellX: cell.cellX, cellY: cell.cellY });
  }

  const bands = new Map<number, PathCell[]>();
  for (const cell of unique.values()) {
    const band = shape.columnMajor ? cell.cellX : cell.cellY;
    const held = bands.get(band);
    if (held === undefined) {
      bands.set(band, [cell]);
    } else {
      held.push(cell);
    }
  }

  // Sorted explicitly and never left to the insertion order of the map: that is what
  // makes the result a function of the set rather than of the iteration order.
  const bandKeys = [...bands.keys()].sort((a, b) => a - b);
  if (shape.reverseBands) {
    bandKeys.reverse();
  }

  const path: PathCell[] = [];
  for (let index = 0; index < bandKeys.length; index += 1) {
    const key = bandKeys[index];
    if (key === undefined) {
      continue;
    }
    const band = bands.get(key) ?? [];
    band.sort((a, b) => (shape.columnMajor ? a.cellY - b.cellY : a.cellX - b.cellX));
    const backwards = (index % 2 === 1) !== shape.reverseFirstBand;
    if (backwards) {
      band.reverse();
    }
    for (const cell of band) {
      path.push(cell);
    }
  }
  return path;
}

/** Where along the route a progress lands: a segment index and a fraction of it. */
export interface PathCursor {
  readonly index: number;
  readonly frac: number;
}

/**
 * The cursor of a progress over a route of `length` cells.
 *
 * The parameter is the cell index and not the arc length. The two differ only on the
 * turn at the end of a band, where a diagonal step is longer than a straight one, and
 * paying for a cumulative length table per task to remove a barely visible variation in
 * speed at the headland would be the wrong trade: a real machine slows down there too.
 *
 * Monotone in `progress` by construction, which is what its test asserts: `index + frac`
 * is `clamp(progress) * (length - 1)`, and clamping is monotone.
 */
export function pathCursor(length: number, progress: number): PathCursor {
  if (length <= 1) {
    return { index: 0, frac: 0 };
  }
  const clamped = Math.min(1, Math.max(0, progress));
  const t = clamped * (length - 1);
  const index = Math.min(length - 2, Math.floor(t));
  return { index, frac: t - index };
}

/** Where an entity is and which way it points. Cell coordinates, fractional. */
export interface PathPose {
  /** Centre of the entity, in cells. Already offset to the centre of the cell. */
  readonly cellX: number;
  readonly cellY: number;
  /** Tangent of the route at that point, in radians. East is zero (`shapes.ts`). */
  readonly headingRad: number;
  readonly index: number;
  readonly frac: number;
}

/**
 * The pose at a progress.
 *
 * The heading comes from the tangent of the route and from nothing else, which is why no
 * second set of textures per direction exists: every machine and the worker are drawn
 * facing east and rotated about the centre of their canvas (`game/textures/shapes.ts`).
 */
export function poseAt(path: readonly PathCell[], progress: number): PathPose | null {
  if (path.length === 0) {
    return null;
  }
  const cursor = pathCursor(path.length, progress);
  const from = path[cursor.index];
  const to = path[Math.min(cursor.index + 1, path.length - 1)];
  if (from === undefined || to === undefined) {
    return null;
  }
  const deltaX = to.cellX - from.cellX;
  const deltaY = to.cellY - from.cellY;
  return {
    cellX: from.cellX + deltaX * cursor.frac + 0.5,
    cellY: from.cellY + deltaY * cursor.frac + 0.5,
    headingRad: deltaX === 0 && deltaY === 0 ? 0 : Math.atan2(deltaY, deltaX),
    index: cursor.index,
    frac: cursor.frac,
  };
}

/**
 * Distance travelled along the route at a progress, in cells.
 *
 * Not used by the renderer, which needs the pose and not the length. It exists because
 * "the position is monotone in the progress" is a property about distance and a test
 * that only checked the index would pass on a route that jumped backwards inside a
 * segment.
 */
export function travelledCells(path: readonly PathCell[], progress: number): number {
  if (path.length <= 1) {
    return 0;
  }
  const cursor = pathCursor(path.length, progress);
  let total = 0;
  for (let index = 0; index < cursor.index; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (from === undefined || to === undefined) {
      continue;
    }
    total += Math.hypot(to.cellX - from.cellX, to.cellY - from.cellY);
  }
  const from = path[cursor.index];
  const to = path[cursor.index + 1];
  if (from !== undefined && to !== undefined) {
    total += Math.hypot(to.cellX - from.cellX, to.cellY - from.cellY) * cursor.frac;
  }
  return total;
}

/** The interval of a task, as the progress needs it. */
export interface TaskWindow {
  readonly startGameMs: bigint;
  readonly scheduledEndGameMs: bigint;
  /** Real end, set when the task was cancelled. Differs from the scheduled one. */
  readonly endedGameMs?: bigint | null;
}

/**
 * Elapsed fraction of a task at an instant, from 0 to 1.
 *
 * The clock is a parameter and never `Date.now`: the game clock is an extrapolation
 * from an anchor with a rational multiplier (plan section 6.1), and a renderer that read
 * the wall clock would drift away from every countdown in the interface within a minute
 * of a multiplier change.
 *
 * `endedGameMs` caps the ratio because a cancelled task stops where it stopped: nothing
 * is refunded and the wear is prorated (plan section 2.2), so the machine must not keep
 * crawling towards a scheduled end that will never happen.
 */
export function taskProgressRatio(window: TaskWindow, nowGameMs: bigint): number {
  const span = window.scheduledEndGameMs - window.startGameMs;
  if (span <= 0n) {
    return 1;
  }
  const ended = window.endedGameMs;
  const capped = ended == null ? nowGameMs : nowGameMs < ended ? nowGameMs : ended;
  const elapsed = capped - window.startGameMs;
  if (elapsed <= 0n) {
    return 0;
  }
  if (elapsed >= span) {
    return 1;
  }
  return Number(elapsed) / Number(span);
}
