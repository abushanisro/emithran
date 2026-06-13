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

export interface ProcessCandidate {
  candidateId: string;        // 'op-1', ...
  dbId: string;               // real processes.id
  processName: string;
  processCategory: string;    // Machining | Casting | Sheet Metal | ...
  machineType: string | null;
  standardTimeMinutes: number | null;
  setupTimeMinutes: number | null;
  cycleTimeMinutes: number | null;
  skillLevelRequired: string | null;
  score: number;
}

export interface CalculatorCandidate {
  candidateId: string;        // 'cl-1', ...
  dbId: string;               // real calculators.id
  name: string;
  calcCategory: string;
  description: string | null;
  score: number;
}

export interface CandidateSet {
  rawMaterials: MaterialCandidate[];
  machines: MachineCandidate[];
  labour: LabourCandidate[];
  processes: ProcessCandidate[];
  calculators: CalculatorCandidate[];
}
