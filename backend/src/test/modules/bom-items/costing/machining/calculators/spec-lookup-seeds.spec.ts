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
