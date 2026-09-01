import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost, PhysicsGap, ConfidenceLevel } from '../../../dto/cost-breakdown.dto';
import type { CapabilityCheck, PartGeometryForCapability } from '../../shared/capability/machine-capability';
import { checkMachineCapability } from '../../shared/capability/machine-capability';
import type { MachineCapability } from '../../shared/capability/machine-selection/seed-registry';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';
import { eMithranTerms } from '../../shared/core/engine-kernel';

// Extracted verbatim from cost-engine.ts's inline Tapping block (Platform
// Architecture Remediation Phase 1 — engine registry unification, Rule 8).
export interface TappingInput {
  threadCount: number; // threads.length > 0 gates the line
  batchSize: number;
  rate: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  cycleTimeSecFromCalculator?: number;
  fallbackSetupMin: number; // opSetupMinByOp?.tapping ?? TAPPING_SETUP_MIN, per-batch
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

export interface TappingResult {
  processLines: ProcessLineCost[];
  cycleTimeMin: number;
  warnings: string[];
}

export function computeTappingCost(input: TappingInput): TappingResult {
  const warnings: string[] = [];
  if (input.threadCount <= 0) return { processLines: [], cycleTimeMin: 0, warnings };

  let cycleTimeMin = 0;
  if (typeof input.cycleTimeSecFromCalculator === 'number' && Number.isFinite(input.cycleTimeSecFromCalculator)) {
    cycleTimeMin = input.cycleTimeSecFromCalculator / 60;
  } else if (input.physicsGap) {
    const gap = input.physicsGap;
    warnings.push(gap.gapType === 'missing_lookup'
      ? `Tapping cycle time unavailable — ${gap.requiredAction}`
      : `Tapping cycle time unavailable — ${gap.reason}`);
  } else {
    warnings.push('Tapping cycle time unavailable — no calculator result and no reported gap (unexpected; check resolveTappingCycleTimeSec).');
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
    warnings.push('No tapping MHR rate in DB — tapping process cost is $0; add a row to mhr_records');
  }

  return {
    processLines: [{
      process: 'Tapping',
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

export interface TappingContext extends TappingInput {}

export class TappingEngine implements ManufacturingProcessEngine<TappingContext, TappingResult> {
  readonly machineClass = 'tapping' as const;
  readonly processFamily = 'sheet_metal_secondary_ops';

  checkCapability(
    geometry: PartGeometryForCapability,
    commodityCode: string | null,
    realCapability?: MachineCapability | null,
    capabilitySource?: 'imported' | 'seed' | 'default_class',
  ): CapabilityCheck {
    return checkMachineCapability(this.machineClass, commodityCode, geometry, realCapability, capabilitySource);
  }

  computeCost(context: TappingContext): TappingResult {
    return computeTappingCost(context);
  }
}
