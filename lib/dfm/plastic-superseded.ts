import type { PlasticDfmView } from '@/lib/api/hooks/useBOMItems';

// The fixed-threshold plastic warnings and checks the rule-based engine replaced (backend plastic-molding/dfm/plastic-dfm.ts): draft (0.3 degrees), thin zones (60 % of
// nominal), the nominal wall range (1.0 to 6.0 mm), and the "no critical issues" card. The analysis no longer writes them, but an analysis stored before that still holds
// them: they are not shown, and not counted in the readiness or the risk flags, so one part is never judged by two rule sets.
const SUPERSEDED_WARNING_PREFIXES = ['dfm_im_draft_', 'dfm_im_thin_wall_', 'dfm_im_wall_min_', 'dfm_im_wall_max_', 'dfm_im_pass_'] as const;
const SUPERSEDED_CHECK_IDS = ['check_im_draft', 'check_im_wall_range', 'check_im_thin_zones'] as const;

export const isSupersededPlasticWarning = (w: { id: string }): boolean => SUPERSEDED_WARNING_PREFIXES.some((p) => w.id.startsWith(p));
export const isSupersededPlasticCheck = (c: { id: string }): boolean => (SUPERSEDED_CHECK_IDS as readonly string[]).includes(c.id);

/**
 * What the rule-based result says about readiness: a critical finding blocks as a critical warning did, and the critical and major findings are the part's risk flags.
 * Nothing before the result is loaded (a flag is never invented while waiting).
 */
export function plasticDfmReadiness(view: PlasticDfmView | undefined): { critical: boolean; flags: string[] } {
  const findings = view?.status === 'ok' ? view.result?.findings ?? [] : [];
  return {
    critical: findings.some((f) => f.severity === 'Critical'),
    flags: findings.filter((f) => f.severity === 'Critical' || f.severity === 'Major').map((f) => f.label),
  };
}
