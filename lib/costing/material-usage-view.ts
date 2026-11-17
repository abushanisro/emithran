import type { MaterialUsageExplanation, MaterialUsageSource } from '@/lib/api/hooks/useMaterialUsage';

/** Where the engine's usage comes from, in the words the dialog shows. */
export const USAGE_SOURCE_LABEL: Record<MaterialUsageSource, string> = {
  sheet_nesting: 'Sheet nesting',
  stock_blank: 'Machining stock',
  casting_charge: 'Casting metal',
  molding_allowance: 'Molding shot',
  scrap_allowance_fallback: 'Estimate: no stock, nest or charge yet',
  none: 'Not derived',
};

/** A stored figure differs from the engine's when it is off by more than 1 % (the same tolerance Apply uses to call a record stale). */
const differs = (stored: number, live: number) => live > 0 && Math.abs(stored - live) / live > 0.01;

export interface UsageDrift { field: 'Net usage' | 'Gross usage'; recorded: number; calculated: number }

/**
 * Which of the dialog's usage fields disagree with the engine's current figures. Empty when the engine derived nothing (there is nothing to compare
 * with) and when a field is still empty (it is about to be filled, not out of date).
 */
export function usageDrift(usage: MaterialUsageExplanation | undefined, fields: { net: number | ''; gross: number | '' }): UsageDrift[] {
  if (!usage || usage.source === 'none') return [];
  const out: UsageDrift[] = [];
  if (typeof fields.net === 'number' && fields.net > 0 && differs(fields.net, usage.netUsage)) out.push({ field: 'Net usage', recorded: fields.net, calculated: usage.netUsage });
  if (typeof fields.gross === 'number' && fields.gross > 0 && differs(fields.gross, usage.grossUsage)) out.push({ field: 'Gross usage', recorded: fields.gross, calculated: usage.grossUsage });
  return out;
}

/** A weight in kg as the dialog prints it: enough digits for a part of a few grams, no trailing zeros. */
export function formatKg(kg: number): string {
  return String(parseFloat(kg.toFixed(kg < 1 ? 4 : 3)));
}
