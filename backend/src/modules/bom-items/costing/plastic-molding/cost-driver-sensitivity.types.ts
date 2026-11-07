/** The part of an engine result the sensitivity reads: what the cost view adds up. */
export interface EngineResultLike {
  materialCost?: number;
  processLines?: Array<{ operation?: string; process?: string; totalCost?: number }>;
  tooling?: { moldCostPerPartUsd?: number } | null;
}
