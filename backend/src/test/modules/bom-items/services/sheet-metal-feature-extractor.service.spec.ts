import { SheetMetalFeatureExtractorService } from '../../../../modules/bom-items/services/sheet-metal-feature-extractor.service';
import type { RawGeometry } from '../../../../modules/bom-items/services/auto-fill.service';

function geo(overrides: Partial<RawGeometry> = {}): RawGeometry {
  return {
    volume: 0,
    surfaceArea: 0,
    boundingBox: { length: 100, width: 50, height: 2 },
    holeCount: 0,
    pocketCount: 0,
    thinWallCount: 0,
    bendCount: 0,
    cutLengthMm: 400,
    sheetThicknessMm: 2,
    pierceCount: 3,
    flatPatternAreaMm2: 10_000,
    holeDiameters: [],
    holeGroups: [],
    counterboreGroups: [],
    countersinkGroups: [],
    bendRadii: [],
    bendLengths: [],
    bendAngles: [],
    featureSource: 'step_topology',
    ...overrides,
  };
}

describe('SheetMetalFeatureExtractorService — hole subtype classification', () => {
  const svc = new SheetMetalFeatureExtractorService();

  it('classifies plain hole groups as through-holes', () => {
    const features = svc.extract(geo({
      holeGroups: [{ diameter_mm: 6, count: 4 }],
    }));
    const holes = features.filter((f) => f.type === 'hole');
    expect(holes).toHaveLength(1);
    expect((holes[0] as any).recognition.hole_type).toBe('through');
    expect((holes[0] as any).manufacturingIntent).toBe('laser_pierce');
  });

  it('emits a separate counterbore feature and does not double-count it as a through-hole', () => {
    const features = svc.extract(geo({
      holeGroups: [{ diameter_mm: 10, count: 5 }], // 5 holes at Ø10, 2 of which are counterbores
      counterboreGroups: [{ diameter_mm: 10, count: 2 }],
    }));
    const holes = features.filter((f) => f.type === 'hole') as any[];
    const through = holes.find((h) => h.recognition.hole_type === 'through');
    const counterbore = holes.find((h) => h.recognition.hole_type === 'counterbore');

    expect(counterbore).toBeDefined();
    expect(counterbore.recognition.count).toBe(2);
    expect(counterbore.manufacturingIntent).toBe('counterbore');
    // 5 total at Ø10 minus 2 counterbores = 3 remaining plain through-holes
    expect(through).toBeDefined();
    expect(through.recognition.count).toBe(3);
  });

  it('drops the through-hole group entirely when all holes at that diameter are counterbores', () => {
    const features = svc.extract(geo({
      holeGroups: [{ diameter_mm: 12, count: 2 }],
      counterboreGroups: [{ diameter_mm: 12, count: 2 }],
    }));
    const holes = features.filter((f) => f.type === 'hole') as any[];
    expect(holes).toHaveLength(1);
    expect(holes[0].recognition.hole_type).toBe('counterbore');
  });

  it('emits a separate countersink feature', () => {
    const features = svc.extract(geo({
      holeGroups: [{ diameter_mm: 8, count: 3 }],
      countersinkGroups: [{ diameter_mm: 8, count: 1 }],
    }));
    const holes = features.filter((f) => f.type === 'hole') as any[];
    const countersink = holes.find((h) => h.recognition.hole_type === 'countersink');
    const through = holes.find((h) => h.recognition.hole_type === 'through');
    expect(countersink.recognition.count).toBe(1);
    expect(through.recognition.count).toBe(2);
  });

  it('produces no counterbore/countersink features when none were detected', () => {
    const features = svc.extract(geo({ holeGroups: [{ diameter_mm: 5, count: 10 }] }));
    const holes = features.filter((f) => f.type === 'hole') as any[];
    expect(holes.every((h) => h.recognition.hole_type === 'through')).toBe(true);
  });
});
