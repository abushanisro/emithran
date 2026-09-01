// Proves the "canonical cost-result" claim in cost-result.ts: a real Sheet
// Metal line, a real CNC line, and a real Injection Molding line all satisfy
// the SAME re-exported ProcessLineCost/CostSummaryDto shape with no `as any`
// — i.e. this is genuinely already a shared cross-domain contract, not
// something Phase 1 invented.
import type { ProcessLineCost, CostSummaryDto } from '../../domain/cost-result';
import { provenanceOfMhrSource, provenanceOfLhrSource } from '../../domain/rate-provenance';

describe('canonical cost-result domain contract', () => {
  const sheetMetalLaserLine: ProcessLineCost = {
    process: 'Laser Cutting',
    processGroup: 'Sheet Metal',
    processRoute: 'Fiber Laser Cutting',
    operation: 'Perimeter Cut',
    setupCost: 12.5,
    runCost: 34.2,
    totalCost: 46.7,
    cycleTimeMin: 3.4,
    setupTimeMin: 15,
    hourlyRate: 65,
    rateSource: 'mhr_database',
    machineClass: 'fiber_laser',
    machineName: 'Trumpf TruLaser 3030',
    commodityCode: null,
    labourRate: 8.5,
    labourRateSource: 'lhr_database',
  };

  const cncMilledLine: ProcessLineCost = {
    process: 'CNC Milling',
    setupCost: 20,
    runCost: 55,
    totalCost: 75,
    cycleTimeMin: 6.1,
    hourlyRate: 45,
    rateSource: 'default_rate',
    machineClass: 'cnc_3ax_vmc',
    machineName: null,
    commodityCode: null,
  };

  const injectionMoldedLine: ProcessLineCost = {
    process: 'Injection Molding',
    setupCost: 40,
    runCost: 2.1,
    totalCost: 42.1,
    cycleTimeMin: 0.5,
    hourlyRate: 30,
    rateSource: 'tier_synthetic',
    machineClass: 'injection_molding',
    machineName: null,
    commodityCode: null,
  };

  it('accepts a real Sheet Metal, CNC, and Injection Molding line under the same type', () => {
    const lines: ProcessLineCost[] = [sheetMetalLaserLine, cncMilledLine, injectionMoldedLine];
    expect(lines).toHaveLength(3);
  });

  it('a CostSummaryDto can mix lines from all three domains (proves the shared contract at the summary level too)', () => {
    const summary: CostSummaryDto = {
      materialCost: 100,
      materialGrade: 'SS304',
      grossWeightKg: 1.2,
      materialCostPerKg: 3.5,
      materialSource: 'db',
      processLines: [sheetMetalLaserLine, cncMilledLine, injectionMoldedLine],
      totalProcessCost: sheetMetalLaserLine.totalCost + cncMilledLine.totalCost + injectionMoldedLine.totalCost,
      totalCost: 100 + sheetMetalLaserLine.totalCost + cncMilledLine.totalCost + injectionMoldedLine.totalCost,
      cycleTimes: { laserMin: 3.4, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 3.4 },
      batchSize: 100,
      family: 'sheet_metal',
      warnings: [],
      ratesSource: 'Location benchmark rates v2 (2026)',
      sustainability: {
        netWeightKg: 1.2,
        scrapKg: 0.3,
        wasteCostInr: 15,
        materialUtilizationPct: 80,
        materialCo2Kg: 2.1,
        materialCo2PerKg: 1.75,
        materialCo2Source: 'lookup',
        processCo2Breakdown: [],
        totalProcessEnergyKwh: 0.5,
        totalProcessCo2Kg: 0.4,
        totalCo2Kg: 2.5,
        co2PerKgPart: 2.08,
        co2Contributors: [],
        recyclabilityPct: 90,
        sustainabilityScore: 72,
        scoreBreakdown: { materialEfficiency: 24, carbonIntensity: 20, recyclability: 18, processEnergy: 10 },
        opportunities: [],
        factorsSource: 'default',
      },
    };
    expect(summary.processLines).toHaveLength(3);
  });

  it('maps every real rateSource/labourRateSource value to a provenance tier with no silent fallthrough', () => {
    expect(provenanceOfMhrSource('mhr_database')).toBe('REAL');
    expect(provenanceOfMhrSource('benchmark_override')).toBe('BENCHMARK');
    expect(provenanceOfMhrSource('default_rate')).toBe('BENCHMARK');
    expect(provenanceOfMhrSource('tier_synthetic')).toBe('ESTIMATE');
    expect(provenanceOfMhrSource('no_db_rate')).toBe('NO_RATE');

    expect(provenanceOfLhrSource('lhr_database')).toBe('REAL');
    expect(provenanceOfLhrSource('mhr_machine_specific')).toBe('REAL');
    expect(provenanceOfLhrSource('lhr_benchmark')).toBe('BENCHMARK');
    expect(provenanceOfLhrSource('lhr_cross_location')).toBe('REFERENCE');
    expect(provenanceOfLhrSource('no_lhr_rate')).toBe('NO_RATE');
    expect(provenanceOfLhrSource(null)).toBe('NO_RATE');
    expect(provenanceOfLhrSource(undefined)).toBe('NO_RATE');
  });
});
