import {
  computeCNCTurnedCostSummary,
  checkCNCCapability,
  type CNCCostInput,
  type MachineClassId,
  type CNCCapabilityResult,
} from './cost-cnc-engine';
import type { CostSummaryDto } from '../../../dto/cost-breakdown.dto';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';
import type { CNCCapabilityGeometry } from './cnc-milling-registry-engine';
import type { MachineClass } from '../../shared/core/default-rates.constants';

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
  // See cnc-milling-registry-engine.ts's identical field for why this is
  // MachineClass (the shared cross-domain union), not MachineClassId.
  readonly machineClass: MachineClass;
  readonly processFamily = 'cnc_turning';

  constructor(machineClass: string) {
    this.machineClass = machineClass as MachineClass;
  }

  checkCapability(geometry: CNCCapabilityGeometry): CNCCapabilityResult {
    return checkCNCCapability(this.machineClass as MachineClassId, geometry.maxLength, geometry.maxWidth, geometry.maxHeight, geometry.weightKg);
  }

  computeCost(context: CNCCostInput): CostSummaryDto {
    return computeCNCTurnedCostSummary(context, this.machineClass as MachineClassId);
  }
}
