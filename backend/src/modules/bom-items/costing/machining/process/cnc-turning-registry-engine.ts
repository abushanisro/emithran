import {
  computeCNCTurnedCostSummary,
  checkCNCCapability,
  type CNCCostInput,
  type CNCMachineClass,
  type CNCCapabilityResult,
} from './cost-cnc-engine';
import type { CostSummaryDto } from '../../../dto/cost-breakdown.dto';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';
import type { CNCCapabilityGeometry } from './cnc-milling-registry-engine';

// Thin conformance wrapper around the real, tested computeCNCTurnedCostSummary()
// (Platform Architecture Remediation Phase 1 — "fix the pattern across all
// three domains"). Same shape as cnc-milling-registry-engine.ts, mirrors the
// existing PressStrokeEngine multi-instance pattern.
export class CncTurningEngine implements ManufacturingProcessEngine<
  CNCCostInput,
  CostSummaryDto,
  CNCCapabilityGeometry,
  CNCCapabilityResult
> {
  readonly machineClass: CNCMachineClass;
  readonly processFamily = 'cnc_turning';

  constructor(machineClass: 'cnc_lathe' | 'cnc_lathe_live' | 'cnc_mill_turn') {
    this.machineClass = machineClass;
  }

  checkCapability(geometry: CNCCapabilityGeometry): CNCCapabilityResult {
    return checkCNCCapability(this.machineClass, geometry.maxLength, geometry.maxWidth, geometry.maxHeight, geometry.weightKg);
  }

  computeCost(context: CNCCostInput): CostSummaryDto {
    return computeCNCTurnedCostSummary(context, this.machineClass as 'cnc_lathe' | 'cnc_lathe_live' | 'cnc_mill_turn');
  }
}
