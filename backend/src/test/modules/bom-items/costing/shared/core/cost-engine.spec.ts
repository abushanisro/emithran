import { computeCostSummary, applyPersistedRouteToSummary, type CostEngineInput, type MHRRateInput, type AppliedProcessCostRecord } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';
import type { LookupGap, UnsupportedOperationGap } from '../../../../../../modules/bom-items/dto/cost-breakdown.dto';
import { planInspection, finalizeInspectionLine, type InspectionInput } from '../../../../../../modules/bom-items/costing/shared/process/inspection-engine';
import type { NestingResult } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/sheet-metal-nesting.engine';
import { UTILIZATION_ADVISORY_THRESHOLD_PCT } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';

function nesting(overrides: Partial<NestingResult> = {}): NestingResult {
  return {
    sheetLengthMm: 3000, sheetWidthMm: 1500, partsPerSheet: 672,
    sheetWeightKg: 53, grossWeightPerPartKg: 0.079, scrapWeightPerPartKg: 0.041,
    utilisationPct: 48.5, grossMaterialCost: 0.093, scrapRecoveryCost: 0,
    netMaterialCost: 0.093, partAllowanceMm: 2,
    ...overrides,
  };
}

function rate(value: number, machineClass: string, overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: value,
    source: 'mhr_database',
    machineClass,
    machineName: `Test ${machineClass}`,
    commodityCode: null,
    ...overrides,
  };
}

// Flat bracket with 2 through-holes, 1 bend — the baseline "plain" part with no
// counterbore/countersink/PEM/tight-tolerance signal.
//
// laserCycleTimeSecFromCalculator/pressBrakeCycleTimeSecFromCalculator mirror
// what bom-items.service.ts's resolvePhysicsQuantity actually resolves and
// passes in production (see its smLaserCalc/smBendCalc call sites) — cost-
// engine.ts itself has no fallback arithmetic left for these two processes,
// so a fixture that omitted them would only exercise the defensive "no
// calculator result and no reported gap" branch, not the real pipeline.
function baseInput(overrides: Partial<CostEngineInput> = {}): CostEngineInput {
  return {
    sheetThicknessMm: 2,
    cutLengthMm: 400,
    pierceCount: 3,
    bendCount: 1,
    flatPatternAreaMm2: 10_000,
    holeCount: 2,
    materialGrade: 'CRCA',
    materialCostPerKg: 60,
    materialDensityKgM3: 7850,
    materialSource: 'db',
    threads: [],
    batchSize: 100,
    family: 'sheet_metal',
    directLaborRatePerHr: 300,
    qaInspectorRatePerHr: 350,
    laserCycleTimeSecFromCalculator: 45,
    laserCalculatorId: 'test-laser-calculator-id',
    laserCalculatorVersion: 1,
    pressBrakeCycleTimeSecFromCalculator: 20,
    pressBrakeCalculatorId: 'test-press-brake-calculator-id',
    pressBrakeCalculatorVersion: 1,
    deburrCycleTimeSecFromCalculator: 30,
    deburrCalculatorId: 'test-deburr-calculator-id',
    deburrCalculatorVersion: 1,
    mhrRates: {
      laser: rate(1200, 'fiber_laser'),
      pressBrake: rate(800, 'press_brake'),
      deburring: rate(300, 'deburring'),
      tapping: rate(900, 'tapping'),
      drillPress: rate(600, 'drill_press'),
      pemPress: rate(500, 'pem_press'),
      inspection: rate(450, 'cmm'),
    },
    ...overrides,
  };
}

function processNames(result: ReturnType<typeof computeCostSummary>): string[] {
  return result.processLines.map((l) => l.process);
}

describe('computeCostSummary — feature-driven secondary hole operations', () => {
  it('baseline part with no secondary-hole features gets only the original lines', () => {
    const result = computeCostSummary(baseInput());
    const names = processNames(result);
    expect(names).toContain('Laser Cutting');
    expect(names).toContain('Press Brake');
    expect(names).toContain('Deburring');
    expect(names).not.toContain('Counterboring');
    expect(names).not.toContain('Countersinking');
    expect(names).not.toContain('PEM Insertion');
    expect(names).not.toContain('Reaming');
    expect(names).not.toContain('Inspection');
  });

  it('adds a Counterboring line only when counterboreCount > 0', () => {
    const withCb = computeCostSummary(baseInput({ counterboreCount: 4, counterboreCycleTimeSecFromCalculator: 40 }));
    expect(processNames(withCb)).toContain('Counterboring');
    const line = withCb.processLines.find((l) => l.process === 'Counterboring')!;
    expect(line.totalCost).toBeGreaterThan(0);
    expect(line.machineClass).toBe('drill_press');

    const without = computeCostSummary(baseInput({ counterboreCount: 0 }));
    expect(processNames(without)).not.toContain('Counterboring');
  });

  it('adds a Countersinking line only when countersinkCount > 0', () => {
    const withCs = computeCostSummary(baseInput({ countersinkCount: 6, countersinkCycleTimeSecFromCalculator: 42 }));
    expect(processNames(withCs)).toContain('Countersinking');
    const line = withCs.processLines.find((l) => l.process === 'Countersinking')!;
    expect(line.totalCost).toBeGreaterThan(0);

    const without = computeCostSummary(baseInput({ countersinkCount: 0 }));
    expect(processNames(without)).not.toContain('Countersinking');
  });

  it('adds a PEM Insertion line only when pemCount > 0', () => {
    const withPem = computeCostSummary(baseInput({
      pemCount: 2, pemCycleTimeSecFromCalculator: 10, pemPartSpecs: ['PEM S-M4-1'],
    }));
    expect(processNames(withPem)).toContain('PEM Insertion');
    const line = withPem.processLines.find((l) => l.process === 'PEM Insertion')!;
    expect(line.machineClass).toBe('pem_press');
    expect(line.totalCost).toBeGreaterThan(0);

    const without = computeCostSummary(baseInput({ pemCount: 0 }));
    expect(processNames(without)).not.toContain('PEM Insertion');
  });

  it('adds Reaming only when tolerance is below the tight-tolerance threshold', () => {
    const tight = computeCostSummary(baseInput({ tightestToleranceMm: 0.03 }));
    expect(processNames(tight)).toContain('Reaming');

    const loose = computeCostSummary(baseInput({ tightestToleranceMm: 0.2 }));
    expect(processNames(loose)).not.toContain('Reaming');

    const noTolerance = computeCostSummary(baseInput({ tightestToleranceMm: null }));
    expect(processNames(noTolerance)).not.toContain('Reaming');

    // Tight tolerance with zero holes on the part — nothing to ream.
    const noHoles = computeCostSummary(baseInput({ tightestToleranceMm: 0.03, holeCount: 0 }));
    expect(processNames(noHoles)).not.toContain('Reaming');
  });

  // Inspection is now a separate, general-purpose line (see inspection-engine.spec.ts
  // for its own unit tests) — this just confirms the fold-in point: passing a
  // tight-tolerance hole candidate through input.inspection produces exactly ONE
  // 'Inspection' line, escalated to 'cmm', not a second standalone CMM line.
  it('folds a tight-tolerance hole candidate into a single escalated Inspection line', () => {
    // Inspection's own sampling/method-escalation logic lives in
    // planInspection() (see inspection-engine.spec.ts for its unit tests);
    // production resolves the final cycle time via the real "Sheet Metal -
    // Inspection" calculator (resolvePhysicsQuantity) — this test sums the
    // plan's fields the same way that calculator's real formula does, since
    // it has no DB access here.
    const inspectionInput: InspectionInput = {
      holes: [{ diameterMm: 5, toleranceMm: 0.02 }, { diameterMm: 5 }],
      bends: [],
      sheetThicknessMm: 2,
      hasOverallDimensions: true,
      threads: [],
      generalTolerances: null,
      toleranceConfidence: 0,
      gdtCallouts: [],
      inspectionRules: [],
      operationDefaults: [],
      inspectionStrategy: '100pct',
      samplingRate: 1,
      batchSize: 100,
      rate: rate(450, 'cmm'),
      qaInspectorRatePerHr: 350,
    };
    const plan = planInspection(inspectionInput);
    const cycleTimeSec = plan.visualPassBaseSec
      + plan.holesToInspect * plan.holeCheckSec
      + plan.bendsToInspect * plan.bendCheckSec
      + plan.threadsToInspect * plan.threadGaugeSec
      + (plan.hasThicknessCheck ? 1 : 0) * plan.thicknessCheckSec
      + (plan.hasDimensionCheck ? 1 : 0) * plan.dimensionCheckSec;
    const inspectionResult = finalizeInspectionLine(inspectionInput, plan, { cycleTimeSec });

    const result = computeCostSummary(baseInput({ inspectionResult }));
    const inspectionLines = result.processLines.filter((l) => l.process === 'Inspection');
    expect(inspectionLines).toHaveLength(1);
    expect(inspectionLines[0]!.machineClass).toBe('cmm');
    expect(inspectionLines[0]!.totalCost).toBeGreaterThan(0);
  });

  it('emits a no_db_rate warning when a new process line has no MHR rate on file', () => {
    const result = computeCostSummary(baseInput({
      counterboreCount: 2, counterboreCycleTimeSecFromCalculator: 20,
      mhrRates: {
        laser: rate(1200, 'fiber_laser'),
        pressBrake: rate(800, 'press_brake'),
        deburring: rate(300, 'deburring'),
        tapping: rate(900, 'tapping'),
        drillPress: { rate: 0, source: 'no_db_rate', machineClass: 'drill_press', machineName: null, commodityCode: null },
      },
    }));
    const line = result.processLines.find((l) => l.process === 'Counterboring')!;
    expect(line.hourlyRate).toBe(0);
    expect(line.rateSource).toBe('no_db_rate');
    expect(result.warnings.some((w) => w.includes('drill press MHR rate'))).toBe(true);
  });
});

describe('computeCostSummary — Manufacturing Physics Calculator pipeline (Laser Cutting / Press Brake)', () => {
  it('uses the calculator-resolved cycle time and attaches calculator identity, not a fallback formula', () => {
    const result = computeCostSummary(baseInput());

    const laser = result.processLines.find((l) => l.process === 'Laser Cutting')!;
    expect(laser.cycleTimeMin).toBeCloseTo(45 / 60, 3);
    expect(laser.calculatorId).toBe('test-laser-calculator-id');
    expect(laser.calculatorVersion).toBe(1);
    expect(laser.physicsGap).toBeUndefined();

    const pressBrake = result.processLines.find((l) => l.process === 'Press Brake')!;
    expect(pressBrake.cycleTimeMin).toBeCloseTo(20 / 60, 3);
    expect(pressBrake.calculatorId).toBe('test-press-brake-calculator-id');
    expect(pressBrake.calculatorVersion).toBe(1);
    expect(pressBrake.physicsGap).toBeUndefined();

    const deburr = result.processLines.find((l) => l.process === 'Deburring')!;
    expect(deburr.cycleTimeMin).toBeCloseTo(30 / 60, 3);
    expect(deburr.calculatorId).toBe('test-deburr-calculator-id');
    expect(deburr.calculatorVersion).toBe(1);
    expect(deburr.physicsGap).toBeUndefined();
  });

  it("uses each process's own differentiated labour rate instead of one flat rate for every process", () => {
    // Deburr has a real, differentiated 'Deburr' process-group LHR rate in
    // production (lhr_benchmark_rates) distinct from — and typically lower
    // than — the generic 'Sheet Metal' rate every other process falls back
    // to. Before this fix, cost-engine.ts ignored MHRRateInput.labourRate
    // entirely and applied the SAME flat directLaborRatePerHr to every
    // process regardless of skill tier.
    const flatRate = 300;
    const deburrLabourRate = 50;
    const result = computeCostSummary(baseInput({
      directLaborRatePerHr: flatRate,
      mhrRates: {
        laser: rate(1200, 'fiber_laser'), // no labourRate override -> falls back to the flat rate
        pressBrake: rate(800, 'press_brake'),
        deburring: rate(300, 'deburring', { labourRate: deburrLabourRate }),
        tapping: rate(900, 'tapping'),
        drillPress: rate(600, 'drill_press'),
        pemPress: rate(500, 'pem_press'),
        inspection: rate(450, 'cmm'),
      },
    }));

    const deburr = result.processLines.find((l) => l.process === 'Deburring')!;
    const laser = result.processLines.find((l) => l.process === 'Laser Cutting')!;

    const deburrMachineCost = (300 / 60) * (30 / 60);
    const deburrLaborCost = (deburrLabourRate / 60) * 1 * (30 / 60);
    expect(deburr.runCost).toBeCloseTo(deburrMachineCost + deburrLaborCost, 2);

    const laserMachineCost = (1200 / 60) * (45 / 60);
    const laserLaborCost = (flatRate / 60) * 1 * (45 / 60);
    expect(laser.runCost).toBeCloseTo(laserMachineCost + laserLaborCost, 2);
  });

  it('propagates confidence through to the process line for all three states', () => {
    const verified = computeCostSummary(baseInput({ laserConfidence: 'verified' }));
    expect(verified.processLines.find((l) => l.process === 'Laser Cutting')!.confidence).toBe('verified');

    const derived = computeCostSummary(baseInput({ pressBrakeConfidence: 'derived' }));
    expect(derived.processLines.find((l) => l.process === 'Press Brake')!.confidence).toBe('derived');

    const unsupportedGap: UnsupportedOperationGap = {
      gapType: 'unsupported_operation',
      process: 'Deburring',
      machineClass: 'deburring',
      reason: 'No calculator registered for machine class deburring',
    };
    const unsupported = computeCostSummary(baseInput({
      deburrCycleTimeSecFromCalculator: undefined,
      deburrPhysicsGap: unsupportedGap,
      deburrConfidence: 'unsupported',
    }));
    expect(unsupported.processLines.find((l) => l.process === 'Deburring')!.confidence).toBe('unsupported');
  });

  it('reports a missing_lookup gap and zero cycle time — never a guessed number — when the calculator has no seeded row', () => {
    const laserGap: LookupGap = {
      gapType: 'missing_lookup',
      process: 'Laser Cutting',
      machineClass: 'fiber_laser',
      inputValidation: [],
      lookupResolution: {
        table: 'sm_lookup_laser_cut',
        policy: 'INTERPOLATE',
        queryParams: [{ column: 'thickness_mm', value: 2 }],
        matchedRow: null,
        nearestRows: [],
      },
      requiredAction: 'Add a real, sourced row to sm_lookup_laser_cut for thickness_mm=2.',
      priority: 'medium',
    };
    const result = computeCostSummary(baseInput({
      laserCycleTimeSecFromCalculator: undefined,
      laserPhysicsGap: laserGap,
    }));

    const laser = result.processLines.find((l) => l.process === 'Laser Cutting')!;
    expect(laser.cycleTimeMin).toBe(0);
    expect(laser.physicsGap).toEqual(laserGap);
    expect(result.warnings.some((w) => w.includes('sm_lookup_laser_cut'))).toBe(true);
  });

  it('reports an unsupported_operation gap for Press Brake when no calculator is registered for the machine class', () => {
    const pbGap: UnsupportedOperationGap = {
      gapType: 'unsupported_operation',
      process: 'Press Brake',
      machineClass: 'press_brake',
      reason: 'No calculator registered for machine class press_brake',
    };
    const result = computeCostSummary(baseInput({
      pressBrakeCycleTimeSecFromCalculator: undefined,
      pressBrakeCalculatorId: null,
      pressBrakeCalculatorVersion: null,
      pressBrakePhysicsGap: pbGap,
    }));

    const pressBrake = result.processLines.find((l) => l.process === 'Press Brake')!;
    expect(pressBrake.cycleTimeMin).toBe(0);
    expect(pressBrake.physicsGap).toEqual(pbGap);
    expect(pressBrake.calculatorId).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('No calculator registered'))).toBe(true);
  });

  it('reports a missing_lookup gap and zero cycle time for Deburring when the calculator has no seeded rate', () => {
    const deburrGap: LookupGap = {
      gapType: 'missing_lookup',
      process: 'Deburring',
      machineClass: 'deburring',
      inputValidation: [],
      lookupResolution: {
        table: 'sm_lookup_deburr_rate',
        policy: 'EXACT_MATCH',
        queryParams: [{ column: 'cut_length_mm', value: 400 }],
        matchedRow: null,
        nearestRows: [],
      },
      requiredAction: 'Add a real, sourced row to sm_lookup_deburr_rate for cut_length_mm=400.',
      priority: 'medium',
    };
    const result = computeCostSummary(baseInput({
      deburrCycleTimeSecFromCalculator: undefined,
      deburrPhysicsGap: deburrGap,
    }));

    const deburr = result.processLines.find((l) => l.process === 'Deburring')!;
    expect(deburr.cycleTimeMin).toBe(0);
    expect(deburr.physicsGap).toEqual(deburrGap);
    expect(result.warnings.some((w) => w.includes('sm_lookup_deburr_rate'))).toBe(true);
  });
});

describe('computeCostSummary — Manufacturing Physics Calculator pipeline (Counterboring / Countersinking)', () => {
  it('uses the calculator-resolved cycle time and attaches calculator identity for both', () => {
    const result = computeCostSummary(baseInput({
      counterboreCount: 4,
      counterboreCycleTimeSecFromCalculator: 40,
      counterboreCalculatorId: 'test-counterbore-calculator-id',
      counterboreCalculatorVersion: 1,
      countersinkCount: 6,
      countersinkCycleTimeSecFromCalculator: 42,
      countersinkCalculatorId: 'test-countersink-calculator-id',
      countersinkCalculatorVersion: 1,
    }));

    const cb = result.processLines.find((l) => l.process === 'Counterboring')!;
    expect(cb.cycleTimeMin).toBeCloseTo(40 / 60, 3);
    expect(cb.calculatorId).toBe('test-counterbore-calculator-id');
    expect(cb.physicsGap).toBeUndefined();

    const cs = result.processLines.find((l) => l.process === 'Countersinking')!;
    expect(cs.cycleTimeMin).toBeCloseTo(42 / 60, 3);
    expect(cs.calculatorId).toBe('test-countersink-calculator-id');
    expect(cs.physicsGap).toBeUndefined();
  });

  it('reports an unsupported_operation gap for Counterboring/Countersinking when no calculator is registered', () => {
    const cbGap: UnsupportedOperationGap = {
      gapType: 'unsupported_operation',
      process: 'Counterboring',
      machineClass: 'drill_press',
      reason: 'No calculator registered for machine class drill_press',
    };
    const csGap: UnsupportedOperationGap = {
      gapType: 'unsupported_operation',
      process: 'Countersinking',
      machineClass: 'drill_press',
      reason: 'No calculator registered for machine class drill_press',
    };
    const result = computeCostSummary(baseInput({
      counterboreCount: 4,
      counterboreCycleTimeSecFromCalculator: undefined,
      counterborePhysicsGap: cbGap,
      countersinkCount: 6,
      countersinkCycleTimeSecFromCalculator: undefined,
      countersinkPhysicsGap: csGap,
    }));

    const cb = result.processLines.find((l) => l.process === 'Counterboring')!;
    expect(cb.cycleTimeMin).toBe(0);
    expect(cb.physicsGap).toEqual(cbGap);

    const cs = result.processLines.find((l) => l.process === 'Countersinking')!;
    expect(cs.cycleTimeMin).toBe(0);
    expect(cs.physicsGap).toEqual(csGap);
  });
});

describe('computeCostSummary — Manufacturing Physics Calculator pipeline (Hole Extrusion / PEM Insertion)', () => {
  it('uses the calculator-resolved cycle time and attaches calculator identity for both', () => {
    const result = computeCostSummary(baseInput({
      extrudedFlangeCount: 2,
      burringCycleTimeSecFromCalculator: 12,
      burringCalculatorId: 'test-burring-calculator-id',
      burringCalculatorVersion: 1,
      pemCount: 2,
      pemCycleTimeSecFromCalculator: 10,
      pemCalculatorId: 'test-pem-calculator-id',
      pemCalculatorVersion: 1,
      pemPartSpecs: ['PEM S-M4-1'],
    }));

    const burring = result.processLines.find((l) => l.process === 'Hole Extrusion (Burring)')!;
    expect(burring.cycleTimeMin).toBeCloseTo(12 / 60, 3);
    expect(burring.calculatorId).toBe('test-burring-calculator-id');
    expect(burring.physicsGap).toBeUndefined();

    const pem = result.processLines.find((l) => l.process === 'PEM Insertion')!;
    expect(pem.cycleTimeMin).toBeCloseTo(10 / 60, 3);
    expect(pem.calculatorId).toBe('test-pem-calculator-id');
    expect(pem.physicsGap).toBeUndefined();
  });

  it('reports an unsupported_operation gap for Burring/PEM when no calculator is registered', () => {
    const burlGap: UnsupportedOperationGap = {
      gapType: 'unsupported_operation',
      process: 'Hole Extrusion (Burring)',
      machineClass: 'hole_forming',
      reason: 'No calculator registered for machine class hole_forming',
    };
    const pemGap: UnsupportedOperationGap = {
      gapType: 'unsupported_operation',
      process: 'PEM Insertion',
      machineClass: 'pem_press',
      reason: 'No calculator registered for machine class pem_press',
    };
    const result = computeCostSummary(baseInput({
      extrudedFlangeCount: 2,
      burringCycleTimeSecFromCalculator: undefined,
      burringPhysicsGap: burlGap,
      pemCount: 2,
      pemCycleTimeSecFromCalculator: undefined,
      pemPhysicsGap: pemGap,
      pemPartSpecs: ['PEM S-M4-1'],
    }));

    const burring = result.processLines.find((l) => l.process === 'Hole Extrusion (Burring)')!;
    expect(burring.cycleTimeMin).toBe(0);
    expect(burring.physicsGap).toEqual(burlGap);

    const pem = result.processLines.find((l) => l.process === 'PEM Insertion')!;
    expect(pem.cycleTimeMin).toBe(0);
    expect(pem.physicsGap).toEqual(pemGap);
  });
});

describe('computeCostSummary — Manufacturing Physics Calculator pipeline (Reaming)', () => {
  it('uses the calculator-resolved cycle time and attaches calculator identity when triggered', () => {
    const result = computeCostSummary(baseInput({
      tightestToleranceMm: 0.03,
      reamCycleTimeSecFromCalculator: 25,
      reamCalculatorId: 'test-reaming-calculator-id',
      reamCalculatorVersion: 1,
    }));
    const ream = result.processLines.find((l) => l.process === 'Reaming')!;
    expect(ream.cycleTimeMin).toBeCloseTo(25 / 60, 3);
    expect(ream.calculatorId).toBe('test-reaming-calculator-id');
    expect(ream.physicsGap).toBeUndefined();
  });

  it('reports an unsupported_operation gap and zero cycle time when no real hole-diameter data exists', () => {
    const gap: UnsupportedOperationGap = {
      gapType: 'unsupported_operation',
      process: 'Reaming',
      machineClass: 'drill_press',
      reason: 'No real hole-diameter data extracted for this part — cannot resolve real reaming physics without a diameter.',
    };
    const result = computeCostSummary(baseInput({
      tightestToleranceMm: 0.03,
      reamCycleTimeSecFromCalculator: undefined,
      reamPhysicsGap: gap,
    }));
    const ream = result.processLines.find((l) => l.process === 'Reaming')!;
    expect(ream.cycleTimeMin).toBe(0);
    expect(ream.physicsGap).toEqual(gap);
    expect(result.warnings.some((w) => w.includes('No real hole-diameter data'))).toBe(true);
  });
});

describe('computeCostSummary — material utilisation advisory (RTP2 MAG2 FRONTFRAME-style irregular part)', () => {
  it('surfaces an informational advisory, not an error, below the configurable threshold', () => {
    const result = computeCostSummary(baseInput({ nestingResult: nesting({ utilisationPct: 48.5 }) }));
    const advisory = result.warnings.find((w) => w.includes('Material utilisation'));
    expect(advisory).toBeDefined();
    // Reworded away from "is low" / imperative "consider panel nesting optimisation" --
    // must read as informational context, not an alarm on a legitimately irregular part.
    expect(advisory).not.toContain('is low');
    expect(advisory).toContain('can be normal for an irregular flat pattern');
    expect(advisory).toContain(`${UTILIZATION_ADVISORY_THRESHOLD_PCT}%`);
    expect(advisory).toContain('672 parts/sheet on 1500×3000mm');
  });

  it('does not surface the advisory at or above the threshold', () => {
    const result = computeCostSummary(baseInput({
      nestingResult: nesting({ utilisationPct: UTILIZATION_ADVISORY_THRESHOLD_PCT }),
    }));
    expect(result.warnings.some((w) => w.includes('Material utilisation'))).toBe(false);
  });

  it('threshold is a single named constant, not re-hardcoded inline', () => {
    const justBelow = computeCostSummary(baseInput({
      nestingResult: nesting({ utilisationPct: UTILIZATION_ADVISORY_THRESHOLD_PCT - 0.1 }),
    }));
    expect(justBelow.warnings.some((w) => w.includes('Material utilisation'))).toBe(true);
  });
});

// P0.2 — process_cost_records is the applied-quote authority. Once a route
// has been applied and persisted, Cost Summary must agree with it on the
// full costing identity (process/operation, machine_class, machine_name,
// cycle_time, setup_time, direct_rate, total_cost_per_part) for the cutting
// and press-brake lines -- never fabricate or fall back to Laser Cutting.
describe('applyPersistedRouteToSummary — P0.2 applied-route authority', () => {
  function appliedRecord(overrides: Partial<AppliedProcessCostRecord> = {}): AppliedProcessCostRecord {
    return {
      machine_class: 'waterjet',
      machine_name: 'Test Waterjet Machine',
      mhr_id: 'mhr-wj-1',
      operation: 'waterjet_cutting',
      process_group: 'Sheet Metal',
      process_route: 'Waterjet Cutting',
      cycle_time: 600,           // seconds
      setup_time: 25,            // minutes
      direct_rate: 950,
      setup_cost_per_part: 5.25,
      total_cycle_cost_per_part: 37.5,
      total_cost_per_part: 42.75,
      ...overrides,
    };
  }

  it('pre-apply path is byte-for-byte unchanged when no active process_cost_records row exists', () => {
    const preApply = computeCostSummary(baseInput());
    const result = applyPersistedRouteToSummary(preApply, []);
    expect(result).toEqual(preApply);
    expect(result.processLines.find((l) => l.process === 'Laser Cutting')).toBeDefined();
  });

  it('applied Waterjet: Cost Summary agrees with the persisted record on the full costing identity, not just the process name', () => {
    const preApply = computeCostSummary(baseInput());
    const record = appliedRecord({ machine_class: 'waterjet' });
    const result = applyPersistedRouteToSummary(preApply, [record]);

    // Cannot fabricate or fall back to Laser Cutting.
    expect(result.processLines.find((l) => l.process === 'Laser Cutting')).toBeUndefined();

    const line = result.processLines.find((l) => l.process === 'Waterjet Cutting')!;
    expect(line).toBeDefined();
    expect(line.operation).toBe(record.operation);
    expect(line.machineClass).toBe('waterjet');
    expect(line.machineName).toBe(record.machine_name);
    expect(line.cycleTimeMin).toBeCloseTo(record.cycle_time / 60, 6); // cycle_time
    expect(line.setupTimeMin).toBe(record.setup_time);                // setup_time
    expect(line.hourlyRate).toBe(record.direct_rate);                 // direct_rate
    expect(line.totalCost).toBe(record.total_cost_per_part);          // total_cost_per_part

    // Aggregates recomputed to reflect the swap, not the discarded laser line.
    expect(result.totalProcessCost).toBe(
      result.processLines.reduce((s, l) => s + l.totalCost, 0),
    );
    expect(result.totalCost).toBe(result.materialCost + result.totalProcessCost);
    expect(result.cycleTimes.laserMin).toBe(0);
  });

  it('applied Turret Punch: Cost Summary agrees with the persisted record on the full costing identity, not just the process name', () => {
    const preApply = computeCostSummary(baseInput());
    const record = appliedRecord({
      machine_class: 'turret_punch',
      machine_name: 'Test Turret Press',
      operation: 'turret_punching',
      process_route: 'Turret Punching',
      cycle_time: 180,
      setup_time: 45,
      direct_rate: 620,
      total_cost_per_part: 18.9,
    });
    const result = applyPersistedRouteToSummary(preApply, [record]);

    expect(result.processLines.find((l) => l.process === 'Laser Cutting')).toBeUndefined();
    expect(result.processLines.find((l) => l.process === 'Waterjet Cutting')).toBeUndefined();

    const line = result.processLines.find((l) => l.process === 'Turret Punching')!;
    expect(line).toBeDefined();
    expect(line.operation).toBe(record.operation);
    expect(line.machineClass).toBe('turret_punch');
    expect(line.machineName).toBe(record.machine_name);
    expect(line.cycleTimeMin).toBeCloseTo(record.cycle_time / 60, 6);
    expect(line.setupTimeMin).toBe(record.setup_time);
    expect(line.hourlyRate).toBe(record.direct_rate);
    expect(line.totalCost).toBe(record.total_cost_per_part);
    expect(result.cycleTimes.laserMin).toBe(0);
  });

  it('applied Press Brake: an edited/persisted bending record overrides the live recompute independently of cutting', () => {
    const preApply = computeCostSummary(baseInput());
    const liveLaser = preApply.processLines.find((l) => l.process === 'Laser Cutting')!;
    const record = appliedRecord({
      machine_class: 'press_brake',
      machine_name: 'Test 160T Brake',
      operation: 'press_brake_bending',
      process_group: 'Sheet Metal',
      process_route: 'Press Brake',
      cycle_time: 90,
      setup_time: 12,
      direct_rate: 410,
      total_cost_per_part: 9.4,
    });
    const result = applyPersistedRouteToSummary(preApply, [record]);

    // Cutting line is untouched -- Press Brake is an independent operation,
    // not an alternative to the cutting technology.
    expect(result.processLines.find((l) => l.process === 'Laser Cutting')).toEqual(liveLaser);

    const line = result.processLines.find((l) => l.process === 'Press Brake')!;
    expect(line).toBeDefined();
    expect(line.operation).toBe(record.operation);
    expect(line.machineClass).toBe('press_brake');
    expect(line.machineName).toBe(record.machine_name);
    expect(line.cycleTimeMin).toBeCloseTo(record.cycle_time / 60, 6);
    expect(line.setupTimeMin).toBe(record.setup_time);
    expect(line.hourlyRate).toBe(record.direct_rate);
    expect(line.totalCost).toBe(record.total_cost_per_part);
    expect(result.cycleTimes.pressBrakeMin).toBeCloseTo(record.cycle_time / 60, 6);
  });

  it('a machine whose commodity code the static registry has never heard of is still judged on its real persisted numbers, not silently dropped', () => {
    // Distinct from machine-capability.ts's P0.1 registry -- this proves the
    // SAME "no fabrication" discipline holds for the applied-cost read path.
    const preApply = computeCostSummary(baseInput());
    const record = appliedRecord({ machine_class: 'waterjet', mhr_id: null });
    const result = applyPersistedRouteToSummary(preApply, [record]);
    const line = result.processLines.find((l) => l.process === 'Waterjet Cutting')!;
    expect(line.rateSource).toBe('default_rate'); // honest, since mhr_id is absent -- never fabricated as 'mhr_database'
    expect(line.totalCost).toBe(record.total_cost_per_part);
  });
});
