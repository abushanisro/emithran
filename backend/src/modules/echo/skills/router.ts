import type { SkillId } from '../prompts/skills';

/**
 * Maps a Next.js pathname to one of the Echo expert Skills.
 *
 * Order matters: more specific patterns must come before broader ones. The
 * first match wins. Falls through to `universal` if nothing matches — Echo
 * still works on Settings, Dashboard, etc., it just doesn't have an entity to
 * reason about.
 *
 * The matcher is intentionally regex-based on the route prefix rather than a
 * Next.js routing tree walk. This keeps the router stateless, testable, and
 * cheap to invoke per turn.
 */
type SkillRule = {
  skill: SkillId;
  /** Pattern. Match is case-insensitive. `[id]` style segments are matched as `[^/]+`. */
  test: RegExp;
};

const RULES: SkillRule[] = [
  // ── Project sub-routes (specific first) ────────────────────────────────
  { skill: 'bom',         test: /^\/projects\/[^/]+\/bom(\/|$)/i },
  { skill: 'processDfm',  test: /^\/projects\/[^/]+\/process-planning(\/|$)/i },
  { skill: 'production',  test: /^\/projects\/[^/]+\/production-planning(\/|$)/i },
  { skill: 'qa',          test: /^\/projects\/[^/]+\/quality-control(\/|$)/i },
  { skill: 'supplier',    test: /^\/projects\/[^/]+\/supplier-(nomination|evaluation)(\/|$)/i },
  { skill: 'rfq',         test: /^\/projects\/[^/]+\/rfq(\/|$)/i },
  { skill: 'project',     test: /^\/projects\/[^/]+\/?$/i },

  // ── Top-level feature routes ───────────────────────────────────────────
  { skill: 'bom',         test: /^\/bom(\/|$)/i },
  { skill: 'processDfm',  test: /^\/process(-planning)?(\/|$)/i },
  { skill: 'production',  test: /^\/production-planning(\/|$)/i },
  { skill: 'supplier',    test: /^\/(supplier-evaluation|vendors)(\/|$)/i },
  { skill: 'costing',     test: /^\/(raw-materials|hr-rates|mhr-database|calculators)(\/|$)/i },
  { skill: 'vave',        test: /^\/vave(\/|$)/i },
  { skill: 'benchmark',   test: /^\/benchmarks?(\/|$)/i },
];

export interface SkillSelection {
  skill: SkillId;
  matchedPattern: string | null;
}

export function selectSkill(route: string | undefined | null): SkillSelection {
  if (!route || typeof route !== 'string') {
    return { skill: 'universal', matchedPattern: null };
  }
  // Normalise: strip query string + trailing slash (preserve root "/")
  const clean = route.split('?')[0].replace(/\/+$/, '') || '/';
  for (const rule of RULES) {
    if (rule.test.test(clean)) {
      return { skill: rule.skill, matchedPattern: rule.test.source };
    }
  }
  return { skill: 'universal', matchedPattern: null };
}

/**
 * Which tools each Skill may call. Used as an allow-list before sending the
 * tool catalog to Claude — a Universal skill cannot call entity tools, an
 * RFQ skill should not be calling DFM tools, etc.
 */
export const SKILL_TOOLS: Record<SkillId, readonly string[]> = {
  universal: [],
  project: [
    'get_part_cost_breakdown',
    'get_rfq_status',
    'get_production_lot_status',
    'get_vave_ideas',
  ],
  bom: [
    'get_part_cost_breakdown',
    'get_dfm_review',
    'get_drawing_analysis',
    'compare_cost_to_benchmark',
  ],
  processDfm: [
    'get_dfm_review',
    'get_drawing_analysis',
    'run_dfm_deep_analysis',
    'get_process_candidates',
    'get_part_cost_breakdown',
    'find_suppliers_with_capability',
  ],
  supplier: [
    'rank_suppliers_for_part',
    'find_suppliers_with_capability',
    'compare_cost_to_benchmark',
    'get_part_cost_breakdown',
  ],
  rfq: ['get_rfq_status', 'rank_suppliers_for_part'],
  production: ['get_production_lot_status'],
  qa: [],
  costing: ['get_part_cost_breakdown', 'compare_cost_to_benchmark'],
  vave: ['get_vave_ideas', 'get_part_cost_breakdown'],
  benchmark: ['compare_cost_to_benchmark', 'find_suppliers_with_capability'],
};
