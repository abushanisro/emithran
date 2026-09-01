import {
  computeCNCMilledCostSummary,
  checkCNCCapability,
  type CNCCostInput,
  type CNCMachineClass,
  type CNCCapabilityResult,
} from './cost-cnc-engine';
import type { CostSummaryDto } from '../../../dto/cost-breakdown.dto';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';

// Thin conformance wrapper around the real, tested computeCNCMilledCostSummary()
// (Platform Architecture Remediation Phase 1 — "fix the pattern across all
// three domains"). No formula rewrite: computeCost() calls the existing
// function unchanged and returns its CostSummaryDto as-is (material cost lives
// inside it — never stripped to just processLines[]).
export interface CNCCapabilityGeometry {
  maxLength: number;
  maxWidth: number;
  maxHeight: number;
  weightKg: number;
}

// One class, one real machine class per instance — mirrors the existing
// PressStrokeEngine multi-instance pattern (press-stroke-engine.ts).
export class CncMillingEngine implements ManufacturingProcessEngine<
  CNCCostInput,
  CostSummaryDto,
  CNCCapabilityGeometry,
  CNCCapabilityResult
> {
  readonly machineClass: CNCMachineClass;
  readonly processFamily = 'cnc_milling';

  constructor(machineClass: 'cnc_3ax_vmc' | 'cnc_4ax_vmc' | 'cnc_5ax_mc') {
    this.machineClass = machineClass;
  }

  checkCapability(geometry: CNCCapabilityGeometry): CNCCapabilityResult {
    // checkCNCCapability's real envelope check doesn't use commodityCode/
    // realCapability/capabilitySource — CNC capability today is a bounding-
    // box + weight envelope check per class, not a per-machine capability
    // hydration (unlike the sheet-metal engines' checkMachineCapability).
    return checkCNCCapability(this.machineClass, geometry.maxLength, geometry.maxWidth, geometry.maxHeight, geometry.weightKg);
  }

  computeCost(context: CNCCostInput): CostSummaryDto {
    return computeCNCMilledCostSummary(context, this.machineClass as 'cnc_3ax_vmc' | 'cnc_4ax_vmc' | 'cnc_5ax_mc');
  }
}
