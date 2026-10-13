import { describe, it, expect } from 'vitest';
import { effectiveOperation, liveOperationOptions, resolveSavedOperation } from '@/lib/processCatalog/live-operation-options';

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
    // A line saved under its own name keeps it, so the reopened dialog shows it.
    expect(resolveSavedOperation([hpdc], 'High Pressure Die Casting', 'die_casting_high_pressure_die_casting')).toBe('High Pressure Die Casting');
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

// The Deburring step of Rtp2 Mag2 Backframe as the backend reports it (live, 2026-10-13):
// the Deslag catalog operation on each cut feature the part has. Before, the dialog's
// "3. Operation" offered the route-style line name ("Finishing") instead.
describe('liveOperationOptions — sheet-metal catalog operations', () => {
  const group = (featureType: string, count: number, status = 'resolved') =>
    ({ operations: ['Deslag'], featureType, count, status });
  const deburring = {
    process: 'Finishing', machineClass: 'deburring', cycleTimeMin: 0.84,
    catalogOperations: [
      group('Blank', 3), group('ComplexHole', 3),
      group('SimpleHole', 60), group('SimpleHole', 6), group('SimpleHole', 7), group('SimpleHole', 11),
      group('SimpleHole', 11), group('SimpleHole', 6), group('SimpleHole', 1), group('SimpleHole', 2),
      group('SimpleHole', 3), group('SimpleHole', 5), group('SimpleHole', 3), group('SimpleHole', 8), group('SimpleHole', 1),
    ],
  };

  it('offers the catalog operation on each feature, not the line name', () => {
    const opts = liveOperationOptions([deburring], new Set(['deburring']), new Map());
    expect(opts.map((o) => o.value)).toEqual(['Deslag // Blank', 'Deslag // ComplexHole', 'Deslag // SimpleHole']);
    expect(opts.map((o) => o.label)).toEqual(['Deslag // Blank [3]', 'Deslag // ComplexHole [3]', 'Deslag // SimpleHole [124]']);
    expect(opts.every((o) => o.lineProcess === 'Finishing' && o.cycleTimeMin === 0)).toBe(true);
  });

  it('keeps several candidate operations together and leaves out an infeasible group', () => {
    const turret = {
      process: 'Turret Punching', machineClass: 'turret_punch', cycleTimeMin: 1,
      catalogOperations: [
        { operations: ['Nibbling', 'Punching'], featureType: 'Blank', count: 1, status: 'undecided' },
        { operations: [], featureType: 'Lance', count: 2, status: 'infeasible' },
      ],
    };
    expect(liveOperationOptions([turret], new Set(['turret_punch']), new Map()).map((o) => o.value))
      .toEqual(['Nibbling or Punching // Blank']);
  });

  it('a line without catalog operations is still offered by its engine name', () => {
    const inspectionLine = { process: 'Inspection', machineClass: 'cmm', cycleTimeMin: 0.32 };
    expect(liveOperationOptions([inspectionLine], new Set(['cmm']), new Map()).map((o) => o.value)).toEqual(['Inspection']);
  });

  it('a line saved under its own name keeps it (never a blank Operation); a catalog operation is kept as saved', () => {
    expect(resolveSavedOperation([deburring], 'Finishing', 'deburring')).toBe('Finishing');
    expect(resolveSavedOperation([deburring], 'Deslag // SimpleHole', 'deburring')).toBe('Deslag // SimpleHole');
  });
});

// Reported on the Rtp2 Inspection line (saved operation 'Inspection', machine class cmm, no machine):
// the reopened dialog showed "Select operation". The operation is now derived, not synchronised.
describe('effectiveOperation', () => {
  const options = [{ value: 'Inspection' }, { value: 'Deslag // SimpleHole' }];

  it('shows the line saved operation as soon as it applies and is offered, with no pick made', () => {
    expect(effectiveOperation({ choice: null, options, savedOperation: 'Inspection', savedApplies: true })).toBe('Inspection');
  });

  it('is blank only while the saved operation does not apply (the line moved to another machine class)', () => {
    expect(effectiveOperation({ choice: null, options, savedOperation: 'Inspection', savedApplies: false })).toBe('');
  });

  it('the engineer pick wins while it is offered, and falls back to the saved one when it is not', () => {
    expect(effectiveOperation({ choice: 'Deslag // SimpleHole', options, savedOperation: 'Inspection', savedApplies: true })).toBe('Deslag // SimpleHole');
    expect(effectiveOperation({ choice: 'Gone', options, savedOperation: 'Inspection', savedApplies: true })).toBe('Inspection');
  });

  it('is a pure function of its inputs: the same inputs give the same answer in any order of loading', () => {
    const settled = { choice: null, options, savedOperation: 'Inspection', savedApplies: true };
    const loading = { ...settled, options: [] as Array<{ value: string }>, savedApplies: false };
    expect(effectiveOperation(loading)).toBe('');
    expect(effectiveOperation(settled)).toBe('Inspection'); // no stale state from the loading render
  });
});
