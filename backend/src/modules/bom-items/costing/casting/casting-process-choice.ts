// A part whose Process is the generic "Casting" is priced by every casting process (die, sand, investment) and quoted on the cheapest one that
// is fully costed: the piece cost plus the tooling its route needs, per part. Pure: the caller prices each family with its own engine.
import type { CostSummaryDto } from '../../dto/cost-breakdown.dto';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';
import { CAD_FAMILY_TO_PROCESS_GROUP } from '../shared/core/part-family-process-group';

export interface CastingFamilyOption {
  family: string;
  /** The process as the Process field names it (Die Casting, Sand Casting, Casting Investment). */
  process: string;
  /** Every step is costed and, for die casting, a die-casting process is feasible. */
  costed: boolean;
  /** Piece cost + tooling per part, in the summary's currency; null when not costed. */
  total: number | null;
  /** Why it is not costed: its first uncosted step, or the die-casting engine's own reason. */
  detail: string | null;
}

type Priced = Pick<CostSummaryDto, 'processLines' | 'totalCost' | 'dieCastingProcess' | 'dieTooling' | 'coreboxTooling' | 'patternTooling' | 'usdToDisplayRate'
  | 'scenarioReady' | 'missingInputs'> & Partial<Pick<CostSummaryDto, 'warnings'>>;

/** One family's summary as an option: its tools (USD on the summary) are added per part in the summary's currency. */
export function castingFamilyOption(family: string, summary: Priced): CastingFamilyOption {
  const process = CAD_FAMILY_TO_PROCESS_GROUP[family] ?? family;
  const gap = findRouteDataGaps(summary.processLines)[0];
  const die = summary.dieCastingProcess;
  const infeasible = die?.chosenBy === 'none_feasible' ? die.options.map((o) => `${o.process}: ${o.detail}`).join('; ') : null;
  // A summary that priced nothing says which input it lacks (the material grade), not "no step was costed".
  const detail = unpricedReason(summary) ?? infeasible ?? (gap ? `${gap.process}: ${gap.reason}` : summary.processLines.length === 0 ? 'no step was costed' : null);
  if (detail) return { family, process, costed: false, total: null, detail };
  const toolingUsd = (summary.dieTooling?.perPartUsd ?? 0) + (summary.coreboxTooling?.perPartUsd ?? 0) + (summary.patternTooling?.perPartUsd ?? 0);
  return { family, process, costed: true, total: summary.totalCost + toolingUsd * (summary.usdToDisplayRate ?? 1), detail: null };
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * The family to quote: the cheapest costed one (the first on a tie, in the order given); with none costed, the first, so the summary shows what
 * its engine lacks. The note says how it was chosen and what each of the others came to, or why it could not be costed.
 */
export function chooseCastingFamily(options: readonly CastingFamilyOption[]): { chosen: CastingFamilyOption; note: string } {
  const costed = options.filter((o) => o.costed);
  // "Could not be priced", not "not costed": the Part Summary counts a warning that says "not costed" as an operation of this route that failed.
  const said = (o: CastingFamilyOption) => (o.costed ? `${o.process} ${money(o.total!)}` : `${o.process} could not be priced (${o.detail})`);
  if (costed.length === 0) {
    return { chosen: options[0]!, note: `Casting: no casting process could be fully costed for this part. ${options.map(said).join('; ')}.` };
  }
  const chosen = costed.reduce((best, o) => (o.total! < best.total! ? o : best));
  const others = options.filter((o) => o !== chosen);
  return {
    chosen,
    note: `Casting: ${chosen.process} is quoted, the cheapest casting process that is fully costed (piece cost + tooling per part, ${money(chosen.total!)}).${others.length ? ` ${others.map(said).join('; ')}.` : ''}`,
  };
}
