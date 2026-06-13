import type { PartFamily, BriefDfm } from '../dto/engineering-brief.dto';
import type { ProcessCandidate } from '../dto/candidate-set.dto';

/**
 * Scores process_catalog rows for fit against the family + DFM features.
 *
 * The process master is hierarchical (group → route → operations). For
 * this stage we flatten and rank by family-name match + DFM-feature
 * relevance (drilling ops boost when holes are present, milling ops boost
 * when pockets, T-slot/EDM when undercuts).
 */

interface ProcessRow {
  id: string;
  process_name: string | null;
  process_category: string | null;
  machine_type?: string | null;             // optional — some deployments don't have it
  description: string | null;
  standard_time_minutes?: number | string | null;
  setup_time_minutes?: number | string | null;
  cycle_time_minutes?: number | string | null;
  skill_level_required?: string | null;
}

const FAMILY_PROCESS_KEYWORDS: Record<Exclude<PartFamily, 'out_of_scope'>, string[]> = {
  cnc_turned: ['turn', 'lathe', 'face', 'thread', 'chamfer', 'parting', 'groove'],
  cnc_milled: ['mill', 'machin', 'face mill', 'pocket', 'profile', 'slot'],
  sheet_metal: ['laser', 'punch', 'bend', 'form', 'shear', 'deburr'],
};

const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().trim();

const toNumber = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function familyKeywordScore(row: ProcessRow, family: Exclude<PartFamily, 'out_of_scope'>): number {
  const keywords = FAMILY_PROCESS_KEYWORDS[family];
  const haystack = `${norm(row.process_name)} ${norm(row.process_category)} ${norm(row.machine_type)} ${norm(row.description)}`;
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score = Math.max(score, 1);
  }
  // Secondary processes useful across families
  if (haystack.includes('drill') || haystack.includes('tap') || haystack.includes('deburr')) {
    score = Math.max(score, 0.7);
  }
  if (haystack.includes('heat treat') || haystack.includes('hardening') || haystack.includes('grind')) {
    score = Math.max(score, 0.5);
  }
  return score;
}

function dfmRelevanceScore(row: ProcessRow, dfm: BriefDfm): number {
  const name = norm(row.process_name);
  let s = 0.4;
  if (dfm.holeCount > 0 && (name.includes('drill') || name.includes('tap'))) s = Math.max(s, 1);
  if (dfm.pocketCount > 0 && (name.includes('mill') || name.includes('pocket'))) s = Math.max(s, 0.95);
  if (dfm.thinWallCount > 0 && (name.includes('precision') || name.includes('finish'))) s = Math.max(s, 0.7);
  if (dfm.undercutCount > 0 && (name.includes('edm') || name.includes('t-slot') || name.includes('undercut'))) s = Math.max(s, 1);
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

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topN).map(({ row, score }, idx) => ({
    candidateId: `op-${idx + 1}`,
    dbId: row.id,
    processName: row.process_name ?? '',
    processCategory: row.process_category ?? '',
    machineType: row.machine_type ?? null,
    standardTimeMinutes: toNumber(row.standard_time_minutes) || null,
    setupTimeMinutes: toNumber(row.setup_time_minutes) || null,
    cycleTimeMinutes: toNumber(row.cycle_time_minutes) || null,
    skillLevelRequired: row.skill_level_required ?? null,
    score: Number(score.toFixed(3)),
  }));
}
