import type { MaterialClass } from '../process/cost-machining-engine';

// Real Machining lookup tables (tblCounterboring/tblReaming/tblChamfering/
// tblDeburring) key their real speed/feed/tool-life rows by a numeric
// material_cut_code with real hardness/hardness_system fields, but NO name
// legend anywhere in the reference data — verified directly (grepped every
// memory/machining/ file and every migration for material_cut_code
// alongside a readable name field; none exists), not assumed.
//
// Rather than fabricate a code->material-name mapping, this bridges
// through the one real physical property both sides genuinely share:
// hardness. A harder material cuts slower — resolving to the lookup row
// whose own real hardness is nearest this class's real representative
// hardness is standard machining practice (this IS how speeds/feeds are
// actually selected from a materials handbook), not a guess.
//
// Representative hardness per MaterialClass, derived from the ONE real
// Brinell-hardness dataset in this repo (memory/sheetmetal/rawmetrial/
// rawmetalusa.json, 101 real named material grades — computed
// programmatically 2026-09-16, not eyeballed):
//   aluminum:     HB60  — median of 29 real AA-series entries, uniform at HB60
//   mild_steel:   HB125 — MODE of 37 real low/mild-carbon entries (AISI 10xx
//                 hot/cold worked, ASTM A36; excludes the AISI 1095
//                 high-carbon spring-steel outlier at HB1034 and every
//                 stainless-labeled entry) — 14 of 37 sit exactly at HB125,
//                 which also matches tblCounterboring/tblDeburring's own
//                 material_cut_code "1.0" hardness exactly, corroborating
//                 the bridge.
//   stainless:    HB275 — median of 14 real stainless grades (AISI
//                 301/303/304/304L/316/316L/316Ti/321/440B, 15-5PH/17-4PH,
//                 A240/A351CF8/AISI441)
//   copper_alloy: HB100 — median of 7 real copper/brass entries
// titanium/tool_steel/plastic have NO real Brinell data anywhere in this
// repo (titanium's 2 real rawmetalusa.json entries both have
// HardnessSystem=null; no P20/H13/D2/M2 tool-steel entry exists at all;
// plastics use an incompatible hardness scale entirely) — a genuine,
// disclosed gap. They carry no hardness (NaN), and the matchers below only
// match a finite value inside a table's own tabulated range, so these classes
// resolve to null (reported missing by the caller) instead of borrowing the
// hardest or softest steel row.
export const MACHINING_MATERIAL_HARDNESS_HB: Record<MaterialClass, number> = {
  aluminum: 60,
  mild_steel: 125,
  stainless: 275,
  copper_alloy: 100,
  titanium: Number.NaN,
  tool_steel: Number.NaN,
  plastic: Number.NaN,
};

function rowHardness(row: any): number | null {
  const h = row.hardness ?? row.Hardness;
  return typeof h === 'number' && Number.isFinite(h) ? h : null;
}

// Every matcher below snaps only WITHIN the table's own tabulated range:
// nearest row to a value between the table's lowest and highest entry is the
// table's own granularity; a value outside that range would be extrapolation
// the source never gives, so it returns null and the caller reports the gap.
function withinRange(values: number[], target: number): boolean {
  if (values.length === 0 || !Number.isFinite(target)) return false;
  return target >= Math.min(...values) && target <= Math.max(...values);
}

function tableHardnesses(rows: unknown[]): number[] {
  return rows.map(rowHardness).filter((h): h is number => h != null);
}

export function nearestByHardness<T>(rows: T[], targetHb: number): T | null {
  if (!withinRange(tableHardnesses(rows), targetHb)) return null;
  return nearestHardnessRow(rows, targetHb);
}

// Nearest row by hardness with no range check — only called once the caller
// has bounded the target against the WHOLE table (see
// nearestByDiameterThenHardness: a material's rows can sit on a different
// diameter grid, so bounding within one diameter's rows would wrongly reject
// a hardness the table does cover).
function nearestHardnessRow<T>(rows: T[], targetHb: number): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const r of rows) {
    const h = rowHardness(r);
    if (h == null) continue;
    const dist = Math.abs(h - targetHb);
    if (dist < bestDist) {
      best = r;
      bestDist = dist;
    }
  }
  return best;
}

function rowDiameter(row: any): number | null {
  // 'Diameter (mm)' is tblGunDrilling's own real column name, transcribed
  // verbatim from its source spreadsheet — a third real spelling alongside
  // the snake_case/CamelCase variants every other lookup table already uses.
  const d = row.diameter_mm ?? row.DiameterMm ?? row['Diameter (mm)'];
  return typeof d === 'number' && Number.isFinite(d) ? d : null;
}

// Nearest real diameter first, then nearest real hardness among the rows at
// that diameter — same two-axis "nearest X, then nearest Y among ties"
// pattern sheet-metal-lookup.service.ts already uses (getLaserParams:
// nearest thickness then nearest power; getPlasmaCutRateParams: nearest
// power then nearest thickness), not a new convention.
export function nearestByDiameterThenHardness<T>(rows: T[], diameterMm: number, targetHb: number): T | null {
  const withDiam = rows.filter((r) => rowDiameter(r) != null);
  if (withDiam.length === 0) return null;
  const diameters = [...new Set(withDiam.map((r) => rowDiameter(r)!))].sort((a, b) => a - b);
  // Both axes bounded against the whole table's own range.
  if (!withinRange(diameters, diameterMm)) return null;
  if (!withinRange(tableHardnesses(withDiam), targetHb)) return null;
  const nearestDiam = diameters.reduce((best, d) => (Math.abs(d - diameterMm) < Math.abs(best - diameterMm) ? d : best), diameters[0]);
  const atDiam = withDiam.filter((r) => rowDiameter(r) === nearestDiam);
  return nearestHardnessRow(atDiam, targetHb);
}

// Some real tables (deep_bore_drill_lookup.json/deep_bore_trepan_lookup.json,
// and straight_drill_lookup.json's tblDrilling) key feed/depth by diameter
// as a {"<diameterMm>": value} map NESTED inside each material row, rather
// than one row per (material, diameter) — a genuinely different real shape
// from tblGunDrilling/tblCounterboring/tblReaming's flat rows, not a typo.
// Picks the value at the real diameter key nearest the requested one.
export function nearestByDiameterKey(
  byDiameter: Record<string, number> | undefined | null,
  diameterMm: number,
): number | null {
  if (!byDiameter) return null;
  // Keep each key's ORIGINAL string alongside its numeric value -- real
  // keys are formatted like "12.0", and reconstructing via String(Number(k))
  // would look up "12" instead and silently miss the real entry.
  const entries = Object.keys(byDiameter)
    .map((key) => ({ key, num: Number(key) }))
    .filter((e) => Number.isFinite(e.num));
  if (entries.length === 0) return null;
  if (!withinRange(entries.map((e) => e.num), diameterMm)) return null;
  const nearest = entries.reduce(
    (best, e) => (Math.abs(e.num - diameterMm) < Math.abs(best.num - diameterMm) ? e : best),
    entries[0]!,
  );
  const v = byDiameter[nearest.key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
