import type { PartFamily } from '../dto/engineering-brief.dto';
import type { CalculatorCandidate } from '../dto/candidate-set.dto';

/**
 * Scores calculators by category fit. The user has both built-in and
 * custom calculators; the model picks one per process line as the
 * "lens" through which that operation will be computed.
 */

interface CalculatorRow {
  id: string;
  name: string | null;
  calc_category: string | null;
  description: string | null;
}

const FAMILY_CALC_KEYWORDS: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned: ['turn', 'lathe', 'cnc', 'machining', 'process'],
  cnc_milled: ['mill', 'machining', 'cnc', 'process'],
  sheet_metal: ['sheet metal', 'laser', 'punch', 'bend', 'sheet', 'cutting'],
};

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

function keywordScore(row: CalculatorRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  const keywords = FAMILY_CALC_KEYWORDS[family];
  const haystack = `${norm(row.name)} ${norm(row.calc_category)} ${norm(row.description)}`;
  for (const kw of keywords) {
    if (haystack.includes(kw)) return 1;
  }
  if (haystack.includes('process') || haystack.includes('cost')) return 0.5;
  return 0.2;
}

export function rankCalculators(
  rows: CalculatorRow[],
  family: Exclude<PartFamily, 'out_of_scope'>,
  topN: number,
): CalculatorCandidate[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const scored = rows.map((row) => ({
    row,
    score: keywordScore(row, family),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topN).map(({ row, score }, idx) => ({
    candidateId: `cl-${idx + 1}`,
    dbId: row.id,
    name: row.name ?? '',
    calcCategory: row.calc_category ?? '',
    description: row.description ?? null,
    score: Number(score.toFixed(3)),
  }));
}
