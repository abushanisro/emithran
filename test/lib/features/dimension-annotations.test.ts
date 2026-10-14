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
    expect(holes).toHaveLength(physical.size);
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
    expect(list.filter((a) => a.kind === 'diameter')).toHaveLength(holeCount);
    const bends = (sheetMetal.feature_graph_v2.features as any[]).filter((f) => f.feature_type === 'StraightBend');
    expect(list.filter((a) => a.kind === 'radius')).toHaveLength(bends.reduce((n, f) => n + f.occurrences.length, 0));
    expect(list.filter((a) => a.kind === 'radius').every((a) => a.label === 'R0.5')).toBe(true);
    expect(list.map((a) => a.label)).toContain('Ø4.8');
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

  it('two holes of the same size at different positions stay two callouts', () => {
    const list = buildDimensionAnnotations(src(
      feat('SimpleHole', 'through', { diameter_mm: 6, centroid: [0, 0, 0] }, [1]),
      feat('SimpleHole', 'through', { diameter_mm: 6, centroid: [20, 0, 0] }, [2]),
    ));
    expect(list).toHaveLength(2);
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
