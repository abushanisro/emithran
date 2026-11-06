// The tooling a priced route needs, as the tooling items the Cost Guide lists: pure, from the engine's own cost summary. The record is a snapshot of
// what the engine already computed (the mold's cost and its amortisation over the job); nothing is priced here.
import type { CostSummaryDto } from '../../dto/cost-breakdown.dto';

/** Marks a tooling record as written by an apply: the apply replaces these and never touches one the user added. */
export const ROUTE_TOOLING_NOTE_PREFIX = 'auto_fill_from_scenario:';

export interface RouteToolingItem {
  /** Stable per kind of tool, so a re-apply finds and replaces the same record. */
  key: string;
  toolingType: string;
  description: string;
  specifications: string;
  /** The whole investment, USD. */
  investmentUsd: number;
  /** Parts the investment is spread over: annual volume x production life. */
  amortizationParts: number;
}

/** The tools of the summary's route. Plastic molding: the mold (every mold the job wears out, one investment). */
export function routeToolingItems(summary: Pick<CostSummaryDto, 'tooling' | 'family'>): RouteToolingItem[] {
  const items: RouteToolingItem[] = [];
  const t = summary.tooling;
  if (t && t.moldCostUsd > 0) {
    const parts = Math.round(t.annualVolume * t.productionLifeYears);
    if (parts >= 1) {
      items.push({
        key: 'mold',
        toolingType: 'die',
        description: `Injection mold (SPI ${t.moldClass})`,
        specifications: `${t.moldsRequired ?? 1} mold(s); one lasts ${(t.moldToolLifeShots ?? 0).toLocaleString('en-US')} shots. Components ${(t.moldBomSubtotalUsd ?? 0).toFixed(2)} USD plus toolroom labour; excludes mold-base steel (no price table on file).`,
        investmentUsd: t.moldCostUsd,
        amortizationParts: parts,
      });
    }
  }
  return items;
}
