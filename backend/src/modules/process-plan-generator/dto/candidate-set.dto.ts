/**
 * CandidateSet — Stage 1 output. Pre-ranked top-N rows from each master,
 * given symbolic IDs so the LLM never has to handle a real DB UUID.
 *
 * Symbolic-ID prefixes:
 *   rm-N → raw material
 *   mc-N → machine (MHR)
 *   lb-N → labour band (LSR)
 *   op-N → process operation
 *   cl-N → calculator
 */

export interface MaterialCandidate {
  candidateId: string;        // 'rm-1', 'rm-2', ...
  dbId: string;               // real raw_materials.id
  materialGroup: string;
  material: string;
  grade: string | null;
  densityKgPerM3: number | null;
  unitCostInrPerKg: number;
  location: string | null;
  score: number;              // 0..1, higher = better fit for brief
}

export interface MachineCandidate {
  candidateId: string;        // 'mc-1', ...
  dbId: string;               // real mhr.id (or mhr_records.id)
  machineName: string;
  commodityCode: string | null;
  description: string | null;
  rateInrPerHour: number;
  location: string | null;
  score: number;
}

export interface LabourCandidate {
  candidateId: string;        // 'lb-1', ...
  dbId: string;               // real lsr.id (or lsr_records.id)
  labourType: string;         // Unskilled | Semi-Skilled | Skilled | Highly Skilled
  labourCode: string | null;
  lhrInrPerHour: number;
  location: string | null;
  score: number;
}

export interface ProcessReferenceTable {
  tableName: string;
  columnDefinitions: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
}

export interface ProcessCandidate {
  candidateId: string;        // 'op-1', ...
  dbId: string;               // real process_calculator_mappings.id
  processGroup: string;       // mapping.process_group  (e.g. "Sheet Metal")
  processRoute: string;       // mapping.process_route  (e.g. "Sheet Cutting")
  operation: string;          // mapping.operation      (e.g. "Shearing")
  calculatorId: string | null; // mapping.calculator_id
  score: number;
  referenceTables: ProcessReferenceTable[]; // lookup tables attached to this process
}

export interface CalculatorFieldDef {
  fieldName: string;
  dataSource: string | null;  // 'mhr' | 'lhr' | 'raw_materials' | 'processes' | 'manual'
  sourceField: string | null; // e.g. 'total_machine_hour_rate', 'cycle_time_minutes'
  defaultValue: string | null;
}

export interface CalculatorFormulaDef {
  formulaName: string | null;   // e.g. 'rpm', 'cycle_time' — stored by name in scope for chaining
  formulaExpression: string;
  executionOrder: number;
  isPrimaryResult: boolean;
}

export interface CalculatorCandidate {
  candidateId: string;        // 'cl-1', ...
  dbId: string;               // real calculators.id
  name: string;
  calcCategory: string;
  description: string | null;
  score: number;
  fields: CalculatorFieldDef[];
  formulas: CalculatorFormulaDef[];
}

export interface ToolingCandidate {
  candidateId: string;        // 'tc-N'
  dbId: string;               // tooling_cost_records.id
  toolingType: string;        // cutting_tool | fixture | jig | gauge | die | mold | other
  description: string;
  specifications: string | null;
  unitCostInr: number;        // ₹ per unit — from DB
  quantity: number;           // units — from DB
  amortizationParts: number;  // amortised over N parts — from DB
  usagePercentage: number;    // % — from DB
  costPerPart: number;        // pre-computed: (unitCostInr × quantity × usagePct/100) / amortizationParts
  isCustom: boolean;
  supplier: string | null;
  score: number;
}

export interface CandidateSet {
  rawMaterials: MaterialCandidate[];
  machines: MachineCandidate[];
  labour: LabourCandidate[];
  processes: ProcessCandidate[];
  calculators: CalculatorCandidate[];
  tooling: ToolingCandidate[];
}
