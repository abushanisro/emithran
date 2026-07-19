/**
 * AbstractPlan — Stage 2 output. What the LLM emits via the `save_draft` tool.
 *
 * Lines reference masters by `candidateId` (or `proposedMasterId` for new
 * masters). Stage 3 resolves these to real DB IDs and validates against the
 * existing CreateXxxCostDto shapes.
 *
 * Validation: see `validateAbstractPlan` in
 * `process-plan-generator/services/abstract-plan.validator.ts`. We do NOT
 * use class-validator here because the input is raw LLM JSON, not a class
 * instance with decorators.
 */

export type PartFamilyHint = 'cnc_turned' | 'cnc_milled' | 'sheet_metal';

export interface AbstractRawMaterialLine {
  candidateId?: string;          // 'rm-N' from CandidateSet
  proposedMasterId?: string;     // OR points to a proposedMasters entry
  grossUsageKg: number;
  netUsageKg: number;
  scrapPct: number;
  overheadPct: number;
  reason: string;
}

export interface AbstractProcessLine {
  opNbr: number;
  candidateId?: string;          // 'op-N' from CandidateSet
  proposedMasterId?: string;     // OR points to a proposedMasters entry
  machineCandidateId: string;    // 'mc-N'
  labourCandidateId: string;     // 'lb-N'
  calculatorCandidateId?: string | null; // 'cl-N' optional
  featureId?: string;            // 'F1', 'F2' — which ManufacturingFeature this op addresses
  featureQty?: number;           // count of identical features this op covers (e.g. 11 tapped holes)
  machineCategoryHint?: string;  // routing template step.machine_type (e.g. 'bench_manual')
  batchSize: number;
  heads: number;
  partsPerCycle: number;
  scrapPct: number;
  reason: string;
  // Timing hints: optional — resolver overrides with calculator > lookup table > default
  setupMin?: number;
  setupManning?: number;
  cycleSec?: number;
  // When set to 'planner_physics' the resolver elevates this above the geometry heuristic
  // tier and writes timing_source = 'physics' to the cost record.
  timingSource?: 'planner_physics' | 'ai_hint' | string;
}

export interface AbstractToolingLine {
  candidateId: string;   // 'tc-N' from tooling CandidateSet — all cost data comes from DB
  reason: string;        // ≤ 240 chars, must cite the operation and why this tool is needed
}

export interface AbstractLogisticsLine {
  costName: string;
  logisticsType: 'packaging' | 'inbound' | 'outbound' | 'storage';
  modeOfTransport: 'road' | 'rail' | 'air' | 'sea';
  costBasis: 'per_unit' | 'per_batch' | 'per_kg' | 'per_km';
  unitCost: number;
  quantity: number;
  parameters: string;
  reason: string;
}

export interface AbstractProcuredPartLine {
  partName: string;
  partNumber: string;
  supplierName: string | null;
  unitCost: number;
  quantity: number;
  scrapPct: number;
  overheadPct: number;
  leadTimeDays: number | null;
  reason: string;
}

export interface AbstractProposedRawMaterial {
  kind: 'raw_material';
  proposedMasterId: string;          // 'pm-N'
  materialGroup: string;
  material: string;
  grade: string;
  densityKgPerM3: number;
  unitCostInrPerKg: number;
  location: string;
  reason: string;
}

export interface AbstractProposedProcess {
  kind: 'process';
  proposedMasterId: string;          // 'pm-N'
  processGroup: string;
  processRoute: string;
  operation: string;
  reason: string;
}

export type AbstractProposedMaster =
  | AbstractProposedRawMaterial
  | AbstractProposedProcess;

export interface AbstractPlan {
  partFamily: PartFamilyHint;
  rawMaterials: AbstractRawMaterialLine[];
  processes: AbstractProcessLine[];
  tooling: AbstractToolingLine[];
  logistics: AbstractLogisticsLine[];
  procuredParts: AbstractProcuredPartLine[];
  proposedMasters: AbstractProposedMaster[];
  notes?: string;
}
