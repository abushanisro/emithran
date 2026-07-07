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

import type { MachineSelectionResult } from './machine-selection.dto';

export interface ProcessLineCost {
  process: string;       // "Laser Cutting", "Press Brake", "Tapping", "Deburring"
  setupCost: number;     // INR — amortised over batchSize
  runCost: number;       // INR — pure cycle cost per piece
  totalCost: number;     // setupCost + runCost
  cycleTimeMin: number;  // machine cycle time in minutes (setup excluded)
  hourlyRate: number;    // INR/hr — MHR applied to this line
  rateSource: 'mhr_database' | 'default_rate' | 'tier_synthetic';
  machineClass: string;        // e.g. 'fiber_laser' — maps to MACHINE_REGISTRY key
  machineName: string | null;  // DB machine_name; null when source is 'default_rate'
  commodityCode: string | null; // DB commodity_code; null when source is 'default_rate'
  // Physics-based selection result (recommendation + alternatives + profiles).
  // Attached by BOMItemsService when ENABLE_PHYSICS_MACHINE_SELECTION is on.
  machineSelection?: MachineSelectionResult;
}

export interface CostSummaryDto {
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

  // Location currency (set by getCostSummary; undefined = legacy INR response)
  currency?: string;         // ISO 4217 code: 'INR', 'USD', 'EUR', 'CNY'
  currencySymbol?: string;   // display symbol: '₹', '$', '€', '¥'
  toUsdRate?: number;        // amount_local × toUsdRate = amount_usd

  // Persistent aPriori-style manual overrides applied to this response, keyed
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
  processTree?: import('../costing/injection-molding/process-tree').IMProcessTree;

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
