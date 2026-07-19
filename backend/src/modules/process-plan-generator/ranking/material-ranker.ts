import type { PartFamily } from '../dto/engineering-brief.dto';
import type { MaterialCandidate } from '../dto/candidate-set.dto';

/**
 * Scores raw_materials rows for fit against the brief.
 *
 * Inputs: raw rows from the raw_materials table; the part family; an
 * optional material-name hint from the BOM (e.g., "Aluminium 6061").
 * Optional GeometrySignals add weighted scoring for form factor, thickness
 * range, process fit (holes/bends), and coating compatibility.
 * Returns the top-N rows with scores normalised so the best candidate ≈ 0.92.
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
  material_form?: string | null;
  material_family?: string | null;
}

export interface GeometrySignals {
  sheetThicknessMm?: number;
  holeCount?: number;
  bendCount?: number;
  coating?: string | null;
}

const COMPATIBLE_FORMS: Partial<Record<Exclude<PartFamily, 'out_of_scope'>, string[]>> = {
  sheet_metal: ['sheet', 'plate', 'coil', 'strip', 'blank'],
  cnc_turned:  ['bar', 'rod', 'tube', 'billet'],
  cnc_milled:  ['bar', 'block', 'plate', 'billet', 'blank'],
};

const PREFERRED_MATERIALS_BY_FAMILY: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned:       ['aluminium', 'aluminum', 'mild steel', 'ms', 'en8', 'en24', 'stainless', 'ss304', 'ss316', 'brass', 'copper', 'free cutting steel'],
  cnc_milled:       ['aluminium', 'aluminum', 'mild steel', 'en8', 'en19', 'en24', 'stainless', 'ss304', 'ss316', 'p20', 'h13', 'tool steel'],
  sheet_metal:      ['mild steel', 'ms', 'cold rolled', 'crca', 'galvanized', 'galvanised', 'gi', 'stainless', 'ss304', 'aluminium sheet', 'aluminum sheet', 'aluminium 5052', 'aluminium 6061', 'aluminium 1100', 'aluminium 3003', 'aluminum 5052', 'aluminum 6061'],
  injection_molded: ['abs', 'pp', 'polypropylene', 'pc', 'polycarbonate', 'nylon', 'pa6', 'pa66', 'pom', 'acetal', 'delrin', 'hdpe', 'ldpe', 'peek', 'tpu', 'tpe', 'plastic'],
};

const EXCLUDED_MATERIALS_BY_FAMILY: Partial<Record<Exclude<PartFamily, 'out_of_scope'>, string[]>> = {
  sheet_metal: ['bronze', 'brass', 'beryllium', 'nickel alloy', 'monel', 'hastelloy', 'inconel', 'titanium', 'tool steel', 'bearing'],
};

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

const toNumber = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// ── Scoring axes ──────────────────────────────────────────────────────────────

function familyFitScore(row: RawMaterialRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  const haystack = `${norm(row.material_group)} ${norm(row.material)} ${norm(row.material_grade)}`;
  const excluded = EXCLUDED_MATERIALS_BY_FAMILY[family] ?? [];
  if (excluded.some((kw) => haystack.includes(kw))) return 0;
  const compatibleForms = COMPATIBLE_FORMS[family];
  if (compatibleForms && row.material_form) {
    const formNorm = norm(row.material_form);
    if (!compatibleForms.some((f) => formNorm.includes(f))) return 0.15;
  }
  const preferred = PREFERRED_MATERIALS_BY_FAMILY[family];
  for (const kw of preferred) {
    if (haystack.includes(kw)) return 1;
  }
  if (norm(row.material_group).includes('ferrous')) return 0.5;
  return 0.2;
}

/**
 * Discriminates thin-gauge sheet from thick structural plate.
 * Drives IS2062 E350 (plate) below CRCA (sheet) for thin-section parts.
 */
function formFactorScore(
  row: RawMaterialRow,
  family: Exclude<PartFamily, 'out_of_scope'>,
  thicknessMm: number,
): number {
  const form = norm(row.material_form);
  if (!form) return 0.5;

  if (family === 'sheet_metal') {
    const isSheet = ['sheet', 'coil', 'strip', 'blank'].some((f) => form.includes(f));
    const isPlate = form.includes('plate');
    const t = thicknessMm > 0 ? thicknessMm : 0;

    if (isSheet) {
      if (t <= 0) return 0.7;
      if (t <= 3) return 1.0;
      if (t <= 6) return 0.85;
      if (t <= 12) return 0.6;
      return 0.3;
    }
    if (isPlate) {
      if (t <= 0) return 0.4;
      if (t <= 3) return 0.10;   // plates are wrong form for thin-gauge work
      if (t <= 6) return 0.40;
      if (t <= 12) return 0.80;
      return 1.0;
    }
    return 0.2; // bar / rod form for sheet_metal is wrong
  }

  if (family === 'cnc_turned') {
    return ['bar', 'rod', 'tube', 'billet'].some((f) => form.includes(f)) ? 1.0 : 0.3;
  }

  if (family === 'cnc_milled') {
    return ['bar', 'block', 'plate', 'billet', 'blank'].some((f) => form.includes(f)) ? 1.0 : 0.3;
  }

  return 0.5;
}

/**
 * Scores how well the material grade's typical thickness range suits the part.
 * IS2062 E350 (structural, ~5-25 mm) scores near 0 for a 2.4 mm sheet part.
 * CRCA (cold-rolled, 0.5-3 mm) scores 1.0 for the same part.
 */
function thicknessRangeScore(row: RawMaterialRow, thicknessMm: number): number {
  if (thicknessMm <= 0) return 0.5;

  const h = `${norm(row.material)} ${norm(row.material_grade)}`;

  // Cold-rolled / CRCA: 0.5–3 mm optimum
  if (['crca', 'cold rolled', 'cold-rolled', 'is513', 'cr2', 'cr3', 'cr4'].some((k) => h.includes(k))) {
    if (thicknessMm <= 3) return 1.0;
    if (thicknessMm <= 5) return 0.50;
    return 0.10;
  }

  // Galvanised / GI / SECC / SGCC: 0.5–2.5 mm optimum
  if (['galvanized', 'galvanised', 'gi sheet', 'gi coil', 'secc', 'sgcc', 'is277', 'z120', 'z180'].some((k) => h.includes(k))) {
    if (thicknessMm <= 2.5) return 1.0;
    if (thicknessMm <= 4.0) return 0.70;
    return 0.20;
  }

  // Structural / high-strength: 5–25 mm optimum — penalise heavily for thin gauge
  if (['is2062', 'e250', 'e350', 'e410', 'structural', 'high strength', 'high-strength'].some((k) => h.includes(k))) {
    if (thicknessMm <= 2) return 0.05;
    if (thicknessMm <= 4) return 0.20;
    if (thicknessMm <= 8) return 0.70;
    return 1.0;
  }

  // Stainless: versatile 0.5–10 mm
  if (['stainless', 'ss304', 'ss316', 'ss430', 'ss202', 'ss201', 'ss409'].some((k) => h.includes(k))) {
    if (thicknessMm <= 6) return 0.85;
    if (thicknessMm <= 12) return 0.70;
    return 0.40;
  }

  // Aluminium sheet grades: 0.5–5 mm
  if (['aluminium', 'aluminum', 'alum'].some((k) => h.includes(k))) {
    if (thicknessMm <= 5) return 0.90;
    if (thicknessMm <= 10) return 0.70;
    return 0.30;
  }

  // Generic mild steel / IS1079 strip: 1–8 mm
  if (['mild steel', 'ms sheet', 'ms strip', 'is1079'].some((k) => h.includes(k))) {
    if (thicknessMm <= 6) return 0.80;
    if (thicknessMm <= 12) return 0.90;
    return 0.70;
  }

  return 0.5; // unknown — neutral
}

/**
 * Scores laser-cut suitability (from hole density) and bend formability
 * (from bend count) independently, then combines weighted by signal strength.
 * High-strength plate scores poorly on both axes.
 */
function processFitScore(row: RawMaterialRow, holeCount: number, bendCount: number): number {
  if (holeCount <= 0 && bendCount <= 0) return 0.5;

  const h = `${norm(row.material)} ${norm(row.material_grade)}`;

  // Laser-cut suitability
  let laserScore = 0.55;
  if (holeCount > 0) {
    if (['crca', 'cold rolled', 'is513', 'mild steel', 'ms', 'is1079'].some((k) => h.includes(k))) laserScore = 1.0;
    else if (['galvanized', 'galvanised', 'secc', 'gi'].some((k) => h.includes(k))) laserScore = 0.85;
    else if (['ss304', 'ss316', 'ss430', 'stainless'].some((k) => h.includes(k))) laserScore = 0.80;
    else if (['aluminium', 'aluminum', 'alum'].some((k) => h.includes(k))) laserScore = 0.75;
    else if (['is2062', 'e350', 'e410', 'structural', 'high strength'].some((k) => h.includes(k))) laserScore = 0.35;
    else laserScore = 0.60;
  }

  // Bend formability
  let bendScore = 0.55;
  if (bendCount > 0) {
    if (['crca', 'cold rolled', 'is513', 'cr2', 'cr3', 'cr4'].some((k) => h.includes(k))) bendScore = 1.0;
    else if (['aluminium', 'aluminum', '1100', '3003', '5052'].some((k) => h.includes(k))) bendScore = 0.90;
    else if (['galvanized', 'galvanised', 'secc', 'gi'].some((k) => h.includes(k))) bendScore = 0.80;
    else if (['mild steel', 'ms sheet', 'ss304'].some((k) => h.includes(k))) bendScore = 0.70;
    else if (['ss316', 'ss430'].some((k) => h.includes(k))) bendScore = 0.60;
    else if (['is2062', 'e350', 'e410', 'structural', 'high strength'].some((k) => h.includes(k))) bendScore = 0.20;
    else bendScore = 0.50;
  }

  // Weight each axis by signal intensity (capped at 1)
  const hw = holeCount > 0 ? Math.min(1, holeCount / 150) : 0;
  const bw = bendCount > 0 ? Math.min(1, bendCount / 25) : 0;
  const total = hw + bw;
  if (total === 0) return 0.5;

  return (laserScore * hw + bendScore * bw) / total;
}

/**
 * Coating compatibility — mild steel and CRCA are ideal substrates for powder
 * coat (zinc phosphate pretreat is the industry standard). Stainless is poor.
 */
function coatingFitScore(row: RawMaterialRow, coating: string | null): number {
  if (!coating) return 0.5;
  const coat = norm(coating);
  const h = `${norm(row.material)} ${norm(row.material_grade)}`;

  if (coat.includes('powder') || coat.includes('ral')) {
    if (['crca', 'cold rolled', 'is513', 'mild steel', 'ms', 'is1079', 'is2062'].some((k) => h.includes(k))) return 1.0;
    if (['galvanized', 'galvanised', 'secc', 'gi'].some((k) => h.includes(k))) return 0.70;
    if (['aluminium', 'aluminum', 'alum'].some((k) => h.includes(k))) return 0.65;
    if (['stainless', 'ss304', 'ss316', 'ss430'].some((k) => h.includes(k))) return 0.25;
    return 0.50;
  }

  if (coat.includes('anodiz') || coat.includes('anodis')) {
    if (['aluminium', 'aluminum', 'alum'].some((k) => h.includes(k))) return 1.0;
    return 0.10;
  }

  if (coat.includes('zinc') || coat.includes('phosphate') || coat.includes('galvan')) {
    if (['crca', 'cold rolled', 'mild steel', 'ms'].some((k) => h.includes(k))) return 1.0;
    if (['galvanized', 'galvanised', 'gi'].some((k) => h.includes(k))) return 0.50;
    if (['stainless'].some((k) => h.includes(k))) return 0.30;
    return 0.60;
  }

  return 0.5;
}

function hintFitScore(row: RawMaterialRow, hint: string | null): number {
  if (!hint) return 0.5;
  const h = norm(hint);
  const haystack = `${norm(row.material)} ${norm(row.material_grade)}`;
  if (!haystack) return 0;
  if (haystack.includes(h) || h.includes(haystack)) return 1;
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
  if (orgLoc.includes('india') && rowLoc.includes('india')) return 0.9;
  return 0.4;
}

function costSanityScore(row: RawMaterialRow): number {
  const c = toNumber(row.cost ?? row.unit_cost);
  if (c <= 0) return 0;
  if (c > 50000) return 0.3;
  if (c > 5) return 1;
  return 0.6;
}

// ── Weight sets ───────────────────────────────────────────────────────────────

// With geometry signals, thickness + form factor dominate to discriminate
// structural plate from thin-gauge sheet. Without signals, fall back to the
// original family + location + cost weighting.

type Weights = {
  family: number; hint: number; form: number;
  thickness: number; process: number; coating: number;
  location: number; cost: number;
};

function weights(hasSignals: boolean, hasHint: boolean): Weights {
  if (hasSignals && !hasHint) {
    return { family: 0.10, hint: 0.00, form: 0.25, thickness: 0.25, process: 0.20, coating: 0.08, location: 0.08, cost: 0.04 };
  }
  if (hasSignals && hasHint) {
    return { family: 0.08, hint: 0.25, form: 0.18, thickness: 0.18, process: 0.13, coating: 0.07, location: 0.07, cost: 0.04 };
  }
  // No signals — original behaviour (used by retrieval.service.ts)
  if (!hasHint) {
    return { family: 0.30, hint: 0.00, form: 0.00, thickness: 0.00, process: 0.00, coating: 0.00, location: 0.45, cost: 0.25 };
  }
  return { family: 0.20, hint: 0.40, form: 0.00, thickness: 0.00, process: 0.00, coating: 0.00, location: 0.25, cost: 0.15 };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function rankMaterials(
  rows: RawMaterialRow[],
  family: Exclude<PartFamily, 'out_of_scope'>,
  hint: string | null,
  orgLocation: string,
  topN: number,
  signals?: GeometrySignals,
): MaterialCandidate[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const hasSignals = !!signals;
  const hasHint = !!hint;
  const w = weights(hasSignals, hasHint);
  const t = signals?.sheetThicknessMm ?? 0;
  const holes = signals?.holeCount ?? 0;
  const bends = signals?.bendCount ?? 0;
  const coating = signals?.coating ?? null;

  const scored = rows.map((row) => {
    const fScore = familyFitScore(row, family);
    const hScore = hintFitScore(row, hint);
    const ffScore = hasSignals ? formFactorScore(row, family, t) : 0.5;
    const trScore = hasSignals ? thicknessRangeScore(row, t) : 0.5;
    const pfScore = hasSignals ? processFitScore(row, holes, bends) : 0.5;
    const cfScore = hasSignals ? coatingFitScore(row, coating) : 0.5;
    const lScore = locationFitScore(row, orgLocation);
    const cScore = costSanityScore(row);

    const score =
      w.family * fScore +
      w.hint * hScore +
      w.form * ffScore +
      w.thickness * trScore +
      w.process * pfScore +
      w.coating * cfScore +
      w.location * lScore +
      w.cost * cScore;

    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));

  // Deduplicate by (material, grade) keeping the highest-scoring row per group.
  // The DB has one USD/GL row and one INR/IN row for every material; both score
  // similarly and without this step both appear as candidates for the same slot.
  // Normalise dashes so "Martensitic - Round Bar" and "Martensitic Round Bar"
  // collapse to the same key — a grade-string inconsistency between migration 154
  // and 175 that migration 347 corrects at the DB level.
  const seenMaterialGrade = new Set<string>();
  const deduped = scored.filter(({ row }) => {
    const key =
      `${(row.material ?? '').toLowerCase().trim()}|` +
      `${(row.material_grade ?? '').toLowerCase().trim().replace(/\s*-\s*/g, ' ')}`;
    if (seenMaterialGrade.has(key)) return false;
    seenMaterialGrade.add(key);
    return true;
  });

  const topSlice = deduped.slice(0, topN);

  // Normalise so the best candidate ≈ 0.92 (realistic spread, never 100%).
  const maxScore = topSlice[0]?.score ?? 1;
  const scaleFactor = maxScore > 0 ? 0.92 / maxScore : 1;

  return topSlice.map(({ row, score }, idx) => ({
    candidateId: `rm-${idx + 1}`,
    dbId: row.id,
    materialGroup: row.material_group ?? '',
    material: row.material ?? '',
    grade: row.material_grade ?? null,
    densityKgPerM3: toNumber(row.density_kg_m3 ?? row.density) || null,
    unitCostInrPerKg: toNumber(row.cost ?? row.unit_cost),
    location: row.location ?? null,
    score: Number((score * scaleFactor).toFixed(3)),
  }));
}
