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

export interface ProcessLineCost {
  process: string;       // "Laser Cutting", "Press Brake", "Tapping", "Deburring"
  setupCost: number;     // INR — amortised over batchSize
  runCost: number;       // INR — pure cycle cost per piece
  totalCost: number;     // setupCost + runCost
  cycleTimeMin: number;  // machine cycle time in minutes (setup excluded)
  hourlyRate: number;    // INR/hr — MHR applied to this line
  rateSource: 'mhr_database' | 'default_rate';
  machineClass: string;        // e.g. 'fiber_laser' — maps to MACHINE_REGISTRY key
  machineName: string | null;  // DB machine_name; null when source is 'default_rate'
  commodityCode: string | null; // DB commodity_code; null when source is 'default_rate'
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

  // Transparency
  warnings: string[];
  ratesSource: string;

  // Manufacturing sustainability (computed from same inputs, zero extra DB queries)
  sustainability: SustainabilitySummaryDto;
}
