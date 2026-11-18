import { allowanceVolume, asPrimaryFaceIds, deriveBlankSource, BLANK_FAMILY, BLANK_PROCESS } from '../../../../../modules/bom-items/costing/two-model/derived-blank';
import { withSourceComponent } from '../../../../../modules/bom-items/costing/two-model/two-model-cost';
import type { MachiningAllowanceResult } from '../../../../../modules/bom-items/costing/casting/machining-allowance';
import type { CostSummaryResponseDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

const allowance = (features: Array<Partial<MachiningAllowanceResult['features'][number]>>) =>
  ({ features: features.map((f, i) => ({ featureKey: `k${i}`, featureType: 'PlanarFace', label: `F${i}`, faceIds: [], featureId: null, occurrenceIndex: 0, status: 'standard_derived', allowanceMm: 2, sides: 1, unit: 'mm', source: { level: 3, kind: 'dataset', id: null, ref: null }, asCast: null, notes: [], ...f })), notMachined: [], costed: false }) as MachiningAllowanceResult;

const fg = { feature_graph_v2: { features: [
  { id: 'face', occurrences: [{ face_ids: [1], area_mm2: 500 }] },
  { id: 'hole', diameter_mm: 10, occurrences: [{ face_ids: [2], depth_mm: 20 }] },
  { id: 'edge', occurrences: [{ face_ids: [3] }] },
] } };

describe('a derived 2-Model blank', () => {
  it('is a sand casting: priced from the machined part\'s own analysis, with its machining allowance', () => {
    expect([BLANK_PROCESS, BLANK_FAMILY]).toEqual(['Sand Casting', 'sand_cast']);
  });

  it('adds the allowance metal: a face by its area, a hole by its wall (π d depth), times the sides', () => {
    const { volumeMm3, notes } = allowanceVolume(allowance([
      { featureId: 'face', allowanceMm: 2 },
      { featureId: 'hole', allowanceMm: 1.5, sides: 2 },
      { featureId: 'edge', label: 'Edge 1' },
      { featureId: 'face', label: 'Face review', allowanceMm: null, status: 'requires_review' },
    ]), fg);
    expect(volumeMm3).toBeCloseTo(2 * 500 + 1.5 * 2 * Math.PI * 10 * 20);
    expect(notes).toEqual(['Edge 1: its area is not measured, no allowance added.', 'Face review: no allowance (needs review), none added.']);
    expect(allowanceVolume(null, fg).volumeMm3).toBe(0);
  });

  it('leaves as supplied the faces of the features the casting holds', () => {
    expect(asPrimaryFaceIds({ features: [{ verdict: 'as_primary', faceIds: [1, 2] }, { verdict: 'needs_machining', faceIds: [3] }, { verdict: 'as_primary', faceIds: [2] }] }))
      .toEqual({ faceIds: [1, 2], count: 2 });
  });

  const blank = {
    materialCost: 166, totalProcessCost: 249, totalCost: 415, grossWeightKg: 1.2, materialCostPerKg: 138, usdToDisplayRate: 83, family: 'sand_cast',
    castingMetal: { partKg: 1, chargedKg: 1.4 },
    coreboxTooling: { boxes: 1, costUsd: 1000, perPartUsd: 0.2, detail: 'one corebox' },
    processLines: [
      { process: 'Melting', processGroup: 'Sand Casting', totalCost: 83 },
      { process: 'Moulding', processGroup: 'Sand Casting', totalCost: 83 },
      { process: 'Drilling', processGroup: 'Machining', totalCost: 41.5 },
      { process: 'Tapping', processGroup: 'Machining', totalCost: 41.5 },
    ],
    warnings: ['Measured by the cad-engine'],
  } as unknown as CostSummaryResponseDto;

  it('is the casting\'s material, casting steps and (fully burdened) tooling per part; its machining is the part\'s', () => {
    const fb = deriveBlankSource(blank, { partName: 'Housing', blankProcess: 'Sand Casting', fullyBurdened: true });
    expect(fb.source).toMatchObject({ name: 'Housing (derived sand casting blank)', basis: 'fully_burdened', materialCost: 166, processCost: 166, massKg: 1.4 });
    expect(fb.source.toolingCost).toBeCloseTo(0.2 * 83);
    expect(fb.machiningLines.map((l) => l.process)).toEqual(['Drilling', 'Tapping']);
    expect(deriveBlankSource(blank, { partName: 'Housing', blankProcess: 'Sand Casting', fullyBurdened: false }).source.toolingCost).toBe(0);
  });

  it('prices the part as the blank plus its machining: the casting steps are inside the material, not counted again', () => {
    const { source, machiningLines } = deriveBlankSource(blank, { partName: 'Housing', blankProcess: 'Sand Casting', fullyBurdened: false });
    const part = withSourceComponent(blank, source, {
      asSuppliedCount: 3, removedVolumeMm3: 1200, warnings: [], lines: machiningLines,
      derived: { blankProcess: 'Sand Casting', allowanceVolumeMm3: 1200.4, asSuppliedFaceIds: [1, 2] },
    });
    expect(part.processLines.map((l) => l.process)).toEqual(['Drilling', 'Tapping']);
    expect(part.totalProcessCost).toBe(83);
    expect(part.materialCost).toBe(332);
    expect(part.totalCost).toBe(415);
    expect(part.family).toBe('two_model');
    expect(part.sourceComponent).toMatchObject({ derived: true, blankProcess: 'Sand Casting', allowanceVolumeMm3: 1200, asSuppliedFaceIds: [1, 2], itemId: '' });
  });
});
