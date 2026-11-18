import { describe, expect, it } from 'vitest';

import {
  isAssemblyItem, jointMeasures, jointTableOf, jointTablePatch, missingMeasures, newJointId, withDerivedEnabled, withJoint, withoutJoint, type JointRow,
} from '@/lib/costing/assembly-view';
import { assemblyRouteKeyOf } from '@/lib/routing/assembly-route-id';

const screw = { id: 'screw:housing:hole-1', process: 'Mechanical Assembly', operation: 'Screw Tighten - Manual', count: 4 };

describe('the assembly Cost Guide', () => {
  it('reads the joint table set in the Cost Guide, and nothing else as a row', () => {
    expect(jointTableOf({ assemblyJoints: [{ id: 'joint-1', process: 'MIG Welding' }, { process: 'no id' }, 'text'] })).toEqual([{ id: 'joint-1', process: 'MIG Welding' }]);
    expect(jointTableOf(undefined)).toEqual([]);
  });

  it('adds a joint, replaces it by its id, removes it; an empty table clears the key', () => {
    const weld: JointRow = { id: 'joint-1', process: 'MIG Welding', count: 1, lengthMm: 300, throatMm: 4 };
    const t = withJoint([], weld);
    expect(withJoint(t, { ...weld, lengthMm: 200 })).toEqual([{ ...weld, lengthMm: 200 }]);
    expect(withoutJoint(t, 'joint-1')).toEqual([]);
    expect(jointTablePatch([])).toEqual({ assemblyJoints: null });
    expect(newJointId(t)).toBe('joint-2');
  });

  it('switches a derived screw off and back on; back on keeps an edit, and drops a row that only switched it off', () => {
    const off = withDerivedEnabled([], screw, false);
    expect(off).toEqual([{ ...screw, enabled: false }]);
    expect(withDerivedEnabled(off, screw, true)).toEqual([]);
    const edited = withDerivedEnabled([{ ...screw, operation: 'Screw Tighten - Power', timeS: 6 }], screw, false);
    expect(withDerivedEnabled(edited, screw, true)).toEqual([{ ...screw, operation: 'Screw Tighten - Power', timeS: 6 }]);
  });

  it('names the measures a joint still needs for its process', () => {
    expect(missingMeasures({ id: 'j', process: 'MIG Welding', count: 1, lengthMm: 300 })).toEqual(['throatMm']);
    expect(missingMeasures({ id: 'j', process: 'Rivet', count: 8 })).toEqual(['timeS']);
    expect(missingMeasures({ id: 'j', process: 'Cap Sealing', count: 6 })).toEqual([]);
  });

  it('says a joint\'s measures in one line', () => {
    expect(jointMeasures({ count: 2, lengthMm: 300, throatMm: 4, depthMm: null, areaMm2: null, weldMaterial: 'Steel', gas: null, position: null, timeS: null })).toBe('2 x 300 mm, 4 mm throat, Steel');
  });

  it('an item is costed as an assembly by its Process, or as an assembly in the BOM with no Process', () => {
    expect(isAssemblyItem({ itemType: 'child_part', scenarioOverrides: { processGroup: 'Assembly' } })).toBe(true);
    expect(isAssemblyItem({ itemType: 'assembly', scenarioOverrides: {} })).toBe(true);
    expect(isAssemblyItem({ itemType: 'assembly', scenarioOverrides: { processGroup: 'Part Assembly' } })).toBe(false);
    expect(isAssemblyItem({ itemType: 'child_part' })).toBe(false);
  });

  it('reads an assembly route id as its route key, any other route as none', () => {
    expect(assemblyRouteKeyOf('assembly-robotic')).toBe('robotic');
    expect(assemblyRouteKeyOf('additive-printing')).toBeUndefined();
  });
});
