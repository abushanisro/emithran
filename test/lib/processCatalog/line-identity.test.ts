import { describe, expect, it } from 'vitest';

import { keepsSavedOperation, resolveLineIdentity } from '@/lib/processCatalog/line-identity';

// Live catalog rows (process_calculator_mappings): CMM Inspection and Black Oxide.
const blackOxide = { processRoute: 'Black Oxide', operation: 'Black Oxide' };
const inspectionLine = { savedMachineClass: 'cmm', savedProcessRoute: 'Inspection', savedOperation: 'Inspection' };

describe('resolveLineIdentity', () => {
  it('the reported bug: an Inspection line moved to a Black Oxide machine takes the Black Oxide identity', () => {
    const r = resolveLineIdentity({ ...inspectionLine, selectedMachineClass: 'surface_black_oxide', selectedOperation: '', classCatalog: blackOxide });
    expect(r).toEqual({ ok: true, processRoute: 'Black Oxide', operation: 'Black Oxide', source: 'catalog' });
  });

  it('an unchanged line keeps its saved route and operation', () => {
    const r = resolveLineIdentity({ ...inspectionLine, selectedMachineClass: 'cmm', selectedOperation: '', classCatalog: null });
    expect(r).toEqual({ ok: true, processRoute: 'Inspection', operation: 'Inspection', source: 'saved' });
  });

  it('a CAD-detected operation the engineer picked wins over the saved and catalog operation', () => {
    expect(resolveLineIdentity({ ...inspectionLine, selectedMachineClass: 'cmm', selectedOperation: 'Hole Check', classCatalog: null }))
      .toMatchObject({ operation: 'Hole Check' });
    expect(resolveLineIdentity({ ...inspectionLine, selectedMachineClass: 'surface_black_oxide', selectedOperation: 'Black Oxide Rack', classCatalog: blackOxide }))
      .toMatchObject({ processRoute: 'Black Oxide', operation: 'Black Oxide Rack' });
  });

  it('a new line (nothing saved) takes the catalog identity', () => {
    const r = resolveLineIdentity({ savedMachineClass: null, savedProcessRoute: '', savedOperation: '', selectedMachineClass: 'surface_black_oxide', selectedOperation: '', classCatalog: blackOxide });
    expect(r).toMatchObject({ ok: true, source: 'catalog', processRoute: 'Black Oxide' });
  });

  it('refuses (never saves a stale label) when the new class has no single catalog row', () => {
    const r = resolveLineIdentity({ ...inspectionLine, selectedMachineClass: 'press_brake', selectedOperation: '', classCatalog: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('press_brake');
  });

  it('asks for a machine when none is chosen', () => {
    const r = resolveLineIdentity({ savedMachineClass: null, savedProcessRoute: '', savedOperation: '', selectedMachineClass: '', selectedOperation: '', classCatalog: null });
    expect(r.ok).toBe(false);
  });
});

describe('keepsSavedOperation', () => {
  it.each([
    ['cmm', 'cmm', true],
    ['cmm', 'surface_black_oxide', false],
    [null, 'cmm', false],
    ['', '', false],
  ])('saved %s, selected %s -> %s', (saved, selected, expected) => {
    expect(keepsSavedOperation(saved, selected)).toBe(expected);
  });
});
