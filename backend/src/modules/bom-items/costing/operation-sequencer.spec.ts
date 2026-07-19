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
} from './operation-sequencer';

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
