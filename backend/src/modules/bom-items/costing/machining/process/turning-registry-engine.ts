import {
  computeTurningCostSummary,
  checkMachiningCapability,
  type MachiningCostInput,
  type MachineClassId,
  type MachiningCapabilityResult,
} from './cost-machining-engine';
import type { CostSummaryDto } from '../../../dto/cost-breakdown.dto';
import type { ManufacturingProcessEngine } from '../../shared/core/manufacturing-process.types';
import type { MachiningCapabilityGeometry } from './milling-registry-engine';
import type { MachineClass } from '../../shared/core/default-rates.constants';

// Thin conformance wrapper around the real, tested computeTurningCostSummary()
// (Platform Architecture Remediation Phase 1 — "fix the pattern across all
// three domains"). Same shape as milling-registry-engine.ts, mirrors the
// existing PressStrokeEngine multi-instance pattern.
export class TurningEngine implements ManufacturingProcessEngine<
  MachiningCostInput,
  CostSummaryDto,
  MachiningCapabilityGeometry,
  MachiningCapabilityResult
> {
  // See milling-registry-engine.ts's identical field for why this is
  // MachineClass (the shared cross-domain union), not MachineClassId.
  readonly machineClass: MachineClass;
  readonly processFamily = 'cnc_turning';

  constructor(machineClass: string) {
    this.machineClass = machineClass as MachineClass;
  }

  checkCapability(geometry: MachiningCapabilityGeometry): MachiningCapabilityResult {
    return checkMachiningCapability(this.machineClass as MachineClassId, geometry.maxLength, geometry.maxWidth, geometry.maxHeight, geometry.weightKg);
  }

  computeCost(context: MachiningCostInput): CostSummaryDto {
    return computeTurningCostSummary(context, this.machineClass as MachineClassId);
  }
}
