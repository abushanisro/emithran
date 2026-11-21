import { realHydroformingCatalog } from './hydroforming-test-data';
import { hydroformFeatures, hydroformingCatalogOperations } from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-features';

import type { HydroformPart } from '../../../../../modules/bom-items/costing/hydroforming/hydroforming-part';


// The rows each step lists in the process tree, from memory's own catalog and the part's features. Cannula Holder bottom's numbers: its
// feature graph's Blank and three bends; the hydroform measurement's holes (faces 17, 21: 1.62 mm; 18, 22: 5 mm; 90: the 18.4 mm bore).
const hole = (diameterMm: number, faceIds: number[], inFlat = true) => ({
  featureType: 'SimpleHole', diameterMm, perimeterMm: Math.PI * diameterMm, areaMm2: 0, inFlat, onMainSurface: true, edgeDistanceMm: null, faceIds,
});
const PART = { holes: [hole(1.62, [17]), hole(5, [18]), hole(1.62, [21]), hole(5, [22]), hole(18.4, [90], false)] } as unknown as HydroformPart;
const GRAPH = [
  { id: 'blank_0', feature_type: 'Blank', variant: 'default' },
  { id: 'bend_0', feature_type: 'StraightBend', variant: 'default' }, { id: 'bend_1', feature_type: 'StraightBend', variant: 'default' },
  { id: 'hole_0', feature_type: 'SimpleHole', variant: 'through' },
];
const catalog = realHydroformingCatalog();
const features = hydroformFeatures(GRAPH, PART);

describe('each hydroforming step names the part\'s CAD features, as memory\'s catalog states them', () => {
  it('reads the part\'s features: the graph\'s Blank and bends, the measurement\'s holes by diameter with their faces', () => {
    expect(features).toMatchObject({ blank: ['blank_0'], bends: ['bend_0', 'bend_1'], forms: [], graphHoles: ['hole_0'] });
    expect(features.holes).toEqual([
      { featureType: 'SimpleHole', diameterMm: 1.6, faceIds: [[17], [21]] },
      { featureType: 'SimpleHole', diameterMm: 5, faceIds: [[18], [22]] },
      { featureType: 'SimpleHole', diameterMm: 18.4, faceIds: [[90]] },
    ]);
  });

  it('Offline Blank: Blanking // Blank, and Piercing // each hole group, a hole through a formed wall too (memory pierces every hole)', () => {
    const { blank } = hydroformingCatalogOperations(catalog, 'Hydroform Fluid Cell', 'Fluid Cell Forming', features, false);
    expect(blank.map((o) => [o.operations[0], o.featureType, o.diameterMm, o.count])).toEqual([
      ['Blanking', 'Blank', null, 1], ['Piercing', 'SimpleHole', 1.6, 2], ['Piercing', 'SimpleHole', 5, 2], ['Piercing', 'SimpleHole', 18.4, 1],
    ]);
    expect(blank[0]).toMatchObject({ featureIds: ['blank_0'], status: 'resolved' });
    expect(blank[3]).toMatchObject({ featureIds: [], featureFaceIds: [[90]] });
  });

  it('the press: the route\'s forming operation on each feature, the rest of its cycle under it (hand adjusting only when the route has it)', () => {
    const fluid = hydroformingCatalogOperations(catalog, 'Hydroform Fluid Cell', 'Fluid Cell Forming', features, true).press;
    expect(fluid.map((o) => [o.operations[0], o.featureType, o.diameterMm])).toEqual([
      ['Fluid Cell Forming', 'StraightBend', null], ['Fluid Cell Forming', 'SimpleHole', 1.6], ['Fluid Cell Forming', 'SimpleHole', 5], ['Fluid Cell Forming', 'SimpleHole', 18.4],
    ]);
    expect(fluid[0].children.map((c) => c.operation)).toEqual(['Loading', 'Hand Adjusting', 'Clean Tooling', 'Visual Inspection', 'Unloading']);
    expect(fluid[0].featureIds).toEqual(['bend_0', 'bend_1']);
    expect(fluid[3].children.every((c) => JSON.stringify(c.featureFaceIds) === '[[90]]')).toBe(true);
    const deep = hydroformingCatalogOperations(catalog, 'Hydroform Deep Draw', 'Deep Draw Forming', { ...features, forms: ['form_0'] }, false).press;
    expect(deep[0]).toMatchObject({ operations: ['Deep Draw Forming'], featureType: 'Form', featureIds: ['form_0'] });
    expect(deep[0].children.map((c) => c.operation)).toEqual(['Loading', 'Clean Tooling', 'Visual Inspection', 'Unloading']);
  });

  it('no catalog (not staged), no rows: the tree shows the steps\' own breakdown instead', () => {
    expect(hydroformingCatalogOperations([], 'Hydroform Deep Draw', 'Deep Draw Forming', features, false)).toEqual({ blank: [], press: [] });
  });
});
