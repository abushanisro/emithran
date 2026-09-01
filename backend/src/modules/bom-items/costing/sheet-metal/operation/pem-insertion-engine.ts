import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost, PhysicsGap, ConfidenceLevel } from '../../../dto/cost-breakdown.dto';
import type { CapabilityCheck, PartGeometryForCapability } from '../../shared/capability/machine-capability';
import { checkMachineCapability } from '../../shared/capability/machine-capability';
import type { MachineCapability } from '../../shared/capability/machine-selection/seed-registry';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';
import { eMithranTerms } from '../../shared/core/engine-kernel';

// Extracted verbatim from cost-engine.ts's inline PEM Insertion block
// (Platform Architecture Remediation Phase 1 — engine registry unification,
// Rule 8).
export interface PemInsertionInput {
  pemCount: number;
  batchSize: number;
  rate: MHRRateInput; // pem_press
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  cycleTimeSecFromCalculator?: number;
  fallbackSetupMin: number; // opSetupMinByOp?.pem_insertion ?? PEM_INSERTION_SETUP_MIN, per-batch
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

export interface PemInsertionResult {
  processLines: ProcessLineCost[];
  cycleTimeMin: number;
  warnings: string[];
}

export function computePemInsertionCost(input: PemInsertionInput): PemInsertionResult {
  const warnings: string[] = [];
  if (input.pemCount <= 0) return { processLines: [], cycleTimeMin: 0, warnings };

  let cycleTimeMin = 0;
  if (typeof input.cycleTimeSecFromCalculator === 'number' && Number.isFinite(input.cycleTimeSecFromCalculator)) {
    cycleTimeMin = input.cycleTimeSecFromCalculator / 60;
  } else if (input.physicsGap) {
    const gap = input.physicsGap;
    warnings.push(gap.gapType === 'missing_lookup'
      ? `PEM insertion cycle time unavailable — ${gap.requiredAction}`
      : `PEM insertion cycle time unavailable — ${gap.reason}`);
  } else {
    warnings.push('PEM insertion cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
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
    warnings.push('No PEM press MHR rate in DB — PEM insertion process cost is $0; add a row to mhr_records');
  }

  return {
    processLines: [{
      process: 'PEM Insertion',
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

export interface PemInsertionContext extends PemInsertionInput {}

export class PemInsertionEngine implements ManufacturingProcessEngine<PemInsertionContext, PemInsertionResult> {
  readonly machineClass = 'pem_press' as const;
  readonly processFamily = 'sheet_metal_secondary_ops';

  checkCapability(
    geometry: PartGeometryForCapability,
    commodityCode: string | null,
    realCapability?: MachineCapability | null,
    capabilitySource?: 'imported' | 'seed' | 'default_class',
  ): CapabilityCheck {
    return checkMachineCapability(this.machineClass, commodityCode, geometry, realCapability, capabilitySource);
  }

  computeCost(context: PemInsertionContext): PemInsertionResult {
    return computePemInsertionCost(context);
  }
}
