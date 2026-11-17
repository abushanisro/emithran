import { describe, expect, it } from 'vitest';

import { calculatorSwitch } from '@/lib/processCatalog/calculator-switch';

// The Process dialog: a line's calculator follows its machine class and the operation the engineer picks.
const at = (machineClass: string, operationChoice: string | null = null) => ({ machineClass, operationChoice });

describe('when the calculator of a process line switches', () => {
  it("moving the line to another machine class switches to that class's calculator", () => {
    expect(calculatorSwitch(at('forging_press'), at('forging_hammer'), 'hammer-calc', 'press-calc')).toBe('hammer-calc');
  });

  it('picking another operation on the same machine switches to its calculator', () => {
    expect(calculatorSwitch(at('forging_oven_furnace'), at('forging_oven_furnace', 'Preheat'), 'furnace-calc', '')).toBe('furnace-calc');
  });

  it('a class or operation with no calculator leaves none selected, never the old one', () => {
    expect(calculatorSwitch(at('forging_oven_furnace', 'Preheat'), at('forging_oven_furnace', 'Reheat'), null, 'furnace-calc')).toBe('');
  });

  it('opening a saved line is not a change: it keeps the calculator it was costed with', () => {
    expect(calculatorSwitch(at(''), at('forging_press'), 'press-calc', 'engine-calc')).toBeNull();
    expect(calculatorSwitch(at('forging_press'), at('forging_press'), 'press-calc', 'engine-calc')).toBeNull();
  });

  it('a change that keeps the same calculator keeps its inputs (no switch to blank them)', () => {
    expect(calculatorSwitch(at('press_a'), at('press_b'), 'press-calc', 'press-calc')).toBeNull();
  });
});
