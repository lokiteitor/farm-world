// Least recently used index of decoded chunks.
//
// Owner: workflow W4-D (world rendering). Pure: it holds keys and recency, never the
// chunk itself, so it can be asserted without a renderer and so the thing it evicts is
// decided in one place.
//
// Plan section 9.5 sizes the cache at 256 decoded chunks, "so that going back is
// instant". The number matters less than the eviction rule, which has one hard
// constraint: a chunk the camera is looking at is never evicted, however old its last
// use. Without that guarantee a pan across a large area would evict the chunk under the
// pointer as soon as the cache filled, and the symptom is a hole that appears in the
// middle of the screen and fills in again a tick later.
//
// A `Map` is the whole implementation. JavaScript maps iterate in insertion order, so
// deleting and reinserting a key on every touch keeps the iteration order equal to the
// recency order, and the least recently used key is the first one iteration yields.

/** An index of keys ordered by recency of use. */
export interface LruIndex<TKey> {
  /** Records a use. Inserts the key when it is new. */
  touch(key: TKey): void;
  has(key: TKey): boolean;
  delete(key: TKey): boolean;
  readonly size: number;
  readonly capacity: number;
  /** Keys from least to most recently used. */
  keys(): readonly TKey[];
  /**
   * Keys that should be evicted so that the index fits its capacity, least recently
   * used first, skipping everything in `protectedKeys`.
   *
   * It does not evict: it reports. The caller destroys the chunk and then calls
   * `delete`, so a failure to destroy cannot leave the index claiming the chunk is
   * gone while its tilemap is still on screen.
   */
  overflow(protectedKeys: ReadonlySet<TKey>): readonly TKey[];
  clear(): void;
}

export function createLruIndex<TKey>(capacity: number): LruIndex<TKey> {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError(`The LRU capacity must be a positive integer, got ${capacity}`);
  }
  const order = new Map<TKey, true>();

  return {
    touch(key: TKey): void {
      order.delete(key);
      order.set(key, true);
    },
    has: (key: TKey): boolean => order.has(key),
    delete: (key: TKey): boolean => order.delete(key),
    get size(): number {
      return order.size;
    },
    capacity,
    keys: (): readonly TKey[] => [...order.keys()],
    overflow(protectedKeys: ReadonlySet<TKey>): readonly TKey[] {
      let excess = order.size - capacity;
      if (excess <= 0) {
        return [];
      }
      const victims: TKey[] = [];
      for (const key of order.keys()) {
        if (excess <= 0) {
          break;
        }
        if (protectedKeys.has(key)) {
          continue;
        }
        victims.push(key);
        excess -= 1;
      }
      return victims;
    },
    clear(): void {
      order.clear();
    },
  };
}
