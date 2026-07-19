import type {
  IsoGroup,
  CalculationStep,
  ValidationResult,
  MachineRequirements,
  ToolRequirements,
} from "../interfaces/operation-calculator.interface";

export interface OperationResult {
  operation: string;
  timingSource: "machining_rules" | "geometry_estimate" | "default";
  isoGroup: IsoGroup | null;
  totalCycleTimeSec: number;
  perFeatureCycleTimeSec: number;
  featureCount: number;
  steps: CalculationStep[];
  parameterSource: string;
  machineRequirements: MachineRequirements;
  toolRequirements: ToolRequirements;
  validation: ValidationResult;
}
