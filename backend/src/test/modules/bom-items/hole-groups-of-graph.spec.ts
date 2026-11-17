import { holeGroupsOfGraph } from '../../../modules/bom-items/bom-item-costing.service';

/**
 * The drilling calculator of the process dialog is filled from the part's drilled-hole groups. A forged or cast part has no machining
 * recognizer output, so its groups come from the hole features of its own analysis: the Carriage Mount's 11 holes, drilled after forging.
 */
describe('the drilled-hole groups of a forged or cast part', () => {
  const hole = (id: string, diameter: number, depth: number) => ({ id, feature_type: 'SimpleHole', variant: 'through', occurrences: [{ face_ids: [1], diameter_mm: diameter, depth_mm: depth }] });

  it('groups the holes by diameter, with their count, deepest hole and the occurrences that are its holes', () => {
    const groups = holeGroupsOfGraph([
      hole('hole-1', 2.2, 8), hole('hole-2', 2.2, 10), hole('hole-3', 2.529, 6),
      { id: 'face-1', feature_type: 'PlanarFace', occurrences: [{ face_ids: [4] }] },
    ]);
    expect(groups).toEqual([
      { diameter_mm: 2.2, count: 2, depth_mm: 10, occurrences: [{ featureId: 'hole-1', occurrenceIndex: 0 }, { featureId: 'hole-2', occurrenceIndex: 0 }] },
      { diameter_mm: 2.5, count: 1, depth_mm: 6, occurrences: [{ featureId: 'hole-3', occurrenceIndex: 0 }] },
    ]);
  });

  it('reads the diameter from the feature when the occurrence has none, and skips a hole with no diameter', () => {
    expect(holeGroupsOfGraph([{ id: 'h', feature_type: 'SimpleHole', diameter_mm: 5, occurrences: [{}, {}] }])).toEqual([
      { diameter_mm: 5, count: 2, occurrences: [{ featureId: 'h', occurrenceIndex: 0 }, { featureId: 'h', occurrenceIndex: 1 }] },
    ]);
    expect(holeGroupsOfGraph([{ id: 'h', feature_type: 'SimpleHole', occurrences: [{}] }])).toEqual([]);
    expect(holeGroupsOfGraph(null)).toEqual([]);
  });
});
