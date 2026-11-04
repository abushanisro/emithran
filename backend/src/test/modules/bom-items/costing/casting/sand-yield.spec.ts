import { referenceYieldNote, yieldVariableFor } from '../../../../../modules/bom-items/costing/casting/sand/sand-yield';
import { realSandReference } from './sand-test-data';

const ref = realSandReference();

describe('the plant baseline yield beside the designed one', () => {
  it('names the plant variable of each alloy family it holds, and none for the others', () => {
    expect(yieldVariableFor('Gray Iron')).toBe('materialYieldGray');
    expect(yieldVariableFor('Stainless Steel')).toBe('materialYieldSteel');
    expect(yieldVariableFor('Magnesium')).toBeNull();
    expect(yieldVariableFor(null)).toBeNull();
  });

  it('states both figures and the variable the baseline came from, with no verdict', () => {
    const note = referenceYieldNote(ref, 'Gray Iron', 72.34)!;
    expect(note).toContain('72.3 %');
    expect(note).toContain(`${ref.number('materialYieldGray')} %`);
    expect(note).toContain('materialYieldGray');
    expect(note).not.toMatch(/too|exceed|low|high/i);
  });

  it('says nothing for an alloy the plant holds no baseline for', () => {
    expect(referenceYieldNote(ref, 'Magnesium', 50)).toBeNull();
  });
});
