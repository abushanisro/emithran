import { BadRequestException } from '@nestjs/common';

import { plasticLookupTableNames, plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-injection-molding-engine';
import { computeReactionInjectionMoldingCost } from '../../../../../modules/bom-items/costing/plastic-molding/process/cost-reaction-injection-molding-engine';
import { PLASTIC_REFERENCE_SOURCE_VERSION } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { cadEvidenceKey } from '../../../../../modules/bom-items/costing/shared/cad-evidence';
import type { MHRRateInput } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { ProcessesService } from '../../../../../modules/processes/processes.service';
import { realFillFactorRows, realMaterialClamp, realPlasticReference, realPress, realResinInputs } from './real-plastic-reference';

// "Show me where it came from": a calculator input measured on the CAD model carries the evidence key the cost dialog resolves to faces; an input read from a reference
// table carries the table and the row, which the dialog's eye opens and outlines.

const CALCULATORS = plasticMoldingCalculatorsByName();
const PRESS = realPress('Arburg Allrounder 420 C 1300 - 350');
const rate = (machineClass: string, usd: number, name: string | null) => ({ rate: usd, labourRate: 34.48, operators: 0.5, source: 'mhr_database' as const, machineClass, machineName: name, commodityCode: null });
const part = (over: Partial<InjectionMoldingCostInput> = {}): InjectionMoldingCostInput => ({
  volume: 50_000, surfaceArea: 40_000, wallThicknessNominalMm: 2, materialGrade: 'ABS', materialCostPerKg: 3.046, materialDensityKgM3: 1040, materialSource: 'db',
  batchSize: 250, family: 'plastic_molded', mhrRate: { ...rate('injection_molding', PRESS.mhrUsd, 'Arburg Allrounder 420 C 1300 - 350'), setupTimeHr: 2 },
  // The part's height along the pull: the ejector stroke of the cycle (calculator version 2).
  bboxMinMm: 30,
  deburrRate: rate('deburring', 0, null), inspectionRate: rate('cmm', 0, null), machineClampTonnes: PRESS.maxTonnage, machineShotCapacityG: PRESS.shotCapacityGrams,
  pressTiming: PRESS.timing, goodPartYield: PRESS.goodPartYield, calculators: CALCULATORS, materialClamp: realMaterialClamp('ABS'), realResinInputs: realResinInputs('ABS'), materialType: 'ABS',
  plasticReference: realPlasticReference(), location: 'USA', annualVolume: 100_000, productionLifeYears: 3, signals: { projectedAreaMm2: 10_000, undercutCount: 0 },
  ...over,
});
const moldingLine = (over: Partial<InjectionMoldingCostInput> = {}) => computeInjectionMoldedCostSummary(part(over)).processLines.find((l) => l.calculationSnapshot !== undefined)!;

describe('the evidence key of a calculator input measured on the CAD model', () => {
  it('names the wall and the volume, and only for a value whose source is CAD extraction', () => {
    expect(cadEvidenceKey('Nominal Wall Thickness', 'CAD nominal wall thickness')).toBe('wall_thickness');
    expect(cadEvidenceKey('Shot Melt Volume', 'CAD part volume x cavities + runner, at the material melt density')).toBe('part_volume');
    expect(cadEvidenceKey('Part Volume', 'CAD net part volume (mm3)')).toBe('part_volume');
    // typed by hand, or read from a table or the material: not measured on these faces
    expect(cadEvidenceKey('Nominal Wall Thickness', 'Entered in the calculator')).toBeUndefined();
    expect(cadEvidenceKey('Melt Temperature', 'Material reference (raw_materials): melting temperature')).toBeUndefined();
  });

  it('is on the injection line: the wall and the shot volume carry it, every other input does not', () => {
    const trace = moldingLine().calculationTrace!;
    const withEvidence = trace.filter((t) => t.evidence).map((t) => `${t.fieldName}=${t.evidence}`).sort();
    expect(withEvidence).toEqual(['Nominal Wall Thickness=wall_thickness', 'Shot Melt Volume=part_volume']);
    // the engine-supplied, machine, material, variable and lookup inputs are not CAD faces
    for (const name of ['Press Injection Rate', 'Melt Temperature', 'Fill Factor for Cavities', 'Cycle Time Adjustment Factor']) {
      expect(trace.find((t) => t.fieldName === name)?.evidence).toBeUndefined();
    }
  });

  it('is on the reaction injection line for the part volume', () => {
    const rateOf = ({ rate: 60, source: 'mhr_database', machineClass: 'x', machineName: 'M', commodityCode: null, pressCycleTimeS: 10, setupTimeHr: 0.5 }) as unknown as MHRRateInput;
    const line = computeReactionInjectionMoldingCost({ batchSize: 100, partWeightKg: 0.2, rate: rateOf, cureTimeMinFromMaterial: 3, partVolumeMm3: 80_000, injectionRateMm3PerS: 100_000, calculators: CALCULATORS }).processLines[0]!;
    expect(line.calculationTrace!.find((t) => t.fieldName === 'Part Volume')?.evidence).toBe('part_volume');
    expect(line.calculationTrace!.find((t) => t.fieldName === 'Machine Injection Rate')?.evidence).toBeUndefined();
  });
});

describe('the lookup row an injection line used', () => {
  it('is on the line, per input, with the table and the row', () => {
    const line = moldingLine({ cavityCountOverride: 1 });
    expect(line.lookupMatches).toEqual({
      'Fill Factor for Cavities': { table: 'injectionTimeAdjustmentFactors', row: { attribute: 'Cavities Per Mold', number: 3 } },
      'Fill Factor for Gates': { table: 'injectionTimeAdjustmentFactors', row: { attribute: 'Gates Per Cavity', number: 1 } },
      // the press record states no plasticizing rate, so it is the clamp-force table's row at the press's 1,300 kN
      'Press Plasticizing Rate': { table: 'plasticizingRateByClampForce', row: { 'Clamp Force (kN)': 1300 } },
    });
  });

  it('is the bracket the value falls in: 4 cavities use the row up to 5', () => {
    // the cavity count is the engine's choice (press sizing); an override beyond what the press holds is refused, so read it from the trace
    const line = moldingLine({ cavityCountOverride: 4, machineClampTonnes: 5000, machineShotCapacityG: 5000, pressTiming: { injectionRateMm3PerS: 400_000, dryCycleTimeS: 2 } });
    const m = line.lookupMatches?.['Fill Factor for Cavities'];
    if (m) expect(m.row).toEqual({ attribute: 'Cavities Per Mold', number: 5 });
  });

  /** The staged row a match names, and the value it holds: a fill factor, or a plasticizing rate. */
  const stagedValue = (m: { table: string; row: Record<string, string | number> }): number | undefined =>
    m.table === 'injectionTimeAdjustmentFactors'
      ? realFillFactorRows().find((r) => r.attribute === m.row.attribute && r.number === m.row.number)?.factor
      : realPlasticReference().cycleModel.plasticizingRateByClampKn.find((r) => r.clampKn === m.row['Clamp Force (kN)'])?.gPerS;

  it('names a row that is really in the staged table, so the viewer can outline it', () => {
    const matches = Object.values(moldingLine().lookupMatches ?? {});
    expect(matches.map((m) => m.table).sort()).toEqual(['injectionTimeAdjustmentFactors', 'injectionTimeAdjustmentFactors', 'plasticizingRateByClampForce']);
    for (const m of matches) expect(stagedValue(m)).toBeDefined();
  });

  it('the value on the trace is that row\'s value', () => {
    const line = moldingLine();
    for (const [field, m] of Object.entries(line.lookupMatches ?? {})) {
      expect(line.calculationTrace!.find((t) => t.fieldName === field)?.value).toBe(stagedValue(m));
    }
  });

  it('a line with no calculator has no lookup rows (nothing is invented)', () => {
    const r = computeInjectionMoldedCostSummary(part({ calculators: {} }));
    for (const l of r.processLines) expect(l.lookupMatches).toBeUndefined();
  });
});

describe('the calculator fields that name a reference table', () => {
  it('are the fill factors, and the table is one the endpoint is willing to serve', () => {
    expect(plasticLookupTableNames()).toEqual(['injectionTimeAdjustmentFactors', 'plasticizingRateByClampForce']);
    const f = CALCULATORS['Injection Molding - Cycle Time']!.fields.filter((x) => x.source_table);
    expect(f.map((x) => [x.field_name, x.data_source, x.source_table, x.source_field])).toEqual([
      ['Fill Factor for Cavities', 'machining_lookup', 'injectionTimeAdjustmentFactors', 'adjustment_factor'],
      ['Fill Factor for Gates', 'machining_lookup', 'injectionTimeAdjustmentFactors', 'adjustment_factor'],
      ['Press Plasticizing Rate', 'machining_lookup', 'plasticizingRateByClampForce', 'Plasticizing Rate (g / s)'],
    ]);
  });
});

describe('the lookup-table endpoint serves the plastic reference tables the calculators name, and nothing else', () => {
  function service(raw: unknown) {
    const calls: Array<[string, unknown]> = [];
    const chain: any = {
      select: () => chain,
      eq: (col: string, v: unknown) => { calls.push([col, v]); return chain; },
      maybeSingle: async () => ({ data: { raw }, error: null }),
    };
    const svc = Object.create(ProcessesService.prototype) as ProcessesService;
    Object.assign(svc, { databaseService: { getPrivilegedClient: () => ({ from: () => chain }) } });
    return { svc, calls };
  }
  const stagedRaw = () => ({ rows: realFillFactorRows().map((r) => ({ name: 'injectionTimeAdjustmentFactors', file_path: 'x.csv', attribute: r.attribute, number: r.number, adjustment_factor: r.factor })) });

  it('reads the plastic dataset (not the machining one) and flattens it with the keys the matched row uses', async () => {
    const { svc, calls } = service(stagedRaw());
    const table = await svc.getMachiningLookupTableByName('injectionTimeAdjustmentFactors', 'adjustment_factor');
    expect(calls).toContainEqual(['source_version', PLASTIC_REFERENCE_SOURCE_VERSION]);
    expect(calls).toContainEqual(['key', 'injectionTimeAdjustmentFactors']);
    expect(table.rows).toHaveLength(realFillFactorRows().length);
    // the output column is last, and the matched row's keys are columns of the table
    expect(table.columnDefinitions.map((c: { name: string }) => c.name).slice(-1)).toEqual(['adjustment_factor']);
    const columns = table.columnDefinitions.map((c: { name: string }) => c.name);
    const fillMatches = Object.values(moldingLine().lookupMatches ?? {}).filter((m) => m.table === 'injectionTimeAdjustmentFactors');
    for (const m of fillMatches) for (const key of Object.keys(m.row)) expect(columns).toContain(key);
    // and the row the engine named is among the rows
    const used = moldingLine().lookupMatches!['Fill Factor for Cavities']!.row;
    expect(table.rows.some((r: Record<string, unknown>) => r.attribute === used.attribute && r.number === used.number)).toBe(true);
  });

  it('serves the plasticizing table too, with the key and the row the line names', async () => {
    const staged = realPlasticReference().cycleModel.plasticizingRateByClampKn;
    const { svc, calls } = service({ rows: staged.map((r) => ({ name: 'plasticizingRateByClampForce', 'Clamp Force (kN)': r.clampKn, 'Plasticizing Rate (g / s)': r.gPerS })) });
    const table = await svc.getMachiningLookupTableByName('plasticizingRateByClampForce', 'Plasticizing Rate (g / s)');
    expect(calls).toContainEqual(['key', 'plasticizingRateByClampForce']);
    const used = moldingLine().lookupMatches!['Press Plasticizing Rate']!.row;
    expect(table.columnDefinitions.map((c: { name: string }) => c.name)).toContain('Clamp Force (kN)');
    expect(table.rows.some((r: Record<string, unknown>) => r['Clamp Force (kN)'] === used['Clamp Force (kN)'])).toBe(true);
  });

  it('refuses a table no calculator names', async () => {
    const { svc } = service({ rows: [] });
    await expect(svc.getMachiningLookupTableByName('raw_materials', undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.getMachiningLookupTableByName('../variables', undefined)).rejects.toBeInstanceOf(BadRequestException);
  });
});
