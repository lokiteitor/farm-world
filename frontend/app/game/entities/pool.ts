// Recycling of sprites, grouped by chunk.
//
// Owner: workflow W5-D (canvas entities). Generic over the object it holds and free of
// any engine import, which is what lets its ceilings be asserted by a unit test instead
// of by watching the heap of a browser.
//
// Why grouping by chunk and not one flat list. The world renderer streams chunks in and
// out with a hysteresis of two rings (`game/world/config.ts`), so "these entities have
// just stopped being relevant" is already computed, per chunk, ten times a second. A
// flat list would have to rediscover it by walking every entity on every tick; a group
// per chunk turns dropping a screenful of trees into releasing a handful of groups.
//
// Why a ceiling on the group and a second one on the pool. They answer two different
// failure modes. The group ceiling bounds what one chunk can cost: a chunk holds
// `CELLS_PER_CHUNK` cells and one tree per cell (GDD section 130), so a source that
// reported more is reporting something impossible and must cost a dropped sprite rather
// than an unbounded group. The pool ceiling bounds what a long session costs: without
// it, panning across a forest would leave every sprite ever created warm in memory, and
// the recycling meant to save allocations would have become a leak with a nicer name.

/** What the pool has to be able to do with the objects it holds. */
export interface PoolHandlers<T> {
  /** Builds a new object. Called only when the free list is empty. */
  create(): T;
  /** Prepares an object for reuse. Typically hides it and drops its tint. */
  recycle(item: T): void;
  /** Releases an object for good. Called past the ceiling and on `clear`. */
  destroy(item: T): void;
}

/**
 * A free list with a ceiling.
 *
 * One pool per texture key: a `Phaser.GameObjects.Image` can be retextured, but doing so
 * on recycling defeats the multi texture batch, because the batch is what groups sprites
 * that share a texture and reassigning textures on the fly scatters them.
 */
export class SpritePool<T> {
  private readonly handlers: PoolHandlers<T>;

  private readonly maxIdle: number;

  private readonly idle: T[] = [];

  private live = 0;

  private createdCount = 0;

  private destroyedCount = 0;

  constructor(handlers: PoolHandlers<T>, maxIdle: number) {
    this.handlers = handlers;
    this.maxIdle = Math.max(0, Math.trunc(maxIdle));
  }

  acquire(): T {
    const held = this.idle.pop();
    this.live += 1;
    if (held !== undefined) {
      return held;
    }
    this.createdCount += 1;
    return this.handlers.create();
  }

  /** Returns an object. Destroyed rather than retained once the free list is full. */
  release(item: T): void {
    this.live = Math.max(0, this.live - 1);
    this.handlers.recycle(item);
    if (this.idle.length >= this.maxIdle) {
      this.destroyedCount += 1;
      this.handlers.destroy(item);
      return;
    }
    this.idle.push(item);
  }

  get idleCount(): number {
    return this.idle.length;
  }

  get liveCount(): number {
    return this.live;
  }

  /** Objects built and objects destroyed since construction. Reported by the counter. */
  get churn(): { readonly created: number; readonly destroyed: number } {
    return { created: this.createdCount, destroyed: this.destroyedCount };
  }

  clear(): void {
    for (const item of this.idle) {
      this.destroyedCount += 1;
      this.handlers.destroy(item);
    }
    this.idle.length = 0;
    this.live = 0;
  }
}

/**
 * The sprites of one chunk, keyed by the identifier of the entity they draw.
 *
 * The key is the entity and not the cell: a machine moves across cells inside one task
 * and would otherwise be released and reacquired on every cell boundary, which is the
 * allocation the pool exists to avoid.
 */
export class ChunkEntityGroup<T> {
  readonly chunkX: number;

  readonly chunkY: number;

  private readonly maxSize: number;

  private readonly items = new Map<string, T>();

  private droppedCount = 0;

  constructor(chunkX: number, chunkY: number, maxSize: number) {
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    this.maxSize = Math.max(0, Math.trunc(maxSize));
  }

  get size(): number {
    return this.items.size;
  }

  /** Entities the group refused because it was full, since construction. */
  get dropped(): number {
    return this.droppedCount;
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /**
   * The sprite of an entity, building one through `acquire` if it has none.
   *
   * The group takes a function and not the pool itself, because one group holds sprites
   * of several textures and there is one pool per texture key. Keeping the group free of
   * that mapping is what lets it be tested with plain objects.
   *
   * Returns null once the group is full rather than growing past the ceiling. A null is
   * a dropped sprite and never a dropped entity: the caller draws nothing for it this
   * tick and the counter reports it, which is what makes the ceiling visible instead of
   * mysterious.
   */
  claim(id: string, acquire: () => T): T | null {
    const held = this.items.get(id);
    if (held !== undefined) {
      return held;
    }
    if (this.items.size >= this.maxSize) {
      this.droppedCount += 1;
      return null;
    }
    const acquired = acquire();
    this.items.set(id, acquired);
    return acquired;
  }

  /** Releases every sprite whose entity is not in `keep`. */
  retainOnly(keep: ReadonlySet<string>, release: (item: T) => void): number {
    let released = 0;
    for (const [id, item] of this.items) {
      if (keep.has(id)) {
        continue;
      }
      this.items.delete(id);
      release(item);
      released += 1;
    }
    return released;
  }

  /** Releases one entity. Returns whether it was there. */
  remove(id: string, release: (item: T) => void): boolean {
    const held = this.items.get(id);
    if (held === undefined) {
      return false;
    }
    this.items.delete(id);
    release(held);
    return true;
  }

  /** Releases everything. Used when the chunk leaves the ring. */
  releaseAll(release: (item: T) => void): number {
    const released = this.items.size;
    for (const item of this.items.values()) {
      release(item);
    }
    this.items.clear();
    return released;
  }

  entries(): IterableIterator<[string, T]> {
    return this.items.entries();
  }

  values(): IterableIterator<T> {
    return this.items.values();
  }
}

/** Key of a chunk group. The same string form the world renderer uses. */
export function groupKeyOf(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`;
}
