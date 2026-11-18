import { describe, expect, it } from 'vitest';

import { splitNote } from '@/lib/text/concise-note';

describe('splitNote', () => {
  it('keeps a short note whole', () => {
    expect(splitNote('Gate: edge (reference defaultRunnerSystem cold runner; no gate signal on the part)')).toEqual({
      lead: 'Gate: edge (reference defaultRunnerSystem cold runner; no gate signal on the part)', rest: null,
    });
  });

  it('leads with the first sentence and keeps the rest one click away', () => {
    const r = splitNote('Tooling-dominated: mold cost $21239 amortizes to $0.425/part. Consider higher volumes or shared tooling.');
    expect(r.lead).toBe('Tooling-dominated: mold cost $21239 amortizes to $0.425/part.');
    expect(r.rest).toBe('Consider higher volumes or shared tooling.');
  });

  it('does not split at "e.g." or inside a number', () => {
    expect(splitNote('Pick a grade, e.g. ABS at 1.04 g/cm3, then apply.').rest).toBeNull();
  });

  it('cuts a long single sentence at a word and keeps every word', () => {
    const long = `The tooling cost includes ${'the mold base plate steel, '.repeat(8)}and the toolroom hours`;
    const r = splitNote(long);
    expect(r.lead.length).toBeLessThanOrEqual(141);
    expect(r.lead.endsWith('…')).toBe(true);
    expect(`${r.lead.slice(0, -1)} ${r.rest ?? ""}`.replace(/\s+/g, ' ')).toContain('toolroom hours');
  });
});
