import type { PartFamily } from '../dto/engineering-brief.dto';
import type { MaterialCandidate } from '../dto/candidate-set.dto';

/**
 * Scores raw_materials rows for fit against the brief.
 *
 * Inputs: raw rows from the raw_materials table; the part family; an
 * optional material-name hint from the BOM (e.g., "Aluminium 6061").
 * Returns the top-N rows with score and a symbolic `rm-N` candidateId.
 *
 * Scoring (each axis returns 0..1, equally weighted):
 *   - familyFit:  alignment between material_group / material name and the
 *                 family's preferred materials
 *   - hintFit:    fuzzy match against the BOM's materialHint
 *   - locationFit: India / user-org location preferred over others
 *   - costSanity: penalises rows with cost = 0 or absurd values
 */

interface RawMaterialRow {
  id: string;
  material_group: string | null;
  material: string | null;
  material_grade: string | null;
  density_kg_m3?: number | string | null;
  density?: number | string | null;          // legacy column name fallback
  cost?: number | string | null;             // canonical name in raw_materials
  unit_cost?: number | string | null;        // legacy column name fallback
  location?: string | null;
}

const PREFERRED_MATERIALS_BY_FAMILY: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned: ['aluminium', 'aluminum', 'mild steel', 'ms', 'en8', 'en24', 'stainless', 'ss304', 'ss316', 'brass', 'copper', 'free cutting steel'],
  cnc_milled: ['aluminium', 'aluminum', 'mild steel', 'en8', 'en19', 'en24', 'stainless', 'ss304', 'ss316', 'p20', 'h13', 'tool steel'],
  sheet_metal: ['mild steel', 'ms', 'cold rolled', 'crca', 'galvanized', 'gi', 'stainless', 'ss304', 'aluminium', 'aluminum 6061'],
};

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

const toNumber = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function familyFitScore(row: RawMaterialRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  const preferred = PREFERRED_MATERIALS_BY_FAMILY[family];
  const haystack = `${norm(row.material_group)} ${norm(row.material)} ${norm(row.material_grade)}`;
  for (const kw of preferred) {
    if (haystack.includes(kw)) return 1;
  }
  // Soft fit: ferrous/non-ferrous group is fine even without keyword match
  if (norm(row.material_group).includes('ferrous')) return 0.5;
  return 0.2;
}

function hintFitScore(row: RawMaterialRow, hint: string | null): number {
  if (!hint) return 0.5; // neutral if no hint
  const h = norm(hint);
  const haystack = `${norm(row.material)} ${norm(row.material_grade)}`;
  if (!haystack) return 0;
  if (haystack.includes(h) || h.includes(haystack)) return 1;
  // Token overlap
  const hintTokens = new Set(h.split(/\s+/).filter((t) => t.length > 2));
  const rowTokens = new Set(haystack.split(/\s+/).filter((t) => t.length > 2));
  let hits = 0;
  for (const t of hintTokens) if (rowTokens.has(t)) hits++;
  return hits === 0 ? 0.2 : Math.min(1, hits / hintTokens.size);
}

function locationFitScore(row: RawMaterialRow, orgLocation: string): number {
  const orgLoc = norm(orgLocation);
  const rowLoc = norm(row.location);
  if (!rowLoc) return 0.5;
  if (rowLoc === orgLoc) return 1;
  // Country-level match (e.g. "India-Bangalore" vs "India-Chennai")
  if (orgLoc.includes('india') && rowLoc.includes('india')) return 0.9;
  return 0.4;
}

function costSanityScore(row: RawMaterialRow): number {
  const c = toNumber(row.cost ?? row.unit_cost);
  if (c <= 0) return 0;
  if (c > 50000) return 0.3; // very expensive
  if (c > 5) return 1;
  return 0.6;
}

export function rankMaterials(
  rows: RawMaterialRow[],
  family: Exclude<PartFamily, 'out_of_scope'>,
  hint: string | null,
  orgLocation: string,
  topN: number,
): MaterialCandidate[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const scored = rows.map((row) => {
    const fScore = familyFitScore(row, family);
    const hScore = hintFitScore(row, hint);
    const lScore = locationFitScore(row, orgLocation);
    const cScore = costSanityScore(row);
    // Hint weight raised to 0.40 when a BOM material hint is present — it must drive selection.
    // Without hint (hScore=0.5 for all) the weights collapse to family+location+cost tiebreak.
    const score = hint
      ? 0.20 * fScore + 0.40 * hScore + 0.25 * lScore + 0.15 * cScore
      : 0.30 * fScore + 0.00 * hScore + 0.45 * lScore + 0.25 * cScore;
    return { row, score };
  });

  // Secondary sort by DB id ensures identical scores sort the same way every run.
  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));

  return scored.slice(0, topN).map(({ row, score }, idx) => ({
    candidateId: `rm-${idx + 1}`,
    dbId: row.id,
    materialGroup: row.material_group ?? '',
    material: row.material ?? '',
    grade: row.material_grade ?? null,
    densityKgPerM3: toNumber(row.density_kg_m3 ?? row.density) || null,
    unitCostInrPerKg: toNumber(row.cost ?? row.unit_cost),
    location: row.location ?? null,
    score: Number(score.toFixed(3)),
  }));
}
