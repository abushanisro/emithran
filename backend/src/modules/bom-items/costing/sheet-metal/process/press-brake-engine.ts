import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost, PhysicsGap, ConfidenceLevel } from '../../../dto/cost-breakdown.dto';
import type { CapabilityCheck, PartGeometryForCapability } from '../../shared/capability/machine-capability';
import { checkMachineCapability } from '../../shared/capability/machine-capability';
import type { MachineCapability } from '../../shared/capability/machine-selection/seed-registry';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';
import { eMithranTerms } from '../../shared/core/engine-kernel';

// Extracted verbatim from cost-engine.ts's inline Press Brake block (Platform
// Architecture Remediation Phase 1 — engine registry unification, Rule 8).
// Same eMithranTerms()-based math as before the extraction; the only change
// is that this formula is now a registered, reusable engine instead of code
// duplicated between computeCostSummary() and getRouteComparison().
export interface PressBrakeInput {
  bendCount: number;
  batchSize: number;
  rate: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Real cycle/setup time from the "Sheet Metal - Bending Manufacturing" DB
  // calculator, resolved by the caller via resolvePhysicsQuantity. Absent +
  // physicsGap means the calculator couldn't resolve one — the line is still
  // emitted with cycleTimeMin 0 and the gap attached, never a guessed value.
  cycleTimeSecFromCalculator?: number;
  setupTimeMinFromCalculator?: number;
  fallbackSetupMin: number; // toolSetupBrakeMin, per-batch — used only when setupTimeMinFromCalculator is absent
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

export interface PressBrakeResult {
  processLines: ProcessLineCost[];
  cycleTimeMin: number;
  warnings: string[];
}

export function computePressBrakeCost(input: PressBrakeInput): PressBrakeResult {
  const warnings: string[] = [];
  if (input.bendCount <= 0) return { processLines: [], cycleTimeMin: 0, warnings };

  let cycleTimeMin = 0;
  if (typeof input.cycleTimeSecFromCalculator === 'number' && Number.isFinite(input.cycleTimeSecFromCalculator)) {
    cycleTimeMin = input.cycleTimeSecFromCalculator / 60;
  } else if (input.physicsGap) {
    const gap = input.physicsGap;
    warnings.push(gap.gapType === 'missing_lookup'
      ? `Press brake cycle time unavailable — ${gap.requiredAction}`
      : `Press brake cycle time unavailable — ${gap.reason}`);
  } else {
    warnings.push('Press brake cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
  }

  const setupTimeMin = (typeof input.setupTimeMinFromCalculator === 'number' && Number.isFinite(input.setupTimeMinFromCalculator))
    ? input.setupTimeMinFromCalculator
    : input.fallbackSetupMin / Math.max(input.batchSize, 1);

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
    warnings.push('No press brake MHR rate in DB — bending process cost is $0; add a row to mhr_records');
  }

  return {
    processLines: [{
      process: 'Press Brake',
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

export interface PressBrakeContext extends PressBrakeInput {}

export class PressBrakeEngine implements ManufacturingProcessEngine<PressBrakeContext, PressBrakeResult> {
  readonly machineClass = 'press_brake' as const;
  readonly processFamily = 'sheet_metal_secondary_ops';

  checkCapability(
    geometry: PartGeometryForCapability,
    commodityCode: string | null,
    realCapability?: MachineCapability | null,
    capabilitySource?: 'imported' | 'seed' | 'default_class',
  ): CapabilityCheck {
    return checkMachineCapability(this.machineClass, commodityCode, geometry, realCapability, capabilitySource);
  }

  computeCost(context: PressBrakeContext): PressBrakeResult {
    return computePressBrakeCost(context);
  }
}
