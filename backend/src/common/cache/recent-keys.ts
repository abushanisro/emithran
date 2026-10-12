/**
 * Remembers which keys were seen within the last `ttlMs`, so a repeated, idempotent
 * side effect (a telemetry upsert for the same gap) runs once per window instead of
 * once per call. Bounded: when full, the oldest entries go first.
 */
export class RecentKeys {
  private readonly seen = new Map<string, number>(); // insertion order = oldest first

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  /** True the first time `key` is offered within the window (and marks it); false for repeats. */
  firstSeen(key: string, now: number = Date.now()): boolean {
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.ttlMs) return false;
    this.seen.delete(key);
    this.seen.set(key, now);
    while (this.seen.size > this.maxEntries) {
      this.seen.delete(this.seen.keys().next().value as string);
    }
    return true;
  }
}
