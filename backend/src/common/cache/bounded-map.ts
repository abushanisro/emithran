/**
 * Makes room in a size-capped Map by dropping its oldest entry (a Map keeps
 * insertion order), never the whole map: a burst of new keys must not wipe
 * every other entry and send all their callers back to Supabase at once.
 */
export function evictOldestIfFull(map: Map<string, unknown>, max: number): void {
  if (map.size < max) return;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}
