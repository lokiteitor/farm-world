// The recency index of the chunk cache.
//
// Owner: workflow W4-D. The one property that is not obvious: a chunk the camera is
// looking at is never evicted, however old its last use, because the alternative is a
// hole that opens in the middle of the screen as soon as the cache fills.

import { describe, expect, it } from 'vitest';
import { createLruIndex } from '../lru';

const NOTHING: ReadonlySet<string> = new Set<string>();

describe('createLruIndex', () => {
  it('refuses a capacity that is not a positive integer', () => {
    expect(() => createLruIndex<string>(0)).toThrow(RangeError);
    expect(() => createLruIndex<string>(1.5)).toThrow(RangeError);
  });

  it('reports nothing to evict while it fits', () => {
    const index = createLruIndex<string>(3);
    index.touch('a');
    index.touch('b');
    expect(index.size).toBe(2);
    expect(index.overflow(NOTHING)).toEqual([]);
  });

  it('evicts the least recently used first', () => {
    const index = createLruIndex<string>(2);
    index.touch('a');
    index.touch('b');
    index.touch('c');
    expect(index.overflow(NOTHING)).toEqual(['a']);
  });

  it('a use moves a key to the back of the queue', () => {
    const index = createLruIndex<string>(2);
    index.touch('a');
    index.touch('b');
    index.touch('a');
    index.touch('c');
    expect(index.overflow(NOTHING)).toEqual(['b']);
  });

  it('never evicts a protected key, and takes the next candidate instead', () => {
    const index = createLruIndex<string>(2);
    index.touch('a');
    index.touch('b');
    index.touch('c');
    expect(index.overflow(new Set(['a']))).toEqual(['b']);
  });

  it('evicts nothing when everything over capacity is protected', () => {
    const index = createLruIndex<string>(1);
    index.touch('a');
    index.touch('b');
    expect(index.overflow(new Set(['a', 'b']))).toEqual([]);
  });

  it('reports keys from least to most recently used', () => {
    const index = createLruIndex<string>(4);
    index.touch('a');
    index.touch('b');
    index.touch('c');
    index.touch('a');
    expect(index.keys()).toEqual(['b', 'c', 'a']);
  });

  it('forgets a deleted key', () => {
    const index = createLruIndex<string>(2);
    index.touch('a');
    expect(index.delete('a')).toBe(true);
    expect(index.delete('a')).toBe(false);
    expect(index.has('a')).toBe(false);
  });

  it('evicts down to capacity in one call and not one key at a time', () => {
    const index = createLruIndex<string>(2);
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      index.touch(key);
    }
    expect(index.overflow(NOTHING)).toEqual(['a', 'b', 'c']);
  });
});
