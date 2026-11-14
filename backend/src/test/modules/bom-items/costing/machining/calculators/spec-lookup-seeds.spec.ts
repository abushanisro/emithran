import { specLookupSeeds, type SpecLookupData } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-lookup-seeds';
import { loadMachiningCalculatorSpec } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import { readMachiningMemoryCsv } from '../real-reference-tables';

// The reference tables themselves, with numbers as numbers (as the staged rows are).
const table = (file: string) => readMachiningMemoryCsv(`lookup/${file}`).map((r) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== '' && Number.isFinite(Number(v)) ? Number(v) : v])));
const SPEC = loadMachiningCalculatorSpec();
const fieldsOf = (name: string) => SPEC.calculators.find((c) => c.name === name)!.fields;
const data = (matClass: SpecLookupData['matClass'], cutCode: number, extra: Partial<SpecLookupData> = {}): SpecLookupData => ({
  matClass, cutCode,
  tables: {
    tblShaping: table('tblShaping.csv'), tblRotarySurfaceGrinding: table('tblRotarySurfaceGrinding.csv'),
    tblStraightBevelGearCutting: table('tblStraightBevelGearCutting_partial.csv'),
  },
  variables: { finishGrindingDepth: 0.1, sparkOutMultiplier: 2, shapingDwellTimePerStroke: 0.15, numDwellsPerShapingStroke: 2, straightBevelCutterDiameterToPitchDiameterRatio: 1 },
  ...extra,
});

describe('specLookupSeeds: lookups read as the calculator spec describes them', () => {
  it('a table with no hardness column is read by the material cut code (rotary surface grinding, aluminum 30.11)', () => {
    const { seeds, missing } = specLookupSeeds(fieldsOf('Machining - Rotary Surface Grinding'), data('aluminum', 30.11), {});
    expect(missing).toEqual([]);
    expect(seeds['Table Speed']!.value).toBe(53);
    expect(seeds['Rough Downfeed']!.value).toBe(0.1);
    expect(seeds['Grinding Allowance']).toMatchObject({ value: 0.1, source: 'variables: finishGrindingDepth' });
  });

  it('`where` picks the row of that cut type: shaping roughs on type 1 and finishes on type 3 (mild steel 1.0)', () => {
    const { seeds, missing } = specLookupSeeds(fieldsOf('Machining - Shaping'), data('mild_steel', 1), {});
    expect(missing).toEqual([]);
    expect(seeds['Rough Stroke Rate']!.value).toBe(60);
    expect(seeds['Rough Rotary Feed']!.value).toBe(2);
    expect(seeds['Finish Stroke Rate']!.value).toBe(100);
    expect(seeds['Finish Rotary Feed']!.value).toBe(0.8);
  });

  it('`nearest` picks the cutter diameter nearest Module x Teeth (2 x 30 = 60 mm reads the 63.5 mm cutter)', () => {
    const { seeds, missing } = specLookupSeeds(fieldsOf('Machining - Straight Bevel Gear Cutting'), data('mild_steel', 1), { Module: 2, Teeth: 30 });
    expect(missing).toEqual([]);
    expect(seeds['Blades per Side']).toMatchObject({ value: 8, source: expect.stringContaining('Diameter (mm) 63.5') });
    expect(seeds['Cutting Speed']!.value).toBe(62.2);
  });

  it('names what is missing instead of filling it: no inputs to choose the row by, a variable not staged, a material the table lacks', () => {
    expect(specLookupSeeds(fieldsOf('Machining - Straight Bevel Gear Cutting'), data('mild_steel', 1), {}).missing[0]).toContain('Module and Teeth');
    expect(specLookupSeeds(fieldsOf('Machining - Bench Operation'), data('mild_steel', 1, { variables: {} }), {}).missing).toEqual([
      'Identing Time: variables defaultIdentingTime is not staged', 'Spark Test Time: variables defaultSparkTestTime is not staged',
    ]);
    expect(specLookupSeeds(fieldsOf('Machining - Rotary Surface Grinding'), data('aluminum', 99.9), {}).missing.join(' ')).toContain('has no row for aluminum');
  });
});

describe('specLookupSeeds: rows keyed by material type or by a size band (chemical milling)', () => {
  const chem = (matClass: SpecLookupData['matClass']): SpecLookupData => ({
    matClass, cutCode: null,
    tables: {
      tblChemicalMillingEtchingRates: [{ material_type: 'Aluminum', etch_rate_mm_min: 0.0381 }, { material_type: 'Steel', etch_rate_mm_min: 0.025 }],
      tblChemicalMilling: [{ component_area_mm2: 1000000, peel_rate_mm2_s: 4166 }, { component_area_mm2: 5000000, peel_rate_mm2_s: 4000 }],
    },
    variables: { defaultChemMillRinsingTime: 25, defaultChemMillDesmutTime: 10, defaultChemMillDesmutRinseTime: 10, defaultChemMillDryingTime: 25, demaskPeelTimeUpperCap: 60, defaultEdgeDressingRate: 10 },
  });

  it('the etch rate is the row of the material type; the peel rate is the first area band that holds the part', () => {
    const { seeds, missing } = specLookupSeeds(fieldsOf('Machining - Etch Cell'), chem('aluminum'), { 'Part Surface Area': 2_000_000 });
    expect(missing).toEqual([]);
    expect(seeds['Etch Rate']).toMatchObject({ value: 0.0381, source: 'tblChemicalMillingEtchingRates: material_type Aluminum' });
    expect(seeds['Peel Rate']).toMatchObject({ value: 4000, source: 'tblChemicalMilling: component_area_mm2 up to 5000000' });
    expect(seeds['Drying Time']!.value).toBe(25);
  });

  it('names a material with no etch rate and a part larger than every band', () => {
    const { missing } = specLookupSeeds(fieldsOf('Machining - Etch Cell'), chem('plastic'), { 'Part Surface Area': 9_000_000 });
    expect(missing).toEqual(expect.arrayContaining([
      'Etch Rate: tblChemicalMillingEtchingRates has no row for material_type plastic',
      'Peel Rate: tblChemicalMilling has no row for component_area_mm2 for 9000000',
    ]));
  });

  it('asks for the part area when the band cannot be chosen without it', () => {
    expect(specLookupSeeds(fieldsOf('Machining - DeMask'), chem('aluminum'), {}).missing.join(' ')).toContain('Part Surface Area');
  });
});
