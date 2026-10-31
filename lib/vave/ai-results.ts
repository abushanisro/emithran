/**
 * Validation of the VAVE AI answers (should-cost, cost analysis, ideation).
 *
 * Each function either returns the model's answer or throws an AiResultError;
 * it never fills a gap with a ratio, a default rating or an empty list, so a
 * bad or missing answer reaches the user as an error rather than as data.
 */

import type {
  AffinityGroup,
  CreateVaveIdea,
  QFDMatrix,
  ShouldCostResult,
  VaveBomItem,
} from '@/lib/api/vave';

export class AiResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiResultError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite, non-negative number, else null. */
const amount = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

export const SHOULD_COST_SOURCE = 'AI estimate (Claude), not a bottom-up cost model';

export function shouldCostFromAi(
  part: Pick<VaveBomItem, 'unitCost'>,
  answer: unknown,
): ShouldCostResult {
  if (!isRecord(answer)) throw new AiResultError('AI should-cost answer is not a JSON object.');
  const shouldCost = amount(answer.shouldCost);
  if (shouldCost === null || shouldCost === 0) {
    throw new AiResultError('AI should-cost answer has no positive shouldCost.');
  }
  const delta = part.unitCost - shouldCost;
  return {
    shouldCost,
    materialCost: amount(answer.materialCost),
    processCost: amount(answer.processCost),
    overhead: amount(answer.overhead),
    margin: amount(answer.margin),
    delta,
    deltaPct: part.unitCost > 0 ? (delta / part.unitCost) * 100 : null,
    benchmarkSource: SHOULD_COST_SOURCE,
  };
}

export interface AiCostAnalysis {
  affinityGroups: AffinityGroup[];
  focusAreas: string[];
  qfdMatrix?: QFDMatrix;
}

export function costAnalysisFromAi(
  answer: unknown,
  spendByPartNumber: ReadonlyMap<string, number>,
): AiCostAnalysis {
  if (!isRecord(answer)) throw new AiResultError('AI cost analysis answer is not a JSON object.');
  if (!Array.isArray(answer.affinityGroups) || !Array.isArray(answer.focusAreas)) {
    throw new AiResultError('AI cost analysis answer is missing affinityGroups or focusAreas.');
  }
  const affinityGroups: AffinityGroup[] = answer.affinityGroups.filter(isRecord).map((g) => {
    const parts = Array.isArray(g.parts) ? g.parts.filter((p): p is string => typeof p === 'string') : [];
    return {
      name: typeof g.name === 'string' ? g.name : '',
      parts,
      // Summed from the BOM's own spend, not taken from the model.
      totalCost: parts.reduce((s, pn) => s + (spendByPartNumber.get(pn) ?? 0), 0),
      description: typeof g.description === 'string' ? g.description : '',
    };
  });
  const focusAreas = answer.focusAreas.filter((f): f is string => typeof f === 'string');
  return {
    affinityGroups,
    focusAreas,
    ...(isRecord(answer.qfdMatrix) ? { qfdMatrix: answer.qfdMatrix as unknown as QFDMatrix } : {}),
  };
}

const FRAMEWORKS = ['SCAMPER', 'TRIZ', 'FAST', 'Manual'] as const;
const LEVELS = ['High', 'Medium', 'Low'] as const;
const COMPLEXITIES = ['L1', 'L2', 'L3'] as const;

const oneOf = <T extends string>(allowed: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

/**
 * Ideas from the model. A rating the model did not give (or gave outside the
 * allowed values) is left unset, not defaulted to a middle value.
 */
export function ideasFromAi(answer: unknown): CreateVaveIdea[] {
  if (!Array.isArray(answer)) throw new AiResultError('AI ideation answer is not a JSON array.');
  return answer.filter(isRecord).map((idea) => {
    const framework = oneOf(FRAMEWORKS, idea.framework);
    const feasibility = oneOf(LEVELS, idea.feasibility);
    const complexity = oneOf(COMPLEXITIES, idea.complexity);
    const risk = oneOf(LEVELS, idea.risk);
    const savings = amount(idea.estSavingsUsd);
    const investment = amount(idea.estInvestmentUsd);
    const months = amount(idea.timeToImplementMonths);
    return {
      title: (typeof idea.title === 'string' && idea.title.trim() ? idea.title : 'Untitled idea').slice(0, 255),
      ...(typeof idea.description === 'string' ? { description: idea.description } : {}),
      ...(framework ? { framework } : {}),
      ...(typeof idea.scamperType === 'string' ? { scamperType: idea.scamperType } : {}),
      affectedParts: Array.isArray(idea.affectedParts)
        ? idea.affectedParts.filter((p): p is string => typeof p === 'string')
        : [],
      ...(savings !== null ? { estSavingsUsd: savings } : {}),
      ...(investment !== null ? { estInvestmentUsd: investment } : {}),
      ...(feasibility ? { feasibility } : {}),
      ...(complexity ? { complexity } : {}),
      ...(risk ? { risk } : {}),
      ...(months !== null && months > 0 ? { timeToImplementMonths: months } : {}),
      status: 'draft' as const,
    };
  });
}
