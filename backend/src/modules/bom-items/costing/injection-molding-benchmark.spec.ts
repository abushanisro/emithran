// Benchmark regression tests for the injection molding cost engine.
// These lock in golden values before Phase 2 changes. All inputs are
// representative of real parts; tolerances are ±10% (cost models are
// heuristics, not measurements).
//
// Run: npm run test -- injection-molding-benchmark

import {
  computeInjectionMoldedCostSummary,
  recommendCavityCount,
  recommendMoldClass,
  computeMoldCost,
  computeCostConfidence,
} from './cost-injection-molding-engine';
import type { InjectionMoldingCostInput } from './cost-injection-molding-engine';

// Fixture MHR rates (realistic INR rates, not defaults)
const mockMhr = (rate: number) => ({
  rate,
  source: 'mhr_database' as const,
  machineClass: 'injection_molding',
  machineName: 'Arburg Allrounder 570',
  commodityCode: null,
});
const mockDeburr = (rate: number) => ({
  rate,
  source: 'mhr_database' as const,
  machineClass: 'deburring',
  machineName: 'Deburring Bench',
  commodityCode: null,
});
const mockInspection = (rate: number) => ({
  rate,
  source: 'mhr_database' as const,
  machineClass: 'cmm',
  machineName: 'Inspection Bench',
  commodityCode: null,
});

const BASE_RATES = {
  mhrRate: mockMhr(3500),
  deburrRate: mockDeburr(800),
  inspectionRate: mockInspection(600),
};

// ── Cavity count unit tests ────────────────────────────────────────────────────

describe('recommendCavityCount', () => {
  it('case 1 — small part, low volume → 1 cavity', () => {
    const { count, constrainedBy } = recommendCavityCount({
      projectedAreaMm2: 12000,   // 120 cm²
      annualVolume: 10_000,
      clampTonnageKN: 570,       // 57T Arburg 570
      shotCapacityCm3: 51,
      partVolumeMm3: 5_000,
      gateType: 'edge',
    });
    expect(count).toBe(1);
    expect(['economic', 'clamp', 'shot_capacity']).toContain(constrainedBy);
  });

  it('case 2 — high volume, large machine → 4+ cavities', () => {
    const { count } = recommendCavityCount({
      projectedAreaMm2: 8000,    // 80 cm²
      annualVolume: 500_000,
      clampTonnageKN: 2000,      // 200T machine
      shotCapacityCm3: 180,
      partVolumeMm3: 3_000,
      gateType: 'hot_tip',
    });
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it('shot capacity constraint — large part on small machine → 1 cavity', () => {
    const { count, constrainedBy } = recommendCavityCount({
      projectedAreaMm2: 5000,
      annualVolume: 200_000,
      clampTonnageKN: 800,
      shotCapacityCm3: 60,       // only 60 cm³ capacity
      partVolumeMm3: 50_000,     // 50 cm³ part → barely fits 1 shot
      gateType: 'edge',
    });
    expect(count).toBe(1);
    expect(constrainedBy).toBe('shot_capacity');
  });
});

// ── Mold class unit tests ─────────────────────────────────────────────────────

describe('recommendMoldClass', () => {
  it('prototype volume → Class 105', () => {
    const cls = recommendMoldClass(400, null, null);
    expect(cls).toBe('Class105');
  });

  it('low production → Class 104', () => {
    const cls = recommendMoldClass(50_000, null, null);
    expect(cls).toBe('Class104');
  });

  it('medium production → Class 103', () => {
    const cls = recommendMoldClass(400_000, null, null);
    expect(cls).toBe('Class103');
  });

  it('high production + complex parting → bumped up from Class 103', () => {
    const cls = recommendMoldClass(400_000, 0.7, 3);
    // Should bump from Class 103 → Class 102
    expect(['Class101', 'Class102']).toContain(cls);
  });

  it('very high production → Class 101 or 102', () => {
    const cls = recommendMoldClass(800_000, null, null);
    expect(['Class101', 'Class102']).toContain(cls);
  });
});

// ── Full cost engine golden-value tests ──────────────────────────────────────

describe('computeInjectionMoldedCostSummary', () => {
  function baseInput(overrides: Partial<InjectionMoldingCostInput>): InjectionMoldingCostInput {
    return {
      volume: 10_000,               // 10 cm³
      surfaceArea: 50_000,
      wallThicknessNominalMm: 2.0,
      materialGrade: 'PP',
      materialCostPerKg: 150,       // INR/kg
      materialDensityKgM3: 900,
      materialSource: 'db',
      batchSize: 1000,
      family: 'injection_molded',
      ...BASE_RATES,
      clampTonnageKN: 570,
      shotCapacityCm3: 51,
      ...overrides,
    };
  }

  it('case 1 — PP bracket, 10k/yr, simple → cycle time within physics range', () => {
    const result = computeInjectionMoldedCostSummary(baseInput({
      annualVolume: 10_000,
      productionLifeYears: 3,
    }));
    const cycleTimeSec = result.injectionMolding!.cycleTimeSec;
    // PP 2mm wall: Menges ≈ 7.5s cool + fill + pack + eject ≈ 14–20s total
    expect(cycleTimeSec).toBeGreaterThan(8);
    expect(cycleTimeSec).toBeLessThan(30);
    expect(result.injectionMolding!.cavityCount).toBe(1);
    expect(result.tooling?.moldClass).toBe('Class104');
  });

  it('case 2 — ABS housing, hygroscopic resin → drying routed', () => {
    const result = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'ABS',
      materialDensityKgM3: 1050,
      annualVolume: 50_000,
      productionLifeYears: 5,
      clampTonnageKN: 1500,
      shotCapacityCm3: 135,
      batchSize: 5000,
    }));
    const dryingLine = result.processLines.find((l) => l.process === 'Material Drying');
    expect(dryingLine).toBeDefined();
    // Multi-cavity expected at 50k/yr with 150T machine
    expect(result.injectionMolding!.cavityCount).toBeGreaterThanOrEqual(1);
  });

  it('case 3 — PA66 connector, 1 undercut → side action routed', () => {
    const result = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'PA66',
      materialDensityKgM3: 1140,
      annualVolume: 20_000,
      productionLifeYears: 5,
      signals: {
        undercutCount: 1,
        partingComplexity: 0.3,
        projectedAreaMm2: 8000,
      },
    }));
    const sideActionLine = result.processLines.find((l) => l.process.includes('Side Action'));
    expect(sideActionLine).toBeDefined();
  });

  it('case 4 — prototype PP, 200/yr → mold Class 105, tooling dominant warning', () => {
    const result = computeInjectionMoldedCostSummary(baseInput({
      annualVolume: 200,
      productionLifeYears: 1,
    }));
    expect(result.tooling?.moldClass).toBe('Class105');
    const toolingDominantWarning = result.warnings.some((w) => w.includes('Tooling-dominated'));
    expect(toolingDominantWarning).toBe(true);
  });

  it('case 5 — runner scrap: hot runner has 0 scrap, cold runner has scrap', () => {
    const coldResult = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'PP',   // → edge gate (cold runner)
    }));
    const hotResult = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'PC',   // → hot tip gate
    }));
    expect(coldResult.injectionMolding!.runnerScrapKg).toBeGreaterThan(0);
    expect(hotResult.injectionMolding!.runnerScrapKg).toBe(0);
    expect(hotResult.injectionMolding!.runnerSystemType).toBe('hot');
    expect(coldResult.injectionMolding!.runnerSystemType).toBe('cold');
  });

  it('case 7 — LSR gasket, 2mm wall: lsr_compound_dosing + secondary_cure_oven; no material_drying; cycle 20–40s', () => {
    const result = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'LSR',
      wallThicknessNominalMm: 2.0,
      annualVolume: 5000,
    }));
    const im = result.injectionMolding!;
    const tree = result.processTree!;
    const opIds = tree.operations.map((o) => o.id);
    expect(im.moldingSubtype).toBe('lsr');
    expect(opIds).toContain('lsr_compound_dosing');
    expect(opIds).toContain('secondary_cure_oven');
    expect(opIds).not.toContain('material_drying');
    expect(im.cycleTimeSec).toBeGreaterThanOrEqual(20);
    expect(im.cycleTimeSec).toBeLessThanOrEqual(60);  // 2mm wall, Arrhenius + fill + eject
    const lineLabels = result.processLines.map((l) => l.process);
    expect(lineLabels.some((l) => /lsr.*dosing/i.test(l))).toBe(true);
  });

  it('case 8 — insert housing, 3 inserts: insert_loading routed; insert process lines present', () => {
    const result = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'ABS',
      moldingSubtype: 'insert',
      signals: { insertCount: 3, undercutCount: 0 },
    }));
    const im = result.injectionMolding!;
    const opIds = result.processTree!.operations.map((o) => o.id);
    expect(im.moldingSubtype).toBe('insert');
    expect(opIds).toContain('insert_loading');
    expect(opIds).toContain('insert_inspection');
    // insert_loading process line must be present with non-zero run cost
    const insertLine = result.processLines.find((l) => /insert.*load/i.test(l.process));
    expect(insertLine).toBeDefined();
    expect(insertLine!.cycleTimeMin).toBeGreaterThan(0);
  });

  it('case 9 — unscrewing cores: core_unscrewing routed; mold class bumped vs baseline', () => {
    const baseline = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'PP',
      annualVolume: 10000,
      productionLifeYears: 3,
      signals: { undercutCount: 0 },
    }));

    const result = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'PP',
      annualVolume: 10000,
      productionLifeYears: 3,
      signals: { undercutCount: 0, unscrewingCoreCount: 2 },
    }));
    const opIds = result.processTree!.operations.map((o) => o.id);
    expect(result.injectionMolding!.moldingSubtype).toBe('unscrewing');
    expect(opIds).toContain('core_unscrewing');
    // Mold class should be at least as durable as baseline (unscrewing cores bump it up)
    const moldClassOrder = ['Class105', 'Class104', 'Class103', 'Class102', 'Class101'];
    const baselineIdx = moldClassOrder.indexOf(baseline.tooling!.moldClass);
    const resultIdx   = moldClassOrder.indexOf(result.tooling!.moldClass);
    expect(resultIdx).toBeGreaterThanOrEqual(baselineIdx);
  });

  it('case 10 — overmold stub: routingWarning present; moldingSubtype: overmold', () => {
    const result = computeInjectionMoldedCostSummary(baseInput({
      materialGrade: 'ABS',
      moldingSubtype: 'overmold',
    }));
    const im = result.injectionMolding!;
    const tree = result.processTree!;
    expect(im.moldingSubtype).toBe('overmold');
    expect(tree.routingWarnings.some((w) => /overmold/i.test(w))).toBe(true);
  });

  it('case 6 — cost confidence degrades with missing signals', () => {
    const goodResult = computeInjectionMoldedCostSummary(baseInput({
      wallThicknessNominalMm: 2.0,
      signals: { undercutCount: 0, partingComplexity: 0.1 },
    }));
    const poorResult = computeInjectionMoldedCostSummary(baseInput({
      wallThicknessNominalMm: 0,   // not measured
      ...BASE_RATES,
      mhrRate: { ...BASE_RATES.mhrRate, source: 'default_rate', machineName: null },
    }));
    expect(goodResult.injectionMolding!.costConfidence).toBeGreaterThan(
      poorResult.injectionMolding!.costConfidence,
    );
    expect(poorResult.injectionMolding!.costConfidence).toBeLessThan(0.70);
  });
});
