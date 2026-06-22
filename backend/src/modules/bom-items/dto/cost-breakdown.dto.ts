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
}
