import { resolveBarePcbSpec, type BarePcbSpecDraft } from './spec';

const s = <T>(value: T) => ({ value, note: 'fabrication drawing rev A' });

const full: BarePcbSpecDraft = {
  layers: s(2),
  finishedThicknessMm: s(1.6),
  outerCopperOz: s(1),
  surfaceFinish: s('hasl' as const),
  panel: s({ lengthMm: 457, widthMm: 610, borderMm: 12.7, spacingMm: 2.54 }),
  batchSize: s(500),
  annualVolume: s(6000),
  location: s('India'),
};

describe('resolveBarePcbSpec', () => {
  it('accepts a complete two-layer spec without asking for inner copper', () => {
    expect(resolveBarePcbSpec(full).status).toBe('complete');
  });

  it('reports every missing field instead of defaulting any of them', () => {
    const r = resolveBarePcbSpec({});
    expect(r.status).toBe('incomplete');
    if (r.status !== 'incomplete') return;
    expect(r.problems.map((p) => p.field).sort()).toEqual(
      ['annualVolume', 'batchSize', 'finishedThicknessMm', 'layers', 'location', 'outerCopperOz', 'panel', 'surfaceFinish'].sort(),
    );
    expect(r.problems.every((p) => p.reason === 'not supplied')).toBe(true);
  });

  it('requires inner copper weight only above two layers', () => {
    const four = resolveBarePcbSpec({ ...full, layers: s(4) });
    expect(four.status === 'incomplete' && four.problems).toEqual([{ field: 'innerCopperOz', reason: 'not supplied' }]);
    expect(resolveBarePcbSpec({ ...full, layers: s(4), innerCopperOz: s(0.5) }).status).toBe('complete');
  });

  it('does not round an unpriced copper weight to the nearest supported one', () => {
    const r = resolveBarePcbSpec({ ...full, outerCopperOz: s(1.2) });
    expect(r.status === 'incomplete' && r.problems[0].field).toBe('outerCopperOz');
  });

  it('rejects a field with no stated source', () => {
    const r = resolveBarePcbSpec({ ...full, surfaceFinish: { value: 'hasl', note: '  ' } });
    expect(r.status === 'incomplete' && r.problems).toEqual([{ field: 'surfaceFinish', reason: 'say who stated it (a note is required)' }]);
  });

  it.each([
    ['layers', { layers: s(2.5) }],
    ['finishedThicknessMm', { finishedThicknessMm: s(0) }],
    ['surfaceFinish', { surfaceFinish: s('gold' as never) }],
    ['batchSize', { batchSize: s(0) }],
    ['annualVolume', { annualVolume: s(-5) }],
    ['location', { location: s(' ') }],
    ['panel', { panel: s({ lengthMm: 457, widthMm: 610, borderMm: -1, spacingMm: 2.54 }) }],
  ])('rejects an invalid %s', (field, patch) => {
    const r = resolveBarePcbSpec({ ...full, ...patch });
    expect(r.status === 'incomplete' && r.problems.map((p) => p.field)).toEqual([field]);
  });
});
