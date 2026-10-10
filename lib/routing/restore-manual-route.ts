// After a reload, which plain (non-custom) route did the engineer pick in
// Manual mode? Saved lines from a plain route carry `auto_fill_from_route:<id>`
// in Auto and Manual mode alike; the saved processRouting is what tells them
// apart. Returns null when it was not a manual pick, or when that route is no
// longer offered (then nothing is guessed).
export function restoredManualRouteId(
  records: readonly { notes?: string | null }[],
  savedRouting: unknown,
  offeredRouteIds: readonly string[],
): string | null {
  if (savedRouting !== 'manual') return null;
  for (const r of records) {
    const id = /^auto_fill_from_route:(.+)$/.exec(r.notes ?? '')?.[1];
    if (id) return offeredRouteIds.includes(id) ? id : null;
  }
  return null;
}
