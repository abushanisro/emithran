import { computeSurfaceTreatmentLine } from './cost-surface-treatment';
import type { SurfaceTreatmentDbRate } from '../core/default-rates.constants';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CapabilityCheck } from '../capability/machine-capability';
import type { ManufacturingProcessEngine } from '../core/manufacturing-process.types';

// Thin conformance wrapper around the real, tested computeSurfaceTreatmentLine()
// (Platform Architecture Remediation Phase 1 — "fix the pattern across all
// three domains"). computeSurfaceTreatmentLine() is already isolated-engine-
// shaped (pure function, pre-resolved scalars in, ProcessLineCost|null out)
// — deliberately NOT eMithranTerms()-based, since surface treatment has no
// real per-part machine cycle (a subcontracted-style area treatment); this
// wrapper only adapts its (positional args, mutated warnings array) calling
// convention to the shared (context, {processLines, warnings}) shape every
// other registered engine uses — no math changes.
export interface SurfaceTreatmentContext {
  surfaceTreatment: string | null;
  surfaceAreaMm2: number;
  batchSize: number;
  location: string;
  dbRate?: SurfaceTreatmentDbRate | null;
}

export interface SurfaceTreatmentResult {
  processLines: ProcessLineCost[];
  warnings: string[];
}

export class SurfaceTreatmentEngine implements ManufacturingProcessEngine<
  SurfaceTreatmentContext,
  SurfaceTreatmentResult,
  Record<string, never>,
  CapabilityCheck
> {
  readonly machineClass = 'surface_treatment' as const;
  readonly processFamily = 'surface_treatment';

  checkCapability(): CapabilityCheck {
    return { capable: true, confidence: 'low', reasonCodes: [], reasons: [], estimatedTonnage: null };
  }

  computeCost(context: SurfaceTreatmentContext): SurfaceTreatmentResult {
    const warnings: string[] = [];
    const line = computeSurfaceTreatmentLine(
      context.surfaceTreatment,
      context.surfaceAreaMm2,
      context.batchSize,
      context.location,
      warnings,
      context.dbRate,
    );
    return { processLines: line ? [line] : [], warnings };
  }
}
