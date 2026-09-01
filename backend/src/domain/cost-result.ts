// Canonical cost-result contract — re-exported, not reinvented.
//
// `CostSummaryDto`/`ProcessLineCost`/`CalculationTraceStep` in
// cost-breakdown.dto.ts already are the shared cost-result shape across all
// three real manufacturing engines (Sheet Metal's cost-engine.ts, CNC's
// cost-cnc-engine.ts, Injection Molding's cost-injection-molding-engine.ts —
// all three import CostSummaryDto/ProcessLineCost from the same file and
// build the same shape). New cross-domain code should import from here so
// there is one canonical path, without duplicating or renaming the types
// existing engines already return.
export type {
  CostSummaryDto,
  ProcessLineCost,
  CalculationTraceStep,
  CostStatus,
  FeatureOp,
  LookupPolicyType,
  SustainabilitySummaryDto,
} from '../modules/bom-items/dto/cost-breakdown.dto';

export type { MHRRateInput, LhrRateSource } from '../modules/bom-items/costing/shared/core/cost-engine';
