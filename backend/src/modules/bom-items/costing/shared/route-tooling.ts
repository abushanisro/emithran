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
 * A tool the engine reports as an investment and a cost per part. When the engine also reports the part count it amortised over, that count is
 * written. Otherwise the count is investment / per part: the per-part figure is rounded to 4 decimals, so the count is exact to that rounding (a
 * tool worth under 0.05 USD a part is not written: the count would be off by more than 0.1%).
 */
function fromPerPart(
  key: string, toolingType: string, description: string, specifications: string,
  investmentUsd: number | null | undefined, perPartUsd: number | null | undefined, parts?: number | null,
): RouteToolingItem[] {
  if (!(investmentUsd != null && investmentUsd > 0)) return [];
  if (parts != null && parts >= 1) return [{ key, toolingType, description, specifications, investmentUsd, amortizationParts: Math.round(parts) }];
  if (!(perPartUsd != null && perPartUsd >= 0.05)) return [];
  return [{ key, toolingType, description, specifications, investmentUsd, amortizationParts: Math.round(investmentUsd / perPartUsd) }];
}

/**
 * The tools of the summary's route: the injection mold (every mold the job wears out, one investment), the die casting die, the coreboxes of the
 * cores (die casting and sand casting), and the wax pattern die of an investment casting.
 */
export function routeToolingItems(summary: Pick<CostSummaryDto, 'tooling' | 'family' | 'dieTooling' | 'coreboxTooling' | 'patternTooling' | 'forgingDies' | 'firstArticleInspection' | 'barTubeTooling' | 'rotoBlowTooling' | 'hydroformingTooling'>): RouteToolingItem[] {
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
  const pattern = summary.patternTooling;
  if (pattern) items.push(...fromPerPart('wax-pattern-die', 'die', `Wax pattern die (${pattern.tools})`, pattern.detail, pattern.costUsd, pattern.perPartUsd));
  const dies = summary.forgingDies;
  if (dies) items.push(...fromPerPart('forging-dies', 'die', `Forging dies (${dies.sets} set${dies.sets === 1 ? '' : 's'})`, dies.detail, dies.costUsd, dies.perPartUsd));
  for (const t of summary.barTubeTooling ?? []) items.push(...fromPerPart(`bar-tube-${t.key}`, 'die', t.description, t.detail, t.costUsd, t.perPartUsd));
  for (const t of summary.rotoBlowTooling ?? []) items.push(...fromPerPart(`roto-blow-${t.key}`, 'mold', t.description, t.detail, t.costUsd, t.perPartUsd));
  // The hydroform tools the job wears out (its costUsd is that whole investment, over the parts the engine spread it); the blanking die, not
  // costed, is not written.
  for (const t of summary.hydroformingTooling ?? []) {
    items.push(...fromPerPart(`hydroforming-${t.key}`, 'die', t.description, t.detail, t.costUsd, t.perPartUsd, t.amortizationParts));
  }
  const fai = summary.firstArticleInspection;
  if (fai) items.push(...fromPerPart('first-article-inspection', 'inspection', 'First article inspection (CMM)', fai.detail, fai.costUsd, fai.perPartUsd));
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
