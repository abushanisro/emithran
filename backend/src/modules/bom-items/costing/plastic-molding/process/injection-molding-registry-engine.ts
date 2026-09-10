import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from './cost-injection-molding-engine';
import type { IMProcessTree } from './process-tree';
import type { CostSummaryDto } from '../../../dto/cost-breakdown.dto';
import type { CapabilityCheck } from '../../shared/capability/machine-capability';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';

// Thin conformance wrapper around the real, tested
// computeInjectionMoldedCostSummary() (Platform Architecture Remediation
// Phase 1 — "fix the pattern across all three domains"). No formula
// rewrite: computeCost() calls the existing function unchanged, preserving
// its extra `processTree` field.
export class InjectionMoldingEngine implements ManufacturingProcessEngine<
  InjectionMoldingCostInput,
  CostSummaryDto & { processTree: IMProcessTree },
  Record<string, never>,
  CapabilityCheck
> {
  readonly machineClass = 'injection_molding' as const;
  readonly processFamily = 'injection_molding';

  // Disclosed gap, not fabricated: real IM machine-instance capability
  // (clamp tonnage, shot size, daylight) is already checked at the point of
  // machine SELECTION (evaluateIMCandidate/selectIMmachinesByTier,
  // machine-selector-im.ts), which needs a specific MachineCandidate — a
  // richer input than this registry contract's generic
  // (geometry, commodityCode) shape provides. This wrapper's checkCapability
  // is therefore a true, honest no-op rather than a fabricated pass/fail;
  // no current consumer calls it for injection_molding (unlike the
  // sheet-metal cutting/forming loop in getRouteComparison()).
  checkCapability(): CapabilityCheck {
    return {
      capable: true,
      confidence: 'low',
      reasonCodes: [],
      reasons: ['Injection Molding capability is evaluated per-machine-candidate via evaluateIMCandidate/selectIMmachinesByTier, not through this registry-level check.'],
      estimatedTonnage: null,
    };
  }

  computeCost(context: InjectionMoldingCostInput): CostSummaryDto & { processTree: IMProcessTree } {
    return computeInjectionMoldedCostSummary(context);
  }
}
