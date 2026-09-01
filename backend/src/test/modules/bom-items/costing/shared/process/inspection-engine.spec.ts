import { planInspection, finalizeInspectionLine, type InspectionInput, type InspectionOperationDefaultRow, type InspectionResult } from '../../../../../../modules/bom-items/costing/shared/process/inspection-engine';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';
import type { InspectionRuleRow } from '../../../../../../modules/bom-items/costing/shared/physics/gdt-severity';
import type { UnsupportedOperationGap } from '../../../../../../modules/bom-items/dto/cost-breakdown.dto';

function rate(value: number, overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return { rate: value, source: 'mhr_database', machineClass: 'cmm', machineName: 'Test CMM', commodityCode: null, ...overrides };
}

// Manufacturing Physics Calculator architecture: production resolves the
// final cycle time via the real "Sheet Metal - Inspection" DB calculator
// (resolvePhysicsQuantity) — these unit tests have no DB access, so this
// helper sums planInspection()'s resolved fields the exact same way that
// calculator's real 'Total Time' formula does, then runs the same
// finalizeInspectionLine() cost-math/line-assembly production uses. Tests
// below exercise planInspection's real sampling/method-escalation logic
// through this helper; a dedicated describe block further down tests
// finalizeInspectionLine's gap-reporting path directly.
function computeInspectionLine(input: InspectionInput): InspectionResult {
  const plan = planInspection(input);
  const cycleTimeSec = plan.visualPassBaseSec
    + plan.holesToInspect * plan.holeCheckSec
    + plan.bendsToInspect * plan.bendCheckSec
    + plan.threadsToInspect * plan.threadGaugeSec
    + (plan.hasThicknessCheck ? 1 : 0) * plan.thicknessCheckSec
    + (plan.hasDimensionCheck ? 1 : 0) * plan.dimensionCheckSec;
  return finalizeInspectionLine(input, plan, { cycleTimeSec });
}

const OPERATION_DEFAULTS: InspectionOperationDefaultRow[] = [
  { feature: 'visual_base', method: 'visual', cycle_time_sec: 5, sampling_default: 'sampling', equipment: null },
  { feature: 'hole', method: 'visual', cycle_time_sec: 1.2, sampling_default: 'sampling', equipment: null },
  { feature: 'hole', method: 'caliper', cycle_time_sec: 2.5, sampling_default: 'sampling', equipment: null },
  { feature: 'hole', method: 'cmm', cycle_time_sec: 10, sampling_default: '100pct', equipment: null },
  { feature: 'bend', method: 'visual', cycle_time_sec: 2, sampling_default: 'sampling', equipment: null },
  { feature: 'thickness', method: 'visual', cycle_time_sec: 3, sampling_default: '100pct', equipment: null },
  { feature: 'dimension', method: 'visual', cycle_time_sec: 5, sampling_default: '100pct', equipment: null },
  { feature: 'thread', method: 'visual', cycle_time_sec: 4, sampling_default: 'sampling', equipment: null },
  { feature: 'thread', method: 'caliper', cycle_time_sec: 4, sampling_default: 'sampling', equipment: null },
];

function baseInput(overrides: Partial<InspectionInput> = {}): InspectionInput {
  return {
    holes: [],
    bends: [],
    sheetThicknessMm: 2,
    hasOverallDimensions: true,
    threads: [],
    generalTolerances: null,
    toleranceConfidence: 0,
    gdtCallouts: [],
    inspectionRules: [],
    operationDefaults: OPERATION_DEFAULTS,
    inspectionStrategy: '100pct',
    samplingRate: 1,
    batchSize: 100,
    rate: rate(450),
    qaInspectorRatePerHr: 350,
    ...overrides,
  };
}

describe('computeInspectionLine — Level 1 (CAD only)', () => {
  it('always produces exactly one Inspection line, even with no holes/bends/threads', () => {
    const result = computeInspectionLine(baseInput());
    expect(result.processLines).toHaveLength(1);
    expect(result.processLines[0]!.process).toBe('Inspection');
    expect(result.inspectionMethod).toBe('visual');
  });

  it('scales cycle time with real hole/bend counts under a 100pct strategy', () => {
    const withFeatures = computeInspectionLine(baseInput({
      holes: [{ diameterMm: 3 }, { diameterMm: 5 }, { diameterMm: 5 }],
      bends: [{ lengthMm: 50 }, { lengthMm: 60 }],
    }));
    const bare = computeInspectionLine(baseInput());
    expect(withFeatures.processLines[0]!.cycleTimeMin).toBeGreaterThan(bare.processLines[0]!.cycleTimeMin);
    expect(withFeatures.featuresInspected.holes).toBe(3);
    expect(withFeatures.featuresInspected.bends).toBe(2);
  });

  it('never fabricates a bend angle — angleDeg stays absent even when holes/bends are present', () => {
    const result = computeInspectionLine(baseInput({ bends: [{ lengthMm: 50 }] }));
    // No throw, no NaN — the engine must tolerate an undefined angleDeg rather
    // than require it (bend angle isn't extracted anywhere in the sheet-metal
    // pipeline today — see class-level comment in inspection-engine.ts).
    expect(Number.isFinite(result.processLines[0]!.cycleTimeMin)).toBe(true);
  });
});

describe('computeInspectionLine — sampling strategy (not raw feature count)', () => {
  const manyHoles = Array.from({ length: 100 }, () => ({ diameterMm: 4 }));

  it('100pct inspects every candidate', () => {
    const result = computeInspectionLine(baseInput({ holes: manyHoles, inspectionStrategy: '100pct', samplingRate: 1 }));
    expect(result.featuresInspected.holes).toBe(100);
  });

  it('sampling uses the real AQL fraction, not the raw count', () => {
    const result = computeInspectionLine(baseInput({ holes: manyHoles, inspectionStrategy: 'sampling', samplingRate: 0.08 }));
    expect(result.featuresInspected.holes).toBe(8); // ceil(100 * 0.08)
    expect(result.featuresInspected.holes).toBeLessThan(100);
  });

  it('first_article inspects exactly one unit and amortizes cost across the batch', () => {
    const fullBatch = computeInspectionLine(baseInput({ holes: manyHoles, inspectionStrategy: '100pct', batchSize: 500 }));
    const firstArticle = computeInspectionLine(baseInput({ holes: manyHoles, inspectionStrategy: 'first_article', batchSize: 500 }));
    expect(firstArticle.featuresInspected.holes).toBe(100); // still checks every feature on that ONE unit
    // But the resulting per-unit cost is amortized over the batch, so it should
    // be far cheaper per unit than inspecting the feature set on every unit.
    expect(firstArticle.processLines[0]!.totalCost).toBeLessThan(fullBatch.processLines[0]!.totalCost);
  });

  it('skip produces no line at all, with a disclosed warning', () => {
    const result = computeInspectionLine(baseInput({ holes: manyHoles, inspectionStrategy: 'skip' }));
    expect(result.processLines).toHaveLength(0);
    expect(result.warnings.some((w: string) => w.toLowerCase().includes('skip'))).toBe(true);
  });
});

describe('computeInspectionLine — Level 2 (drawing intelligence)', () => {
  it('adds thread-gauge time for real drawing-extracted thread callouts', () => {
    const withThreads = computeInspectionLine(baseInput({ threads: [{ size: 'M3', count: 2 }] }));
    const without = computeInspectionLine(baseInput({ threads: [] }));
    expect(withThreads.processLines[0]!.cycleTimeMin).toBeGreaterThan(without.processLines[0]!.cycleTimeMin);
    expect(withThreads.featuresInspected.threads).toBeGreaterThan(0);
  });

  it('escalates method to caliper for a tight ISO 2768 general tolerance class', () => {
    const tight = computeInspectionLine(baseInput({ generalTolerances: 'ISO 2768-fH' }));
    expect(tight.inspectionMethod).toBe('caliper');

    const coarse = computeInspectionLine(baseInput({ generalTolerances: 'ISO 2768-cH' }));
    expect(coarse.inspectionMethod).toBe('visual');
  });
});

describe('computeInspectionLine — Level 3 (GD&T, dormant until real extraction exists)', () => {
  const rules: InspectionRuleRow[] = [
    {
      gdt_symbol: 'position', tol_max_mm: 0.05, severity: 'high', inspection_method: 'cmm',
      inspection_time_min: 8, cost_impact_percent: 15, cost_impact_range: '10-20%',
      reason_codes: ['CMM_REQUIRED'], manufacturing_actions: [],
    },
  ];

  it('never escalates when gdtCallouts is empty (real parser behavior today)', () => {
    const result = computeInspectionLine(baseInput({ gdtCallouts: [], inspectionRules: rules }));
    expect(result.inspectionMethod).toBe('visual');
  });

  it('escalates to cmm via resolveInspectionRule when a real GD&T callout exists', () => {
    const result = computeInspectionLine(baseInput({
      gdtCallouts: [{ type: 'position', toleranceMm: 0.03 }],
      inspectionRules: rules,
    }));
    expect(result.inspectionMethod).toBe('cmm');
  });

  it('folds a tight per-hole tolerance into the same escalation (replaces the old standalone CMM block)', () => {
    const result = computeInspectionLine(baseInput({
      holes: [{ diameterMm: 5, toleranceMm: 0.02 }],
    }));
    expect(result.inspectionMethod).toBe('cmm');
    expect(result.processLines).toHaveLength(1);
  });

  it('charges the dedicated cmmRate (not the generic bench rate) once escalated to cmm', () => {
    const dedicatedCmmRate = rate(1200, { machineName: 'Real CMM Machine' });
    const result = computeInspectionLine(baseInput({
      holes: [{ diameterMm: 5, toleranceMm: 0.02 }],
      rate: rate(450, { machineName: 'Manual Inspection Bench' }),
      cmmRate: dedicatedCmmRate,
    }));
    expect(result.inspectionMethod).toBe('cmm');
    expect(result.processLines[0]!.hourlyRate).toBe(1200);
    expect(result.processLines[0]!.machineName).toBe('Real CMM Machine');
  });

  it('reports a genuine gap (never the bench rate) when escalated to cmm but no dedicated cmmRate is on file', () => {
    // Method and resource are separate decisions — a tight-tolerance hole
    // correctly escalates the METHOD to cmm regardless of what resource
    // rate happens to be on file. Substituting the "Manual Inspection
    // Bench" rate here would bill CMM-precision work at a bench rate — the
    // exact conflation this test used to encode as correct behavior.
    const result = computeInspectionLine(baseInput({
      holes: [{ diameterMm: 5, toleranceMm: 0.02 }],
      rate: rate(450, { machineName: 'Manual Inspection Bench' }),
    }));
    expect(result.inspectionMethod).toBe('cmm');
    expect(result.processLines[0]!.hourlyRate).toBe(0);
    expect(result.processLines[0]!.rateSource).toBe('no_db_rate');
    expect(result.warnings.some((w: string) => w.includes('No CMM MHR rate'))).toBe(true);
  });

  it("surfaces the determined method in featureBreakdown's leading entry", () => {
    const result = computeInspectionLine(baseInput({
      generalTolerances: 'ISO 2768-fH',
    }));
    const methodEntry = result.processLines[0]!.featureBreakdown?.[0];
    expect(methodEntry?.name).toBe('Method: caliper');
  });
});

describe('computeInspectionLine — disclosed fallback', () => {
  it('warns when a feature+method combo has no seeded row', () => {
    const result = computeInspectionLine(baseInput({ operationDefaults: [], holes: [{ diameterMm: 4 }] }));
    expect(result.warnings.some((w: string) => w.includes('inspection_operation_defaults'))).toBe(true);
    // Still produces a real, non-zero line from the disclosed fallback constants —
    // never a silent $0/zero-time line just because the table isn't seeded yet.
    expect(result.processLines[0]!.cycleTimeMin).toBeGreaterThan(0);
  });

  it('visual inspection charges the caller-resolved generic bench resource, never the dedicated cmmRate', () => {
    // baseInput() has no tight tolerances/GD&T escalation, so this resolves
    // to 'visual'. input.rate here stands in for what
    // BOMItemsService.resolveGenericInspectionRate resolves in production —
    // a real, non-CMM-named bench/gauge resource that genuinely exists per
    // location. A separate cmmRate is also supplied to prove visual never
    // reaches for it — that would be exactly the machine/method conflation
    // this refactor removed.
    const result = computeInspectionLine(baseInput({
      rate: rate(5, { machineName: 'Manual Inspection Bench' }),
      cmmRate: rate(1200, { machineName: 'Real CMM Machine' }),
    }));
    expect(result.inspectionMethod).toBe('visual');
    expect(result.processLines[0]!.hourlyRate).toBe(5);
    expect(result.processLines[0]!.machineName).toBe('Manual Inspection Bench');
    // Cycle time is real regardless of which costing resource priced it.
    expect(result.processLines[0]!.cycleTimeMin).toBeGreaterThan(0);
  });

  it('visual inspection reports a genuine gap when no generic inspection resource is on file for the location', () => {
    const result = computeInspectionLine(baseInput({
      rate: { rate: 0, source: 'no_db_rate', machineClass: 'visual', machineName: null, commodityCode: null },
    }));
    expect(result.inspectionMethod).toBe('visual');
    expect(result.processLines[0]!.hourlyRate).toBe(0);
    expect(result.processLines[0]!.rateSource).toBe('no_db_rate');
    expect(result.warnings.some((w: string) => w.includes('visual inspection has no dedicated machine/resource rate'))).toBe(true);
    expect(result.processLines[0]!.cycleTimeMin).toBeGreaterThan(0);
  });
});

describe('finalizeInspectionLine — Manufacturing Physics Calculator gap reporting', () => {
  it('uses the calculator-resolved cycle time and attaches calculator identity when resolved', () => {
    const plan = planInspection(baseInput({ holes: [{ diameterMm: 4 }] }));
    const result = finalizeInspectionLine(baseInput({ holes: [{ diameterMm: 4 }] }), plan, {
      cycleTimeSec: 30,
      calculatorId: 'test-inspection-calculator-id',
      calculatorVersion: 1,
    });
    expect(result.processLines[0]!.cycleTimeMin).toBeCloseTo(30 / 60, 3);
    expect(result.processLines[0]!.calculatorId).toBe('test-inspection-calculator-id');
    expect(result.processLines[0]!.physicsGap).toBeUndefined();
  });

  it('reports an unsupported_operation gap and zero cycle time — never a guessed number — when the calculator has no result', () => {
    const gap: UnsupportedOperationGap = {
      gapType: 'unsupported_operation',
      process: 'Inspection',
      machineClass: 'cmm',
      reason: 'No calculator registered for machine class cmm',
    };
    const input = baseInput({ holes: [{ diameterMm: 4 }] });
    const plan = planInspection(input);
    const result = finalizeInspectionLine(input, plan, { gap });

    expect(result.processLines[0]!.cycleTimeMin).toBe(0);
    expect(result.processLines[0]!.physicsGap).toEqual(gap);
    expect(result.warnings.some((w: string) => w.includes('No calculator registered'))).toBe(true);
  });

  it('produces no line at all for a skipped strategy, regardless of the resolved result', () => {
    const input = baseInput({ inspectionStrategy: 'skip' });
    const plan = planInspection(input);
    const result = finalizeInspectionLine(input, plan, { cycleTimeSec: 999 });
    expect(result.processLines).toHaveLength(0);
  });
});
