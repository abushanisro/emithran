import { describe, it, expect } from 'vitest';
import { liveOperationOptions, resolveSavedOperation } from '@/lib/processCatalog/live-operation-options';

// Line shapes as the cost engine emits them: the inspection engine names its
// line "Inspection" and carries a per-feature breakdown; the machining engine
// emits several distinct lines on one machine class.
const inspection = {
  process: 'Inspection',
  machineClass: 'cmm',
  cycleTimeMin: 0.32,
  featureBreakdown: [{ name: 'Hole diameter ×4' }, { name: 'Flatness ×1' }],
};
const roughTurning = { process: 'Rough Turning', machineClass: 'cnc_lathe', cycleTimeMin: 1.2 };
const finishTurning = { process: 'Finish Turning', machineClass: 'cnc_lathe', cycleTimeMin: 0.8 };

describe('liveOperationOptions', () => {
  it('offers the line itself, valued by its engine name — the identity every writer saves', () => {
    const [op] = liveOperationOptions([inspection], new Set(['cmm']), new Map());
    expect(op).toEqual({
      value: 'Inspection',
      label: 'Inspection',
      detail: 'Hole diameter ×4, Flatness ×1',
      cycleTimeMin: 0.32,
      lineProcess: 'Inspection',
    });
  });

  it('never offers a feature-breakdown entry as an operation of its own', () => {
    const values = liveOperationOptions([inspection], new Set(['cmm']), new Map()).map((o) => o.value);
    expect(values).toEqual(['Inspection']);
  });

  it('keeps distinct lines on one machine class distinct', () => {
    const values = liveOperationOptions([roughTurning, finishTurning], new Set(['cnc_lathe']), new Map()).map((o) => o.value);
    expect(values).toEqual(['Finish Turning', 'Rough Turning']);
  });

  it('only lists lines on the chosen category machine classes', () => {
    expect(liveOperationOptions([inspection, roughTurning], new Set(['cnc_lathe']), new Map()).map((o) => o.value))
      .toEqual(['Rough Turning']);
  });

  it('adds the catalog feature type to the label, not to the value', () => {
    const [op] = liveOperationOptions([roughTurning], new Set(['cnc_lathe']), new Map([['Rough Turning', 'Ring']]));
    expect(op!.value).toBe('Rough Turning');
    expect(op!.label).toBe('Rough Turning // Ring');
  });

  it('a line that performs several catalog operations offers each one, sharing the line', () => {
    const hpdc = {
      process: 'High Pressure Die Casting', machineClass: 'die_casting_high_pressure_die_casting', cycleTimeMin: 1.14,
      featureBreakdown: [{ name: 'Fill' }, { name: 'Solidification' }],
      featureOperations: [
        { operation: 'No Coring', featureType: 'SimpleHole', instances: Array.from({ length: 17 }, () => ({})) },
        { operation: 'As Cast', featureType: 'Void', instances: [{}, {}, {}] },
      ],
    };
    const opts = liveOperationOptions([hpdc], new Set(['die_casting_high_pressure_die_casting']), new Map());
    expect(opts.map((o) => o.value)).toEqual(['As Cast // Void', 'No Coring // SimpleHole']);
    expect(opts.map((o) => o.label)).toEqual(['As Cast // Void [3]', 'No Coring // SimpleHole [17]']);
    expect(opts.every((o) => o.lineProcess === 'High Pressure Die Casting' && o.cycleTimeMin === 0)).toBe(true);
    // The line's own name is not an operation: nothing pre-selected.
    expect(resolveSavedOperation([hpdc], 'High Pressure Die Casting', 'die_casting_high_pressure_die_casting')).toBe('');
    expect(resolveSavedOperation([hpdc], 'As Cast // Void', 'die_casting_high_pressure_die_casting')).toBe('As Cast // Void');
  });
});

describe('resolveSavedOperation', () => {
  it('keeps a saved name a live line still has', () => {
    expect(resolveSavedOperation([roughTurning, finishTurning], 'Finish Turning', 'cnc_lathe')).toBe('Finish Turning');
  });

  it('maps a legacy catalog name to the one live line on its machine class', () => {
    expect(resolveSavedOperation([inspection, roughTurning], 'CMM Inspection', 'cmm')).toBe('Inspection');
  });

  it('does not guess between several live lines on the class', () => {
    expect(resolveSavedOperation([roughTurning, finishTurning], 'Turning', 'cnc_lathe')).toBe('Turning');
  });
});
