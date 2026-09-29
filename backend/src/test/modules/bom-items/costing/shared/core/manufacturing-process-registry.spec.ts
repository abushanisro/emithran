import 'reflect-metadata';
import { MANUFACTURING_PROCESS_REGISTRY, getEnginesForFamily, getMachiningRouteIds } from '../../../../../../modules/bom-items/costing/shared/core/manufacturing-process-registry';
import { VALID_ROUTE_IDS } from '../../../../../../modules/bom-items/dto/apply-route.dto';

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
      'milling',
      'turning',
      'injection_molding',
      'inspection',
      'surface_treatment',
    ];
    for (const family of expectedFamilies) {
      expect(getEnginesForFamily(family).length).toBeGreaterThan(0);
    }
  });

  // Machining Engine Re-Architecture: the 6 coarse cnc_3ax_vmc/cnc_4ax_vmc/
  // cnc_5ax_mc/cnc_lathe/cnc_lathe_live/cnc_mill_turn buckets were replaced
  // by 7 real granular classes (3 milling, 4 turning — 2_axis_lathe/
  // 3_axis_lathe/2_axis_bar_feed_lathe_with_sub_spindle/
  // 3_axis_bar_feed_lathe_with_sub_spindle, since the coarse cnc_lathe/
  // cnc_lathe_live buckets each mapped to two real, distinct categories).
  it('registers one engine per real granular machine class for milling (3) and turning (5)', () => {
    expect(getEnginesForFamily('milling')).toHaveLength(3);
    // 5th real turning class: simultaneous_turning (multi-spindle automatic
    // lathe fleet — simultaneous_turning_usa.csv, 15 real machines).
    expect(getEnginesForFamily('turning')).toHaveLength(5);
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

// Machining routes are identified by their catalog machine class (the id the
// milled/turned route comparison emits), so an apply request for any route
// the comparison offers passes DTO validation -- the legacy cnc-* ids, which
// the comparison never produced, are gone.
describe('machining route ids', () => {
  it('are exactly the registered milling and turning machine classes', () => {
    expect(getMachiningRouteIds().sort()).toEqual([
      '2_axis_bar_feed_lathe_with_sub_spindle', '2_axis_lathe', '3_axis_bar_feed_lathe_with_sub_spindle',
      '3_axis_lathe', '3_axis_mill', '4_axis_mill', '5_axis_mill', 'simultaneous_turning',
    ]);
  });

  it('are all accepted by apply-route validation, and no legacy cnc-* id is', () => {
    for (const id of getMachiningRouteIds()) expect(VALID_ROUTE_IDS).toContain(id);
    expect(VALID_ROUTE_IDS.filter((id) => id.startsWith('cnc-'))).toEqual([]);
  });
});
