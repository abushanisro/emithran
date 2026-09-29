import {
  machiningRouteFamilyOf,
  resolveCanonicalOperation,
} from '../../../../../../modules/bom-items/costing/machining/process/canonical-operation';
import { isReferenceOperation } from '../../../../../../modules/bom-items/costing/shared/reference-features.generated';

// canonical-operation.ts verifies every pairing against the generated
// reference catalog at import time; these tests pin the resolved labels and
// the catalog check itself.
describe('resolveCanonicalOperation', () => {
  it('labels plain, cross and patterned holes as Drilling // SimpleHole', () => {
    for (const variant of ['through', 'blind', 'cross', 'pcd_pattern']) {
      expect(resolveCanonicalOperation('SimpleHole', variant, 'milling')).toBe('Drilling // SimpleHole');
    }
  });

  it('labels a threaded hole as Tapping // SimpleHole', () => {
    expect(resolveCanonicalOperation('SimpleHole', 'threaded', 'milling')).toBe('Tapping // SimpleHole');
  });

  it('labels a counterbore by the operation the catalog attaches to its MultiStepHole', () => {
    expect(resolveCanonicalOperation('MultiStepHole', 'counterbore', 'milling')).toBe('Multistep Holemaking // MultiStepHole');
  });

  it('uses the lathe-specific chamfer operation on turning routes', () => {
    expect(resolveCanonicalOperation('Edge', 'chamfer', 'milling')).toBe('Chamfering // Edge');
    expect(resolveCanonicalOperation('Edge', 'chamfer', 'turning')).toBe('Mill Chamfering // Edge');
  });

  it('treats a missing variant as "default"', () => {
    expect(resolveCanonicalOperation('PocketV2', undefined, 'milling')).toBe('Rough Milling // PocketV2');
  });

  it('returns null for an unmapped feature instead of a fabricated label', () => {
    expect(resolveCanonicalOperation('AxiGroove', 'default', 'milling')).toBeNull();
    expect(resolveCanonicalOperation('SimpleHole', 'made_up', 'milling')).toBeNull();
  });

  it('maps the backend-normalized cad families onto route families', () => {
    expect(machiningRouteFamilyOf('turned')).toBe('turning');
    expect(machiningRouteFamilyOf('mill_turn')).toBe('turning');
    expect(machiningRouteFamilyOf('milled')).toBe('milling');
  });
});

describe('isReferenceOperation (generated from the reference catalog)', () => {
  it('accepts a real catalog pairing and rejects an invented one', () => {
    expect(isReferenceOperation('machining', 'SimpleHole', 'Drilling')).toBe(true);
    expect(isReferenceOperation('machining', 'SimpleHole', 'Laser Drilling')).toBe(false);
    expect(isReferenceOperation('sheet_metal', 'StraightBend', 'Bending')).toBe(true);
  });
});
