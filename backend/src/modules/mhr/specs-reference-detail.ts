import type { MHRReferenceDetailDto } from './dto/mhr-response.dto';

// Provenance keys the memory/ machine seeds write into specs (the source csv
// path); shown as the lookup's source, not as a machine field.
const SOURCE_KEYS = ['source', 'press_data_source'];

// mhr_records.location -> the reference tables' source_region code (836).
const REGION_OF_LOCATION: Record<string, string> = { usa: 'USA', india: 'IND', china: 'CHN', mexico: 'MEX', france: 'FRA' };

/**
 * One reference row for a machine when the same key/name is staged once per
 * region. Migration 836 staged the India/China/Mexico/France rate rows of
 * sm_reference_data under the same "<Category>:<Name>" keys and names as the
 * USA machine_library rows (505-508), so a plain "exactly one match" check
 * found five and resolved nothing: every Sheet Metal machine showed no
 * reference. Prefers the USA row (machine_library itself, the full spec
 * record), then the row of the machine's own location. Two candidates in the
 * same region are still ambiguous and resolve to null, never to a guess.
 */
export function pickRegionalReferenceRow<T extends { source_region?: string | null }>(
  rows: T[],
  location: string | null | undefined,
): T | null {
  if (rows.length === 1) return rows[0]!;
  const own = REGION_OF_LOCATION[String(location ?? '').trim().toLowerCase()];
  for (const region of ['USA', own]) {
    if (!region) continue;
    const hits = rows.filter((r) => r.source_region === region);
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * The machine's own reference record held in mhr_records.specs — the full
 * source row of every machine seeded from a memory/ machine csv (Die Casting
 * 845, Forging 824, Hydroforming 828, Surface Treatment 820, ...), whose
 * domains have no machine_library-style reference table. Not a name match:
 * it is this row's own data, so nothing can resolve to another machine.
 * found:false when specs holds nothing beyond its provenance.
 */
export function specsReferenceDetail(
  specs: unknown,
  benchmarkSourceKey: string | null | undefined,
): MHRReferenceDetailDto {
  if (!specs || typeof specs !== 'object' || Array.isArray(specs)) {
    return { found: false, sourceKey: null, raw: null };
  }
  const raw: Record<string, any> = {};
  let source: string | null = null;
  for (const [k, v] of Object.entries(specs as Record<string, any>)) {
    if (SOURCE_KEYS.includes(k)) source ??= typeof v === 'string' ? v : null;
    else raw[k] = v;
  }
  if (Object.keys(raw).length === 0) return { found: false, sourceKey: null, raw: null };
  return { found: true, sourceKey: source ?? benchmarkSourceKey ?? null, raw };
}
