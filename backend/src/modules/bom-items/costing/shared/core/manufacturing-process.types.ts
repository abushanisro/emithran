import type { MHRRateInput } from './cost-engine';
import type { ProcessLineCost, PhysicsGap, ConfidenceLevel } from '../../../dto/cost-breakdown.dto';
import type { CapabilityCheck, PartGeometryForCapability } from '../capability/machine-capability';
import type { MachineCapability } from '../capability/machine-selection/seed-registry';
import type { MachineClass } from './default-rates.constants';

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

// Real, material+thickness-specific OxyFuel Cut feed-rate/pierce-time
// params (2026-09-01), resolved by the caller from sm_reference_data's
// staged 'nestingCutRate:*:OxyFuelCut:*' rows (migration 492, real "USA
// reference export" data covering Steel/Cast Iron/Stainless Steel,
// 3mm-305mm) via SheetMetalLookupService.getOxyfuelParams(). Only
// feedRateLargeFeaturesMmPerMin is used for the main profile cut length —
// feedRateSmallFeaturesMmPerMin exists in the source but is deliberately
// NOT used yet (this app has no real per-hole "small feature length" to
// apply it to without fabricating one — a disclosed scoping choice, not
// an oversight). Same disclosed-fallback convention as WaterjetParams
// above: dataFound:false means an honest $0 cutting line, never a guess.
export interface OxyfuelParams {
  feedRateLargeFeaturesMmPerMin: number;
  pierceTimeSec: number;
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

// Real, per-SELECTED-MACHINE punch/nibble physics (2026-09-01), resolved by
// the caller from sm_reference_data's staged 'laserPunchMachine:<machine
// name>' rows (machine_library.json's "Laser Punch / Punch Press" category,
// all 26 real machines) via SheetMetalLookupService.getLaserPunchMachineParams().
// Unlike WaterjetParams/OxyfuelParams/TurretParams (resolved ONCE from
// material+thickness before machine selection), this is keyed by the
// specific machine mhrRates.laserPunch resolved to — a genuinely different
// class of combo laser+punch machine where hits/min and nibble speed are
// per-unit specs, not a shared material/thickness table. nibbleMmPerMin is
// pre-derived at resolution time from real nibble_rate_cycles_min ×
// (nibble_tool_diameter_mm − nibble_tool_overlap_mm) — standard nibbling
// step-per-cycle geometry (each cycle advances less than the full tool
// diameter to keep the cut edge continuous), not a fabricated speed.
// dataFound:false (no real row for this machine) means an honest $0
// punch/nibble line, never a guess.
export interface LaserPunchParams {
  punchRateCyclesPerMin: number;
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
  oxyfuelParams?: OxyfuelParams | null;
  turretParams?: TurretParams | null;
  routerParams?: RouterParams | null;
  laserPunchParams?: LaserPunchParams | null;
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
  // ── Shared cost-composition-core inputs (Phase 1, engine registry unification) ──
  // These 7 fields feed eMithranTerms() (engine-kernel.ts) — the platform's one
  // real, generic cost-composition core (machine + setup + direct-labor + QA
  // inspection-sampling + yield-loss cost). Resolved ONCE per request by the
  // caller (bom-items.service.ts), identically to how cost-engine.ts's
  // computeCostSummary() already resolves them for its own 9 inline blocks —
  // every registered engine now reads the SAME values, closing the formula
  // divergence that used to exist between the primary quote path and the
  // registry/route-comparison path. Absent means the caller genuinely has no
  // real rate/table for it; engines pass 0/defaults through eMithranTerms
  // exactly as cost-engine.ts's own destructuring defaults do — never a
  // silently different fallback invented at the engine level.
  qairPerHr?: number;
  inspTimeMin?: number;
  samplingRate?: number;
  yieldPct?: number;
  netMatCost?: number;
  netWeightKg?: number;
  scrapPricePerKg?: number;
  // Flat blanket direct-labor rate (CostEngineInput.directLaborRatePerHr in
  // cost-engine.ts) — the last-resort fallback when `rate.labourRate` itself
  // is null (this specific machine class has no differentiated labor rate
  // resolved via any of resolveLHRRates' 4 passes). Mirrors cost-engine.ts's
  // own `laserRate.labourRate ?? dlrPerHr` precedence exactly.
  dlrPerHr?: number;
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
//
// Generic over TContext/TResult/TGeometry/TCapabilityResult (Phase 1, engine
// registry unification): the original 7 sheet-metal cutting/forming engines
// (+ 8 secondary-op engines) use every default type arg unchanged (zero code
// required at their call sites). New engines outside that family (CNC,
// Injection Molding, Inspection) declare their own concretely-typed
// context/result — never a `Record<string, unknown>` escape hatch, so each
// engine keeps real compile-time safety over the fields its own formula
// actually reads. CNC/IM's real formula functions already compute a whole
// CostSummaryDto (material + every line + totals) internally, not just one
// line — those engines use TResult = CostSummaryDto; sheet-metal
// line-contributor engines keep TResult = CuttingProcessResult.
//
// TGeometry/TCapabilityResult exist because CNC's real capability check
// (bounding-box envelope + weight, checkCNCCapability in cost-cnc-engine.ts)
// is genuinely, structurally incompatible with PartGeometryForCapability
// (sheet-thickness/bend-length/UTS-shaped) — forcing CNC through that shape
// would mean fabricating fields it has no real geometry for. Sheet-metal
// engines use the defaults unchanged; CNC/IM declare their own.
export interface ManufacturingProcessEngine<
  TContext = CuttingProcessContext,
  TResult = CuttingProcessResult,
  TGeometry = PartGeometryForCapability,
  TCapabilityResult = CapabilityCheck,
> {
  readonly machineClass: MachineClass;
  readonly processFamily: string;
  // realCapability/capabilitySource: the real, DB-first hydrated capability
  // (and its provenance) for the specific machine `commodityCode` resolved to
  // (see machine-capability.ts's P0.1 doc comment) — optional so existing
  // callers/tests that don't yet have it in scope keep compiling; engines
  // pass both straight through unchanged.
  checkCapability(
    geometry: TGeometry,
    commodityCode: string | null,
    realCapability?: MachineCapability | null,
    capabilitySource?: "imported" | "seed" | "default_class",
  ): TCapabilityResult;
  computeCost(context: TContext): TResult;
}
