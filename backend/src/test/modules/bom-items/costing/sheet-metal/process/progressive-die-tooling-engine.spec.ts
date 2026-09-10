import {
  computeProgressiveDieToolingCost,
  estimateToolBuildHours,
  progressiveDieToolingDataGap,
  type ToolingComponentCost,
} from '../../../../../../modules/bom-items/costing/sheet-metal/process/progressive-die-tooling-engine';

// Real component costs, verbatim from
// memory/sheetmetal/lookuptable/component_standard_costs.json (staged as
// sm_lookup_tooling_component_costs, migration 720). Hand-computed dollar
// figures below are derived directly from these numbers — nothing invented.
const REAL_CATALOG: ToolingComponentCost[] = [
  { componentName: 'guidePinAssy', model: 'small', costUsd: 360 },
  { componentName: 'guidePinAssy', model: 'medium', costUsd: 400 },
  { componentName: 'guidePinAssy', model: 'large', costUsd: 480 },
  { componentName: 'stripperGuidePinAssy', model: null, costUsd: 100 },
  { componentName: 'stripperPinAssy', model: null, costUsd: 5 },
  { componentName: 'piercePunchStandard', model: null, costUsd: 125 },
  { componentName: 'piercePunchRetainerStandard', model: null, costUsd: 75 },
  { componentName: 'dieButton', model: null, costUsd: 125 },
  { componentName: 'tappingUnit', model: null, costUsd: 10379 },
  { componentName: 'tapStandard', model: null, costUsd: 15 },
];

// Real per-die-block build-hour variables, verbatim from sm_reference_data
// (migration 479): dbCncSetupHrs=.75, dbMillingHrs=1.5, dbCncHrsPerPocket=.5,
// dbMilledPocketsPerDieBlock=5, dbGrindingHrsPerDieBlock=3,
// dbDrillingHrsPerDieBlock=0, dbWireEdmSetupHrs=1; orDesignPercent=32.8%,
// orAssemblyPercent=35.6%, orDebugPercent=4.1%, orReworkPercent=2%;
// assyHrsCompProgDie=1.1 (Progressive-Die-only dial).
const REAL_BUILD_HOUR_VARS = {
  dbCncSetupHrs: 0.75,
  dbMillingHrs: 1.5,
  dbCncHrsPerPocket: 0.5,
  dbMilledPocketsPerDieBlock: 5,
  dbGrindingHrsPerDieBlock: 3,
  dbDrillingHrsPerDieBlock: 0,
  dbWireEdmSetupHrs: 1,
  designHoursPct: 0.328,
  assemblyHoursPct: 0.356,
  debugHoursPct: 0.041,
  reworkHoursPct: 0.02,
  progDieAssemblyDial: 1.1,
};

const baseInput = (over: Partial<Parameters<typeof computeProgressiveDieToolingCost>[0]> = {}) => ({
  machineClass: 'progressive_die_press' as const,
  holeGroupCount: 0,
  threadGroupCount: 0,
  bendCount: 0,
  extrudedFlangeCount: 0,
  batchSize: 250,
  annualVolume: 1000,
  productionLifeYears: 5,
  componentCosts: REAL_CATALOG,
  markupPct: 0.10,
  sgAndAPct: 0.10,
  profitPct: 0.10,
  buildHourVariables: REAL_BUILD_HOUR_VARS,
  ...over,
});

describe('computeProgressiveDieToolingCost — the reported part (830-001720-00: 3 hole groups, 0 threads)', () => {
  it('charges the real fixed baseline hardware even with zero feature-driven components', () => {
    const r = computeProgressiveDieToolingCost(baseInput());
    // guidePinAssy(small) 360 + stripperGuidePinAssy 100 + stripperPinAssy 5
    expect(r.bomSubtotalUsd).toBeCloseTo(465, 5);
  });

  it('adds one punch+retainer+die-button set per distinct hole group, not per physical hole', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3 }));
    // baseline 465 + 3 * (125+75+125=325) = 465 + 975 = 1440
    expect(r.bomSubtotalUsd).toBeCloseTo(1440, 5);
    const punchLine = r.items.find((i) => i.componentName === 'piercePunchStandard');
    expect(punchLine?.qty).toBe(3);
    expect(punchLine?.totalCostUsd).toBeCloseTo(375, 5);
  });

  it('applies real markup + SG&A + profit percentages on top of the BOM subtotal', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3 }));
    // 1440 * (1 + .10 + .10 + .10) = 1440 * 1.30 = 1872
    expect(r.toolingCostUsd).toBeCloseTo(1872, 5);
  });

  it('amortises the real tooling cost over real annual volume × production life', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3 }));
    // 1872 / (1000 * 5) = 0.3744
    expect(r.toolingCostPerPartUsd).toBeCloseTo(0.3744, 6);
  });

  it('discloses the real scope limitation on every result — never presented as a complete tooling cost', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3 }));
    expect(r.warnings[0]).toContain('does NOT include die-block/shoe raw material');
    expect(r.warnings[0]).toContain('toolmaker design/build labor');
  });
});

describe('computeProgressiveDieToolingCost — thread handling', () => {
  it('charges the one capital tapping unit plus one replaceable tap per distinct thread size', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ threadGroupCount: 2 }));
    // baseline 465 + tappingUnit 10379 + 2*tapStandard(15) = 465+10379+30 = 10874
    expect(r.bomSubtotalUsd).toBeCloseTo(10874, 5);
    expect(r.items.find((i) => i.componentName === 'tappingUnit')?.qty).toBe(1);
    expect(r.items.find((i) => i.componentName === 'tapStandard')?.qty).toBe(2);
  });

  it('charges no tapping unit at all when the part has no threads', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ threadGroupCount: 0 }));
    expect(r.items.some((i) => i.componentName === 'tappingUnit')).toBe(false);
    expect(r.items.some((i) => i.componentName === 'tapStandard')).toBe(false);
  });
});

describe('computeProgressiveDieToolingCost — real, sourced-data-only behaviour', () => {
  it('takes bendCount/extrudedFlangeCount for build-hours only — never charges a BOM line for them', () => {
    // No applicable, sourced BOM component exists for a wipe-bend or a
    // burring/coining punch (see the module's own doc comment) — bends and
    // extruded flanges add real build HOURS (more die stations to machine)
    // but must never change the priced $ BOM subtotal.
    const flat = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3, bendCount: 0, extrudedFlangeCount: 0 }));
    const withFeatures = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3, bendCount: 4, extrudedFlangeCount: 1 }));
    expect(withFeatures.bomSubtotalUsd).toBe(flat.bomSubtotalUsd);
    expect(withFeatures.toolingCostUsd).toBe(flat.toolingCostUsd);
    // But the real build-hours estimate DOES grow with real station complexity.
    expect(withFeatures.estimatedToolBuildHours).toBeGreaterThan(flat.estimatedToolBuildHours);
  });

  it('reports missing components rather than fabricating a cost when the real catalog lacks a needed row', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 1, componentCosts: [] }));
    expect(r.bomSubtotalUsd).toBe(0);
    expect(r.missingComponents).toContain('piercePunchStandard');
    expect(r.missingComponents).toContain('guidePinAssy (small)');
    expect(r.warnings.some((w) => w.includes('no cost on file'))).toBe(true);
  });

  it('returns null per-part cost (never a guess) when annual volume is unresolved', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3, annualVolume: null }));
    expect(r.toolingCostUsd).toBeGreaterThan(0);
    expect(r.toolingCostPerPartUsd).toBeNull();
  });

  it('returns null per-part cost when production life is unresolved', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3, productionLifeYears: null }));
    expect(r.toolingCostPerPartUsd).toBeNull();
  });

  it('treats an unresolved percentage as zero, never a guessed default', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3, markupPct: null, sgAndAPct: null, profitPct: null }));
    expect(r.toolingCostUsd).toBeCloseTo(r.bomSubtotalUsd, 5);
  });
});

describe('progressiveDieToolingDataGap', () => {
  it('reports a gap when a real, non-zero tooling cost could not be amortised', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3, annualVolume: null }));
    const gap = progressiveDieToolingDataGap('progressive_die_press', r);
    expect(gap).not.toBeNull();
    expect(gap!.process).toBe('Progressive Die');
  });

  it('still reports a gap once amortisation succeeds, when real toolmaker hours remain unpriced', () => {
    // THE REPORTED REGRESSION: amortisation succeeding is not the same as the
    // route's total being complete. A real die always needs SOME machining
    // hours, and no toolroom labor rate exists anywhere on file to price them
    // — so a fully-amortised Progressive Die route still cannot be presented
    // as economically complete, or it silently out-competes a fully-costed
    // cutting route on an artificially low total exactly like before this fix.
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3 }));
    expect(r.toolingCostPerPartUsd).not.toBeNull();
    expect(r.estimatedToolBuildHours).toBeGreaterThan(0);
    expect(progressiveDieToolingDataGap('progressive_die_press', r)).not.toBeNull();
  });

  it('reports no gap when the real reference data itself is entirely unavailable', () => {
    // Fail-open, disclosed: with every build-hour variable null, the hours
    // estimate is honestly 0 (nothing to compute), not a fabricated gap.
    const noHourData = Object.fromEntries(Object.keys(REAL_BUILD_HOUR_VARS).map((k) => [k, null])) as any;
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3, buildHourVariables: noHourData }));
    expect(r.estimatedToolBuildHours).toBe(0);
    expect(progressiveDieToolingDataGap('progressive_die_press', r)).toBeNull();
  });

  it('reports no gap when there was no real tooling cost to amortise in the first place', () => {
    // The only way bomSubtotalUsd is truly 0 — the fixed baseline hardware is
    // always charged, so this needs an empty catalog, not just zero features.
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 0, annualVolume: null, componentCosts: [] }));
    expect(r.bomSubtotalUsd).toBe(0);
    expect(progressiveDieToolingDataGap('progressive_die_press', r)).toBeNull();
  });

  it('labels Tandem Press correctly, not just Progressive Die', () => {
    const r = computeProgressiveDieToolingCost(baseInput({ holeGroupCount: 3, annualVolume: null }));
    expect(progressiveDieToolingDataGap('tandem_press', r)?.process).toBe('Tandem Press');
  });
});

describe('estimateToolBuildHours — real per-die-block hour variables, never priced', () => {
  it('hand-computes the base station (no bends/threads/flange) from real sourced hours', () => {
    // perDieBlockHrs = .75 + 1.5 + (.5*5=2.5) + 3 + 0 + 1 = 8.75
    // stationCount = 1 (base only)  =>  fabHrs = 8.75
    // + design(32.8%) + assembly(35.6%*1.1=39.16%) + debug(4.1%) + rework(2%)
    // total pct = 78.06%  =>  8.75 * 1.7806 = 15.58...
    const hrs = estimateToolBuildHours(baseInput());
    expect(hrs).toBeCloseTo(8.75 * (1 + 0.328 + 0.356 * 1.1 + 0.041 + 0.02), 4);
  });

  it('scales with real station count: base + bends + distinct thread groups + extruded flange', () => {
    // stationCount = 1 + 4(bends) + 2(thread groups) + 1(flange) = 8
    const hrs = estimateToolBuildHours(baseInput({ bendCount: 4, threadGroupCount: 2, extrudedFlangeCount: 1 }));
    const perDieBlockHrs = 8.75;
    const stationCount = 1 + 4 + 2 + 1;
    expect(hrs).toBeCloseTo(perDieBlockHrs * stationCount * (1 + 0.328 + 0.356 * 1.1 + 0.041 + 0.02), 4);
  });

  it('does not apply the Progressive-Die-only assembly dial to Tandem Press', () => {
    const progDie = estimateToolBuildHours(baseInput({ machineClass: 'progressive_die_press' }));
    const tandem = estimateToolBuildHours(baseInput({ machineClass: 'tandem_press' }));
    expect(tandem).toBeLessThan(progDie);
    // Tandem Press: assembly uses the raw 35.6% with no ×1.1 dial.
    expect(tandem).toBeCloseTo(8.75 * (1 + 0.328 + 0.356 + 0.041 + 0.02), 4);
  });

  it('drops out null variables instead of substituting a guessed value', () => {
    const hrs = estimateToolBuildHours(baseInput({
      buildHourVariables: { ...REAL_BUILD_HOUR_VARS, dbWireEdmSetupHrs: null, progDieAssemblyDial: null },
    }));
    // perDieBlockHrs without wire-EDM = 7.75; assembly dial defaults to 1 (no scaling) when unresolved.
    expect(hrs).toBeCloseTo(7.75 * (1 + 0.328 + 0.356 + 0.041 + 0.02), 4);
  });

  it('returns 0 hours, never a fabricated positive number, when no build-hour data is on file', () => {
    const noData = Object.fromEntries(Object.keys(REAL_BUILD_HOUR_VARS).map((k) => [k, null])) as any;
    expect(estimateToolBuildHours(baseInput({ buildHourVariables: noData }))).toBe(0);
  });
});
