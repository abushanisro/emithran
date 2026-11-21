import { describe, expect, it } from 'vitest';

import { missingMeasures, prunedRow } from '@/lib/costing/joint-table';
import { isPartAssemblyItem, weldMeasures, weldVocabulary, type WeldRow } from '@/lib/costing/part-assembly-view';
import { partAssemblyRouteKeyOf } from '@/lib/routing/part-assembly-route-id';

// The weld dialog asks exactly what the engine needs (backend weld-geometry.ts): the plate is asked for only where the joint is measured from it
// and the weldment's components give none.
const withPlate = weldVocabulary(3);
const noPlate = weldVocabulary(null);
const weld = (over: Partial<WeldRow>): WeldRow => ({ id: 'w', process: 'MIG Welding', count: 1, ...over });

describe('the weld table of a weldment', () => {
  it('a fillet needs its length; its leg defaults to the AWS D1.1 minimum for the plate, so the plate is needed only when the weldment has none', () => {
    const fillet = weld({ operation: 'Fillet Welding', lengthMm: 300 });
    expect(missingMeasures(withPlate, fillet)).toEqual([]);
    expect(missingMeasures(noPlate, fillet)).toEqual(['thicknessMm']);
    expect(missingMeasures(noPlate, { ...fillet, sizeMm: 5 })).toEqual([]);
    expect(withPlate.optional(fillet)).toEqual(['sizeMm', 'areaMm2', 'bevel', 'grind', 'finishGrind', 'wireBrush', 'thicknessMm']);
    // Bevelled, the plate is the bevel's depth.
    expect(missingMeasures(noPlate, { ...fillet, sizeMm: 5, bevel: true })).toEqual(['thicknessMm']);
  });

  it('a J, U or flared groove (and a Groove or Other weld) has no default shape: its area is needed', () => {
    expect(missingMeasures(withPlate, weld({ operation: 'J-Groove Welding', lengthMm: 100 }))).toEqual(['areaMm2']);
    expect(missingMeasures(noPlate, weld({ operation: 'Other Welding', lengthMm: 100, areaMm2: 40 }))).toEqual([]);
  });

  it('a plug is filled to the plate\'s depth; plugs and tacks have no seam to finish', () => {
    const plug = weld({ operation: 'Plug Welding', count: 4 });
    expect(missingMeasures(noPlate, plug)).toEqual(['thicknessMm']);
    expect(missingMeasures(withPlate, plug)).toEqual([]);
    expect(withPlate.optional(plug)).toEqual(['sizeMm', 'areaMm2', 'thicknessMm']);
    expect(withPlate.label('sizeMm', plug)).toBe('Hole Ø (mm)');
    expect(withPlate.label('count', weld({ operation: 'Tack Welding' }))).toBe('Tacks');
  });

  it('spots: their count, or the length they run along (at a pitch of 10 x the sheet, so then the plate)', () => {
    const spots = { id: 's', process: 'Spot Welding' } as WeldRow;
    expect(missingMeasures(withPlate, spots)).toEqual(['count']);
    expect(missingMeasures(noPlate, { ...spots, lengthMm: 300 })).toEqual(['thicknessMm']);
    expect(missingMeasures(noPlate, { ...spots, count: 8 })).toEqual([]);
    expect(withPlate.choices('feature', spots)).toEqual(['Blank', 'Edge']);
  });

  it('a laser seam needs its length; its penetration defaults to the plate', () => {
    const seam = weld({ process: 'Laser Seam Welding', lengthMm: 200 });
    expect(missingMeasures(withPlate, seam)).toEqual([]);
    expect(missingMeasures(noPlate, seam)).toEqual(['thicknessMm']);
    expect(missingMeasures(noPlate, { ...seam, depthMm: 2 })).toEqual([]);
  });

  it('a MIG weld names its operation first; another kind keeps the name and count, and saving drops what the new kind does not take', () => {
    expect(missingMeasures(withPlate, weld({}))).toEqual(['operation']);
    expect(withPlate.choices('operation', weld({}))).toContain('Fillet Welding');
    const spot = withPlate.rekind({ id: 'w', process: 'MIG Welding', label: 'Tabs', operation: 'Fillet Welding', count: 3, lengthMm: 40, grind: true }, 'Spot Welding');
    expect(spot).toEqual({ id: 'w', process: 'Spot Welding', label: 'Tabs', count: 3 });
    expect(withPlate.rekind(spot, 'MIG Welding')).toEqual({ id: 'w', process: 'MIG Welding', label: 'Tabs', count: 3, operation: 'Fillet Welding' });
    expect(prunedRow(withPlate, { id: 'p', process: 'MIG Welding', operation: 'Plug Welding', count: 4, lengthMm: 40, grind: true })).toEqual({ id: 'p', process: 'MIG Welding', operation: 'Plug Welding', count: 4 });
  });

  it('says a weld\'s measures in one line', () => {
    expect(weldMeasures({ operation: 'Fillet Welding', count: 2, lengthMm: 300, sizeMm: 5, thicknessMm: 3, areaMm2: null, depthMm: null, bevel: false, grind: true, finishGrind: false, wireBrush: true }))
      .toBe('2 x 300 mm, 5 mm leg, 3 mm plate, grind, wire brush');
    expect(weldMeasures({ operation: 'Plug Welding', count: 4, lengthMm: null, sizeMm: 11, thicknessMm: null, areaMm2: null, depthMm: null, bevel: false, grind: false, finishGrind: false, wireBrush: false }))
      .toBe('4, Ø11 mm hole');
    // Spots are counted: given by count, a length is not theirs; given by length, they are spread along it.
    const spot = { operation: 'Spot Welding', sizeMm: null, thicknessMm: null, areaMm2: null, depthMm: null, bevel: false, grind: false, finishGrind: false, wireBrush: false };
    expect(weldMeasures({ ...spot, count: 8, lengthMm: 500 })).toBe('8 spots');
    expect(weldMeasures({ ...spot, count: null, lengthMm: 500 })).toBe('spots along 500 mm, one every 10 x the sheet');
  });

  it('an item is a weldment when its Process is Part Assembly; its route ids are "partassembly-<key>"', () => {
    expect(isPartAssemblyItem({ scenarioOverrides: { processGroup: 'Part Assembly' } })).toBe(true);
    expect(isPartAssemblyItem({ scenarioOverrides: { processGroup: 'Assembly' } })).toBe(false);
    expect(isPartAssemblyItem(null)).toBe(false);
    expect(partAssemblyRouteKeyOf('partassembly-robotic')).toBe('robotic');
    expect(partAssemblyRouteKeyOf('assembly-robotic')).toBeUndefined();
    expect(partAssemblyRouteKeyOf('partassembly-')).toBeUndefined();
  });
});
