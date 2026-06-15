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
  fields?: Array<{ field_name: string; data_source: string | null; source_field: string | null; default_value: string | null }>;
  formulas?: Array<{ formula_name: string | null; formula_expression: string; execution_order: number; is_primary_result: boolean }>;
}

const FAMILY_CALC_KEYWORDS: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned: ['turn', 'lathe', 'cnc', 'machining', 'process', 'drill', 'tap'],
  cnc_milled: ['mill', 'machining', 'cnc', 'process', 'thread mill', 'drill', 'tap'],
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

  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));

  return scored.slice(0, topN).map(({ row, score }, idx) => ({
    candidateId: `cl-${idx + 1}`,
    dbId: row.id,
    name: row.name ?? '',
    calcCategory: row.calc_category ?? '',
    description: row.description ?? null,
    score: Number(score.toFixed(3)),
    fields: (row.fields ?? []).map((f) => ({
      fieldName: f.field_name,
      dataSource: f.data_source ?? null,
      sourceField: f.source_field ?? null,
      defaultValue: f.default_value ?? null,
    })),
    formulas: (row.formulas ?? [])
      .sort((a: any, b: any) => (a.execution_order ?? 0) - (b.execution_order ?? 0))
      .map((f) => ({
        formulaName: f.formula_name ?? null,
        formulaExpression: f.formula_expression,
        executionOrder: f.execution_order ?? 0,
        isPrimaryResult: !!f.is_primary_result,
      })),
  }));
}
