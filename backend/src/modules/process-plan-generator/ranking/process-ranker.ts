import type { PartFamily, BriefDfm } from '../dto/engineering-brief.dto';
import type { ProcessCandidate } from '../dto/candidate-set.dto';

/**
 * Scores process_calculator_mappings rows for fit against the family + DFM.
 *
 * The mappings table IS the user's configured process hierarchy
 * (group → route → operation), so every row here is already a valid
 * selectable process. Ranking just pushes the most-relevant ones to
 * the top so the LLM prompt stays concise.
 */

interface ProcessRow {
  id: string;
  process_group: string | null;
  process_route: string | null;
  operation: string | null;
  calculator_id?: string | null;
}

// Keywords checked against the full "group route operation" haystack
const FAMILY_KEYWORDS: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned: ['turn', 'lathe', 'face', 'thread', 'chamfer', 'parting', 'groove', 'bore', 'tap', 'drill'],
  cnc_milled: ['mill', 'machin', 'pocket', 'profile', 'slot', 'contour', 'tap', 'drill'],
  sheet_metal: ['sheet', 'metal', 'laser', 'punch', 'bend', 'form', 'shear', 'cut', 'press'],
};

// Groups that are almost always relevant (assembly, finishing, inspection)
const UNIVERSAL_KEYWORDS = ['assem', 'weld', 'deburr', 'clean', 'inspect', 'pack'];

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

function familyKeywordScore(row: ProcessRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  const haystack = `${norm(row.process_group)} ${norm(row.process_route)} ${norm(row.operation)}`;
  const keywords = FAMILY_KEYWORDS[family];
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) { score = 1; break; }
  }
  if (score === 0) {
    for (const kw of UNIVERSAL_KEYWORDS) {
      if (haystack.includes(kw)) { score = 0.6; break; }
    }
  }
  if (score === 0) score = 0.3; // non-zero base — all user-configured ops are valid
  return score;
}

function dfmRelevanceScore(row: ProcessRow, dfm: BriefDfm): number {
  const op = norm(row.operation);
  let s = 0.4;
  if (dfm.holeCount > 0 && (op.includes('drill') || op.includes('tap'))) s = Math.max(s, 1);
  if (dfm.pocketCount > 0 && op.includes('mill')) s = Math.max(s, 0.95);
  if (dfm.undercutCount > 0 && (op.includes('edm') || op.includes('t-slot'))) s = Math.max(s, 1);
  return s;
}

export function rankProcesses(
  rows: ProcessRow[],
  family: Exclude<PartFamily, 'out_of_scope'>,
  dfm: BriefDfm,
  topN: number,
): ProcessCandidate[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const scored = rows.map((row) => {
    const fScore = familyKeywordScore(row, family);
    const dScore = dfmRelevanceScore(row, dfm);
    const score = 0.6 * fScore + 0.4 * dScore;
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));

  return scored.slice(0, topN).map(({ row, score }, idx) => ({
    candidateId: `op-${idx + 1}`,
    dbId: row.id,
    processGroup: row.process_group ?? '',
    processRoute: row.process_route ?? '',
    operation: row.operation ?? '',
    calculatorId: row.calculator_id ?? null,
    score: Number(score.toFixed(3)),
    referenceTables: [],
  }));
}
