import { formatCycleSec } from '@/lib/costing/format-cycle';

export function fmt(n: number | undefined | null, d = 1): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
}

// A bare grade/temper fragment ("T6 - Round Bar", "HAZ Weldable Sheet") means
// nothing on its own — "T6" applies to many unrelated aluminum alloys. Prefix
// the material name so the saved/displayed value is unambiguous, unless the
// grade string already names the material (e.g. "AA6061-T6" already says
// aluminum) — avoids "Aluminum AA6061-T6 Aluminum".
export function materialLabel(material: string, materialGrade?: string | null): string {
  if (!materialGrade) return material;
  const g = materialGrade.toLowerCase();
  const m = material.toLowerCase();
  if (g.includes(m) || m.includes(g)) return materialGrade;
  return `${material} ${materialGrade}`;
}

// Display-only Material/Grade split for the Material Database table.
// Root-caused live (2026-09-17): the "Generic ..." Digital Factory material
// family (memory/database/Raw_Material_Database_june.json, 509 real rows)
// was seeded with material_grade = NULL for every row — the full real name
// (e.g. "Generic Aluminum - Honeycomb (Expanded 1)") lives in the `material`
// column alone. This never touches m.material/m.materialGrade themselves
// (search, alias matching, and apply-to-BOM below all keep using the real,
// unmodified pair) — it only decides how these two columns present an
// already-real name when materialGrade is genuinely absent.
// Verified directly against all 509 real rows: 220 use ", " as a real
// Material/Grade separator, 23 use " - ". The remaining ~266 (including
// "Generic Aluminum Bronze" — a real, distinct alloy family, not "Aluminum"
// with grade "Bronze" — and single-product names like "Generic Accura 60")
// have no real separator; inventing one for those would fabricate a grade
// that doesn't exist in the source data, so they correctly keep showing
// the full name in Material with Grade as "—", same as before this split.
export function splitMaterialDisplay(
  material: string,
  materialGrade?: string | null,
): { material: string; grade: string | null } {
  if (materialGrade) return { material, grade: materialGrade };
  const commaIdx = material.indexOf(',');
  if (commaIdx > 0) {
    return { material: material.slice(0, commaIdx).trim(), grade: material.slice(commaIdx + 1).trim() || null };
  }
  const dashMatch = /^(.+?)\s+-\s+(.+)$/.exec(material);
  if (dashMatch) {
    // Both groups are mandatory (non-optional) in the regex above, so they
    // are always present whenever dashMatch itself is truthy.
    return { material: dashMatch[1]!.trim(), grade: dashMatch[2]!.trim() || null };
  }
  return { material, grade: null };
}

export function fmtInt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN');
}

// A real ~5s operation (e.g. a short cut path + a handful of pierces) rounds
// to "0.0 min" at 1-decimal-place minutes, indistinguishable from unset/zero.
// Show sub-minute durations in seconds instead.
// A lookup-table cell for display: numbers/strings as-is, objects as JSON, empty as a dash.
export function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

// Never substitute the process route/group for a missing machine name — that
// silently displays the process as if it were the machine (e.g. "Laser Cutting"
// shown where a real machine like "Trumpf 3030" belongs). Say what's actually true.
/** What a route could not cost, saved at $0 with its reason (backend engine-kernel NO_COST_FEATURE): the operation's process route. */
export const NO_COST_FEATURE = 'No Cost Feature';

export function machineDisplayLabel(proc: { machineName?: string | null; mhrId?: string | null; processRoute?: string | null }): string {
  // A No Cost Feature runs on no machine: it is what the route did not cost, not a manually rated operation.
  if (proc.processRoute === NO_COST_FEATURE) return 'Not costed — No Cost Feature';
  if (proc.machineName) return proc.machineName;
  if (proc.mhrId) return 'Machine name unavailable';
  return 'Manual rate — not linked to a machine';
}

// SPECIFIC-process label (the CAD family's own detected process, one level
// finer than resolveProcessGroupLabel's category above — 'Injection Moulded'
// here is deliberately narrower than the 'Plastic Molding' process group;
// the CAD classifier itself has no sub-classification
// among Injection/Compression/RIM/Structural Foam Molding yet, so this
// always reads 'Injection Moulded' for the plastic_molded family today).
export function familyLabel(f: string): string {
  const m: Record<string, string> = {
    sheet_metal: 'Sheet Metal', milled: 'Milled', turned: 'Turned',
    mill_turn: 'Mill-Turn', plastic_molded: 'Injection Moulded',
    casting: 'Casting', forging: 'Forging',
    extrusion: 'Extrusion', weldment: 'Weldment', additive: 'Additive',
  };
  if (!f) return '—';
  return m[f] ?? f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The header badge of a part: the process it is costed as when one is chosen (Process Group), else the CAD classifier's family with its
 * confidence. The classifier only reads geometry: an insert-molded part looks injection molded, so its guess must not stand for the chosen process.
 */
export function partProcessBadge(
  cls: { family: string; confidence?: number | null } | null | undefined, processGroup: string | null | undefined,
): { label: string; confidence: number | null; title: string } | null {
  const cad = cls ? `${familyLabel(cls.family)}${cls.confidence != null ? ` (${String(Math.round(cls.confidence * 100))}%)` : ''}` : null;
  if (processGroup) return { label: processGroup, confidence: null, title: cad ? `Chosen process. The CAD reads the geometry as ${cad}.` : 'Chosen process.' };
  if (!cls) return null;
  return { label: `${familyLabel(cls.family)}${cls.confidence != null ? ` · ${String(Math.round(cls.confidence * 100))}%` : ''}`, confidence: cls.confidence ?? null, title: 'CAD classification' };
}

export function confidenceCls(c: number): string {
  if (c >= 0.85) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (c >= 0.65) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

export function formatEstCycleTime(sec: number | null, allocated = false): string {
  if (sec == null || !Number.isFinite(sec)) return 'unavailable';
  return allocated ? `≈${formatCycleSec(sec)}` : formatCycleSec(sec);
}

export const money = (n: number, symbol: string) => `${n < 0 ? '-' : '+'}${symbol}${Math.abs(n).toFixed(Math.abs(n) < 0.1 ? 3 : 2)}`;
