import type { MHRReferenceDetailDto } from './dto/mhr-response.dto';

// Provenance keys the memory/ machine seeds write into specs (the source csv
// path); shown as the lookup's source, not as a machine field.
const SOURCE_KEYS = ['source', 'press_data_source'];

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
