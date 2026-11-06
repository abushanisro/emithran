import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { QuoteValidationNote } from '@/components/features/manufacturing-intelligence/QuoteValidationNote';
import type { QuoteValidation } from '@/lib/api/hooks/useBOMItems';

const validation: QuoteValidation = {
  state: 'ASSUMED',
  complete: false,
  formulas: [
    { id: 'F-02', version: 1, name: 'Shot size in GPPS grams', state: 'VALIDATED' },
    { id: 'F-03', version: 1, name: 'Runner and sprue allowance', state: 'ASSUMED' },
  ],
  assumptions: ['F-03: Cold runner 8 % and hot runner 1 % of part mass are engineering estimates, not reference data.'],
  unsupported: [{ id: 'G-03', name: 'Slides and lifters', stagedData: 'tblSlideSizes' }],
};
const html = (v: QuoteValidation | undefined) => renderToStaticMarkup(createElement(QuoteValidationNote, { validation: v }));

describe('quote validation note', () => {
  it('shows the weakest state and that the quote is partial, with how many items are not computed', () => {
    const out = html(validation);
    expect(out).toContain('Assumed');
    expect(out).toContain('partial: 1 items not computed');
  });

  it('opens onto the assumptions and on what the model cannot compute, naming the staged data', () => {
    const out = html(validation);
    expect(out).toContain('F-03: Cold runner 8 %');
    expect(out).toContain('Slides and lifters (staged: tblSlideSizes)');
    expect(out).toContain('2 formulas used, 1 rests on an assumption');
  });

  it('a complete, fully validated quote says so and lists nothing to doubt', () => {
    const out = html({ state: 'VALIDATED', complete: true, formulas: validation.formulas.slice(0, 1), assumptions: [], unsupported: [] });
    expect(out).toContain('Validated');
    expect(out).toContain('complete');
    expect(out).not.toContain('Assumptions');
  });

  it('renders nothing for a quote without a validation (other families, or a part that cannot be molded)', () => {
    expect(html(undefined)).toBe('');
  });
});
