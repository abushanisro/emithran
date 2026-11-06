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

/**
 * A tool the engine reports as an investment and a cost per part, with no part count: the count it was amortised over is investment / per part.
 * The per-part figure is rounded to 4 decimals, so the count is exact to that rounding (a tool worth under 0.05 USD a part is not written: the
 * count would be off by more than 0.1%).
 */
function fromPerPart(key: string, toolingType: string, description: string, specifications: string, investmentUsd: number | null | undefined, perPartUsd: number | null | undefined): RouteToolingItem[] {
  if (!(investmentUsd != null && investmentUsd > 0 && perPartUsd != null && perPartUsd >= 0.05)) return [];
  return [{ key, toolingType, description, specifications, investmentUsd, amortizationParts: Math.round(investmentUsd / perPartUsd) }];
}

/**
 * The tools of the summary's route: the injection mold (every mold the job wears out, one investment), the die casting die, and the coreboxes of the
 * cores (die casting and sand casting).
 */
export function routeToolingItems(summary: Pick<CostSummaryDto, 'tooling' | 'family' | 'dieTooling' | 'coreboxTooling'>): RouteToolingItem[] {
  const items: RouteToolingItem[] = [];
  const die = summary.dieTooling;
  if (die?.ok) {
    items.push(...fromPerPart(
      'die', 'die', `Die casting die (${die.complexity})`,
      `${die.diesRequired ?? 1} die(s)${die.dieSizeMm ? `, ${die.dieSizeMm.map((v) => Math.round(v)).join(' x ')} mm` : ''}${die.shotsPerDie != null ? `; one lasts ${die.shotsPerDie.toLocaleString('en-US')} shots` : ''}.`,
      die.totalToolingUsd ?? die.dieCostUsd, die.perPartUsd,
    ));
  }
  const box = summary.coreboxTooling;
  if (box) items.push(...fromPerPart('corebox', 'die', `Corebox (${box.boxes})`, box.detail, box.costUsd, box.perPartUsd));
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
