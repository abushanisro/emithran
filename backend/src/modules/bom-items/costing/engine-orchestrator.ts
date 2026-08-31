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
import type { ProcessLineCost } from '../dto/cost-breakdown.dto';
import type { MHRRateInput } from './cost-engine';
import type { CapabilityCheck, PartGeometryForCapability } from './machine-capability';
import { checkMachineCapability } from './machine-capability';
import type { MachineCapability } from './machine-selection/seed-registry';
import type { ManufacturingProcessEngine, CuttingProcessContext, CuttingProcessResult } from './manufacturing-process-engine';
import { r2 } from './engine-kernel';

/**
 * Base class for the cutting-family engines. Supplies checkCapability() for
 * free (identical across every registered cutting engine today) — subclasses
 * only implement machineClass/processFamily/computeCost().
 */
export abstract class BaseCuttingEngine implements ManufacturingProcessEngine {
  abstract readonly machineClass: string;
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
  /** Extra fields specific to the calling engine (physicsGap, calculatorId, etc.) — merged in as-is. */
  extra?: Partial<ProcessLineCost>;
}

/** Assembles the field set every cutting-engine ProcessLineCost shares, already r2()-rounded. */
export function buildCuttingProcessLine(input: CuttingProcessLineInput): ProcessLineCost {
  const setupCost = r2(input.setupCost);
  const runCost = r2(input.runCost);
  return {
    process: input.process,
    ...(input.processIdentity ? {
      processGroup: input.processIdentity.processGroup,
      processRoute: input.processIdentity.processRoute,
      operation: input.processIdentity.operation,
    } : {}),
    setupCost,
    runCost,
    totalCost: r2(setupCost + runCost),
    cycleTimeMin: r2(input.cycleTimeMin),
    hourlyRate: input.rate.rate,
    rateSource: input.rate.source,
    machineClass: input.rate.machineClass,
    machineName: input.rate.machineName,
    commodityCode: input.rate.commodityCode,
    ...input.extra,
  };
}
