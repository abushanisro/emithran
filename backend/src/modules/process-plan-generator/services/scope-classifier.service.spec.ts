import { ScopeClassifierService } from './scope-classifier.service';
import type { BriefBomItem, BriefDfm } from '../dto/engineering-brief.dto';

describe('ScopeClassifierService', () => {
  const svc = new ScopeClassifierService();

  const makeBom = (over: Partial<BriefBomItem> = {}): BriefBomItem => ({
    id: 'bom-1',
    partNumber: 'P-1',
    partName: 'Test Part',
    itemType: 'child_part',
    quantity: 1,
    unit: 'pcs',
    annualVolume: 1000,
    unitWeightKg: 0.05,
    dimensions: { lengthMm: 30, widthMm: 20, heightMm: 10 },
    tolerance: 'IT8',
    surfaceFinishRa: 'Ra 3.2',
    heatTreatment: 'As Required',
    hardnessHrc: null,
    materialHint: null,
    coating: null,
    tightestToleranceMm: null,
    ...over,
  });

  const makeDfm = (over: Partial<BriefDfm> = {}): BriefDfm => ({
    volumeMm3: 6000,
    surfaceAreaMm2: 1800,
    boundingBox: { lengthMm: 30, widthMm: 20, heightMm: 10 },
    holeCount: 0,
    pocketCount: 0,
    thinWallCount: 0,
    undercutCount: 0,
    fromCadEngine: false,
    bendCount: 0,
    slotCount: 0,
    cutLengthMm: 0,
    sheetThicknessMm: 0,
    ...over,
  } as BriefDfm);

  it('flags assemblies as out of scope', () => {
    const out = svc.classify(makeBom({ itemType: 'assembly' }), makeDfm());
    expect(out.inScope).toBe(false);
    expect(out.family).toBe('out_of_scope');
  });

  it('flags sub-assemblies as out of scope', () => {
    const out = svc.classify(makeBom({ itemType: 'sub_assembly' }), makeDfm());
    expect(out.inScope).toBe(false);
  });

  it('flags cast iron material hints as out of scope', () => {
    const out = svc.classify(makeBom({ materialHint: 'GG25 cast iron' }), makeDfm());
    expect(out.inScope).toBe(false);
    expect(out.reason).toMatch(/cast iron|gg25/i);
  });

  it('flags forging material hints as out of scope', () => {
    const out = svc.classify(makeBom({ materialHint: 'EN8 forged shaft' }), makeDfm());
    expect(out.inScope).toBe(false);
    expect(out.reason).toMatch(/forg/i);
  });

  it('classifies thin flat parts as sheet metal', () => {
    const out = svc.classify(
      makeBom({ dimensions: { lengthMm: 100, widthMm: 60, heightMm: 2 } }),
      makeDfm({ boundingBox: { lengthMm: 100, widthMm: 60, heightMm: 2 }, volumeMm3: 12000 }),
    );
    expect(out.family).toBe('sheet_metal');
    expect(out.inScope).toBe(true);
  });

  it('classifies cylindrical pins as cnc_turned', () => {
    // 19 long, 8 wide ≈ 8 high — surface area for cylinder: 2πr² + 2πrL ≈ 578 mm²
    const out = svc.classify(
      makeBom({ dimensions: { lengthMm: 19, widthMm: 8, heightMm: 8 } }),
      makeDfm({ boundingBox: { lengthMm: 19, widthMm: 8, heightMm: 8 }, volumeMm3: 515, surfaceAreaMm2: 578 }),
    );
    expect(out.family).toBe('cnc_turned');
    expect(out.inScope).toBe(true);
  });

  it('classifies prismatic small parts as cnc_milled', () => {
    const out = svc.classify(
      makeBom({ dimensions: { lengthMm: 50, widthMm: 40, heightMm: 25 } }),
      makeDfm({
        boundingBox: { lengthMm: 50, widthMm: 40, heightMm: 25 },
        volumeMm3: 30_000,
        pocketCount: 2,
        holeCount: 4,
      }),
    );
    expect(out.family).toBe('cnc_milled');
    expect(out.inScope).toBe(true);
  });

  it('flags very large + very complex parts as out of scope (likely casting)', () => {
    const out = svc.classify(
      makeBom({ dimensions: { lengthMm: 300, widthMm: 250, heightMm: 150 } }),
      makeDfm({
        boundingBox: { lengthMm: 300, widthMm: 250, heightMm: 150 },
        volumeMm3: 6_500_000, // 6500 cm³
        holeCount: 6,
        pocketCount: 3,
        undercutCount: 2,
      }),
    );
    expect(out.inScope).toBe(false);
  });

  // Regression: "Rtp2 Mag2 Backframe" was misclassified as cnc_milled.
  // 414×264×50mm frame: high SA/Vol (1.33 mm⁻¹), low fill (2.56%), compound name ending in "frame".
  it('classifies "backframe" compound name as sheet_metal via name suffix', () => {
    const out = svc.classify(
      makeBom({
        partName: 'Rtp2 Mag2 Backframe',
        dimensions: { lengthMm: 414, widthMm: 264, heightMm: 50 },
      }),
      makeDfm({
        boundingBox: { lengthMm: 414, widthMm: 264, heightMm: 50 },
        volumeMm3: 140_505,
        surfaceAreaMm2: 187_081,
      }),
    );
    expect(out.family).toBe('sheet_metal');
    expect(out.inScope).toBe(true);
  });

  it('classifies open sheet metal frame by SA/Vol ratio when name gives no hint', () => {
    // Same geometry as backframe but with a generic name — SA/Vol rule must fire
    const out = svc.classify(
      makeBom({
        partName: 'Generic Part A',
        dimensions: { lengthMm: 414, widthMm: 264, heightMm: 50 },
      }),
      makeDfm({
        boundingBox: { lengthMm: 414, widthMm: 264, heightMm: 50 },
        volumeMm3: 140_505,
        surfaceAreaMm2: 187_081,
      }),
    );
    expect(out.family).toBe('sheet_metal');
    expect(out.inScope).toBe(true);
  });

  it('does not regress solid CNC-milled block to sheet_metal', () => {
    // 80×60×40mm solid block: SA/Vol ≈ 0.18 mm⁻¹, fill ~100%
    const vol = 80 * 60 * 40;
    const sa = 2 * (80 * 60 + 80 * 40 + 60 * 40); // 20800
    const out = svc.classify(
      makeBom({ partName: 'Housing Block', dimensions: { lengthMm: 80, widthMm: 60, heightMm: 40 } }),
      makeDfm({
        boundingBox: { lengthMm: 80, widthMm: 60, heightMm: 40 },
        volumeMm3: vol,
        surfaceAreaMm2: sa,
        pocketCount: 2,
        holeCount: 4,
      }),
    );
    expect(out.family).toBe('cnc_milled');
    expect(out.inScope).toBe(true);
  });
});
