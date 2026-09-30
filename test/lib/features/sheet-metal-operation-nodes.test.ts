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

  it('labels a resolved operation in the catalog "Operation // Feature" form with size and count', () => {
    expect(p!.label).toBe('Punching // SimpleHole Ø4.0 ×14');
    expect(p!.v2FeatureIds).toEqual(['hole_d4']);
    expect(p!.children?.map((c) => c.label)).toEqual(['Punching // Edge']);
  });

  it('shows every candidate of an undecided feature, picking none', () => {
    expect(b!.label).toBe('Nibbling or Punching // Blank ×1');
    expect(b!.attrs.find((a) => a.name === 'Status')?.value).toMatch(/Undecided/);
  });

  it('marks a feature the machine cannot make, with the reason', () => {
    expect(s!.label).toBe('No operation // SimpleHole Ø1.2 ×2');
    expect(s!.attrs.find((a) => a.name === 'Why')?.value).toMatch(/smallest punchable/);
  });
});
