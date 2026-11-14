import type { BlankSpecDto } from '@/lib/api/hooks/useBOMItems';

// The material record's usage is derived by the backend (costing/shared/material-usage.ts) when a scenario is applied. The web app only needs to
// know whether a blank is a real machining stock, to show where the record's Gross Usage came from.

const STOCK_DRIVEN_FORMS: readonly BlankSpecDto['form'][] = ['round_bar', 'hex_bar', 'rectangular_bar', 'billet', 'extrusion'];

/**
 * True when `blankSpec` describes a real, density-resolved machining stock whose weight drives Gross Usage: both weights real and the stock at least
 * as heavy as the part (a blank lighter than the part it is cut from is inconsistent geometry or units, and is not trusted).
 */
export function isStockDrivenBlank(
  blankSpec: Pick<BlankSpecDto, 'form' | 'grossWeightKg' | 'netWeightKg'> | null | undefined,
): boolean {
  if (!blankSpec || !STOCK_DRIVEN_FORMS.includes(blankSpec.form)) return false;
  return blankSpec.grossWeightKg > 0 && blankSpec.netWeightKg > 0 && blankSpec.grossWeightKg >= blankSpec.netWeightKg;
}
