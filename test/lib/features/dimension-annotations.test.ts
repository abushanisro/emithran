import { describe, expect, it } from 'vitest';

import { buildDimensionAnnotations, formatDimension, visibleAnnotations } from '@/lib/features/dimension-annotations';
import counterbore from '../../fixtures/dimension-annotations/milled-counterbore.json';
import steppedDups from '../../fixtures/dimension-annotations/milled-stepped-dups.json';
import millTurn from '../../fixtures/dimension-annotations/mill-turn-rings.json';
import sheetMetal from '../../fixtures/dimension-annotations/sheet-metal-holes-bend.json';

// The fixtures are stored feature records of real parts (bom_items.feature_graph),
// trimmed to the fields the callouts read.

describe('dimension annotations from real stored parts', () => {
  it('a physical hole is one callout even when the engine split its faces into several features', () => {
    const raw = (steppedDups.machining_features.features as any[]).filter((f) => f.type === 'SimpleHole' && f.params.centroid);
    // Independent count: distinct (diameter, position) pairs in the raw records.
    const physical = new Set(raw.map((f) => `${f.params.diameter_mm}@${f.params.centroid.map((c: number) => c.toFixed(1)).join(',')}`));
    const holes = buildDimensionAnnotations(steppedDups as any).filter((a) => a.featureType === 'SimpleHole');
    expect(raw.length).toBeGreaterThan(physical.size); // the engine really did report duplicates
    // physical holes = the features the callouts stand for ("5x" counts five)
    expect(holes.reduce((n, a) => n + a.count, 0)).toBe(physical.size);
    for (const a of holes) expect(a.instances).toHaveLength(a.count);
  });

  it('no two callouts of one kind and size share a face', () => {
    for (const part of [steppedDups, counterbore, millTurn]) {
      const list = buildDimensionAnnotations(part as any);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!, b = list[j]!;
          if (a.kind === b.kind && Math.abs(a.valueMm - b.valueMm) <= 0.01) {
            expect(a.faceIds.some((f) => b.faceIds.includes(f))).toBe(false);
          }
        }
      }
    }
  });

  it('a stepped hole is one callout listing every diameter, largest first', () => {
    const labels = buildDimensionAnnotations(steppedDups as any).map((a) => a.label);
    expect(labels).toContain('Ø14 / Ø10 / Ø4');
  });

  it('a counterbored hole is one callout with the counterbore and bore diameters, not two holes', () => {
    const list = buildDimensionAnnotations(counterbore as any);
    const cb = list.filter((a) => a.featureType === 'MultiStepHole');
    expect(cb.map((a) => a.label)).toEqual(['Ø27.6 / Ø24.8']);
    expect(cb[0]!.faceIds).toEqual([9, 23, 36, 101]);
  });

  it('every callout carries real engine faces and a unique id', () => {
    for (const part of [steppedDups, counterbore, millTurn, sheetMetal]) {
      const list = buildDimensionAnnotations(part as any);
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
      for (const a of list) expect(a.faceIds.length).toBeGreaterThan(0);
    }
  });

  it('a sheet-metal part gets one Ø per hole and one R per bend, from its feature_graph_v2', () => {
    const list = buildDimensionAnnotations(sheetMetal as any);
    const holes = (sheetMetal.feature_graph_v2.features as any[]).filter((f) => f.feature_type === 'SimpleHole');
    const holeCount = holes.reduce((n, f) => n + f.occurrences.length, 0);
    const count = (kind: string) => list.filter((a) => a.kind === kind).reduce((n, a) => n + a.count, 0);
    expect(count('diameter')).toBe(holeCount); // 10 holes
    const bends = (sheetMetal.feature_graph_v2.features as any[]).filter((f) => f.feature_type === 'StraightBend');
    expect(count('radius')).toBe(bends.reduce((n, f) => n + f.occurrences.length, 0)); // 5 bends
    // identical features share one callout, as a drawing writes it
    expect(list.map((a) => a.label).sort()).toEqual(['2× Ø3', '2× Ø3.5', '5× R0.5', '5× Ø4.8', 'Ø1.6'].sort());
    const fives = list.find((a) => a.label === '5× Ø4.8')!;
    expect(fives.instances).toHaveLength(5);
    expect(fives.faceIds).toEqual([...new Set(fives.instances.flat())].sort((a, b) => a - b));
  });
});

describe('dimension annotation rules', () => {
  const feat = (type: string, variant: string, params: object, face_ids: number[]) => ({ type, variant, params, face_ids });
  const src = (...features: any[]) => ({ machining_features: { features } });

  it('a torus fillet is a radius callout and a pattern record is not a hole', () => {
    const list = buildDimensionAnnotations(src(
      feat('Edge', 'round', { radius_mm: 3, major_diameter_mm: 30 }, [7]),
      feat('SimpleHole', 'pcd_pattern', { hole_diameter_mm: 8, diameter_mm: 8, pcd_mm: 60, hole_count: 6 }, [1, 2, 3]),
    ));
    expect(list.map((a) => a.label)).toEqual(['R3']);
  });

  it('a feature the engine could not size, or tied to no face, gets no callout', () => {
    expect(buildDimensionAnnotations(src(
      feat('SimpleHole', 'through', {}, [1]),
      feat('SimpleHole', 'through', { diameter_mm: 5 }, []),
      feat('CurvedWall', 'default', { area_mm2: 50 }, [4]),
    ))).toEqual([]);
  });

  it('two features that share a face are one hole even at different reported positions', () => {
    const list = buildDimensionAnnotations(src(
      feat('SimpleHole', 'blind', { diameter_mm: 6, centroid: [0, 0, 0] }, [1, 2]),
      feat('SimpleHole', 'blind', { diameter_mm: 6, centroid: [0, 0, 9] }, [2, 3]),
    ));
    expect(list).toHaveLength(1);
    expect(list[0]!.faceIds).toEqual([1, 2, 3]);
  });

  it('two holes of the same size at different positions are two features under one grouped callout', () => {
    const list = buildDimensionAnnotations(src(
      feat('SimpleHole', 'through', { diameter_mm: 6, centroid: [0, 0, 0] }, [1]),
      feat('SimpleHole', 'through', { diameter_mm: 6, centroid: [20, 0, 0] }, [2]),
    ));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: '2× Ø6', count: 2, instances: [[1], [2]], faceIds: [1, 2] });
  });

  it('different sizes never share a callout', () => {
    const list = buildDimensionAnnotations(src(
      feat('SimpleHole', 'through', { diameter_mm: 6, centroid: [0, 0, 0] }, [1]),
      feat('SimpleHole', 'through', { diameter_mm: 8, centroid: [20, 0, 0] }, [2]),
    ));
    expect(list.map((a) => a.label).sort()).toEqual(['Ø6', 'Ø8']);
  });

  it('formats without trailing zeros and the mode filter splits diameter from radius', () => {
    expect(formatDimension(10)).toBe('10');
    expect(formatDimension(45.7549)).toBe('45.75');
    const list = buildDimensionAnnotations(sheetMetal as any);
    expect(visibleAnnotations(list, 'off')).toEqual([]);
    expect(visibleAnnotations(list, 'diameter').every((a) => a.kind === 'diameter')).toBe(true);
    expect(visibleAnnotations(list, 'radius').every((a) => a.kind === 'radius')).toBe(true);
    expect(visibleAnnotations(list, 'all')).toHaveLength(list.length);
  });
});

// The PMI of RMP-00015, as the engine reads it (cad-engine shared/step_pmi_dimensions.py).
const pmi = {
  dimensions: [
    { callout: 'Radius8@Cylinder Pattern1(4.75)', kind: 'radius', nominal_mm: 4.75, lower_mm: -0.15, upper_mm: 0.15, basic: false },
    { callout: 'Diameter5@Simple Hole7(40.08)', kind: 'diameter', nominal_mm: 40.08, lower_mm: -0.1, upper_mm: 0.1, basic: false },
    { callout: 'Diameter3@Simple Hole1(26.5)', kind: 'diameter', nominal_mm: 26.5, lower_mm: -0.25, upper_mm: 0.25, basic: false },
    { callout: 'Radius1@Cylinder2(45.75)', kind: 'radius', nominal_mm: 45.75, lower_mm: -0.15, upper_mm: 0.15, basic: false },
    { callout: 'DistanceBetween1@Cylinder13(6)', kind: 'curve length', nominal_mm: 6, lower_mm: null, upper_mm: null, basic: true },
  ],
};

describe('PMI tolerances on callouts', () => {
  const feat = (type: string, variant: string, params: object, face_ids: number[]) => ({ type, variant, params, face_ids });
  const build = (features: any[], p: any = pmi) => buildDimensionAnnotations({ machining_features: { features }, pmi: p } as any);

  it('a radius and a diameter take the tolerance the STEP states for that size', () => {
    const list = build([
      feat('Edge', 'round', { radius_mm: 45.75, centroid: [0, 0, 0] }, [1]),
      feat('SimpleHole', 'blind', { diameter_mm: 40.08, centroid: [9, 0, 0] }, [2]),
    ]);
    expect(list.map((a) => a.label).sort()).toEqual(['R45.75 ±0.15', 'Ø40.08 ±0.1']);
    expect(list.find((a) => a.kind === 'radius')!.tolerance).toEqual({ lowerMm: -0.15, upperMm: 0.15, callout: 'Radius1@Cylinder2(45.75)' });
  });

  it('a grouped callout carries the tolerance once: "4x R4.75 +/-0.15"', () => {
    const list = build([
      feat('Edge', 'round', { radius_mm: 4.75, centroid: [0, 0, 0] }, [1]),
      feat('Edge', 'round', { radius_mm: 4.75, centroid: [9, 0, 0] }, [2]),
    ]);
    expect(list[0]!.label).toBe('2× R4.75 ±0.15');
  });

  it('a size the PMI does not state gets no tolerance (never a general one)', () => {
    const list = build([feat('SimpleHole', 'blind', { diameter_mm: 9.6, centroid: [0, 0, 0] }, [1])]);
    expect(list[0]!.label).toBe('Ø9.6');
    expect(list[0]!.tolerance).toBeNull();
  });

  it('a radius is never given a diameter tolerance of the same number, nor the reverse', () => {
    const list = build([feat('Edge', 'round', { radius_mm: 26.5, centroid: [0, 0, 0] }, [1])]);
    expect(list[0]!.tolerance).toBeNull();
  });

  it('two PMI dimensions of the same size are ambiguous: no tolerance is shown', () => {
    const twice = { dimensions: [pmi.dimensions[3]!, { ...pmi.dimensions[3]!, callout: 'Radius9@Other(45.75)', lower_mm: -0.5, upper_mm: 0.5 }] };
    const list = build([feat('Edge', 'round', { radius_mm: 45.75, centroid: [0, 0, 0] }, [1])], twice);
    expect(list[0]!.tolerance).toBeNull();
    expect(list[0]!.label).toBe('R45.75');
  });

  it('a basic dimension or one with no stored bounds has nothing to show', () => {
    const basic = { dimensions: [{ kind: 'radius', nominal_mm: 6, lower_mm: null, upper_mm: null, basic: true }] };
    expect(build([feat('Edge', 'round', { radius_mm: 6, centroid: [0, 0, 0] }, [1])], basic)[0]!.tolerance).toBeNull();
  });

  it('asymmetric bounds are written as +upper/-lower', () => {
    const asym = { dimensions: [{ kind: 'diameter', nominal_mm: 8, lower_mm: -0.05, upper_mm: 0.2, basic: false }] };
    expect(build([feat('SimpleHole', 'blind', { diameter_mm: 8, centroid: [0, 0, 0] }, [1])], asym)[0]!.label).toBe('Ø8 +0.2/−0.05');
  });

  it('a part with no PMI is unchanged', () => {
    expect(build([feat('SimpleHole', 'blind', { diameter_mm: 8, centroid: [0, 0, 0] }, [1])], null)[0]!.label).toBe('Ø8');
  });
});
