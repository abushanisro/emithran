import type { MaterialClass } from '../process/cost-machining-engine';

// Machining lookup tables key their speed/feed rows by a material cut code
// with a hardness. The cut code's integer part is the material family, as
// the reference materials number it (memory/Multi-Spindle Maching/Materials/
// materials_table.csv "Cut Code": Steel 1.x / 2.x, Stainless Steel 5.x,
// Titanium 23.x, Aluminum 30.x, Copper and Brass 33.x, Thermoplastic 51.x,
// Thermoset 52.x; 3.x is high-alloy / tool steel in the same numbering).
//
// A row is matched inside the material's own family first, then by the
// hardness nearest the class's representative Brinell hardness. Hardness
// alone crosses families: stainless at HB275 landed on Hastelloy X (20.23,
// HB275) and copper at HB100 on an aluminum row (30.12, HB100).
//
// Representative hardness (memory/sheetmetal/rawmetrial/rawmetalusa.json):
// aluminum HB60 (29 AA grades), mild steel HB125 (mode of 37 low-carbon
// grades), stainless HB275 (median of 14 grades), copper alloy HB100 (median
// of 7). Titanium, tool steel and plastic have no Brinell value in the
// reference (NaN), so they resolve to null and the caller names the gap.
export interface MachiningMaterial { hb: number; cutCodeFamilies: readonly number[] }

export const MACHINING_MATERIAL: Record<MaterialClass, MachiningMaterial> = {
  aluminum: { hb: 60, cutCodeFamilies: [30] },
  mild_steel: { hb: 125, cutCodeFamilies: [1, 2] },
  stainless: { hb: 275, cutCodeFamilies: [5] },
  copper_alloy: { hb: 100, cutCodeFamilies: [33] },
  titanium: { hb: Number.NaN, cutCodeFamilies: [23] },
  tool_steel: { hb: Number.NaN, cutCodeFamilies: [3] },
  plastic: { hb: Number.NaN, cutCodeFamilies: [51, 52] },
};

/** A material to match rows for: a class entry, or a bare hardness (no family filter). */
type MaterialTarget = MachiningMaterial | number;

const targetHb = (t: MaterialTarget): number => (typeof t === 'number' ? t : t.hb);

function rowCutCode(row: any): number | null {
  const c = Number(row.MaterialCutCodeName ?? row.material_cut_code ?? row['Material Cut Code Name'] ?? row.material_cut_code_name);
  return Number.isFinite(c) ? c : null;
}

/** The rows of the material's own cut-code family. A table with no cut code column is returned whole. */
function familyRows<T>(rows: T[], t: MaterialTarget): T[] {
  if (typeof t === 'number' || !rows.some((r) => rowCutCode(r) != null)) return rows;
  return rows.filter((r) => t.cutCodeFamilies.includes(Math.trunc(rowCutCode(r) ?? Number.NaN)));
}

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

export function nearestByHardness<T>(allRows: T[], target: MaterialTarget): T | null {
  const rows = familyRows(allRows, target);
  if (!withinRange(tableHardnesses(rows), targetHb(target))) return null;
  return nearestHardnessRow(rows, targetHb(target));
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
export function nearestByDiameterThenHardness<T>(rows: T[], diameterMm: number, target: MaterialTarget): T | null {
  const withDiam = familyRows(rows, target).filter((r) => rowDiameter(r) != null);
  if (withDiam.length === 0) return null;
  const diameters = [...new Set(withDiam.map((r) => rowDiameter(r)!))].sort((a, b) => a - b);
  // Both axes bounded against the whole table's own range.
  if (!withinRange(diameters, diameterMm)) return null;
  if (!withinRange(tableHardnesses(withDiam), targetHb(target))) return null;
  const nearestDiam = diameters.reduce((best, d) => (Math.abs(d - diameterMm) < Math.abs(best - diameterMm) ? d : best), diameters[0]);
  const atDiam = withDiam.filter((r) => rowDiameter(r) === nearestDiam);
  return nearestHardnessRow(atDiam, targetHb(target));
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
  return nearestDiameterEntry(byDiameter, diameterMm)?.value ?? null;
}

/** The breakpoint nearestByDiameterKey reads: its diameter (the flattened table's diameter_mm) and value. */
export function nearestDiameterEntry(
  byDiameter: Record<string, number> | undefined | null,
  diameterMm: number,
): { diameterMm: number; value: number } | null {
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
  return typeof v === 'number' && Number.isFinite(v) ? { diameterMm: nearest.num, value: v } : null;
}
