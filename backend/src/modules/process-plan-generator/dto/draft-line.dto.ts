/**
 * DraftLine — Stage 3 output. AbstractPlan lines resolved against real DB IDs
 * and validated against the existing CreateXxxCostDto shapes.
 *
 * Each draft line carries:
 *   - `kind`           — which of the 5 cost tables it targets
 *   - `data`           — the payload that will be POSTed to that table at Apply
 *   - `references`     — symbolic dependencies (candidates considered, new
 *                        masters this line depends on)
 *   - `reason`         — the LLM's per-line justification
 *
 * The shapes inside `data` intentionally mirror the existing Create...Dto
 * payloads accepted by /raw-material-costs, /process-costs, /tooling-costs,
 * /packaging-logistics-costs, /procured-parts-costs.
 */

export type DraftLineKind =
  | 'raw_material'
  | 'process'
  | 'tooling'
  | 'logistics'
  | 'procured_part';

export interface CandidateConsidered {
  candidateId: string;
  label: string;
  score: number;
  chosen: boolean;
}

export interface DraftLineReferences {
  candidatesConsidered: CandidateConsidered[];
  // proposedMasterIds that must be inserted into masters before this line
  newMasterRefs: string[];
}

// ─── Per-kind payloads (mirror existing Create...CostDto shapes) ─────────────

export interface DraftRawMaterialPayload {
  // Either materialId is set (existing master) OR newMasterRef is set
  // (proposedMasters needs to be inserted at Apply).
  materialId: string | null;
  newMasterRef: string | null;
  materialCategory: string;          // 'FERROUS_NON_FERROUS' | 'PLASTIC_RUBBER' | ...
  materialGrade: string;
  unitCost: number;                  // INR/kg
  grossUsage: number;                // kg (includes scrap)
  netUsage: number;                  // kg
  scrapPercentage: number;
  overheadPercentage: number;
}

export interface DraftProcessPayload {
  processId: string | null;
  newMasterRef: string | null;
  mhrId: string | null;          // process_cost_records.mhr_id
  lsrId: string | null;          // process_cost_records.lsr_id
  machineName: string | null;    // denormalised display name
  labourType: string | null;     // denormalised display name
  machineRate: number;           // INR/hr from MHR candidate
  labourRate: number;            // INR/hr from LSR candidate
  directRate: number;            // machine + labour combined; REQUIRED by process_cost_records
  opNbr: number;
  setupManning: number;
  setupTimeMinutes: number;      // → setup_time
  batchSize: number;
  heads: number;
  cycleTimeSeconds: number;      // → cycle_time
  partsPerCycle: number;
  scrapPercentage: number;       // → scrap
}

export interface DraftToolingPayload {
  toolingType: string;
  description: string;
  specifications: string;
  unitCost: number;
  quantity: number;
  amortizationParts: number;
  usagePercentage: number;
  isCustom: boolean;
}

export interface DraftLogisticsPayload {
  costName: string;
  logisticsType: string;
  modeOfTransport: string;
  costBasis: string;
  unitCost: number;
  quantity: number;
  parameters: string;
}

export interface DraftProcuredPartPayload {
  partName: string;
  partNumber: string;
  supplierName: string | null;
  unitCost: number;
  quantity: number;
  scrapPercentage: number;
  overheadPercentage: number;
  leadTimeDays: number | null;
}

// ─── Discriminated union ────────────────────────────────────────────────────

export type DraftLine =
  | { kind: 'raw_material'; index: number; data: DraftRawMaterialPayload; references: DraftLineReferences; reason: string; estimatedCost: number | null }
  | { kind: 'process'; index: number; data: DraftProcessPayload; references: DraftLineReferences; reason: string; estimatedCost: number | null }
  | { kind: 'tooling'; index: number; data: DraftToolingPayload; references: DraftLineReferences; reason: string; estimatedCost: number | null }
  | { kind: 'logistics'; index: number; data: DraftLogisticsPayload; references: DraftLineReferences; reason: string; estimatedCost: number | null }
  | { kind: 'procured_part'; index: number; data: DraftProcuredPartPayload; references: DraftLineReferences; reason: string; estimatedCost: number | null };

export interface ProposedMaster {
  proposedMasterId: string;
  kind: 'raw_material' | 'process';
  data: Record<string, any>;
  reason: string;
  approved: boolean;       // updated by user via /apply payload
}

export interface DraftPackage {
  draftLines: DraftLine[];
  proposedMasters: ProposedMaster[];
  validationErrors: string[];
  costPreview: {
    rawMaterial: number;
    process: number;
    tooling: number;
    logistics: number;
    procuredPart: number;
    total: number;
  };
}
