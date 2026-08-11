/**
 * Small bounded cache for values that are expensive to derive and cheap to
 * recompute if lost, such as the jump rail's buckets: they scan the whole
 * media type, and they only change when the catalogue does.
 *
 * Eviction is oldest-inserted-first once the cap is reached, which suits a
 * workload with a handful of distinct keys per user rather than a long tail.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T): void {
    // Re-inserting moves the key to the newest position, so a key that keeps
    // being used is not evicted while a stale one survives.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
