/**
 * Gear routing (tblGearQuality) and gear shaving (tblShaving) on the real
 * memory/Machining reference, end to end through computeTurningCostSummary.
 */
import { resolveGearRoute } from '../../../../../../modules/bom-items/costing/machining/operation/gear-routing';
import { computeTurningCostSummary } from '../../../../../../modules/bom-items/costing/machining/process/cost-machining-engine';
import { specAsCalculators } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import { realGearReference, realHobbingReference } from '../real-reference-tables';

const GEAR = realGearReference();
const HOBBING = realHobbingReference();
const CALCS = specAsCalculators();

const rate = (r: number, extra: Record<string, unknown> = {}) => ({ rate: r, source: 'mhr_database' as const, machineName: null, commodityCode: null, ...extra }) as any;
const mc = (machineClass: string) => ({ machineClass }) as any;

// 30 teeth, tip Ø64 -> module 2; root Ø55 -> tooth depth 4.5; face width 20; mild steel.
const TEETH = [{ tooth_count: 30, tip_diameter_mm: 64, root_diameter_mm: 55, face_width_mm: 20 }];
function turned(drawingIntelligence: Record<string, unknown>) {
  return computeTurningCostSummary({
    volume: 60_000, surfaceArea: 20_000, maxLength: 64, maxWidth: 64, maxHeight: 20,
    holeCount: 0, holeGroups: [], pocketCount: 0,
    materialGrade: 'AISI 1018', materialCostPerKg: 2, materialDensityKgM3: 7850,
    materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
    batchSize: 100, family: 'turned', finishedWeightKg: 0.5,
    mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
    tappingRate: rate(900, { machineClass: 'tapping' }),
    deburrRate: rate(300, { machineClass: 'manual_deburr' }),
    inspectionRate: rate(450, { machineClass: 'machining_inspection' }),
    surfaceTreatment: null,
    machiningCalculators: CALCS,
    toothForms: TEETH,
    hobRate: rate(1500, { machineClass: 'hob_machine' }),
    hobbing: HOBBING,
    gearRoute: resolveGearRoute(drawingIntelligence, GEAR.qualityRows, GEAR.defaultQuality),
    shaving: GEAR.shaving,
    shaverRate: rate(1200, { machineClass: 'shaver' }),
  } as any, mc('2_axis_lathe'));
}

describe('gear routing from tblGearQuality', () => {
  it('no quality on the drawing -> the reference default A8 -> hobbing only', () => {
    const r = resolveGearRoute({}, GEAR.qualityRows, GEAR.defaultQuality);
    expect(GEAR.defaultQuality).toBe('A8');
    expect(r).toMatchObject({ cut: 'hobbing', shave: false, grind: false });
    expect(r.quality!.new_agma_quality_number).toBe('A8');
  });

  it('A6 / Q11 / DIN 6 must be shaved; A4 must be ground; explicit callouts shave or shape', () => {
    for (const q of ['A6', 'Q11', 'DIN6']) expect(resolveGearRoute({ gear_quality: q }, GEAR.qualityRows, 'A8').shave).toBe(true);
    expect(resolveGearRoute({ gear_quality: 'A4' }, GEAR.qualityRows, 'A8')).toMatchObject({ grind: true, shave: false });
    expect(resolveGearRoute({ gear_shaving: 'SHAVED' }, GEAR.qualityRows, 'A8').shave).toBe(true);
    expect(resolveGearRoute({ gear_shaping: 'GEAR SHAPING' }, GEAR.qualityRows, 'A8').cut).toBe('shaping');
  });
});

describe('gear lines end to end (turned part, real tables)', () => {
  it('A8 (default): a Hobbing line and no Shaving line', () => {
    const r = turned({});
    expect(r.processLines.some((l) => l.machineClass === 'hob_machine' && l.cycleTimeMin > 0)).toBe(true);
    expect(r.processLines.some((l) => l.machineClass === 'shaver')).toBe(false);
  });

  it('A6: Hobbing, then Shaving priced from tblShaving with the workpiece speed capped at maxShavingWorkpieceSpeed', () => {
    const r = turned({ gear_quality: 'A6' });
    const shave = r.processLines.find((l) => l.machineClass === 'shaver')!;
    const row = GEAR.shaving.rows.find((x: any) => x['Material Cut Code Name'] === 1)!; // 125 HB, nearest to mild steel
    const rpm = Math.min((row['Cutting Speed (m / min)'] * 1000) / (Math.PI * 2 * 30), GEAR.shaving.maxWorkpieceRpm);
    const sec = row['Strokes'] * (20 / (row['Feed Per Rev (mm / rev)'] * rpm)) * 60;
    expect(shave.cycleTimeMin).toBeCloseTo(sec / 60, 2);
    expect(r.processLines.some((l) => l.machineClass === 'hob_machine')).toBe(true);
    expect(r.warnings.join(' ')).toContain('tblGearQuality A6: must shave');
  });

  it('A4: says gear grinding is required and not built, instead of pricing it', () => {
    expect(turned({ gear_quality: 'A4' }).warnings.join(' ')).toContain('Gear grinding required (tblGearQuality A4: must grind)');
  });

  it('a shaping callout replaces hobbing and is reported as not priced', () => {
    const r = turned({ gear_shaping: 'GEAR SHAPING' });
    expect(r.processLines.some((l) => l.machineClass === 'hob_machine')).toBe(false);
    expect(r.warnings.join(' ')).toContain('Gear shaping (drawing callout) not priced');
  });
});
