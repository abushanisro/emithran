import { validateSuppliedFacts } from './supplied-facts';

describe('validateSuppliedFacts', () => {
  it('accepts the three suppliable facts with a note each', () => {
    expect(
      validateSuppliedFacts({
        'outline.thicknessMm': { value: 1.6, note: 'PCB Processing Requirements.docx' },
        layers: { value: 2, note: 'fabrication drawing' },
        'panel.boardsPerPanel': { value: 2, note: 'BOM: 2-up panel' },
      }),
    ).toMatchObject({ ok: true });
  });

  it('accepts none at all', () => {
    expect(validateSuppliedFacts({})).toEqual({ ok: true, facts: {} });
  });

  it.each([
    ['a key nobody may supply', { 'outline.lengthMm': { value: 10, note: 'x' } }, /cannot be supplied/],
    ['a missing note', { layers: { value: 2 } }, /say who stated it/],
    ['a blank note', { layers: { value: 2, note: '  ' } }, /say who stated it/],
    ['a zero value', { layers: { value: 0, note: 'x' } }, /greater than 0/],
    ['a negative value', { 'outline.thicknessMm': { value: -1, note: 'x' } }, /greater than 0/],
    ['a fractional layer count', { layers: { value: 2.5, note: 'x' } }, /whole number/],
    ['a string value', { layers: { value: '2', note: 'x' } }, /greater than 0/],
    ['an absurd thickness', { 'outline.thicknessMm': { value: 500, note: 'x' } }, /at most 50/],
  ])('rejects %s', (_name, input, message) => {
    const result = validateSuppliedFacts(input);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(message);
  });

  it.each([[null], ['text'], [[1]]])('rejects a non-object: %j', (input) => {
    expect(validateSuppliedFacts(input).ok).toBe(false);
  });
});
