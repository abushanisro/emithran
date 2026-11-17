import type { CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type ForgingSummary = NonNullable<CostSummaryDto['forging']>;

/** A hammer's blow energy or a press's force as the Cost Guide shows it: joules under a kilojoule (a small part's blow is a few hundred J), kN to the unit. */
export function formatForming(forming: ForgingSummary['forming']): string {
  if (forming.quantity === 'force_kn') return `${Math.round(forming.value).toLocaleString('en-US')} kN`;
  return forming.value < 1000 ? `${Math.round(forming.value)} J` : `${(forming.value / 1000).toFixed(1)} kJ`;
}

/** The kind of route an option is ("Closed-die forging") and the machine it is on ("screw press"), from its label "kind · machine". */
export function splitRouteLabel(label: string): { kind: string; machine: string | null } {
  const at = label.indexOf(' · ');
  return at < 0 ? { kind: label, machine: null } : { kind: label.slice(0, at), machine: label.slice(at + 3) };
}

/**
 * A route's reason for not being a route for this part, shortened for one line of the list: the clause before the first colon, without the
 * reference data's own key in parentheses ("complexity 7 carries flash"). The full sentence stays the row's tooltip.
 */
export function shortReason(reason: string | null): string | null {
  if (!reason) return null;
  const clause = reason.split(':')[0]!.replace(/\s*\([^)]*\)/g, '').trim();
  return clause.length > 60 ? `${clause.slice(0, 57).trimEnd()}...` : clause;
}
