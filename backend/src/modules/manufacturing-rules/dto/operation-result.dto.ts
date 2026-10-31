import type {
  IsoGroup,
  CalculationStep,
  ValidationResult,
  MachineRequirements,
  ToolRequirements,
} from "../interfaces/operation-calculator.interface";
import type { MaterialGroupSource } from "../resolvers/material-group.resolver";

export interface OperationResult {
  operation: string;
  timingSource: "machining_rules" | "geometry_estimate" | "default";
  isoGroup: IsoGroup | null;
  /** Where isoGroup came from; anything but db_* is an assumption, explained in validation.warnings. */
  materialGroupSource: MaterialGroupSource;
  totalCycleTimeSec: number;
  perFeatureCycleTimeSec: number;
  featureCount: number;
  steps: CalculationStep[];
  parameterSource: string;
  machineRequirements: MachineRequirements;
  toolRequirements: ToolRequirements;
  validation: ValidationResult;
}
