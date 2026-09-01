import { MANUFACTURING_PROCESS_REGISTRY, getEnginesForFamily } from '../../../../../../modules/bom-items/costing/shared/core/manufacturing-process-registry';

// Platform Architecture Remediation Phase 1 (engine registry unification,
// Rule 8/9) — guards against a future process getting a real engine written
// but never registered, and documents which families exist today so that's
// a deliberate, visible list, not something to rediscover by reading
// bom-items.service.ts.
describe('MANUFACTURING_PROCESS_REGISTRY — registry completeness', () => {
  it('has at least one engine for every expected process family, across all three domains', () => {
    const expectedFamilies = [
      'sheet_metal_cutting',
      'sheet_metal_forming',
      'sheet_metal_secondary_ops',
      'cnc_milling',
      'cnc_turning',
      'injection_molding',
      'inspection',
      'surface_treatment',
    ];
    for (const family of expectedFamilies) {
      expect(getEnginesForFamily(family).length).toBeGreaterThan(0);
    }
  });

  it('registers exactly 3 engines for cnc_milling and cnc_turning each (one per real machine class)', () => {
    expect(getEnginesForFamily('cnc_milling')).toHaveLength(3);
    expect(getEnginesForFamily('cnc_turning')).toHaveLength(3);
  });

  it('every registered engine has a non-empty machineClass and processFamily', () => {
    for (const engine of MANUFACTURING_PROCESS_REGISTRY) {
      expect(typeof engine.machineClass).toBe('string');
      expect(engine.machineClass.length).toBeGreaterThan(0);
      expect(typeof engine.processFamily).toBe('string');
      expect(engine.processFamily.length).toBeGreaterThan(0);
    }
  });

  it('registers exactly the 8 secondary-op engines this phase extracted from cost-engine.ts', () => {
    const secondaryOps = getEnginesForFamily('sheet_metal_secondary_ops');
    expect(secondaryOps).toHaveLength(8);
  });
});
