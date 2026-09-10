// Shared orchestration for the cutting-family ManufacturingProcessEngine
// implementations — the capability-check delegation (previously an
// identical 8-line method body copy-pasted into LaserCuttingEngine,
// Co2LaserCuttingEngine, WaterjetEngine, TurretPunchEngine) and the common
// ProcessLineCost field assembly (process/processIdentity/setupCost/
// runCost/totalCost/cycleTimeMin/hourlyRate/rateSource/machineClass/
// machineName/commodityCode/labourRate — every cutting engine built this
// same shape, each with its own copy of the spread-if-present pattern).
//
// Each engine still owns everything genuinely process-specific: its own
// time-driver formula, its own extra ProcessLineCost fields (physicsGap/
// calculatorId for laser; secondary consumable/handling lines for waterjet/
// turret) — this file only removes what was byte-for-byte identical.
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { MHRRateInput } from './cost-engine';
import type { CapabilityCheck, PartGeometryForCapability } from '../capability/machine-capability';
import { checkMachineCapability } from '../capability/machine-capability';
import type { MachineCapability } from '../capability/machine-selection/seed-registry';
import type { ManufacturingProcessEngine, CuttingProcessContext, CuttingProcessResult } from './manufacturing-process.types';
import type { MachineClass } from './default-rates.constants';
import { r2 } from './engine-kernel';

/**
 * Base class for the cutting-family engines. Supplies checkCapability() for
 * free (identical across every registered cutting engine today) — subclasses
 * only implement machineClass/processFamily/computeCost().
 */
export abstract class BaseCuttingEngine implements ManufacturingProcessEngine {
  abstract readonly machineClass: MachineClass;
  abstract readonly processFamily: string;

  checkCapability(
    geometry: PartGeometryForCapability,
    commodityCode: string | null,
    realCapability?: MachineCapability | null,
    capabilitySource?: 'imported' | 'seed' | 'default_class',
  ): CapabilityCheck {
    return checkMachineCapability(this.machineClass, commodityCode, geometry, realCapability, capabilitySource);
  }

  abstract computeCost(context: CuttingProcessContext): CuttingProcessResult;
}

export interface CuttingProcessLineInput {
  process: string;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  setupCost: number;
  runCost: number;
  cycleTimeMin: number;
  rate: MHRRateInput;
  // Override for totalCost when it isn't simply setupCost + runCost — e.g. an
  // eMithranTerms() caller whose QA-inspection-sampling and yield-loss cost
  // terms are folded into totalCost but deliberately NOT reflected in the
  // separate setupCost/runCost breakdown fields (matching cost-engine.ts's own
  // 9 inline blocks, which do the same thing: `runCost: t.machineCost +
  // t.laborCost` but `totalCost: t.total`). Absent (the default, every
  // pre-Phase-1 caller) preserves the documented setupCost+runCost contract
  // exactly as before.
  totalCost?: number;
  /**
   * Real, un-amortised setup minutes for one batch — the value resolveSetupMinutes()
   * returned, BEFORE division by batch size. Distinct from setupCost, which is
   * already amortised. Carried onto the line so apply-route can persist the real
   * setup time instead of the literal 15 it used to write for every process on
   * every machine, and so the UI can show what the engine actually charged.
   */
  setupTimeMin?: number;
  /** Which tier resolveSetupMinutes() used — disclosed, never inferred downstream. */
  setupTimeSource?: 'calculator' | 'machine' | 'operation_lookup' | 'class_default';
  /** Extra fields specific to the calling engine (physicsGap, calculatorId, etc.) — merged in as-is. */
  extra?: Partial<ProcessLineCost>;
}

/** Assembles the field set every cutting-engine ProcessLineCost shares, already r2()-rounded. */
export function buildCuttingProcessLine(input: CuttingProcessLineInput): ProcessLineCost {
  // Per-PART money is NOT rounded to 2 decimals here.
  //
  // At production volume these are legitimately sub-cent: a real 30-minute
  // press setup amortised over a batch of 125,000 is $0.000356 a part, and r2
  // turns that into $0.00. That is what made a Standard Press line report
  // "Setup (0.0 min) $0.00" on screen while the machine carried a real
  // setup_time_hr of 0.5 on file -- the setup was resolved, charged, and then
  // rounded away before anyone could see it. Run cost survived only because it
  // happened to exceed half a cent.
  //
  // Rounding money for display is the UI currency contract's job, and it
  // already does it. cycleTimeMin below keeps its r2: minutes are a different
  // quantity with their own documented rounding contract.
  const setupCost = input.setupCost;
  const runCost = input.runCost;
  return {
    process: input.process,
    ...(input.processIdentity ? {
      processGroup: input.processIdentity.processGroup,
      processRoute: input.processIdentity.processRoute,
      operation: input.processIdentity.operation,
    } : {}),
    setupCost,
    runCost,
    totalCost: input.totalCost ?? (setupCost + runCost),
    cycleTimeMin: r2(input.cycleTimeMin),
    ...(input.setupTimeMin !== undefined ? { setupTimeMin: r2(input.setupTimeMin) } : {}),
    ...(input.setupTimeSource ? { setupTimeSource: input.setupTimeSource } : {}),
    // Real crew size this line was costed with — the same rate.operators
    // eMithranTerms() used for setupNDL/cycleNDL, carried through so the
    // persisted record and the UI can show it instead of assuming 1.
    ...(input.rate.operators != null ? { operators: input.rate.operators } : {}),
    hourlyRate: input.rate.rate,
    rateSource: input.rate.source,
    machineClass: input.rate.machineClass,
    machineName: input.rate.machineName,
    commodityCode: input.rate.commodityCode,
    ...input.extra,
  };
}
