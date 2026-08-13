// Recycling: the two ceilings, and what happens past each of them.
//
// Owner: workflow W5-D (canvas entities). The pool and the group are generic over the
// object they hold and free of any engine import, which is what lets these ceilings be
// asserted here instead of by watching the heap of a browser.

import { describe, expect, it } from 'vitest';
import { ChunkEntityGroup, groupKeyOf, SpritePool, type PoolHandlers } from '../pool';

interface Fake {
  readonly serial: number;
  visible: boolean;
  destroyed: boolean;
}

function handlers(): { readonly handlers: PoolHandlers<Fake>; readonly log: string[] } {
  const log: string[] = [];
  let serial = 0;
  return {
    log,
    handlers: {
      create: () => {
        serial += 1;
        log.push(`create:${serial}`);
        return { serial, visible: true, destroyed: false };
      },
      recycle: (item) => {
        item.visible = false;
        log.push(`recycle:${item.serial}`);
      },
      destroy: (item) => {
        item.destroyed = true;
        log.push(`destroy:${item.serial}`);
      },
    },
  };
}

describe('SpritePool', () => {
  it('reuses what was released instead of building again', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 8);
    const first = pool.acquire();
    pool.release(first);
    const second = pool.acquire();
    expect(second).toBe(first);
    expect(pool.churn.created).toBe(1);
  });

  it('does not retain past its ceiling: the excess is destroyed', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 3);
    const held = Array.from({ length: 10 }, () => pool.acquire());
    expect(pool.liveCount).toBe(10);
    for (const item of held) {
      pool.release(item);
    }
    expect(pool.idleCount).toBe(3);
    expect(pool.churn.destroyed).toBe(7);
    expect(held.filter((item) => item.destroyed)).toHaveLength(7);
  });

  it('prepares everything it releases for reuse, retained or not', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 1);
    const first = pool.acquire();
    const second = pool.acquire();
    pool.release(first);
    pool.release(second);
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(false);
  });

  it('a ceiling of zero retains nothing', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 0);
    pool.release(pool.acquire());
    expect(pool.idleCount).toBe(0);
    expect(pool.churn.destroyed).toBe(1);
  });

  it('clearing destroys the free list and zeroes the live count', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 4);
    const first = pool.acquire();
    const second = pool.acquire();
    pool.release(first);
    pool.release(second);
    expect(pool.idleCount).toBe(2);
    pool.clear();
    expect(pool.idleCount).toBe(0);
    expect(pool.liveCount).toBe(0);
    expect(pool.churn.destroyed).toBe(2);
  });
});

describe('ChunkEntityGroup', () => {
  it('recycling never exceeds the maximum size of the group', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 64);
    const group = new ChunkEntityGroup<Fake>(3, -2, 5);
    const claimed: (Fake | null)[] = [];
    for (let index = 0; index < 12; index += 1) {
      claimed.push(group.claim(`entity-${index}`, () => pool.acquire()));
    }
    expect(group.size).toBe(5);
    expect(group.dropped).toBe(7);
    expect(claimed.filter((item) => item === null)).toHaveLength(7);
    // The ceiling bounds what the group costs, so nothing beyond it was ever built.
    expect(pool.churn.created).toBe(5);
    expect(pool.liveCount).toBe(5);
  });

  it('answers the same entity with the same object, which is what avoids retexturing', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 8);
    const group = new ChunkEntityGroup<Fake>(0, 0, 4);
    const first = group.claim('machine-1', () => pool.acquire());
    const again = group.claim('machine-1', () => pool.acquire());
    expect(again).toBe(first);
    expect(pool.churn.created).toBe(1);
  });

  it('keeps what is still live and returns the rest to the pool', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 8);
    const group = new ChunkEntityGroup<Fake>(0, 0, 8);
    for (const id of ['a', 'b', 'c', 'd']) {
      group.claim(id, () => pool.acquire());
    }
    const released = group.retainOnly(new Set(['a', 'c']), (item) => {
      pool.release(item);
    });
    expect(released).toBe(2);
    expect(group.size).toBe(2);
    expect(pool.idleCount).toBe(2);
    expect(group.get('a')).toBeDefined();
    expect(group.get('b')).toBeUndefined();
  });

  it('releasing the whole group empties it and returns everything', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 8);
    const group = new ChunkEntityGroup<Fake>(1, 1, 8);
    for (const id of ['a', 'b', 'c']) {
      group.claim(id, () => pool.acquire());
    }
    expect(
      group.releaseAll((item) => {
        pool.release(item);
      }),
    ).toBe(3);
    expect(group.size).toBe(0);
    expect(pool.idleCount).toBe(3);
  });

  it('releasing one entity answers whether it was there', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 8);
    const group = new ChunkEntityGroup<Fake>(0, 0, 8);
    group.claim('a', () => pool.acquire());
    expect(
      group.remove('a', (item) => {
        pool.release(item);
      }),
    ).toBe(true);
    expect(
      group.remove('a', (item) => {
        pool.release(item);
      }),
    ).toBe(false);
    expect(group.size).toBe(0);
  });

  it('admits entities again once room has been made', () => {
    const { handlers: h } = handlers();
    const pool = new SpritePool(h, 8);
    const group = new ChunkEntityGroup<Fake>(0, 0, 2);
    group.claim('a', () => pool.acquire());
    group.claim('b', () => pool.acquire());
    expect(group.claim('c', () => pool.acquire())).toBeNull();
    group.remove('a', (item) => {
      pool.release(item);
    });
    expect(group.claim('c', () => pool.acquire())).not.toBeNull();
    expect(group.size).toBe(2);
  });
});

describe('groupKeyOf', () => {
  it('uses the same key form as the world renderer', () => {
    expect(groupKeyOf(3, -2)).toBe('3:-2');
  });
});
