/**
 * Polygons (hex / square sockets and bosses). cad-engine reports every closed
 * ring of congruent planar walls as a polygon *candidate*
 * (machining_features.polygon_candidates: kind, side_count, across_flats_mm,
 * depth_mm, face_indices) because geometry alone cannot tell a broached hex
 * socket from an ordinary pocket. A candidate becomes a polygon only when the
 * drawing carries a polygon callout (drawing_intelligence.polygon_callout:
 * "HEX SOCKET", "ROTARY BROACH", "POLYGON TURNING" ...) — product decision
 * 2026-09-29. A socket's walls are also recognised as a CAD pocket; that
 * pocket is taken out of the milling sequence (same pre-filter pattern as the
 * keyway / Wire EDM splits) so it is broached, not milled as well.
 */

interface PolygonCandidate {
  kind?: string;
  side_count?: number;
  across_flats_mm?: number | null;
  depth_mm?: number | null;
  face_indices?: number[];
}

export interface Polygon {
  kind: 'socket' | 'boss';
  sides: number;
  acrossFlatsMm: number;
  depthMm: number;
  count: number;
}

export function polygonCallout(drawingIntelligence: any): string | null {
  const v = drawingIntelligence?.polygon_callout;
  return typeof v === 'string' && v.trim() !== '' && v.trim().toLowerCase() !== 'none' ? v.trim() : null;
}

const usable = (c: PolygonCandidate): c is Required<Pick<PolygonCandidate, 'kind' | 'side_count' | 'across_flats_mm' | 'depth_mm'>> & PolygonCandidate =>
  (c.kind === 'socket' || c.kind === 'boss')
  && Number(c.side_count) >= 3 && Number(c.across_flats_mm) > 0 && Number(c.depth_mm) > 0;

/** The polygons to price: every usable candidate when there is a callout, grouped by size. */
export function resolvePolygons(candidates: PolygonCandidate[] | null | undefined, callout: string | null): Polygon[] {
  if (!callout) return [];
  const groups = new Map<string, Polygon>();
  for (const c of candidates ?? []) {
    if (!usable(c)) continue;
    const p = { kind: c.kind as 'socket' | 'boss', sides: Number(c.side_count), acrossFlatsMm: Number(c.across_flats_mm), depthMm: Number(c.depth_mm) };
    const key = `${p.kind}:${p.sides}:${p.acrossFlatsMm}:${p.depthMm}`;
    const g = groups.get(key) ?? { ...p, count: 0 };
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * Removes the pocket occurrences that are a socket polygon's own walls (they
 * share B-Rep face ids with the ring). No callout = no change.
 */
export function splitPolygonPockets<T>(
  features: T[],
  candidates: PolygonCandidate[] | null | undefined,
  callout: string | null,
): { filteredFeatures: T[]; removedPocketOccurrences: number } {
  const socketFaces = new Set<number>();
  if (callout) for (const c of candidates ?? []) if (usable(c) && c.kind === 'socket') for (const id of c.face_indices ?? []) socketFaces.add(id);
  if (socketFaces.size === 0) return { filteredFeatures: features, removedPocketOccurrences: 0 };
  let removed = 0;
  const filteredFeatures: T[] = [];
  for (const f of features) {
    const feat = f as { feature_type?: string; occurrences?: Array<{ face_ids?: number[] }> };
    if (feat?.feature_type !== 'PocketV2' || !Array.isArray(feat.occurrences)) { filteredFeatures.push(f); continue; }
    const kept = feat.occurrences.filter((o) => !(o.face_ids ?? []).some((id) => socketFaces.has(id)));
    removed += feat.occurrences.length - kept.length;
    if (kept.length > 0) filteredFeatures.push({ ...(f as object), occurrences: kept } as T);
  }
  return { filteredFeatures, removedPocketOccurrences: removed };
}
