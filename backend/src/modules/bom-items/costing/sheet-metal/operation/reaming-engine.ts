import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost, PhysicsGap, ConfidenceLevel } from '../../../dto/cost-breakdown.dto';
import type { CapabilityCheck, PartGeometryForCapability } from '../../shared/capability/machine-capability';
import { checkMachineCapability } from '../../shared/capability/machine-capability';
import type { MachineCapability } from '../../shared/capability/machine-selection/seed-registry';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';
import { eMithranTerms } from '../../shared/core/engine-kernel';

// Extracted verbatim from cost-engine.ts's inline Reaming block (Platform
// Architecture Remediation Phase 1 — engine registry unification, Rule 8).
// The tight-tolerance → ream trigger threshold comparison
// (TIGHT_TOLERANCE_REAM_THRESHOLD_MM) stays in the caller, same as before
// extraction — this engine's gate is simply `reamHoleCount > 0`, matching
// every other count-gated secondary op; the caller passes 0 when the
// tolerance threshold wasn't crossed.
export interface ReamingInput {
  reamHoleCount: number; // 0 when the tight-tolerance trigger didn't fire
  tightestToleranceMm: number | null; // for the disclosure warning only
  batchSize: number;
  rate: MHRRateInput; // drill_press
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  cycleTimeSecFromCalculator?: number;
  fallbackSetupMin: number; // opSetupMinByOp?.ream ?? REAM_SETUP_MIN, per-batch
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  physicsGap?: PhysicsGap | null;
  confidence?: ConfidenceLevel;
  dlrPerHr?: number;
  qairPerHr?: number;
  inspTimeMin?: number;
  samplingRate?: number;
  yieldPct?: number;
  netMatCost?: number;
  netWeightKg?: number;
  scrapPricePerKg?: number;
}

export interface ReamingResult {
  processLines: ProcessLineCost[];
  cycleTimeMin: number;
  warnings: string[];
}

export function computeReamingCost(input: ReamingInput): ReamingResult {
  const warnings: string[] = [];
  if (input.reamHoleCount <= 0) return { processLines: [], cycleTimeMin: 0, warnings };

  let cycleTimeMin = 0;
  if (typeof input.cycleTimeSecFromCalculator === 'number' && Number.isFinite(input.cycleTimeSecFromCalculator)) {
    cycleTimeMin = input.cycleTimeSecFromCalculator / 60;
  } else if (input.physicsGap) {
    const gap = input.physicsGap;
    warnings.push(gap.gapType === 'missing_lookup'
      ? `Reaming cycle time unavailable — ${gap.requiredAction}`
      : `Reaming cycle time unavailable — ${gap.reason}`);
  } else {
    warnings.push('Reaming cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
  }

  const setupTimeMin = input.fallbackSetupMin / Math.max(input.batchSize, 1);

  const t = eMithranTerms({
    mhrPerHr: input.rate.rate,
    dlrPerHr: input.rate.labourRate ?? input.dlrPerHr ?? 0,
    qairPerHr: input.qairPerHr ?? 0,
    setupNDL: input.rate.operators ?? 1,
    cycleNDL: input.rate.operators ?? 1,
    cycleTimeMin,
    setupTimeMin,
    inspTimeMin: input.inspTimeMin ?? 0,
    samplingRate: input.samplingRate ?? 0,
    yieldPct: input.yieldPct ?? 0.98,
    netMatCost: input.netMatCost ?? 0,
    netWeightKg: input.netWeightKg ?? 0,
    scrapPricePerKg: input.scrapPricePerKg ?? 0,
  });

  if (input.rate.source === 'no_db_rate') {
    warnings.push('No drill press MHR rate in DB — reaming process cost is $0; add a row to mhr_records');
  }
  warnings.push(`Tight tolerance (${input.tightestToleranceMm}mm) detected on drawing — reaming added for all ${input.reamHoleCount} hole(s); per-feature GD&T linkage not yet available to scope this to specific holes`);

  return {
    processLines: [{
      process: 'Reaming',
      ...(input.processIdentity ? {
        processGroup: input.processIdentity.processGroup,
        processRoute: input.processIdentity.processRoute,
        operation: input.processIdentity.operation,
      } : {}),
      setupCost: Math.round(t.setupCost * 100) / 100,
      runCost: Math.round((t.machineCost + t.laborCost) * 100) / 100,
      totalCost: Math.round(t.total * 100) / 100,
      cycleTimeMin: Math.round(cycleTimeMin * 1000) / 1000,
      hourlyRate: input.rate.rate,
      rateSource: input.rate.source,
      machineClass: input.rate.machineClass,
      machineName: input.rate.machineName,
      commodityCode: input.rate.commodityCode,
      labourRate: input.rate.labourRate ?? null,
      labourRateSource: input.rate.labourRateSource ?? null,
      ...(input.calculatorId ? { calculatorId: input.calculatorId } : {}),
      ...(input.calculatorVersion != null ? { calculatorVersion: input.calculatorVersion } : {}),
      ...(input.physicsGap ? { physicsGap: input.physicsGap } : {}),
      ...(input.confidence ? { confidence: input.confidence } : {}),
    }],
    cycleTimeMin,
    warnings,
  };
}

export interface ReamingContext extends ReamingInput {}

export class ReamingEngine implements ManufacturingProcessEngine<ReamingContext, ReamingResult> {
  readonly machineClass = 'drill_press' as const;
  readonly processFamily = 'sheet_metal_secondary_ops';

  checkCapability(
    geometry: PartGeometryForCapability,
    commodityCode: string | null,
    realCapability?: MachineCapability | null,
    capabilitySource?: 'imported' | 'seed' | 'default_class',
  ): CapabilityCheck {
    return checkMachineCapability(this.machineClass, commodityCode, geometry, realCapability, capabilitySource);
  }

  computeCost(context: ReamingContext): ReamingResult {
    return computeReamingCost(context);
  }
}
