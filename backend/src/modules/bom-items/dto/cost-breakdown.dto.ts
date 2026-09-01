export interface ProcessCO2 {
  process: string;       // "Laser Cutting"
  machineClass: string;  // "fiber_laser"
  energyKwh: number;
  co2Kg: number;
}

export interface CO2Contributor {
  label: string;   // "Material Production" | process name
  co2Kg: number;
  pct: number;     // share of totalCo2Kg, 0–100
}

export interface ScoreBreakdown {
  materialEfficiency: number;  // 0–30
  carbonIntensity: number;     // 0–30
  recyclability: number;       // 0–20
  processEnergy: number;       // 0–20
}

export interface SustainabilitySummaryDto {
  netWeightKg: number;
  scrapKg: number;
  wasteCostInr: number;            // scrapKg × materialCostPerKg
  materialUtilizationPct: number;  // 0–100
  materialCo2Kg: number;
  materialCo2PerKg: number;           // embodied carbon factor used (kg CO₂e / kg material)
  materialCo2Source: 'lookup' | 'default';
  processCo2Breakdown: ProcessCO2[];
  totalProcessEnergyKwh: number;
  totalProcessCo2Kg: number;
  totalCo2Kg: number;
  co2PerKgPart: number;
  co2Contributors: CO2Contributor[];  // sorted descending by co2Kg
  recyclabilityPct: number;
  sustainabilityScore: number;        // 0–100
  scoreBreakdown: ScoreBreakdown;
  opportunities: string[];
  factorsSource: string;
}

// Slim summary for RouteResultDto — enables cost + cycle time + CO₂ side-by-side display
export interface RouteResultSustainability {
  totalCo2Kg: number;
  totalProcessEnergyKwh: number;
  wasteCostInr: number;
  sustainabilityScore: number;
}

import type { CapabilityCheck, MachineSelectionResult } from './machine-selection.dto';
import type { BlankSpecDto } from './blank-spec.dto';

/** One operation in a feature-level breakdown (eMithran-style sub-operations). */
export interface FeatureOp {
  name: string;        // "Drill Ø8.0mm ×3", "Tapping M8 ×2", "Pocket Mill ×2"
  timeSec: number;     // physics-computed cycle seconds for this group
  featureType: string; // 'drill' | 'tapping' | 'pocket' | 'laser_cut' | 'pierce' | 'bend' | …
  count: number;       // number of occurrences collapsed into this entry
}

export interface CalculationTraceStep {
  fieldName: string;         // real calculator_fields.field_name, e.g. "Cutting Speed"
  displayLabel: string;      // real calculator_fields.display_label, e.g. "Cutting Speed (m/min)"
  kind: 'input' | 'calculated';
  value: number | string | null;
  unit?: string | null;
  // 'input' steps: where this real value came from (CAD extraction, a named
  // sm_lookup_* table row, the currently selected machine, etc.).
  // 'calculated' steps: the real formula string as stored on the DB calculator
  // (e.g. "{Cutting Length} / ({Cutting Speed} * 1000)"), evaluated in order.
  source?: string;
  formula?: string;
  // Manufacturing Physics Calculator architecture: 'lookup' when this step's
  // value came from a real sm_lookup_* DB row (subject to that table's
  // resolution policy and real coverage gaps); 'physics' when it's a
  // deterministic formula over already-known values (always computable given
  // valid inputs — never itself "missing lookup data"). Optional/undefined
  // for calculators not yet migrated onto resolvePhysicsQuantity.
  stepType?: 'physics' | 'lookup';
}

// Every lookup table declares exactly one policy (lookup_table_policy,
// migration 427) — governs whether a miss may be bridged by controlled
// interpolation/range-bucketing or must surface as a real gap. See the
// Manufacturing Physics Calculator plan's rule 4 for the full definition of
// each tier.
export type LookupPolicyType = 'EXACT_MATCH' | 'INTERPOLATE' | 'RANGE' | 'FORMULA';

// One real query parameter used to search a lookup table — the actual
// column name and value, not a human-readable sentence a UI has to parse
// back apart.
export interface LookupQueryParam {
  column: string;
  value: string | number;
  unit?: string;
}

// A real row from the lookup table — either the exact match, or a
// candidate "nearest" row surfaced when there's no exact match (never
// fabricated: always a literal row that exists in the table today).
export interface LookupTableRow {
  columns: Record<string, string | number>;
  // For a nearest-row candidate: how many of the query's real dimensions it
  // agrees with, out of how many total — lets the UI say "matches 2 of 3
  // dimensions" instead of just dumping the row. Omitted on the exact match
  // itself (matches every dimension by definition).
  matchedDimensions?: number;
  totalDimensions?: number;
}

// The full, structured account of one lookup-table query: what table, what
// policy governs it, exactly what was searched for, what (if anything)
// matched, and what real rows exist nearby. This is the single source of
// truth for "why didn't this resolve" — the UI renders these fields
// directly; it never re-derives them by parsing a formatted sentence. Also
// the shape the Lookup Coverage Dashboard aggregates over (same real
// queryParams/matchedRow facts, just rolled up across parts instead of
// shown for one).
export interface LookupResolution {
  table: string;
  policy: LookupPolicyType;
  queryParams: LookupQueryParam[];
  matchedRow: LookupTableRow | null;
  nearestRows: LookupTableRow[];
}

// Confirms a real input the calculator used was present and valid — i.e.
// explicitly NOT part of the problem. Exists so a lookup gap's report can
// show "these real inputs resolved fine" separately from "this specific
// lookup failed" — a real bug earlier in this architecture's life listed
// every OTHER resolved input as if it were part of the missing data.
export interface ValidatedInput {
  fieldName: string;
  value: string | number;
  source: string;
}

// Two distinct gap types, with different owners/triage — see
// resolvePhysicsQuantity's own doc comment (bom-items.service.ts).
export interface LookupGap {
  gapType: 'missing_lookup';
  process: string;
  machineClass: string;
  // Every other real input the calculator used, confirmed present/valid —
  // rendered separately from lookupResolution so it's never mistaken for
  // part of the gap.
  inputValidation: ValidatedInput[];
  // The one lookup that actually failed, fully structured — see
  // LookupResolution's own doc comment.
  lookupResolution: LookupResolution;
  // Ready-to-display next step, built FROM lookupResolution's real
  // queryParams (not a separate free-text field someone can drift out of
  // sync with the structured data) — e.g. "Add a real, sourced row to
  // sm_lookup_manual_stroke for thickness_mm=2, tonnage=1, complexity=simple."
  requiredAction: string;
  suggestedSources?: string[];
  priority: 'low' | 'medium' | 'high';
}
export interface UnsupportedOperationGap {
  gapType: 'unsupported_operation';
  process: string;
  machineClass: string;
  reason: string;
  requiredCapability?: string;
}
export type PhysicsGap = LookupGap | UnsupportedOperationGap;

// How much this result should be trusted:
//   'verified'    — every input was real CAD/BOM data or an exact/lookup-table
//                    hit (sm_lookup_* row, EXACT_MATCH policy) for this
//                    specific part — nothing assumed.
//   'derived'      — the calculator resolved a real number, but at least one
//                    input came from a disclosed engineering-standard
//                    assumption (a fallback depth, a published-but-generic
//                    speed/feed table, a standard angle) rather than a
//                    part-specific measurement or exact lookup — real,
//                    sourced, but not exact for this part.
//   'unsupported'  — no calculator registered, or the calculator couldn't
//                    resolve the requested output at all (see `gap`).
export type ConfidenceLevel = 'verified' | 'derived' | 'unsupported';

// A coarser, five-state summary of HOW a ManufacturingPhysicsResult was
// produced — independent of ConfidenceLevel (which grades how much to TRUST
// the result once produced). Derived from the same gap/inputs/outputs the
// resolver already has, never a separate flag a caller sets by hand.
//   'resolved'              — every value came from a real CAD/BOM input, an
//                              exact lookup hit, or a deterministic formula.
//   'nearest_match'         — resolved, but at least one lookup-sourced input
//                              was a disclosed nearest-neighbor substitution
//                              rather than an exact hit.
//   'missing_lookup'        — mirrors LookupGap.gapType exactly; see `gap`.
//   'unsupported_operation' — mirrors UnsupportedOperationGap.gapType exactly
//                              (also used when the process was never asked —
//                              e.g. a zero-count feature — same convention
//                              ConfidenceLevel already follows for that case).
//   'invalid_input'         — a provided numeric input, or a computed
//                              intermediate/output value, was not a finite
//                              number (NaN/Infinity — e.g. a divide-by-zero
//                              in the calculator's own formula). A bad value,
//                              not a missing lookup row — `gap` stays null.
export type ResolutionStatus = 'resolved' | 'nearest_match' | 'missing_lookup' | 'unsupported_operation' | 'invalid_input';

// The single, standardized return shape every Manufacturing Physics
// Calculator resolution (resolvePhysicsQuantity, bom-items.service.ts)
// produces — every process's calculator call returns exactly this, not a
// bespoke per-process result. `trace` is the full ordered evaluation
// sequence (inputs interleaved with calculated fields, in real
// display_order) — the right shape for an on-screen/exported trace panel;
// `inputs`/`lookupTrace`/`formulas`/`intermediateResults` are the same data
// re-sliced into the specific views the architecture calls for, so a
// consumer that only wants "what did this pull from a lookup table" doesn't
// have to filter `trace` itself.
export interface ManufacturingPhysicsResult {
  calculatorId: string | null;
  // calculators.version (migration 428) — bumped when a calculator's
  // fields/formulas change; never edited in place.
  calculatorVersion: number | null;
  // Reserved for a future per-field/per-formula version (e.g. a
  // calculator_fields.formula_version column) finer-grained than the whole
  // calculator's version — no such column exists yet, so this mirrors
  // calculatorVersion today rather than fabricating an independent number.
  // Kept as its own field so that finer-grained versioning can populate it
  // later without an interface change.
  formulaVersion: number | null;
  // Every real input value actually used (kind === 'input' trace steps) —
  // CAD/BOM data and lookup-sourced values alike, each with its real source.
  inputs: CalculationTraceStep[];
  // The subset of inputs whose value came from a named sm_lookup_* table
  // (stepType === 'lookup') — what this result depended on the DB for.
  lookupTrace: CalculationTraceStep[];
  // Every calculated field, in evaluation order, with its real DB formula
  // string (kind === 'calculated' trace steps).
  formulas: CalculationTraceStep[];
  // Every calculated field's numeric value, keyed by field name — includes
  // the caller's requested target field(s) as well as whatever intermediate
  // fields the calculator evaluated on the way there (e.g. Spindle RPM before
  // Machining Time).
  intermediateResults: Record<string, number>;
  // The caller's requested target field(s) only — undefined (never a
  // fallback number) for any that didn't resolve.
  outputs: Record<string, number | undefined>;
  // Human-readable, ready-to-display warning strings — generated once here
  // from `gap` (when present) so every caller doesn't re-derive the same
  // "missing_lookup vs unsupported_operation" message formatting.
  warnings: string[];
  // fieldName -> source string, lifted from `inputs` for quick lookup
  // without re-scanning the trace array.
  provenance: Record<string, string>;
  // Full ordered trace — see doc comment above.
  trace: CalculationTraceStep[];
  // Present instead of a fabricated fallback when a target output couldn't
  // resolve — see LookupGap/UnsupportedOperationGap.
  gap: PhysicsGap | null;
  // See ConfidenceLevel's own doc comment. Inferred from `gap` + each input
  // step's disclosed source text (whether it reads as a real measurement/
  // exact lookup vs. a disclosed standard/assumption) — not a separate,
  // independently-tracked field a caller sets by hand, so it can never drift
  // out of sync with what the trace actually shows.
  confidence: ConfidenceLevel;
  // See ResolutionStatus's own doc comment.
  resolutionStatus: ResolutionStatus;
}

export interface ProcessLineCost {
  process: string;       // "Laser Cutting", "Press Brake", "Tapping", "Deburring" — cosmetic display label only
  // Real process_calculator_mappings identity for this line, when the engine can state it
  // unambiguously (e.g. the laser line always means fiber/CO2 laser cutting specifically).
  // Absent on engines not yet updated to populate it — consumers must fall back to deriving
  // group/route from machineClass rather than reusing `process` as both route and operation
  // (that produced a real bug: process_cost_records saved with processRoute === operation ===
  // the bare display label, which never matches a real mapping row).
  processGroup?: string;
  processRoute?: string;
  operation?: string;
  setupCost: number;     // INR — amortised over batchSize
  runCost: number;       // INR — pure cycle cost per piece
  totalCost: number;     // setupCost + runCost
  cycleTimeMin: number;  // machine cycle time in minutes (setup excluded)
  // Raw, un-amortised setup time in minutes — distinct from setupCost (which
  // is already divided by batchSize). Optional: not every producer populates
  // it yet; consumers must not assume presence. Added for P0.2 so an applied
  // process_cost_records row's setup_time can be verified end-to-end against
  // Cost Summary, not just its already-amortised dollar cost.
  setupTimeMin?: number;
  hourlyRate: number;    // local currency/hr — fully burdened MHR (machine + labour)
  rateSource: 'mhr_database' | 'default_rate' | 'no_db_rate' | 'tier_synthetic' | 'benchmark_override';
  machineClass: string;        // e.g. 'fiber_laser' — maps to MACHINE_REGISTRY key
  machineName: string | null;  // DB machine_name; null when source is 'default_rate'
  commodityCode: string | null; // DB commodity_code; null when source is 'default_rate'
  // Labour hour rate from lhr_benchmark_rates for this location + process group.
  // Already included in hourlyRate (fully burdened) — surfaced for display transparency.
  labourRate?: number | null;
  // Which of resolveLHRRates' 4 passes actually resolved labourRate above —
  // mirrors rateSource's own provenance visibility, for the labor side.
  labourRateSource?: 'lhr_database' | 'lhr_benchmark' | 'lhr_cross_location' | 'no_lhr_rate' | 'mhr_machine_specific' | null;
  // Physics-based selection result (recommendation + alternatives + profiles).
  // Attached by BOMItemsService when ENABLE_PHYSICS_MACHINE_SELECTION is on.
  machineSelection?: MachineSelectionResult;
  // Real mhr_records id / 'bm-mhr-<id>' benchmark id for this line's resolved
  // resource — set directly (not via machineSelection) on classes priced
  // through a flat single-resource resolver instead of the full candidate-
  // list machine selection (currently just Inspection — see
  // resolveCmmSpecificRate/resolveGenericInspectionRate). Lets the frontend
  // persist a real machine link for these lines instead of always saving
  // "not linked to a machine" even when a real, priced resource was used.
  mhrId?: string | null;
  benchmarkMhrId?: string | null;
  // eMithran-style per-feature operation breakdown. Present on CNC Milling (per hole/pocket/tap),
  // Laser Cutting (cut path + pierces), and Press Brake (per bend group). Absent on Setup/Deburr/Inspect.
  featureBreakdown?: FeatureOp[];
  // Full end-to-end audit trail for how this line's cycle time was computed:
  // every real input value (with its provenance — CAD extraction, a specific
  // sm_lookup_* DB table row, or the currently selected machine), then every
  // calculated field in evaluation order with its real DB-stored formula
  // string and the value it evaluated to. Present only for processes wired to
  // a real DB calculator (Laser Cutting, Press Brake so far) — absent
  // elsewhere, not a fabricated placeholder. Powers the "Download calculation"
  // PDF export so costing/manufacturing engineering can verify the number
  // independent of this app.
  calculationTrace?: CalculationTraceStep[];
  // Manufacturing Physics Calculator architecture: which real, registry-
  // resolved calculator (and version — see migration 428) computed this
  // line's cycle time, when resolved via resolvePhysicsQuantity. Absent for
  // processes not yet migrated onto that pipeline.
  calculatorId?: string;
  calculatorVersion?: number;
  // Present instead of a fabricated fallback number when resolvePhysicsQuantity
  // couldn't resolve this line's cycle time — the line still appears (never
  // silently omitted), but cycleTimeMin/totalCost reflect the gap (0/null),
  // not a guessed value. See LookupGap/UnsupportedOperationGap.
  physicsGap?: PhysicsGap;
  // See ConfidenceLevel's own doc comment — lifted from the resolvePhysicsQuantity
  // result that computed this line. Absent for processes not yet migrated onto
  // that pipeline (never fabricated as 'verified' by omission).
  confidence?: ConfidenceLevel;
  // A genuinely separate axis from `confidence` above: that field grades the
  // PROCESS PARAMETERS (did cycle time come from a real sm_lookup_* row);
  // this one grades the SELECTED MACHINE's own capability data
  // (machine-selection/selector.ts's capabilitySource: 'imported' → verified,
  // 'seed'/'benchmark' → derived, 'default_class'/unset → unsupported). A
  // line can have verified process parameters while running on a machine
  // with no real capability on file at all — e.g. a real sm_lookup_laser_cut
  // hit for a press-brake bend, priced against a machine whose "60T" is
  // MACHINE_CLASS_DEFAULTS, not that specific machine's real rating.
  capabilityConfidence?: ConfidenceLevel;
  // Explanation for a SAVED process row's own machine, keyed by mhrId, for when
  // that machine differs from the live balanced/cheapest/fastest picks above
  // (utilization/cost scores can drift after the row was saved). Lets the UI
  // show honest reasoning for whichever machine a saved row actually names,
  // instead of suppressing the explanation entirely or misattributing the
  // live pick's reasoning to a different machine.
  savedMachineExplanations?: Record<string, { reasons: string[]; capabilityCheck: CapabilityCheck | null }>;
}

// 'incomplete' whenever any processLines entry carries a physicsGap (a
// process the Manufacturing Physics Calculator pipeline couldn't resolve —
// missing lookup data or an unsupported operation, never a guessed number).
// totalCost/totalProcessCost below still sum whatever DID resolve, for
// engineering inspection — but that sum is a partial figure, not a real
// quote, and callers (frontend export/finalize-quote actions) must gate on
// this rather than presenting totalCost as if every process priced cleanly.
export type CostStatus = 'complete' | 'incomplete';

export interface CostSummaryDto {
  // Scenario readiness gate — explicitly false when required inputs are missing.
  // Absent (undefined) or true means ready. Frontend blocks cost display on false.
  scenarioReady?: boolean;
  missingInputs?: string[];  // e.g. ['materialGrade']

  // See CostStatus's own doc comment. Optional on the same convention as
  // currency/toUsdRate below — the per-family engines (cost-engine.ts,
  // cost-cnc-engine.ts, cost-injection-molding-engine.ts) build this DTO
  // before normalizeCostSummaryToUsd fills it in; always present by the time
  // a getCostSummary response reaches a caller.
  costStatus?: CostStatus;
  // Process names with an unresolved physicsGap, when costStatus is
  // 'incomplete' — a quick list for the UI without re-scanning processLines.
  incompleteProcesses?: string[];

  // Material
  materialCost: number;
  materialGrade: string;
  grossWeightKg: number;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';

  // Process lines (one entry per active process)
  processLines: ProcessLineCost[];
  totalProcessCost: number;

  // Grand total
  totalCost: number;

  // Cycle time breakdown (minutes)
  cycleTimes: {
    laserMin: number;
    pressBrakeMin: number;
    tappingMin: number;
    deburrMin: number;
    totalMin: number;
  };

  // Scenario context
  batchSize: number;
  family: string;
  setupCount?: number;  // CNC: number of machine setups (1 = 5-axis, 2 = 4-axis, 3 = 3-axis)

  // Blank stock selected for this part — visible in the Cost Guide Panel.
  // CNC: round bar / rectangular bar / billet (from BlankOptimizerService).
  // Sheet metal: flat blank area × thickness.
  blankSpec?: BlankSpecDto;

  // CNC: billet/bar stock vs finish weight breakdown
  materialRemoval?: {
    billetWeightKg: number;
    finishedWeightKg: number;
    utilizationPct: number;   // 0–100 (net/billet × 100)
    chipScrapPct: number;     // 100 - utilizationPct
  };

  // Transparency
  warnings: string[];
  ratesSource: string;

  // Provenance of cost-critical geometry inputs (sheet metal only) — which
  // source supplied each value, for quote debugging. 'cad' = measured geometry,
  // 'drawing' = drawing intelligence, 'estimated' = inferred from route,
  // 'reconstructed' = derived (volume ÷ thickness).
  geometryProvenance?: {
    bendSource: 'cad' | 'drawing' | 'estimated';
    blankAreaSource: 'cad' | 'reconstructed';
  };

  // Display currency (set by getCostSummary; undefined = legacy INR response).
  // Defaults to USD when the scenario has no saved FX snapshot (Currency &
  // Ask Price widget) for this item's current factory currency — see
  // normalizeCostSummaryToCurrency/resolveDisplayCurrency in bom-items.service.ts.
  currency?: string;         // ISO 4217 code of the CURRENT display currency, e.g. 'INR', 'USD', 'EUR', 'CNY'
  currencySymbol?: string;   // display symbol for `currency`: '₹', '$', '€', '¥'
  toUsdRate?: number;        // amount_local × toUsdRate = amount in `currency` (name predates scenario currencies; no longer always USD)
  // amount_usd × usdToDisplayRate = amount in `currency`. DIFFERENT from toUsdRate
  // above (which converts the factory's own native-currency figures already
  // embedded in this DTO) — this one is for the frontend to convert fields it
  // reads from OTHER, always-USD-denominated tables (raw_material_cost_records.
  // unit_cost, packaging/procured/tooling totals, process_cost_records rates).
  // Conflating the two is exactly how a real $1.175/kg got relabeled ₹1.175/kg
  // instead of converted — see bom-items.service.ts's resolveDisplayCurrency.
  usdToDisplayRate?: number;
  // amount_inr × inrToDisplayRate = amount in `currency`. Same idea as
  // usdToDisplayRate above, for frontend constants/estimates that are
  // denominated in INR regardless of factory location (e.g. the NRE/
  // Investment tab's fixture/programming/tooling/inspection cost tables) —
  // without this, converting an INR-based estimate required either a
  // duplicate hardcoded FX table on the frontend or silently mislabeling the
  // INR number under whatever symbol the factory happened to be using.
  inrToDisplayRate?: number;

  // Persistent eMithran-style manual overrides applied to this response, keyed
  // by 'mat_rate' | '<process>::rate' | '<process>::cycleMin'. materialCost /
  // processLines above already reflect these — this map is purely so the UI
  // can render the amber "overridden" state and a reset-to-computed control
  // without re-deriving which fields were touched.
  costOverrides?: Record<string, number>;

  // Manufacturing sustainability (computed from same inputs, zero extra DB queries)
  sustainability: SustainabilitySummaryDto;

  // Routed process tree (injection molding today; other families as their
  // routing engines migrate to the tree structure). Each operation carries the
  // rule that selected it — the route's audit trail, line by line.
  processTree?: import('../costing/injection-molding/process/process-tree').IMProcessTree;

  // Injection-molding-specific piece-cost breakdown (separate from tooling).
  // Present only when family === 'injection_molded'.
  injectionMolding?: InjectionMoldingBreakdown;

  // Tooling cost — always separate from pieceCostUsd.
  // Present only when family === 'injection_molded' and annualVolume / productionLifeYears provided.
  tooling?: ToolingCostDto;
}

export interface InjectionMoldingBreakdown {
  moldingSubtype: 'standard' | 'lsr' | 'insert' | 'overmold' | 'gas_assisted' | 'two_shot' | 'unscrewing';
  cavityCount: number;
  cavityConstrainedBy: 'clamp' | 'shot_capacity' | 'economic' | 'default';
  runnerSystemType: 'hot' | 'cold';
  runnerScrapKg: number;
  gateType: string;
  undercutCount: number | null;
  partingComplexity: number | null;
  cycleTimeSec: number;           // Menges (thermoplastic) or Arrhenius (LSR)
  cavityCycleTimeSec: number;     // cycleTime / cavityCount
  costConfidence: number;         // 0.0–1.0
}

export interface ToolingCostDto {
  moldClass: 'Class101' | 'Class102' | 'Class103' | 'Class104' | 'Class105';
  moldLifeShotRating: number;
  moldCostUsd: number;
  moldCostPerPartUsd: number;
  annualVolume: number;
  productionLifeYears: number;
}
