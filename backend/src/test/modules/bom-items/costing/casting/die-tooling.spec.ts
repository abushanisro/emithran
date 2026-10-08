import { join } from 'path';
import {
  COMPLEXITY_FEATURE_THRESHOLDS,
  DIE_TOOLING_LOOKUP_KEYS,
  complexityOfFeatureCount,
  computeDieTooling,
  permanentMoldBorders,
  pressDieBorders,
  resolveDieToolingReference,
  type DieToolingInput,
  type DieToolingRows,
} from '../../../../../modules/bom-items/costing/casting/die-tooling';
import { castingTableQuery, castingVariablesAsTable } from '../../../../../modules/bom-items/costing/casting/casting-lookup-tables';
import { engineRunsOf, inputsOfRun } from '../../../../../modules/bom-items/costing/shared/calculators/calculator-inputs';
import { dieCastingSpecAsCalculators } from '../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculator-spec';

// Real data only: memory/Die Casting and the Digital Factory USA Default tool
// shop (memory/Plastic Modeling/process), read with the staging CSV reader.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MEM = join(__dirname, '../../../../../../../memory');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(MEM, rel)).rows;

const rows: DieToolingRows = {
  variables: csv('Die Casting/Die casting_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] })),
  lookups: Object.fromEntries(DIE_TOOLING_LOOKUP_KEYS.map((k) => [k, csv(`Die Casting/Lookup/${k}.csv`)])),
  toolShop: {
    digital_factory_settings_usa: csv('Plastic Modeling/process/digital_factory_settings_usa.csv'),
    digital_factory_tool_materials_usa: csv('Plastic Modeling/process/digital_factory_tool_materials_usa.csv'),
  },
};
const variable = (k: string) => Number(csv('Die Casting/Die casting_variables.csv').find((r) => r['Variable Name'] === k)!['String Value']);
const shop = csv('Plastic Modeling/process/digital_factory_settings_usa.csv').find((r) => r['name'] === 'Default')!;
const h13 = csv('Plastic Modeling/process/digital_factory_tool_materials_usa.csv').find((r) => r['name'] === 'AISI H13')!;

describe('die tooling reference', () => {
  it('resolves every die-casting variable, lookup and the Default tool shop', () => {
    const { reference, missing } = resolveDieToolingReference(rows);
    expect(missing).toEqual([]);
    expect(reference!.toolShop.designUsdPerHr).toBe(Number(shop['designRateUsdPerHr']));
    expect(reference!.toolShop.h13UsdPerKg).toBe(Number(h13['materialCostUsdPerKg']));
    expect(reference!.customBase).toBe(false); // defaultMoldConstruction = Standard Mold Base
  });

  it('names a missing tool shop instead of pricing without it', () => {
    const { reference, missing } = resolveDieToolingReference({ ...rows, toolShop: { ...rows.toolShop, digital_factory_settings_usa: [] } });
    expect(reference).toBeNull();
    expect(missing.join(' ')).toMatch(/digital_factory_settings_usa/);
  });
});

describe('die tooling cost (HPDC die)', () => {
  const { reference } = resolveDieToolingReference(rows);
  const ref = reference!;
  // A 100 x 80 mm part, 30 mm deep along the pull, 8000 mm2 projected, 40000 mm2 surface, in a 2400 kN press.
  const borders = (kn: number) => {
    const b = pressDieBorders(ref, kn);
    if ('reason' in b) throw new Error(b.reason);
    return b.borders;
  };
  const input: DieToolingInput = {
    reference: ref, calculators: dieCastingSpecAsCalculators(), pressForceKn: 2400, borders: borders(2400), cavities: { count: 1, lengthWise: 1, widthWise: 1 },
    footprintMm: [100, 80], pullExtentMm: 30, projectedAreaMm2: 8000, surfaceAreaMm2: 40_000,
    featureCount: 438, slideCount: 1, slideWidthsMm: [null], materialType: 'Aluminum', annualVolume: 100_000, productionLifeYears: 5, location: 'USA',
  };
  const firstAtOrAbove = (t: string, boundCol: string, value: number) =>
    csv(`Die Casting/Lookup/${t}.csv`).map((r) => r).sort((a, b) => Number(a[boundCol]) - Number(b[boundCol]))
      .find((r) => value <= Number(r[boundCol]))!;

  it('complexity from the feature count, at the thresholds memory notes give', () => {
    expect(complexityOfFeatureCount(COMPLEXITY_FEATURE_THRESHOLDS.lowBelow - 1)).toBe('Simple');
    expect(complexityOfFeatureCount(COMPLEXITY_FEATURE_THRESHOLDS.lowBelow)).toBe('Average');
    expect(complexityOfFeatureCount(COMPLEXITY_FEATURE_THRESHOLDS.highAbove)).toBe('Average');
    expect(complexityOfFeatureCount(COMPLEXITY_FEATURE_THRESHOLDS.highAbove + 1)).toBe('Complex');
  });

  it('die size, steel, hours and pins from the memory tables', () => {
    const r = computeDieTooling(input);
    expect(r.ok).toBe(true);
    // Cooling channels across the die length and the sprue parts of a pressure die (memory variables).
    const channels = variable('numRowsWaterChCavHoles') + variable('numRowsWaterChCoreHoles');
    const bx = Number(firstAtOrAbove('tblEdgeMoldBorderX', 'Max Press Force KN (kN)', 2400)['Edge Mold Border X (mm)']);
    const by = Number(firstAtOrAbove('tblEdgeMoldBorderY', 'Max Press Force KN (kN)', 2400)['Edge Mold Border Y (mm)']);
    const cav = Number(firstAtOrAbove('tblCavityPlateDepthBorder', 'Max Press Force (kN)', 2400)['Cavity Plate Depth Border (in)']);
    const core = Number(firstAtOrAbove('tblCorePlateDepthBorder', 'Max Press Force (kN)', 2400)['Core Plate Depth Border (in)']);
    const [x, y, z] = [100 + 2 * bx, 80 + 2 * by, 30 + (cav + core) * 25.4];
    expect(r.dieSizeMm).toEqual([x, y, z].map((n) => Math.round(n * 100) / 100));
    const kg = (x * y * z / 1e9) * variable('densityH13');
    expect(r.steelKg!).toBeCloseTo(kg, 6);
    expect(r.steelUsd!).toBeCloseTo(kg * Number(h13['materialCostUsdPerKg']), 6);

    const areaIn2 = 40_000 / 645.16;
    const hr = Number(firstAtOrAbove('tblHrsPerSqInchSimple', 'Surface Area Simple (in^2)', areaIn2)['Hrs Per Sq Inch Simple (hr / in^2)']);
    expect(r.complexity).toBe('Simple');
    const lengthIn = x / 25.4;
    const coolingHr = variable('gunDrillSetup') + channels * lengthIn / variable('waterlineDrillSpeed') / 60
      + variable('gunTapSetup') + channels * variable('gunTapTime') / 60 + variable('cboreSetup') + channels * variable('cboreTime') / 60;
    expect(r.machiningHr!).toBeCloseTo(hr * areaIn2 * variable('machinabilityMultiplierH13ToolSteel') + coolingHr, 9);

    const design = csv('Die Casting/Lookup/tblMoldBaseDesignTime.csv')
      .find((d) => Number(d['Number of Cavities']) >= 1 && Number(d['Mold Base Width (mm)']) >= Math.min(x, y))!;
    expect(r.designHr!).toBeCloseTo(Number(design['Standard Base Design Time (hr)']) + Number(design['Per Slide Design Time (hr)'])
      + variable('partingLineBaseDesignTime') + variable('partingLineDesignTimePerSlide')
      + Math.max(variable('minWaterChannelDesignTime'), channels * variable('waterChannelDesignTime')), 9);

    const pins = Math.ceil((8000 / 645.16) / variable('projAreaPerEjectorPin'));
    expect(r.ejectorPins).toBe(pins);
    // Guide pins: numGuidePins x the smallest componentStandardCosts guidePinAssy, each assembled.
    const gp = csv('Die Casting/Lookup/componentStandardCosts.csv').filter((c) => c['Name'] === 'guidePinAssy')
      .sort((a, b) => Number(a['Size (mm)']) - Number(b['Size (mm)']))[0]!;
    const guideUsd = variable('numGuidePins') * Number(gp['Cost (USD)']);
    expect(r.assemblyHr!).toBeCloseTo(pins * variable('ejPinsAssTimePerTool') + variable('numGuidePins') * variable('guidePinsAssTimePerTool')
      + 2 * variable('sprBushSpreadAssTimePerTool') + variable('locatingRings') * variable('locatRingsAssTimePerTool'), 9);
    const sprueUsd = variable('sprueBushingCost') + variable('sprueSpreaderCost') + variable('locatingRings') * variable('locatingRingsCost');
    const heatUsd = kg * variable('stdHeatTreatCostPerMass') * variable('compHeatTreatCost');

    const labour = r.designHr! * Number(shop['designRateUsdPerHr']) + r.machiningHr! * Number(shop['machiningRateUsdPerHr'])
      + r.assemblyHr! * Number(shop['assemblyRateUsdPerHr']);
    const markup = 1 + variable('percentTuning') + variable('percentSGandA') + variable('percentProfit');
    expect(r.dieCostUsd!).toBeCloseTo((r.steelUsd! + heatUsd + pins * variable('ejectorPinsCost') + guideUsd + sprueUsd + labour) * markup, 6);
    // The one slide has no measured width: said, not costed as steel.
    expect(r.warnings.join(' ')).toMatch(/slide 1 not costed as steel/);
    expect(r.trace.map((t) => t.label)).toContain('Coating');
    const field = (calc: string, f: string) => r.runs[calc]!.trace.find((t) => t.fieldName === f)!.value;
    expect(field('Die Build', 'Guide Pins')).toBe(variable('numGuidePins'));
    expect(Number(field('Die Cost', 'Heat Treat Cost'))).toBeCloseTo(heatUsd, 1); // trace values are shown to the cent
  });

  it('a slide sized by its bundle width: steel, design, CNC, pocket, assembly, spotting and inspection', () => {
    const base = computeDieTooling(input);
    const w = (variable('smallSlideBundleWidthThreshold') + variable('mediumSlideBundleWidthThreshold')) / 2; // a medium slide
    const r = computeDieTooling({ ...input, slideWidthsMm: [w] });
    const vol = variable('mediumSlideVolume');
    const kg = vol * 25.4 ** 3 / 1e9 * variable('densityH13');
    expect(r.designHr! - base.designHr!).toBeCloseTo(variable('mediumSlideDesignTime') + variable('slideCutterPathTimePerTool'), 9);
    expect(r.machiningHr! - base.machiningHr!).toBeCloseTo(
      variable('slideCNCMachRate') * vol + variable('slideSetup') + variable('slidesCNCRate') * vol + variable('slidePocketSetup'), 9);
    expect(r.assemblyHr! - base.assemblyHr!).toBeCloseTo(
      variable('slideAssTimePerTool') + variable('spotSlidesTimePerTool') + variable('slideInspectTimePerTool') + variable('slideInspectSetup'), 9);
    expect(r.trace.find((t) => t.label === 'Slide 1')!.value).toContain(`${Math.round(kg * 100) / 100} kg H13`);
    expect(r.warnings.join(' ')).not.toMatch(/not costed as steel/);
  });

  it('amortised over tblToolLife; a replacement die reuses the design', () => {
    const life = Number(csv('Die Casting/Lookup/tblToolLife.csv').find((t) => t['Material Type'] === 'Aluminum')!['Num Shots Per Tool']);
    const r = computeDieTooling(input);
    const dies = Math.ceil(500_000 / life);
    expect(r.shotsPerDie).toBe(life);
    expect(r.diesRequired).toBe(dies);
    const markup = 1 + r.markupPct;
    const designUsd = r.designHr! * Number(shop['designRateUsdPerHr']) * markup;
    expect(r.totalToolingUsd!).toBeCloseTo(r.dieCostUsd! + (dies - 1) * (r.dieCostUsd! - designUsd), 6);
    expect(r.perPartUsd!).toBeCloseTo(r.totalToolingUsd! / 500_000, 9);
  });

  it('more cavities: a larger die and fewer dies over the same volume', () => {
    const one = computeDieTooling(input);
    const four = computeDieTooling({ ...input, cavities: { count: 4, lengthWise: 2, widthWise: 2 } });
    expect(four.steelKg!).toBeGreaterThan(one.steelKg!);
    expect(four.diesRequired!).toBeLessThanOrEqual(one.diesRequired!);
  });

  it('outside USA the toolmaker hours are reported, not priced', () => {
    const r = computeDieTooling({ ...input, location: 'India' });
    expect(r.ok).toBe(true);
    expect(r.labourUsd).toBeNull();
    expect(r.dieCostUsd).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/USA only/);
  });

  it('a press beyond the border tables is a named gap', () => {
    const b = pressDieBorders(ref, 20_000);
    expect('reason' in b && b.reason).toMatch(/tblEdgeMoldBorderX\/Y/);
  });

  it('a gravity die takes the permanent-mould borders, no press', () => {
    const { borders: pm } = permanentMoldBorders(ref);
    expect([pm.x.value, pm.y.value, pm.cavityDepth.value, pm.coreDepth.value])
      .toEqual([variable('edgeBorderPM'), variable('edgeBorderPM'), variable('depthBorderPM'), variable('depthBorderPM')]);
    const r = computeDieTooling({ ...input, borders: pm, pressForceKn: null });
    expect(r.ok).toBe(true);
    const dims = r.dieSizeMm!;
    [100 + 2 * Number(pm.x.value), 80 + 2 * Number(pm.y.value), 30 + Number(pm.cavityDepth.value) + Number(pm.coreDepth.value)]
      .forEach((v, i) => expect(dims[i]).toBeCloseTo(v, 6));
    expect(r.runs['Die Size']!.calculatorId).toBe('Die Casting - Die Size');
  });

  it('no part depth along the pull axis: not costed, says so', () => {
    const r = computeDieTooling({ ...input, pullExtentMm: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/pull axis/);
  });
});

describe('die tooling runs feed the calculator dialog', () => {
  const { reference } = resolveDieToolingReference(rows);
  const ref = reference!;
  const b = pressDieBorders(ref, 2400);
  if ('reason' in b) throw new Error(b.reason);
  const calculators = dieCastingSpecAsCalculators();
  const r = computeDieTooling({
    reference: ref, calculators, pressForceKn: 2400, borders: b.borders, cavities: { count: 1, lengthWise: 1, widthWise: 1 },
    footprintMm: [100, 80], pullExtentMm: 30, projectedAreaMm2: 8000, surfaceAreaMm2: 40_000,
    featureCount: 438, slideCount: 1, slideWidthsMm: [60], materialType: 'Aluminum', annualVolume: 100_000, productionLifeYears: 5, location: 'USA',
  });

  // The rows the viewer serves for a table (as staged from memory by 846 / 823).
  const served = (table: string): Array<Record<string, unknown>> => {
    const q = castingTableQuery(table);
    if (q.category === 'variable') {
      return castingVariablesAsTable(csv('Die Casting/Die casting_variables.csv')
        .map((v) => ({ key: String(v['Variable Name']), value: v['String Value'], unit_type: v['Unit Type Name'], notes: v['Notes'] }))).rows;
    }
    return (table.startsWith('digital_factory_') ? rows.toolShop[table] : rows.lookups[table] ?? csv(`Die Casting/Lookup/${table}.csv`)) as Array<Record<string, unknown>>;
  };

  it('every lookup row a die run records is exactly one row of the table the viewer serves', () => {
    const matches = Object.values(r.runs).flatMap((run) => Object.values(run.lookupMatches));
    expect(matches.length).toBeGreaterThan(10);
    for (const m of matches) {
      const hits = served(m.table).filter((row) => Object.entries(m.row).every(([k, v]) => String(row[k]) === String(v)));
      expect({ table: m.table, row: m.row, hits: hits.length }).toEqual({ table: m.table, row: m.row, hits: 1 });
    }
  });

  it('the dialog gets the run own inputs, sources and lookup rows', () => {
    const id = calculators['Die Size']!.calculatorId;
    const runs = engineRunsOf(id, [], r.runs);
    expect(runs.map((x) => x.key)).toEqual(['Die Size']);
    const def = calculators['Die Size']!;
    const fields = new Set(def.fields.filter((f) => f.field_type !== 'calculated').map((f) => f.field_name));
    const got = inputsOfRun(runs[0]!, fields);
    expect(Object.keys(got.inputs).sort()).toEqual([...fields].sort());
    expect(got.provenance['H13 Density']).toMatch(/densityH13/);
    expect(got.lookupMatches['Edge Border X']!.table).toBe('tblEdgeMoldBorderX');
    expect(got.missing).toEqual([]);
  });
});
