import type { MHRRateInput } from './cost-engine';
import type { ProcessLineCost, PhysicsGap, ConfidenceLevel } from '../dto/cost-breakdown.dto';
import type { CapabilityCheck, PartGeometryForCapability } from './machine-capability';
import type { MachineCapability } from './machine-selection/seed-registry';

// Real, material+thickness-specific process params resolved by the caller
// from a DB lookup table (sm_lookup_waterjet_cut) — never computed or
// guessed inside an engine. `dataFound: false` means the caller had no real
// row for this material/thickness; the engine falls back to its own
// documented baseline table with a disclosed warning, never an invented
// number. (Laser Cutting no longer uses this pattern — see
// cuttingSecFromCalculator below, resolved via the Manufacturing Physics
// Calculator pipeline instead.)
export interface WaterjetParams {
  cuttingSpeedMmPerMin: number;
  pierceTimeMin: number;
  dataFound: boolean;
}

// Real, thickness-specific turret-punch cycle-time params resolved by the
// caller from sm_lookup_turret_punch (migration 414) — same disclosed-
// fallback convention as WaterjetParams above.
export interface TurretParams {
  hitsPerMin: number;
  nibbleMmPerMin: number;
  toolChangeSec: number;
  dataFound: boolean;
}

// Real material-family cutting speed for 2-Axis Router, resolved by the
// caller from sm_lookup_router_cut (Track B Phase 2, tblRouterUtilities.json)
// via SheetMetalLookupService.getRouterParams(). Only Aluminum/Copper have
// real data in the source — dataFound:false for anything else is a genuine,
// disclosed gap, not a guess.
export interface RouterParams {
  cuttingSpeedMmPerMin: number;
  dataFound: boolean;
}

// Shared input every registered engine's computeCost() receives. Individual
// engines read only the fields their real formula actually needs (e.g. only
// WaterjetEngine reads abrasivePricePerKg/waterjetParams) — unused fields are
// simply ignored, never fabricated into that engine's calculation.
export interface CuttingProcessContext {
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number;
  holeCount: number;
  batchSize: number;
  grade: string | null;
  rate: MHRRateInput;
  // Real process_calculator_mappings identity for this machine class,
  // resolved by the caller (BOMItemsService.resolveProcessIdentities()) —
  // never hardcoded by an engine. Absent means the caller couldn't resolve
  // one; engines must not fabricate processGroup/processRoute/operation.
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  abrasivePricePerKg?: number;
  waterjetParams?: WaterjetParams | null;
  turretParams?: TurretParams | null;
  routerParams?: RouterParams | null;
  // Manufacturing Physics Calculator architecture: pre-resolved by the caller
  // via resolvePhysicsQuantity (bom-items.service.ts) for the engine whose
  // machineClass has a registered calculator (Laser Cutting today). Engines
  // without one (Waterjet, Turret Punch) simply ignore these fields — see
  // rule 1's per-process migration, not a batch cutover.
  cuttingSecFromCalculator?: number;
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  physicsGap?: PhysicsGap | null;
  confidence?: ConfidenceLevel;
  // Real garnet consumption rate (kg/min active cutting) — only WaterjetEngine
  // reads this. Resolved by the caller from sm_lookup_waterjet_abrasive_rate.
  abrasiveKgPerMin?: number;
  // Per-batch setup time (min) for THIS engine's own operation key — resolved
  // by the caller from sm_lookup_op_setup_time (migration 416), keyed by each
  // engine's own machineClass. Every engine reads this.
  opSetupMin?: number;
  // Real part weight (kg) — only TurretPunchEngine reads this today, for the
  // material-handling allowance (migration 530, closeout Plan Phase 2a).
  // Gross/blank weight, not net finished-part weight — handling happens on
  // the blank before scrap is removed.
  partWeightKg?: number;
  // Real handling-allowance rate resolved by the caller from
  // sm_handling_allowance_rates (SheetMetalLookupService.getHandlingAllowanceUsd)
  // for this engine's own machineClass. dataFound: false means no rate is
  // seeded for this machine class — the engine must NOT charge a guessed
  // allowance in that case.
  handlingAllowance?: { allowanceUsd: number; dataFound: boolean };
  // Real nozzle-wear cost/hr resolved by the caller from
  // sm_waterjet_nozzle_rates (SheetMetalLookupService.getWaterjetNozzleCostPerHr,
  // migration 531, closeout Plan Phase 2b). Only WaterjetEngine reads this.
  nozzleRate?: { costPerHr: number; dataFound: boolean };
}

export interface CuttingProcessResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  abrasiveCost: number;
  warnings: string[];
}

// One process = one engine. Capability, cost, consumables, and DFM-flavored
// warnings for that process stay encapsulated inside its own engine — never
// scattered back into bom-items.service.ts as new processes get added.
// `processFamily` groups engines the routing layer should consider together
// (e.g. 'sheet_metal_cutting' today) without engines needing to know about
// each other. Registering an engine here is a deliberate engineering act — "I
// implemented and verified a real cost formula for this machine class" — it
// is never inferred from a process_calculator_mappings catalog row existing.
export interface ManufacturingProcessEngine {
  readonly machineClass: string;
  readonly processFamily: string;
  // realCapability/capabilitySource: the real, DB-first hydrated capability
  // (and its provenance) for the specific machine `commodityCode` resolved to
  // (see machine-capability.ts's P0.1 doc comment) — optional so existing
  // callers/tests that don't yet have it in scope keep compiling; engines
  // pass both straight through unchanged.
  checkCapability(
    geometry: PartGeometryForCapability,
    commodityCode: string | null,
    realCapability?: MachineCapability | null,
    capabilitySource?: "imported" | "seed" | "default_class",
  ): CapabilityCheck;
  computeCost(context: CuttingProcessContext): CuttingProcessResult;
}
