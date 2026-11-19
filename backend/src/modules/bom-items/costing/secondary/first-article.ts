// The first article inspection as the cost summary carries it (formula registry F-39): a one-off per part number on the CMM, kept out of the piece
// cost like the tooling and spread over the job only for display. Pure.
import type { CostSummaryDto } from '../../dto/cost-breakdown.dto';
import { FIRST_ARTICLE_PARTS, type SecondaryProcessResult } from './secondary-process-engine';

export function firstArticleSummary(
  fai: Pick<SecondaryProcessResult, 'status' | 'reason' | 'costPerPartUsd' | 'machine' | 'trace'>,
  annualVolume: number | null,
  productionLifeYears: number,
): NonNullable<CostSummaryDto['firstArticleInspection']> {
  const costUsd = fai.status === 'costed' ? fai.costPerPartUsd : null;
  const parts = annualVolume != null && annualVolume > 0 && productionLifeYears > 0 ? annualVolume * productionLifeYears : null;
  const touches = fai.trace.find((t) => t.label === 'Probe touches per part')?.value;
  return {
    costUsd,
    perPartUsd: costUsd != null && parts != null ? Number((costUsd / parts).toFixed(4)) : null,
    detail: costUsd != null
      ? `${typeof touches === 'number' ? `${touches} probe touches: ` : ''}the CMM program written once and ${FIRST_ARTICLE_PARTS} first-run parts measured in full, with the CMM setup.`
      : `Not priced: ${fai.reason}`,
    machineName: fai.machine?.name ?? null,
  };
}
