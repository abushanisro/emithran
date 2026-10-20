import { distinctRates, rateVersion, type RateBook, type RateEntry } from '../rates/rate-book';
import { routeGraph } from '../routing/route';

import type { PhysicsGap, ProcessLineCost } from '../../../bom-items/dto/cost-breakdown.dto';
import type { ElectronicsEngine, ElectronicsGraph } from '../engines/engine.types';

// Bump when the shape of ElectronicsQuoteResult changes. Stored with every result.
export const QUOTE_RESULT_VERSION = '1.1' as const;

export interface ElectronicsQuoteResult {
  resultVersion: typeof QUOTE_RESULT_VERSION;
  featureGraphContractVersion: ElectronicsGraph['contractVersion'];
  graphKind: ElectronicsGraph['kind'];
  inputTier: ElectronicsGraph['inputTier'];
  // needs_review means a person has not confirmed the graph these lines were routed from.
  graphReviewStatus: ElectronicsGraph['reviewStatus'];
  batchSize: number;
  lines: ProcessLineCost[];
  gaps: PhysicsGap[];
  // The exact rate records the lines were computed from, and one hash of them.
  ratesUsed: RateEntry[];
  rateVersion: string;
  // null whenever any applicable engine reported a gap: a partial sum is never
  // presented as the assembly cost.
  assemblyCostPerUnit: number | null;
  complete: boolean;
}

export function buildQuote(
  graph: ElectronicsGraph,
  registry: readonly ElectronicsEngine<any>[],
  batchSize: number,
  rates: RateBook,
): ElectronicsQuoteResult {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError(`batchSize must be a positive integer, got ${batchSize}`);
  }
  const lines: ProcessLineCost[] = [];
  const gaps: PhysicsGap[] = [];
  const used: RateEntry[][] = [];
  for (const { engine, input } of routeGraph(graph, registry)) {
    const result = engine.computeCost({ graph, input, batchSize, rates });
    if (result.status === 'costed') {
      lines.push(result.line);
      used.push(result.ratesUsed);
    } else {
      gaps.push(result.gap);
    }
  }
  const complete = gaps.length === 0 && lines.length > 0;
  return {
    resultVersion: QUOTE_RESULT_VERSION,
    featureGraphContractVersion: graph.contractVersion,
    graphKind: graph.kind,
    inputTier: graph.inputTier,
    graphReviewStatus: graph.reviewStatus,
    batchSize,
    lines,
    gaps,
    ratesUsed: distinctRates(used),
    rateVersion: rateVersion(used.flat()),
    assemblyCostPerUnit: complete ? lines.reduce((sum, l) => sum + l.totalCost, 0) : null,
    complete,
  };
}
