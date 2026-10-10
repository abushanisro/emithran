import { expandSearchTermSpellingVariants } from './material-search-spelling';
import { shapeRankForFamily } from './constants/material-shape-ranking';

// Deterministic, explainable relevance ranking for raw_materials search and
// for the costing resolver's loose-grade fallback.
//
// Root cause this exists to close (confirmed live, 2026-09-19; migration 600's
// own header describes the same defect for "AISI 304"): a loose grade string
// such as "6061" matched several real rows (2700 kg/m3 base grade, 2770 kg/m3
// "(LD30)" variant), the DB query had no ORDER BY and a .limit(), and the only
// tiebreak was stock-form rank -- so which row's density/cost priced the part
// depended on incidental Postgres row order, with no disclosure. Patching one
// alias at a time (migration 600) cannot fix the class.
//
// Industry-standard practice for material lookup, applied here:
//   1. Match on the DESIGNATION as a whole token, never a raw substring
//      ("6061" must not match "16061"; "304" matches "304" and "304L").
//   2. Tier the evidence: exact identity > registered alias > designation >
//      cross-standard (ASTM/DIN/EN/JIS) > typed prefix > descriptive text.
//   3. Prefer the base designation over suffix variants (specificity), then
//      the stock form suited to the part family, then rows with real
//      cost/density, then a stable name order -- every step deterministic.
//   4. When the query is genuinely under-specified (a bare family like
//      "ALUMINUM", or two equally specific grades with different physical
//      properties) DO NOT guess: report the ambiguity. A wrong density is
//      worse than an honest "pick a grade".
//
// Pure module: no DB, no framework -- unit-tested with real rows.

export interface RankableMaterial {
  id?: string;
  material?: string | null;
  materialGrade?: string | null;
  materialGroup?: string | null;
  materialDescription?: string | null;
  astmStandard?: string | null;
  dinStandard?: string | null;
  enStandard?: string | null;
  jisStandard?: string | null;
  shape?: string | null;
  densityKgM3?: number | null;
  hasCost?: boolean;
}

type MaterialMatchTier =
  | 'exact'
  | 'alias'
  | 'designation'
  | 'standard'
  | 'partial'
  | 'descriptive';

export interface RankedMaterial<T extends RankableMaterial> {
  row: T;
  score: number;
  tier: MaterialMatchTier;
  /** Human-readable evidence, e.g. `designation "6061" in "Generic Aluminum, ANSI 6061"`. */
  reason: string;
  shapeRank: number;
}

// Tier base scores. A candidate's specificity bonus (0-99) is added within a
// tier, so it can reorder rows inside a tier but never lift one across tiers.
const TIER_BASE: Record<MaterialMatchTier, number> = {
  exact: 1000,
  alias: 900,
  designation: 700,
  standard: 600,
  partial: 400,
  descriptive: 100,
};
const PARTIAL_HALF_BASE = 250;

// Words that carry no identity ("Generic Aluminum, ANSI 6061" is the same
// alloy as "Aluminum, ANSI 6061"); ignored when counting how specific a
// candidate name is.
const FILLER_TOKENS = new Set(['generic']);

// Splits on non-alphanumerics AND letter/digit boundaries so "AA6061",
// "6061-T6" and "12L13" tokenize consistently on both the query and the
// candidate side.
export function designationTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizeDesignation(text: string | null | undefined): string {
  return (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Escapes LIKE/ILIKE metacharacters so a grade like "6061_T6" matches literally. */
export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type TokenMatch = { matched: number; whole: number; total: number };

// The query is counted in WORDS ("IS2062" is one word even though it tokenizes
// to "is"+"2062"), so a compound drawing string like "IS2062 E250 CRCA" is 3
// words and "half the words present" means what an engineer expects. A word
// matches a field only when ALL of its tokens do.
function matchWords(queryWords: string[][], fieldTokens: string[]): TokenMatch {
  const set = new Set(fieldTokens);
  let matched = 0;
  let whole = 0;
  for (const word of queryWords) {
    const wholeAll = word.every((t) => set.has(t));
    const prefixAll = word.every(
      (t) => set.has(t) || (t.length >= 3 && fieldTokens.some((f) => f.startsWith(t))),
    );
    if (wholeAll) whole++;
    if (prefixAll) matched++;
  }
  return { matched, whole, total: queryWords.length };
}

function queryWordsOf(variant: string): string[][] {
  return variant
    .split(/[\s,\-\/()]+/)
    .map((w) => meaningful(designationTokens(w)).filter((t) => t.length >= 2))
    .filter((tokens) => tokens.length > 0);
}

function meaningful(tokens: string[]): string[] {
  return tokens.filter((t) => !FILLER_TOKENS.has(t));
}

interface Scored { score: number; tier: MaterialMatchTier; reason: string }

function scoreAgainstVariant(variant: string, row: RankableMaterial): Scored | null {
  const qWords = queryWordsOf(variant);
  const qNorm = normalizeDesignation(variant);
  if (!qNorm) return null;

  const identity: Array<[string, string]> = [];
  if (row.material) identity.push(['material', row.material]);
  if (row.materialGrade) identity.push(['grade', row.materialGrade]);

  // 1. Exact identity (ignoring case, punctuation and a leading "Generic ").
  for (const [, text] of identity) {
    const stripped = text.replace(/^generic\s+/i, '');
    if (normalizeDesignation(text) === qNorm || normalizeDesignation(stripped) === qNorm) {
      return { score: TIER_BASE.exact, tier: 'exact', reason: `exact name "${text}"` };
    }
  }
  if (qWords.length === 0) return null;

  // A specificity bonus only makes sense when the query names a designation
  // (contains a digit). For a bare family word ("aluminum") every candidate is
  // equally relevant -- rewarding the shortest name would fabricate a winner.
  const namesDesignation = qWords.some((w) => w.some((t) => /\d/.test(t)));
  const bonus = (candidateTokenCount: number, matched: number) =>
    namesDesignation ? Math.round((99 * matched) / Math.max(candidateTokenCount, matched, 1)) : 0;

  let best: Scored | null = null;
  const consider = (s: Scored) => { if (!best || s.score > best.score) best = s; };

  for (const [field, text] of identity) {
    const fTokens = meaningful(designationTokens(text));
    const m = matchWords(qWords, fTokens);
    if (m.matched === 0) continue;
    if (m.whole === m.total) {
      consider({
        score: TIER_BASE.designation + bonus(fTokens.length, m.total),
        tier: 'designation',
        reason: `designation "${variant.trim()}" in ${field} "${text}"`,
      });
    } else if (m.matched === m.total) {
      consider({
        score: TIER_BASE.partial + bonus(fTokens.length, m.total),
        tier: 'partial',
        reason: `"${variant.trim()}" starts words in ${field} "${text}"`,
      });
    } else if (m.matched >= Math.max(1, Math.floor(m.total / 2))) {
      // Compound drawing strings ("IS2062 E250 CRCA") where only some tokens
      // exist in any single row -- kept as a low-confidence tier, ranked by
      // how much of the query it covers.
      consider({
        score: PARTIAL_HALF_BASE + Math.round((99 * m.matched) / m.total),
        tier: 'partial',
        reason: `${m.matched}/${m.total} words of "${variant.trim()}" in ${field} "${text}"`,
      });
    }
  }

  // Cross-standard designations (ASTM / DIN / EN / JIS columns): "EN AW-6061",
  // "C 45 E", "SUS304" style queries that are not part of the material name.
  const standards: Array<[string, string | null | undefined]> = [
    ['ASTM', row.astmStandard], ['DIN', row.dinStandard],
    ['EN', row.enStandard], ['JIS', row.jisStandard],
  ];
  for (const [label, text] of standards) {
    if (!text) continue;
    const fTokens = designationTokens(text);
    const m = matchWords(qWords, fTokens);
    if (m.total > 0 && m.whole === m.total) {
      consider({
        score: TIER_BASE.standard + bonus(fTokens.length, m.total),
        tier: 'standard',
        reason: `${label} standard "${text}"`,
      });
    }
  }

  if (!best) {
    const desc = designationTokens(`${row.materialGroup ?? ''} ${row.materialDescription ?? ''}`);
    const m = matchWords(qWords, desc);
    if (m.total > 0 && m.matched === m.total) {
      consider({ score: TIER_BASE.descriptive, tier: 'descriptive', reason: 'group/description text' });
    }
  }
  return best;
}

interface RankOptions {
  /** Part family (milled, sheet_metal, ...) -- prefers suitable stock forms. */
  family?: string;
  /** Row ids known to be registered aliases of the query (tier 'alias'). */
  aliasRowIds?: ReadonlySet<string>;
}

/**
 * Ranks `rows` against a free-text `query`, most relevant first. Rows with no
 * evidence of matching are dropped. Ordering is fully deterministic:
 * score, then real cost, then stock-form fit for the family, then real
 * density, then name, then id.
 */
export function rankMaterialMatches<T extends RankableMaterial>(
  query: string,
  rows: readonly T[],
  opts: RankOptions = {},
): RankedMaterial<T>[] {
  const variants = expandSearchTermSpellingVariants(query.trim()).filter(Boolean);
  const ranked: RankedMaterial<T>[] = [];

  for (const row of rows) {
    let best: Scored | null = null;
    if (row.id && opts.aliasRowIds?.has(row.id)) {
      best = { score: TIER_BASE.alias, tier: 'alias', reason: 'registered alias' };
    }
    for (const v of variants) {
      const s = scoreAgainstVariant(v, row);
      if (s && (!best || s.score > best.score)) best = s;
    }
    if (!best) continue;
    ranked.push({
      row,
      score: best.score,
      tier: best.tier,
      reason: best.reason,
      shapeRank: opts.family ? shapeRankForFamily(row.shape, opts.family) : 0,
    });
  }

  // A costed row outranks an uncosted one BEFORE stock form is considered --
  // the costing resolver has always preferred a row it can actually price, and
  // an uncosted row is only a last resort (density-only, pending review).
  ranked.sort((a, b) =>
    b.score - a.score
    || Number(!!b.row.hasCost) - Number(!!a.row.hasCost)
    || a.shapeRank - b.shapeRank
    || Number(b.row.densityKgM3 != null) - Number(a.row.densityKgM3 != null)
    || (a.row.material ?? '').localeCompare(b.row.material ?? '')
    || (a.row.id ?? '').localeCompare(b.row.id ?? ''),
  );
  return ranked;
}

interface BestPick<T extends RankableMaterial> {
  best: RankedMaterial<T> | null;
  /** Equally-ranked candidates whose density differs materially -- why no pick was made. */
  ambiguous: RankedMaterial<T>[];
  /** Same-tier rows NOT chosen that differ materially from the pick -- disclosed, not hidden. */
  divergentAlternatives: RankedMaterial<T>[];
}

const DENSITY_TOLERANCE = 0.01;

function densitiesDiverge(a?: number | null, b?: number | null): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) > DENSITY_TOLERANCE;
}

/**
 * Chooses the single best row, or declines to. Declines (best = null) when the
 * top-ranked candidates are exactly tied AND differ in density, because then
 * nothing in the query distinguishes a 2700 kg/m3 material from a 2900 kg/m3
 * one and any pick would silently mis-weight the part.
 */
export function pickUnambiguousBest<T extends RankableMaterial>(
  ranked: readonly RankedMaterial<T>[],
): BestPick<T> {
  if (ranked.length === 0) return { best: null, ambiguous: [], divergentAlternatives: [] };
  const top = ranked[0];
  const tied = ranked.filter(
    (r) => r.score === top.score
      && r.shapeRank === top.shapeRank
      && !!r.row.hasCost === !!top.row.hasCost,
  );
  if (tied.some((r) => densitiesDiverge(r.row.densityKgM3, top.row.densityKgM3))) {
    return { best: null, ambiguous: tied, divergentAlternatives: [] };
  }
  const divergentAlternatives = ranked
    .slice(1)
    .filter((r) => r.tier === top.tier && densitiesDiverge(r.row.densityKgM3, top.row.densityKgM3))
    .slice(0, 5);
  return { best: top, ambiguous: [], divergentAlternatives };
}

interface OrderedByRelevance<T> {
  item: T;
  tier: MaterialMatchTier | 'substring';
  reason: string;
  /**
   * True for exactly one row: the unambiguous best match (see
   * pickUnambiguousBest). False for everything else -- including EVERY row
   * when the query is ambiguous -- so a caller that must auto-select one grade
   * can use this flag instead of re-implementing the ambiguity rule.
   */
  isBest: boolean;
}

/**
 * Orders search results by relevance WITHOUT ever dropping a result: rows the
 * database matched by raw substring but the ranker scored as no evidence
 * (e.g. "ium" inside "Aluminum") are kept, after every ranked row, in their
 * incoming order. Ranking may reorder a result list; it must never shrink it.
 */
export function orderByRelevance<T>(
  query: string,
  items: readonly T[],
  toRankable: (item: T) => RankableMaterial,
  opts: RankOptions = {},
): OrderedByRelevance<T>[] {
  const wrapped = items.map((item) => ({ ...toRankable(item), __item: item }));
  const ranked = rankMaterialMatches(query, wrapped, opts);
  const best = pickUnambiguousBest(ranked).best;
  const seen = new Set<T>();
  const out: OrderedByRelevance<T>[] = [];
  for (const r of ranked) {
    seen.add(r.row.__item);
    out.push({ item: r.row.__item, tier: r.tier, reason: r.reason, isBest: r === best });
  }
  for (const item of items) {
    if (!seen.has(item)) out.push({ item, tier: 'substring', reason: 'text contains search term', isBest: false });
  }
  return out;
}

/** Adapts a raw `raw_materials` DB row (snake_case) to what the ranker scores. */
export function rankableFromDbRow(row: Record<string, unknown>): RankableMaterial {
  const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? parseFloat(v) : (v as number | null | undefined);
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const densityG = num(row.density);
  const cost = [row.cost, row.cost_india, row.cost_usa].map(num).some((c) => c != null && c > 0);
  return {
    id: row.id as string,
    material: (row.grade as string | null) ?? null,
    materialGrade: (row.name as string | null) ?? null,
    materialGroup: (row.material_group as string | null) ?? null,
    materialDescription: (row.material_description as string | null) ?? null,
    astmStandard: (row.astm_standard as string | null) ?? null,
    dinStandard: (row.din_standard as string | null) ?? null,
    enStandard: (row.en_standard as string | null) ?? null,
    jisStandard: (row.jis_standard as string | null) ?? null,
    shape: (row.shape as string | null) ?? null,
    densityKgM3: num(row.density_kg_m3) ?? (densityG != null ? densityG * 1000 : null),
    hasCost: cost,
  };
}
