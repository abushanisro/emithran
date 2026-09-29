/**
 * Unit tests for the operation sequencer (Sprint 1 — Fix 3 + Fix 4 + Fix 5)
 *
 * Each test uses synthetic feature_graph_v2 data and verifies:
 *  - Correct operation names generated per feature type
 *  - Machinability factor scales total time appropriately
 *  - Drawing intelligence injection adds/modifies ops correctly
 */

import {
  buildOperationSequence,
  totalCycleTimeSec,
  injectDrawingIntelligence,
  type OperationLine,
} from '../../../../../../modules/bom-items/costing/machining/operation/operation-sequencer';
import { specAsCalculators } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import { realDrillingTable, realTappingTable } from '../real-reference-tables';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tappedHoleFeature(count = 1, diamMm = 4, spec = 'M4'): object {
  return {
    feature_type: 'SimpleHole', variant: 'threaded',
    diameter_mm: diamMm,
    occurrences: Array.from({ length: count }, (_, i) => ({
      centroid: [i * 10, 0, 0],
      depth_mm: diamMm * 2,
      tapped: true,
      spec,
      material_removed_mm3: Math.PI * (diamMm / 2) ** 2 * diamMm * 2,
    })),
  };
}

function pocketFeature(count = 1, removedMm3Each = 5000): object {
  return {
    feature_type: 'PocketV2', variant: 'default',
    diameter_mm: 0,
    occurrences: Array.from({ length: count }, () => ({
      depth_mm: 10,
      material_removed_mm3: removedMm3Each,
    })),
  };
}

function throughHoleFeature(count = 1, diamMm = 6): object {
  return {
    feature_type: 'SimpleHole', variant: 'through',
    diameter_mm: diamMm,
    occurrences: Array.from({ length: count }, () => ({
      depth_mm: 20,
      material_removed_mm3: Math.PI * (diamMm / 2) ** 2 * 20,
    })),
  };
}

// Real cad-engine shape (face_classification.py): PlanarFace/CurvedWall/
// CurvedSurface regions carry a real classified area_mm2 per
// occurrence, no diameter, material_removed_mm3 honestly 0.0 (classifying a
// face does not reveal how much stock sat above it).
function faceRegionFeature(ftype: 'PlanarFace' | 'CurvedWall' | 'CurvedSurface', areaMm2 = 2000): object {
  return {
    feature_type: ftype,
    variant: 'default',
    occurrences: [{ centroid: [0, 0, 0], area_mm2: areaMm2, material_removed_mm3: 0 }],
  };
}

// Real cad-engine shape (Phase 5, detect_cutout_rings): a non-circular
// through-opening, real total wall area_mm2 + side_count, no diameter.
function cutoutFeature(areaMm2 = 1120, sideCount = 4): object {
  return {
    feature_type: 'Cutout', variant: 'default',
    occurrences: [{ centroid: [0, 0, 0], area_mm2: areaMm2, side_count: sideCount, material_removed_mm3: 0 }],
  };
}

// Real cad-engine shape (Phase 5, _detect_multistep_holes): each real
// occurrence carries its own steps[] of {diameter_mm, depth_mm}, strictly
// decreasing diameter, NOT a single scalar diameter_mm/depth_mm.
function multiStepHoleFeature(steps: Array<{ diameter_mm: number; depth_mm: number }>): object {
  return {
    feature_type: 'MultiStepHole', variant: 'stepped',
    occurrences: [{ centroid: [0, 0, 0], steps, step_count: steps.length, material_removed_mm3: 0 }],
  };
}

// Real cad-engine shape: build_machining_feature_graph_v2 buckets toroidal
// features (Edge/round = convex blend, Slot/groove = concave recess) by major_diameter_mm (entry.diameter_mm), material_removed_mm3
// honestly 0.0 (never extracted for toroidal blends) — see that function's
// own doc comment.
function toroidFeature(kind: 'fillet' | 'groove', count = 1, majorDiamMm = 30): object {
  const [featureType, variant] = kind === 'fillet' ? ['Edge', 'round'] : ['Slot', 'groove'];
  return {
    feature_type: featureType,
    variant,
    diameter_mm: majorDiamMm,
    occurrences: Array.from({ length: count }, () => ({
      radius_mm: 4,
      material_removed_mm3: 0,
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildOperationSequence', () => {
  it('returns empty array for null/empty feature list', () => {
    expect(buildOperationSequence(null, 'aluminum')).toEqual([]);
    expect(buildOperationSequence([], 'aluminum')).toEqual([]);
  });

  it('always starts with Facing and ends with Deburr', () => {
    const features = [tappedHoleFeature(2)];
    const ops = buildOperationSequence(features, 'aluminum');
    expect(ops[0].name).toBe('Facing');
    expect(ops[ops.length - 1].name).toBe('Deburr');
  });

  it('generates Center Drilling + Drilling + Chamfering + Tapping for tapped holes', () => {
    const ops = buildOperationSequence([tappedHoleFeature(3, 4, 'M4')], 'aluminum');
    const names = ops.map((o) => o.name);
    expect(names).toContain('Center Drilling');
    expect(names).toContain('Drilling');
    expect(names).toContain('Chamfering');
    expect(names).toContain('Tapping');
  });

  it('generates Rough Milling + Fine Finish Milling (floor + wall) for pockets', () => {
    const ops = buildOperationSequence([pocketFeature(2, 8000)], 'mild_steel');
    const names = ops.map((o) => o.name);
    expect(names).toContain('Rough Milling');
    expect(names).toContain('Fine Finish Milling');
    expect(names).toContain('Fine Finish Milling');
  });

  it('generates Center Drilling + Drilling for through holes', () => {
    const ops = buildOperationSequence([throughHoleFeature(4, 6)], 'aluminum');
    const names = ops.map((o) => o.name);
    expect(names).toContain('Center Drilling');
    expect(names).toContain('Drilling');
    // No tap
    expect(names).not.toContain('Tapping');
  });

  it('carries the real CAD feature_type + diameter onto every hole-family op, for 3D-viewer highlight matching', () => {
    const ops = buildOperationSequence([tappedHoleFeature(3, 4, 'M4')], 'aluminum');
    const spotDrill = ops.find((o) => o.name === 'Center Drilling')!;
    const drill = ops.find((o) => o.name === 'Drilling')!;
    const chamfer = ops.find((o) => o.name === 'Chamfering')!;
    const rigidTap = ops.find((o) => o.name === 'Tapping')!;
    for (const op of [spotDrill, drill, chamfer, rigidTap]) {
      expect(op.cadFeatureType).toBe('SimpleHole');
      expect(op.diameterMm).toBe(4);
    }
  });

  it('carries the real CAD feature_type (no diameter) onto pocket/slot ops', () => {
    const ops = buildOperationSequence([pocketFeature(2, 8000)], 'mild_steel');
    const rough = ops.find((o) => o.name === 'Rough Milling')!;
    expect(rough.cadFeatureType).toBe('PocketV2');
    expect(rough.diameterMm).toBeUndefined();
  });

  it('generates real, distinct Filleting/Groove Milling ops for fillet and groove features (Phase 0 coverage fix; Phase 4b real-name split)', () => {
    const filletOps = buildOperationSequence([toroidFeature('fillet', 2, 30)], 'aluminum');
    const grooveOps = buildOperationSequence([toroidFeature('groove', 1, 18)], 'aluminum');

    // fillet and groove used to share one invented "Corner Round" name;
    // the real catalog treats them as two different real operations
    // (Filleting = edge rounding, Groove Milling = material removal) — the
    // split proves this file no longer conflates them.
    const filletRound = filletOps.find((o) => o.name === 'Filleting')!;
    expect(filletRound).toBeDefined();
    expect(filletRound.cadFeatureType).toBe('Edge');
    expect(filletRound.diameterMm).toBe(30);
    expect(filletRound.timeSec).toBeGreaterThan(0);

    const grooveRound = grooveOps.find((o) => o.name === 'Groove Milling')!;
    expect(grooveRound).toBeDefined();
    expect(grooveRound.cadFeatureType).toBe('Slot');
    expect(grooveRound.diameterMm).toBe(18);
  });

  it('generates real area-driven ops for planar_face/curved_wall/curved_surface regions (Phase 3)', () => {
    const planarOps = buildOperationSequence([faceRegionFeature('PlanarFace', 3000)], 'aluminum');
    const wallOps = buildOperationSequence([faceRegionFeature('CurvedWall', 900)], 'aluminum');
    const surfaceOps = buildOperationSequence([faceRegionFeature('CurvedSurface', 500)], 'aluminum');

    const face = planarOps.find((o) => o.name === 'Fine Finish Milling')!;
    expect(face).toBeDefined();
    expect(face.cadFeatureType).toBe('PlanarFace');
    expect(face.timeSec).toBeGreaterThan(0);

    const wall = wallOps.find((o) => o.name === 'Contouring')!;
    expect(wall).toBeDefined();
    expect(wall.cadFeatureType).toBe('CurvedWall');
    expect(wall.timeSec).toBeGreaterThan(0);

    const surface = surfaceOps.find((o) => o.name === 'Contouring')!;
    expect(surface).toBeDefined();
    expect(surface.cadFeatureType).toBe('CurvedSurface');
    expect(surface.timeSec).toBeGreaterThan(0);

    // Larger real area -> more real time, not a flat constant.
    expect(face.timeSec).toBeGreaterThan(wall.timeSec);
  });

  it('a zero-area face region contributes zero time, not a fabricated fallback', () => {
    const ops = buildOperationSequence([faceRegionFeature('PlanarFace', 0)], 'aluminum');
    const face = ops.find((o) => o.name === 'Fine Finish Milling')!;
    expect(face.timeSec).toBe(0);
  });

  it('generates real per-step Center Drilling + Drilling time for a multi_step_hole (Phase 5)', () => {
    const ops = buildOperationSequence(
      [multiStepHoleFeature([
        { diameter_mm: 16, depth_mm: 8 },
        { diameter_mm: 10, depth_mm: 10 },
        { diameter_mm: 6, depth_mm: 10 },
      ])],
      'mild_steel', 1.0, null, null, null, null, realDrillingTable(), specAsCalculators(),
    );
    const spotDrill = ops.find((o) => o.name === 'Center Drilling' && o.cadFeatureType === 'MultiStepHole')!;
    const drill = ops.find((o) => o.name === 'Drilling' && o.cadFeatureType === 'MultiStepHole')!;
    expect(spotDrill).toBeDefined();
    expect(spotDrill.timeSec).toBe(5); // one real spot-drill per hole assembly, not per step
    expect(drill).toBeDefined();
    expect(drill.timeSec).toBeGreaterThan(0);

    // Real per-step sum must exceed a single-step estimate at the largest
    // diameter alone -- proving all 3 real steps actually contributed time,
    // not just the first.
    const singleStepOps = buildOperationSequence(
      [multiStepHoleFeature([{ diameter_mm: 16, depth_mm: 8 }])],
      'mild_steel', 1.0, null, null, null, null, realDrillingTable(), specAsCalculators(),
    );
    const singleDrill = singleStepOps.find((o) => o.name === 'Drilling' && o.cadFeatureType === 'MultiStepHole')!;
    expect(drill.timeSec).toBeGreaterThan(singleDrill.timeSec);
  });

  it('generates a real Perimeter Milling op for a cutout region (Phase 5)', () => {
    const ops = buildOperationSequence([cutoutFeature(1120, 4)], 'aluminum');
    const perimeter = ops.find((o) => o.name === 'Perimeter Milling')!;
    expect(perimeter).toBeDefined();
    expect(perimeter.cadFeatureType).toBe('Cutout');
    expect(perimeter.timeSec).toBeGreaterThan(0);

    const zeroArea = buildOperationSequence([cutoutFeature(0, 4)], 'aluminum');
    const zeroPerimeter = zeroArea.find((o) => o.name === 'Perimeter Milling')!;
    expect(zeroPerimeter.timeSec).toBe(0);
  });

  it('through holes carry through_hole as cadFeatureType, distinct from tapped_hole', () => {
    const ops = buildOperationSequence([throughHoleFeature(4, 6)], 'aluminum');
    const drill = ops.find((o) => o.name === 'Drilling')!;
    expect(drill.cadFeatureType).toBe('SimpleHole');
    expect(drill.diameterMm).toBe(6);
  });

  it('fixed ops (Facing, Deburr) carry no cadFeatureType — nothing to highlight for them', () => {
    const ops = buildOperationSequence([tappedHoleFeature(1)], 'aluminum');
    expect(ops.find((o) => o.name === 'Facing')!.cadFeatureType).toBeUndefined();
    expect(ops.find((o) => o.name === 'Deburr')!.cadFeatureType).toBeUndefined();
  });

  it('machinability factor 2.0 (Al 6061 vs mild steel) halves cycle time for pockets', () => {
    const features = [pocketFeature(1, 10_000)];
    const milSteel = buildOperationSequence(features, 'mild_steel', 1.0);
    const aluminum = buildOperationSequence(features, 'aluminum', 2.0);

    const roughTimeMild = milSteel.find((o) => o.name === 'Rough Milling')!.timeSec;
    const roughTimeAlum = aluminum.find((o) => o.name === 'Rough Milling')!.timeSec;

    // Al MRR = 60000 * 2 = 120000; mild_steel MRR = 12000 * 1 = 12000 → 10× faster
    // so aluminum pocket rough time ≈ roughTimeMild / 10
    expect(roughTimeAlum).toBeCloseTo(roughTimeMild / 10, 0);
  });

  it('ops are sorted in canonical manufacturing order', () => {
    const features = [pocketFeature(1), tappedHoleFeature(2), throughHoleFeature(1)];
    const ops = buildOperationSequence(features, 'aluminum');
    const names = ops.map((o) => o.name);

    // Facing must precede pockets; Drilling before Tapping; Deburr at end
    const faceIdx = names.indexOf('Facing');
    const roughIdx = names.indexOf('Rough Milling');
    const drillIdx = names.lastIndexOf('Drilling');
    const tapIdx = names.indexOf('Tapping');
    const deburrIdx = names.indexOf('Deburr');

    expect(faceIdx).toBeLessThan(roughIdx);
    expect(drillIdx).toBeLessThan(tapIdx);
    expect(tapIdx).toBeLessThan(deburrIdx);
  });

  it('totalCycleTimeSec sums all operation times', () => {
    const ops: OperationLine[] = [
      { name: 'Facing', timeSec: 45, source: 'fixed' },
      { name: 'Rough Milling', timeSec: 120, source: 'feature' },
      { name: 'Deburr', timeSec: 90, source: 'fixed' },
    ];
    expect(totalCycleTimeSec(ops)).toBe(255);
  });
});

describe('injectDrawingIntelligence', () => {
  const baseOps: OperationLine[] = [
    { name: 'Facing', timeSec: 45, source: 'fixed' },
    { name: 'Rough Milling', timeSec: 200, source: 'feature' },
    { name: 'Fine Finish Milling', timeSec: 30, source: 'feature' },
    { name: 'Deburr', timeSec: 90, source: 'fixed' },
  ];

  it('returns ops unchanged when drawing intelligence is null', () => {
    const result = injectDrawingIntelligence(baseOps, null);
    expect(result).toEqual(baseOps);
  });

  it('scales finish op +30% when Ra < 1.6', () => {
    const result = injectDrawingIntelligence(baseOps, {
      surfaceFinishRa: { value: 0.8 },
    });
    const rough = result.find((o) => o.name === 'Rough Milling')!;
    // The first Finish/Rough op gets +30%
    expect(rough.timeSec).toBeCloseTo(200 * 1.3, 1);
  });

  it('does NOT scale finish op when Ra >= 1.6', () => {
    const result = injectDrawingIntelligence(baseOps, {
      surfaceFinishRa: { value: 3.2 },
    });
    const rough = result.find((o) => o.name === 'Rough Milling')!;
    expect(rough.timeSec).toBe(200); // unchanged
  });

  it('adds Tapping for a drawing thread callout, priced from tblTapping when the depth is known', () => {
    const opsWithoutTap = baseOps.filter((o) => o.name !== 'Tapping');
    const result = injectDrawingIntelligence(opsWithoutTap, {
      threads: [{ spec: 'M6', count: 2, depthMm: 12 }],
    }, 'AISI 1018', realTappingTable(), specAsCalculators());
    const tap = result.find((o) => o.name === 'Tapping');
    expect(tap).toBeDefined();
    expect(tap!.timeSec).toBeGreaterThan(0);
    expect(tap!.missing).toBeUndefined();
  });

  it('adds an unpriced Tapping op naming the missing depth for a callout without one', () => {
    const opsWithoutTap = baseOps.filter((o) => o.name !== 'Tapping');
    const tap = injectDrawingIntelligence(opsWithoutTap, { threads: [{ spec: 'M6', count: 2 }] }, 'AISI 1018', realTappingTable(), specAsCalculators())
      .find((o) => o.name === 'Tapping')!;
    expect(tap.timeSec).toBe(0);
    expect(tap.missing).toContain('Thread Depth');
  });

  it('does NOT add duplicate Rigid Tap when one already exists', () => {
    const opsWithTap = [...baseOps, { name: 'Tapping', timeSec: 20, source: 'feature' as const }];
    const result = injectDrawingIntelligence(opsWithTap, {
      threads: [{ spec: 'M6', count: 2 }],
    });
    const tapCount = result.filter((o) => o.name === 'Tapping').length;
    expect(tapCount).toBe(1);
  });

  it('adds CMM Inspect when tightest tolerance < 0.05 mm', () => {
    const result = injectDrawingIntelligence(baseOps, {
      tolerances: { tightest: 0.02 },
    });
    expect(result.some((o) => o.name === 'CMM Inspect')).toBe(true);
  });

  it('does NOT add CMM Inspect when tolerance >= 0.05 mm', () => {
    const result = injectDrawingIntelligence(baseOps, {
      tolerances: { tightest: 0.1 },
    });
    expect(result.some((o) => o.name === 'CMM Inspect')).toBe(false);
  });
});

// Root-caused 2026-09-16: Counterbore used a flat "count * 8 sec" constant
// (no citation, no diameter or material sensitivity); Chamfer used a flat
// "count * 5 sec" constant. Both now use real tblCounterboring/
// tblChamfering physics when the caller resolves and passes them in
// (bom-items.service.ts, via MachiningLookupService) — falling back to the
// previous flat constants, disclosed as fallbacks, only when that data
// isn't available.
function counterboreFeature(count = 1, diamMm = 10): object {
  return {
    feature_type: 'MultiStepHole', variant: 'counterbore',
    diameter_mm: diamMm,
    occurrences: Array.from({ length: count }, () => ({
      depth_mm: 5,
      material_removed_mm3: 100,
    })),
  };
}

const COUNTERBORE_TABLE = [
  { tool_type: 'Counterbore', material_cut_code_name: '1.0', hardness: 125, hardness_system: 'Brinell', diameter_mm: 10, cutting_speed_m_min: 75.2, feed_mm_rev: 0.15, depth_max_mm: 38 },
  { tool_type: 'Counterbore', material_cut_code_name: '15.0', hardness: 275, hardness_system: 'Brinell', diameter_mm: 10, cutting_speed_m_min: 25.0, feed_mm_rev: 0.08, depth_max_mm: 38 },
  // Real row copied verbatim from memory/Machining/lookup (tblCounterboring__rows.csv): the aluminum-range
  // entry, so an aluminum part is inside the table's own hardness range.
  { tool_type: 'Counterbore', material_cut_code_name: '30.11', hardness: 60, hardness_system: 'Brinell', diameter_mm: 6.3, cutting_speed_m_min: 90.8, feed_mm_rev: 0.3, depth_max_mm: 38 },
];

describe('Counterbore — real tblCounterboring physics vs the previous flat fallback', () => {
  it('falls back to the flat constant when no real table is provided', () => {
    const ops = buildOperationSequence([counterboreFeature(1, 10)], 'aluminum');
    const cbore = ops.find((o) => o.name === 'Counterboring')!;
    expect(cbore.timeSec).toBeCloseTo(8, 3); // count(1) * 8
  });

  it('uses real diameter+hardness-matched physics when a real table is provided', () => {
    const ops = buildOperationSequence(
      [counterboreFeature(1, 10)], 'aluminum', 1.0, 'AL6061-T6', COUNTERBORE_TABLE,
    );
    const cbore = ops.find((o) => o.name === 'Counterboring')!;
    expect(cbore.timeSec).toBeGreaterThan(0);
    expect(cbore.timeSec).not.toBeCloseTo(8, 3);
  });

  it('is material-aware once real data is wired — stainless counterbores slower than aluminum', () => {
    const alu = buildOperationSequence([counterboreFeature(1, 10)], 'aluminum', 1.0, 'AL6061-T6', COUNTERBORE_TABLE);
    const ss = buildOperationSequence([counterboreFeature(1, 10)], 'stainless', 1.0, 'SS304', COUNTERBORE_TABLE);
    const aluTime = alu.find((o) => o.name === 'Counterboring')!.timeSec;
    const ssTime = ss.find((o) => o.name === 'Counterboring')!.timeSec;
    expect(ssTime).toBeGreaterThan(aluTime);
  });
});

const CHAMFER_LINEAR_SPEED = 10.7; // real tblChamfering value, material_cut_code "1.0"

describe('Chamfer — real tblChamfering physics vs the previous flat fallback', () => {
  it('falls back to the flat constant when no real linear speed is provided', () => {
    const ops = buildOperationSequence([{ feature_type: 'Edge', variant: 'chamfer', diameter_mm: 10, occurrences: [{}] }], 'aluminum');
    const chamfer = ops.find((o) => o.name === 'Chamfering')!;
    expect(chamfer.timeSec).toBeCloseTo(5, 3); // count(1) * 5
  });

  it('uses real diameter-derived edge length / real linear speed when provided', () => {
    const ops = buildOperationSequence(
      [{ feature_type: 'Edge', variant: 'chamfer', diameter_mm: 10, occurrences: [{}] }],
      'aluminum', 1.0, null, null, CHAMFER_LINEAR_SPEED,
    );
    const chamfer = ops.find((o) => o.name === 'Chamfering')!;
    // edgeLength = pi*10 = 31.4mm; time = 31.4 / 10.7 = 2.94s
    expect(chamfer.timeSec).toBeCloseTo(Math.PI * 10 / CHAMFER_LINEAR_SPEED, 2);
    expect(chamfer.timeSec).not.toBeCloseTo(5, 1);
  });

  it('also applies real chamfer physics inside the tapped_hole sequence, not just standalone chamfer features', () => {
    const withoutReal = buildOperationSequence([tappedHoleFeature(1, 6, 'M6')], 'aluminum');
    const withReal = buildOperationSequence(
      [tappedHoleFeature(1, 6, 'M6')], 'aluminum', 1.0, null, null, CHAMFER_LINEAR_SPEED,
    );
    const flatChamfer = withoutReal.find((o) => o.name === 'Chamfering')!.timeSec;
    const realChamfer = withReal.find((o) => o.name === 'Chamfering')!.timeSec;
    expect(realChamfer).not.toBeCloseTo(flatChamfer, 3);
  });
});

const ROUNDING_LINEAR_SPEED = 5.4; // real tblCornerRoundingMill value, material_cut_code "1.0"

describe('Corner Rounding (Filleting/Groove Milling) — real tblCornerRoundingMill physics vs the previous flat fallback (Phase 1, 2026-09-19)', () => {
  it('falls back to the flat constant when no real linear speed is provided', () => {
    const ops = buildOperationSequence([toroidFeature('fillet', 1, 30)], 'aluminum');
    const fillet = ops.find((o) => o.name === 'Filleting')!;
    expect(fillet.timeSec).toBeCloseTo(8, 3); // count(1) * 8
  });

  it('uses real diameter-derived edge length / real linear speed when provided', () => {
    const ops = buildOperationSequence(
      [toroidFeature('fillet', 1, 30)],
      'aluminum', 1.0, null, null, null, ROUNDING_LINEAR_SPEED,
    );
    const fillet = ops.find((o) => o.name === 'Filleting')!;
    // edgeLength = pi*30 = 94.2mm; time = 94.2 / 5.4 = 17.45s
    expect(fillet.timeSec).toBeCloseTo(Math.PI * 30 / ROUNDING_LINEAR_SPEED, 2);
    expect(fillet.timeSec).not.toBeCloseTo(8, 1);
  });

  it('applies the same real physics to Groove Milling — fillet and groove share one real rate table', () => {
    const ops = buildOperationSequence(
      [toroidFeature('groove', 1, 18)],
      'aluminum', 1.0, null, null, null, ROUNDING_LINEAR_SPEED,
    );
    const groove = ops.find((o) => o.name === 'Groove Milling')!;
    expect(groove.timeSec).toBeCloseTo(Math.PI * 18 / ROUNDING_LINEAR_SPEED, 2);
    expect(groove.timeSec).not.toBeCloseTo(8, 1);
  });
});

// ── Reference-vocabulary dispatch: hole shapes that previously had no case ───
// Before the reference-vocabulary migration, "cross_hole" and
// "pcd_hole_pattern" had no switch case: a cross hole fell to Bulk Milling of
// its volume and a PCD pattern (material_removed_mm3 = 0) produced no op at
// all, so every hole in a bolt circle was costed at zero.
describe('buildOperationSequence — SimpleHole cross / pcd_pattern', () => {
  it('drills a cross hole like any other plain hole', () => {
    const ops = buildOperationSequence([
      { feature_type: 'SimpleHole', variant: 'cross', diameter_mm: 6,
        occurrences: [{ depth_mm: 20, material_removed_mm3: 565 }] },
    ], 'aluminum');
    const drill = ops.find((o) => o.name === 'Drilling')!;
    expect(drill).toBeDefined();
    expect(drill.cadFeatureType).toBe('SimpleHole');
    expect(ops.some((o) => o.name === 'Bulk Milling')).toBe(false);
  });

  it('drills every real hole a PCD pattern stands for (hole_count), not one', () => {
    const pattern = (holeCount: number) => [{
      feature_type: 'SimpleHole', variant: 'pcd_pattern', diameter_mm: 6,
      occurrences: [{ depth_mm: 12, hole_count: holeCount, material_removed_mm3: 0 }],
    }];
    const six = buildOperationSequence(pattern(6), 'aluminum');
    const three = buildOperationSequence(pattern(3), 'aluminum');
    const spot6 = six.find((o) => o.name === 'Center Drilling')!;
    const spot3 = three.find((o) => o.name === 'Center Drilling')!;
    expect(spot6.timeSec).toBe(6 * 5);
    expect(spot3.timeSec).toBe(3 * 5);
    expect(six.find((o) => o.name === 'Drilling')!.timeSec)
      .toBeCloseTo(2 * three.find((o) => o.name === 'Drilling')!.timeSec, 6);
  });
});

describe('OperationLine.count', () => {
  it('carries the real instance count of the feature each line came from', () => {
    const ops = buildOperationSequence([tappedHoleFeature(3)], 'mild_steel');
    const tapLines = ops.filter((o) => o.cadFeatureType === 'SimpleHole');
    expect(tapLines.length).toBeGreaterThan(0);
    for (const o of tapLines) expect(o.count).toBe(3);
  });

  it('counts every hole a PCD pattern stands for', () => {
    const pcd = {
      feature_type: 'SimpleHole', variant: 'pcd_pattern', diameter_mm: 6,
      occurrences: [{ hole_count: 6, depth_mm: 12 }, { hole_count: 4, depth_mm: 12 }],
    };
    const ops = buildOperationSequence([pcd], 'mild_steel');
    const centerDrill = ops.find((o) => o.name === 'Center Drilling');
    expect(centerDrill?.count).toBe(10);
  });
});

describe('OperationLine.featureIds', () => {
  it('names the exact feature_graph_v2 entry each op machines', () => {
    const a = { ...tappedHoleFeature(2), id: 'SimpleHole_threaded_0' };
    const b = { feature_type: 'PocketV2', variant: 'default', id: 'PocketV2_default_0', occurrences: [{ material_removed_mm3: 500 }] };
    const ops = buildOperationSequence([a, b], 'mild_steel');
    const holeOps = ops.filter((o) => o.cadFeatureType === 'SimpleHole');
    const pocketOps = ops.filter((o) => o.cadFeatureType === 'PocketV2');
    expect(holeOps.length).toBeGreaterThan(0);
    expect(pocketOps.length).toBeGreaterThan(0);
    for (const o of holeOps) expect(o.featureIds).toEqual(['SimpleHole_threaded_0']);
    for (const o of pocketOps) expect(o.featureIds).toEqual(['PocketV2_default_0']);
  });

  it('leaves fixed ops (not tied to one feature) without feature ids', () => {
    const ops = buildOperationSequence([{ ...tappedHoleFeature(1), id: 'x' }], 'mild_steel');
    expect(ops.find((o) => o.source === 'fixed')?.featureIds).toBeUndefined();
  });
});
