import {
  computeMillingCostSummary,
  checkMachiningCapability,
  type MachiningCostInput,
  type MachineClassId,
  type MachiningCapabilityResult,
} from './cost-machining-engine';
import type { CostSummaryDto } from '../../../dto/cost-breakdown.dto';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';
import type { MachineClass } from '../../shared/core/default-rates.constants';

// Thin conformance wrapper around the real, tested computeMillingCostSummary()
// (Platform Architecture Remediation Phase 1 — "fix the pattern across all
// three domains"). No formula rewrite: computeCost() calls the existing
// function unchanged and returns its CostSummaryDto as-is (material cost lives
// inside it — never stripped to just processLines[]).
export interface MachiningCapabilityGeometry {
  maxLength: number;
  maxWidth: number;
  maxHeight: number;
  weightKg: number;
}

// One class, one real machine class per instance — mirrors the existing
// PressStrokeEngine multi-instance pattern (press-stroke-engine.ts).
export class MillingEngine implements ManufacturingProcessEngine<
  MachiningCostInput,
  CostSummaryDto,
  MachiningCapabilityGeometry,
  MachiningCapabilityResult
> {
  // Typed against the shared, cross-domain MachineClass union (required by
  // ManufacturingProcessEngine, which every domain's engines implement) —
  // NOT MachineClassId. Casting to MachineClassId happens only at the two
  // call sites below, into cost-machining-engine.ts's own functions.
  readonly machineClass: MachineClass;
  readonly processFamily = 'milling';

  constructor(machineClass: string) {
    this.machineClass = machineClass as MachineClass;
  }

  checkCapability(geometry: MachiningCapabilityGeometry): MachiningCapabilityResult {
    // checkMachiningCapability's real envelope check doesn't use commodityCode/
    // realCapability/capabilitySource — CNC capability today is a bounding-
    // box + weight envelope check per class, not a per-machine capability
    // hydration (unlike the sheet-metal engines' checkMachineCapability).
    return checkMachiningCapability(this.machineClass as MachineClassId, geometry.maxLength, geometry.maxWidth, geometry.maxHeight, geometry.weightKg);
  }

  computeCost(context: MachiningCostInput): CostSummaryDto {
    return computeMillingCostSummary(context, this.machineClass as MachineClassId);
  }
}
