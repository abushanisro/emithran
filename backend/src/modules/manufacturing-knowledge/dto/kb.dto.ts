export interface FeatureProcessMapping {
  id: string;
  feature_type: string;
  primary_process: string;
  secondary_processes: string[] | null;
  prerequisite_process: string | null;
  typical_tool_type: string | null;
  typical_machine_type: string | null;
  applies_to_families: string[] | null;
  notes: string | null;
  is_system: boolean;
  owner_id: string | null;
  created_at: string;
}

export interface MachineCapability {
  id: string;
  machine_name: string;
  machine_type: string;
  supported_processes: string[];
  min_tolerance_mm: number | null;
  max_part_length_mm: number | null;
  max_part_diameter_mm: number | null;
  max_spindle_rpm: number | null;
  supported_materials: string[] | null;
  mhr_id: string | null;
  is_system: boolean;
  owner_id: string | null;
  created_at: string;
}

export interface ProcessRoutingRule {
  id: string;
  rule_name: string;
  rule_type: 'sequence' | 'dependency' | 'exclusion';
  first_process: string;
  second_process: string;
  constraint_type: 'must_precede' | 'must_follow' | 'cannot_coexist';
  applies_to_families: string[] | null;
  severity: 'error' | 'warning';
  message: string;
  suggested_fix: string | null;
  is_system: boolean;
  owner_id: string | null;
  created_at: string;
}

export interface RouteStep {
  step: number;
  process: string;
  required: boolean;
  machine_type: string;
  description: string;
}

export interface PartFamilyRoutingTemplate {
  id: string;
  part_family: string;
  template_name: string;
  complexity_level: 'simple' | 'standard' | 'complex' | null;
  routing_sequence: RouteStep[];
  applicable_materials: string[] | null;
  notes: string | null;
  is_system: boolean;
  owner_id: string | null;
  created_at: string;
}

export interface MachineProcessMapping {
  id: string;
  feature_type: string;
  process_key: string;
  machine_type: string;
  applies_to_family: string | null;
  applies_when: Record<string, any> | null;
  priority: number;
  is_required: boolean;
  notes: string | null;
  is_system: boolean;
  owner_id: string | null;
  created_at: string;
}

export interface ProcessPlanFeedback {
  id: string;
  bom_item_id: string;
  owner_id: string;
  ai_process_sequence: string[];
  ai_machines: Record<string, string> | null;
  engineer_sequence: string[];
  engineer_machines: Record<string, string> | null;
  correction_reason: string | null;
  part_family: string | null;
  material: string | null;
  is_training_candidate: boolean;
  created_at: string;
}

export interface RouteIssue {
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning';
  message: string;
  affectedProcesses: string[];
  suggestedFix?: string;
}

export interface CreateFeatureProcessMappingDto {
  featureType: string;
  primaryProcess: string;
  secondaryProcesses?: string[];
  prerequisiteProcess?: string;
  typicalToolType?: string;
  typicalMachineType?: string;
  appliesToFamilies?: string[];
  notes?: string;
}

export interface CreateMachineCapabilityDto {
  machineName: string;
  machineType: string;
  supportedProcesses: string[];
  minToleranceMm?: number;
  maxPartLengthMm?: number;
  maxPartDiameterMm?: number;
  maxSpindleRpm?: number;
  supportedMaterials?: string[];
  mhrId?: string;
}

export interface CreateProcessRoutingRuleDto {
  ruleName: string;
  ruleType: 'sequence' | 'dependency' | 'exclusion';
  firstProcess: string;
  secondProcess: string;
  constraintType: 'must_precede' | 'must_follow' | 'cannot_coexist';
  appliesToFamilies?: string[];
  severity: 'error' | 'warning';
  message: string;
  suggestedFix?: string;
}

export interface SubmitFeedbackDto {
  bomItemId: string;
  aiProcessSequence: string[];
  aiMachines?: Record<string, string>;
  engineerSequence: string[];
  engineerMachines?: Record<string, string>;
  correctionReason?: string;
  partFamily?: string;
  material?: string;
}

export interface ValidateRouteDto {
  processSequence: string[];
  partFamily: string;
  machineAssignments?: Record<string, string>;
}
