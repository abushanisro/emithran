import { finalizeInspectionLine, type InspectionInput, type InspectionPlan, type InspectionResolvedTime, type InspectionResult } from './inspection-engine';
import type { CapabilityCheck } from '../capability/machine-capability';
import type { ManufacturingProcessEngine } from '../core/manufacturing-process.types';

// Thin conformance wrapper around the real, tested finalizeInspectionLine()
// (Platform Architecture Remediation Phase 1 — "fix the pattern across all
// three domains"). Deliberately covers ONLY the cost-assembly stage, not
// planInspection() — see inspection-engine.ts's own doc comment: planning
// needs real per-part candidate data (holes/bends/threads/GD&T) assembled by
// the caller from CAD/drawing intelligence, the same reason Laser Cutting's
// own engine doesn't resolve its own cycle time internally either
// (CuttingProcessContext.cuttingSecFromCalculator is pre-resolved by the
// caller). planInspection() stays a caller-side orchestration helper in
// bom-items.service.ts, unchanged.
export interface InspectionContext {
  input: InspectionInput;
  plan: InspectionPlan;
  resolved: InspectionResolvedTime;
}

export class InspectionRegistryEngine implements ManufacturingProcessEngine<
  InspectionContext,
  InspectionResult,
  Record<string, never>,
  CapabilityCheck
> {
  readonly machineClass = 'cmm' as const;
  readonly processFamily = 'inspection';

  // Disclosed gap, not fabricated: Inspection's real resource capability
  // (CMM vs. bench/gauge tiers) is resolved by planInspection()'s method
  // escalation (gdt-severity.ts) plus resolveCmmSpecificRate/
  // resolveGenericInspectionRate in bom-items.service.ts — a richer,
  // multi-source resolution than this registry contract's generic
  // (geometry, commodityCode) shape provides. No current consumer calls
  // this for the 'inspection' family.
  checkCapability(): CapabilityCheck {
    return {
      capable: true,
      confidence: 'low',
      reasonCodes: [],
      reasons: ['Inspection resource/method capability is resolved via planInspection() + resolveCmmSpecificRate/resolveGenericInspectionRate, not through this registry-level check.'],
      estimatedTonnage: null,
    };
  }

  computeCost(context: InspectionContext): InspectionResult {
    return finalizeInspectionLine(context.input, context.plan, context.resolved);
  }
}
