import { describe, expect, it } from 'vitest';

import { TtlCache } from './ttl-cache';

function clockCache<T>(ttlMs: number, maxEntries: number) {
  let now = 0;
  const cache = new TtlCache<T>(ttlMs, maxEntries, () => now);
  return {
    cache,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('TtlCache', () => {
  it('returns a stored value before it expires', () => {
    const { cache, advance } = clockCache<number>(1000, 4);
    cache.set('a', 1);

    advance(999);

    expect(cache.get('a')).toBe(1);
  });

  it('drops a value once its ttl has passed', () => {
    const { cache, advance } = clockCache<number>(1000, 4);
    cache.set('a', 1);

    advance(1000);

    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest entry when full', () => {
    const { cache } = clockCache<number>(1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('keeps a key that is written again rather than evicting it as oldest', () => {
    const { cache } = clockCache<number>(1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);

    expect(cache.get('a')).toBe(3);
    expect(cache.get('b')).toBeUndefined();
  });

  it('clears everything', () => {
    const { cache } = clockCache<number>(1000, 4);
    cache.set('a', 1);
    cache.set('b', 2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});
