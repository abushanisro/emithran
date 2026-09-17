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

// ── Helpers ───────────────────────────────────────────────────────────────────

function tappedHoleFeature(count = 1, diamMm = 4, spec = 'M4'): object {
  return {
    feature_type: 'tapped_hole',
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
    feature_type: 'pocket',
    diameter_mm: 0,
    occurrences: Array.from({ length: count }, () => ({
      depth_mm: 10,
      material_removed_mm3: removedMm3Each,
    })),
  };
}

function throughHoleFeature(count = 1, diamMm = 6): object {
  return {
    feature_type: 'through_hole',
    diameter_mm: diamMm,
    occurrences: Array.from({ length: count }, () => ({
      depth_mm: 20,
      material_removed_mm3: Math.PI * (diamMm / 2) ** 2 * 20,
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildOperationSequence', () => {
  it('returns empty array for null/empty feature list', () => {
    expect(buildOperationSequence(null, 'aluminum')).toEqual([]);
    expect(buildOperationSequence([], 'aluminum')).toEqual([]);
  });

  it('always starts with Face Mill and ends with Deburr', () => {
    const features = [tappedHoleFeature(2)];
    const ops = buildOperationSequence(features, 'aluminum');
    expect(ops[0].name).toBe('Face Mill');
    expect(ops[ops.length - 1].name).toBe('Deburr');
  });

  it('generates Spot Drill + Drill + Chamfer + Rigid Tap for tapped holes', () => {
    const ops = buildOperationSequence([tappedHoleFeature(3, 4, 'M4')], 'aluminum');
    const names = ops.map((o) => o.name);
    expect(names).toContain('Spot Drill');
    expect(names).toContain('Drill');
    expect(names).toContain('Chamfer');
    expect(names).toContain('Rigid Tap');
  });

  it('generates Pocket Rough + Pocket Finish Floor + Pocket Finish Wall for pockets', () => {
    const ops = buildOperationSequence([pocketFeature(2, 8000)], 'mild_steel');
    const names = ops.map((o) => o.name);
    expect(names).toContain('Pocket Rough');
    expect(names).toContain('Pocket Finish Floor');
    expect(names).toContain('Pocket Finish Wall');
  });

  it('generates Spot Drill + Drill for through holes', () => {
    const ops = buildOperationSequence([throughHoleFeature(4, 6)], 'aluminum');
    const names = ops.map((o) => o.name);
    expect(names).toContain('Spot Drill');
    expect(names).toContain('Drill');
    // No tap
    expect(names).not.toContain('Rigid Tap');
  });

  it('machinability factor 2.0 (Al 6061 vs mild steel) halves cycle time for pockets', () => {
    const features = [pocketFeature(1, 10_000)];
    const milSteel = buildOperationSequence(features, 'mild_steel', 1.0);
    const aluminum = buildOperationSequence(features, 'aluminum', 2.0);

    const roughTimeMild = milSteel.find((o) => o.name === 'Pocket Rough')!.timeSec;
    const roughTimeAlum = aluminum.find((o) => o.name === 'Pocket Rough')!.timeSec;

    // Al MRR = 60000 * 2 = 120000; mild_steel MRR = 12000 * 1 = 12000 → 10× faster
    // so aluminum pocket rough time ≈ roughTimeMild / 10
    expect(roughTimeAlum).toBeCloseTo(roughTimeMild / 10, 0);
  });

  it('ops are sorted in canonical manufacturing order', () => {
    const features = [pocketFeature(1), tappedHoleFeature(2), throughHoleFeature(1)];
    const ops = buildOperationSequence(features, 'aluminum');
    const names = ops.map((o) => o.name);

    // Face Mill must precede pockets; Drill before Tap; Deburr at end
    const faceIdx = names.indexOf('Face Mill');
    const roughIdx = names.indexOf('Pocket Rough');
    const drillIdx = names.lastIndexOf('Drill');
    const tapIdx = names.indexOf('Rigid Tap');
    const deburrIdx = names.indexOf('Deburr');

    expect(faceIdx).toBeLessThan(roughIdx);
    expect(drillIdx).toBeLessThan(tapIdx);
    expect(tapIdx).toBeLessThan(deburrIdx);
  });

  it('totalCycleTimeSec sums all operation times', () => {
    const ops: OperationLine[] = [
      { name: 'Face Mill', timeSec: 45, source: 'fixed' },
      { name: 'Pocket Rough', timeSec: 120, source: 'feature' },
      { name: 'Deburr', timeSec: 90, source: 'fixed' },
    ];
    expect(totalCycleTimeSec(ops)).toBe(255);
  });
});

describe('injectDrawingIntelligence', () => {
  const baseOps: OperationLine[] = [
    { name: 'Face Mill', timeSec: 45, source: 'fixed' },
    { name: 'Pocket Rough', timeSec: 200, source: 'feature' },
    { name: 'Pocket Finish Floor', timeSec: 30, source: 'feature' },
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
    const rough = result.find((o) => o.name === 'Pocket Rough')!;
    // The first Finish/Rough op gets +30%
    expect(rough.timeSec).toBeCloseTo(200 * 1.3, 1);
  });

  it('does NOT scale finish op when Ra >= 1.6', () => {
    const result = injectDrawingIntelligence(baseOps, {
      surfaceFinishRa: { value: 3.2 },
    });
    const rough = result.find((o) => o.name === 'Pocket Rough')!;
    expect(rough.timeSec).toBe(200); // unchanged
  });

  it('adds Rigid Tap when drawing has thread callout and no tap in ops', () => {
    const opsWithoutTap = baseOps.filter((o) => o.name !== 'Rigid Tap');
    const result = injectDrawingIntelligence(opsWithoutTap, {
      threads: [{ spec: 'M6', count: 2 }],
    });
    const tap = result.find((o) => o.name === 'Rigid Tap');
    expect(tap).toBeDefined();
    expect(tap!.timeSec).toBeGreaterThan(0); // TAP_CYCLE_SEC.M6 = 10s × 2
  });

  it('does NOT add duplicate Rigid Tap when one already exists', () => {
    const opsWithTap = [...baseOps, { name: 'Rigid Tap', timeSec: 20, source: 'feature' as const }];
    const result = injectDrawingIntelligence(opsWithTap, {
      threads: [{ spec: 'M6', count: 2 }],
    });
    const tapCount = result.filter((o) => o.name === 'Rigid Tap').length;
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
    feature_type: 'counterbore',
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
];

describe('Counterbore — real tblCounterboring physics vs the previous flat fallback', () => {
  it('falls back to the flat constant when no real table is provided', () => {
    const ops = buildOperationSequence([counterboreFeature(1, 10)], 'aluminum');
    const cbore = ops.find((o) => o.name === 'Counterbore')!;
    expect(cbore.timeSec).toBeCloseTo(8, 3); // count(1) * 8
  });

  it('uses real diameter+hardness-matched physics when a real table is provided', () => {
    const ops = buildOperationSequence(
      [counterboreFeature(1, 10)], 'aluminum', 1.0, 'AL6061-T6', COUNTERBORE_TABLE,
    );
    const cbore = ops.find((o) => o.name === 'Counterbore')!;
    expect(cbore.timeSec).toBeGreaterThan(0);
    expect(cbore.timeSec).not.toBeCloseTo(8, 3);
  });

  it('is material-aware once real data is wired — stainless counterbores slower than aluminum', () => {
    const alu = buildOperationSequence([counterboreFeature(1, 10)], 'aluminum', 1.0, 'AL6061-T6', COUNTERBORE_TABLE);
    const ss = buildOperationSequence([counterboreFeature(1, 10)], 'stainless', 1.0, 'SS304', COUNTERBORE_TABLE);
    const aluTime = alu.find((o) => o.name === 'Counterbore')!.timeSec;
    const ssTime = ss.find((o) => o.name === 'Counterbore')!.timeSec;
    expect(ssTime).toBeGreaterThan(aluTime);
  });
});

const CHAMFER_LINEAR_SPEED = 10.7; // real tblChamfering value, material_cut_code "1.0"

describe('Chamfer — real tblChamfering physics vs the previous flat fallback', () => {
  it('falls back to the flat constant when no real linear speed is provided', () => {
    const ops = buildOperationSequence([{ feature_type: 'chamfer', diameter_mm: 10, occurrences: [{}] }], 'aluminum');
    const chamfer = ops.find((o) => o.name === 'Chamfer')!;
    expect(chamfer.timeSec).toBeCloseTo(5, 3); // count(1) * 5
  });

  it('uses real diameter-derived edge length / real linear speed when provided', () => {
    const ops = buildOperationSequence(
      [{ feature_type: 'chamfer', diameter_mm: 10, occurrences: [{}] }],
      'aluminum', 1.0, null, null, CHAMFER_LINEAR_SPEED,
    );
    const chamfer = ops.find((o) => o.name === 'Chamfer')!;
    // edgeLength = pi*10 = 31.4mm; time = 31.4 / 10.7 = 2.94s
    expect(chamfer.timeSec).toBeCloseTo(Math.PI * 10 / CHAMFER_LINEAR_SPEED, 2);
    expect(chamfer.timeSec).not.toBeCloseTo(5, 1);
  });

  it('also applies real chamfer physics inside the tapped_hole sequence, not just standalone chamfer features', () => {
    const withoutReal = buildOperationSequence([tappedHoleFeature(1, 6, 'M6')], 'aluminum');
    const withReal = buildOperationSequence(
      [tappedHoleFeature(1, 6, 'M6')], 'aluminum', 1.0, null, null, CHAMFER_LINEAR_SPEED,
    );
    const flatChamfer = withoutReal.find((o) => o.name === 'Chamfer')!.timeSec;
    const realChamfer = withReal.find((o) => o.name === 'Chamfer')!.timeSec;
    expect(realChamfer).not.toBeCloseTo(flatChamfer, 3);
  });
});
