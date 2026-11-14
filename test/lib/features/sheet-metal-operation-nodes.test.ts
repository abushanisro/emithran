import { describe, it, expect } from 'vitest';
import { sheetMetalOperationNodes } from '@/lib/features/sheet-metal-operation-nodes';
import type { CatalogOperation } from '@/lib/api/hooks/useBOMItems';

// Shaped as the backend resolver returns them for a Turret Press step.
const punched: CatalogOperation = {
  operations: ['Punching'], featureType: 'SimpleHole', variant: 'through', diameterMm: 4, count: 14,
  featureIds: ['hole_d4'], status: 'resolved', children: [{ operation: 'Punching', featureType: 'Edge' }],
  reason: 'Ø4 mm fits one punch tool (max punch size 114.3 mm): punched, not nibbled.',
};
const blank: CatalogOperation = {
  operations: ['Nibbling', 'Punching'], featureType: 'Blank', variant: 'default', diameterMm: null, count: 1,
  featureIds: ['cut_profile'], status: 'undecided', children: [],
  reason: 'The catalog lists several operations for this feature on this process; no data here decides between them.',
};
const tooSmall: CatalogOperation = {
  operations: [], featureType: 'SimpleHole', variant: 'through', diameterMm: 1.2, count: 2,
  featureIds: ['hole_d1.2'], status: 'infeasible', children: [], reason: 'Ø1.2 mm is below the smallest punchable hole.',
};

describe('sheetMetalOperationNodes', () => {
  const [p, b, s] = sheetMetalOperationNodes('catop_0', [punched, blank, tooSmall]);

  it('names a resolved feature with size and count, the operation as an attribute', () => {
    expect(p!.label).toBe('SimpleHole Ø4.0 ×14');
    expect(p!.attrs.find((a) => a.name === 'Operation')?.value).toBe('Punching');
    expect(p!.v2FeatureIds).toEqual(['hole_d4']);
    expect(p!.children?.map((c) => c.label)).toEqual(['Edge']);
  });

  it('shows every candidate of an undecided feature, picking none', () => {
    expect(b!.label).toBe('Blank ×1');
    expect(b!.attrs.find((a) => a.name === 'Operation')?.value).toBe('Nibbling or Punching');
    expect(b!.attrs.find((a) => a.name === 'Status')?.value).toMatch(/Undecided/);
  });

  it('marks a feature the machine cannot make, with the reason', () => {
    expect(s!.label).toBe('SimpleHole Ø1.2 ×2');
    expect(s!.attrs.find((a) => a.name === 'Operation')?.value).toBe('No operation');
    expect(s!.attrs.find((a) => a.name === 'Why')?.value).toMatch(/smallest punchable/);
  });

  it('highlights a sand casting\'s analysis features by their faces on the model, one occurrence each, a child step by its own faces', () => {
    const sand: CatalogOperation = {
      operations: ['Sand Casting'], featureType: 'SimpleHole', variant: '', diameterMm: null, count: 3,
      featureIds: ['SimpleHole:1', 'SimpleHole:2', 'SimpleHole:3'], status: 'resolved',
      // SimpleHole:3's faces were not found on the model: it is left out, not shown in another's place.
      featureFaceIds: [[4, 5], [9], []],
      children: [{ operation: 'As Cast', featureType: 'Edge', featureFaceIds: [[5], [], []] }],
    };
    const [n] = sheetMetalOperationNodes('catop_1', [sand]);
    expect(n!.faceOccurrences).toEqual([[4, 5], [9]]);
    expect(n!.v2FeatureIds).toBeUndefined();
    expect(n!.children![0]!.faceOccurrences).toEqual([[5]]);
  });

  it('highlights nothing rather than guess when none of the faces were found', () => {
    const [n] = sheetMetalOperationNodes('catop_2', [{ ...punched, featureFaceIds: [[]], children: [] }]);
    expect(n!.faceOccurrences).toBeUndefined();
    expect(n!.v2FeatureIds).toBeUndefined();
  });
});
