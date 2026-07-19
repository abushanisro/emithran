import type { PartFamily } from '../dto/engineering-brief.dto';
import type { ToolingCandidate } from '../dto/candidate-set.dto';

interface ToolingRow {
  id: string;
  tooling_type: string | null;
  description: string | null;
  specifications: string | null;
  unit_cost: number | string | null;
  quantity: number | string | null;
  amortization_parts: number | string | null;
  usage_percentage: number | string | null;
  total_cost: number | string | null;
  is_custom: boolean | null;
  supplier: string | null;
  is_active: boolean | null;
}

const FAMILY_TYPE_PREFERENCE: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned:       ['cutting_tool', 'jig', 'gauge', 'fixture', 'other'],
  cnc_milled:       ['cutting_tool', 'fixture', 'jig', 'gauge', 'other'],
  sheet_metal:      ['die', 'mold', 'fixture', 'jig', 'gauge', 'cutting_tool', 'other'],
  injection_molded: ['mold', 'die', 'fixture', 'gauge', 'other'],
};

const FAMILY_KEYWORDS: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned:       ['insert', 'ccmt', 'dcmt', 'turning', 'boring', 'lathe', 'parting', 'thread'],
  cnc_milled:       ['end mill', 'face mill', 'milling', 'slot', 'drill', 'reamer', 'cutter'],
  sheet_metal:      ['laser', 'punch', 'die', 'bend', 'brake', 'shear', 'nozzle', 'lens'],
  injection_molded: ['mold base', 'cavity', 'core', 'ejector', 'runner', 'gate', 'hot runner', 'cooling channel'],
};

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase();
const toNum = (v: number | string | null | undefined, fallback = 0): number => {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
};

function typeScore(row: ToolingRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  const preferred = FAMILY_TYPE_PREFERENCE[family];
  const idx = preferred.indexOf(norm(row.tooling_type));
  if (idx === -1) return 0.2;
  return 1 - idx * 0.15; // 1.0, 0.85, 0.70, 0.55, 0.40, 0.25
}

function keywordScore(row: ToolingRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  const kws = FAMILY_KEYWORDS[family];
  const hay = `${norm(row.description)} ${norm(row.specifications)}`;
  for (const kw of kws) if (hay.includes(kw)) return 1;
  return 0.3;
}

function costSanity(row: ToolingRow): number {
  const c = toNum(row.unit_cost);
  if (c <= 0) return 0;
  if (c > 500_000) return 0.3;
  return 1;
}

export function rankTooling(
  rows: ToolingRow[],
  family: Exclude<PartFamily, 'out_of_scope'>,
  topN: number,
): ToolingCandidate[] {
  if (!rows.length) return [];

  const active = rows.filter((r) => r.is_active !== false);

  const scored = active.map((row) => {
    const score = 0.40 * typeScore(row, family)
                + 0.35 * keywordScore(row, family)
                + 0.25 * costSanity(row);
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // De-duplicate by description so the same standard tool doesn't fill all slots
  const seen = new Set<string>();
  const deduped = scored.filter(({ row }) => {
    const key = norm(row.description).slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, topN).map(({ row, score }, idx) => {
    const unitCost    = toNum(row.unit_cost);
    const qty         = toNum(row.quantity, 1);
    const amort       = Math.max(toNum(row.amortization_parts, 1), 1);
    const usagePct    = toNum(row.usage_percentage, 100);
    const costPerPart = (unitCost * qty * (usagePct / 100)) / amort;

    return {
      candidateId: `tc-${idx + 1}`,
      dbId: row.id,
      toolingType: row.tooling_type ?? 'other',
      description: row.description ?? '',
      specifications: row.specifications ?? null,
      unitCostInr: unitCost,
      quantity: qty,
      amortizationParts: amort,
      usagePercentage: usagePct,
      costPerPart: Number(costPerPart.toFixed(4)),
      isCustom: !!row.is_custom,
      supplier: row.supplier ?? null,
      score: Number(score.toFixed(3)),
    };
  });
}
