import { resolveGdtCallouts } from '../../../../../../modules/bom-items/costing/shared/physics/gdt-callouts';

// Shapes exactly as cad-engine shared/step_pmi.py and the drawing contract emit them.
const pmiRead = { pmi: { status: 'read', gdt_callouts: [{ type: 'flatness', tolerance: 0.05 }, { type: 'position', tolerance: 0.1016 }], unresolved: [] } };
const drawing = { gdt_callouts: [{ type: 'Perpendicularity', tolerance: 0.02, datum: 'A', confidence: 0.8 }] };

describe('resolveGdtCallouts', () => {
  it('uses the STEP model PMI when it carries callouts, never adding the drawing on top', () => {
    const c = resolveGdtCallouts(pmiRead, drawing);
    expect(c.map((x) => [x.type, x.toleranceMm, x.source])).toEqual([
      ['flatness', 0.05, 'step_pmi'], ['position', 0.1016, 'step_pmi'],
    ]);
  });

  it('falls to drawing callouts when the model carries none', () => {
    const noPmi = { pmi: { status: 'no_tolerance_entities', gdt_callouts: [], unresolved: [] } };
    expect(resolveGdtCallouts(noPmi, drawing)).toEqual([
      { type: 'perpendicularity', toleranceMm: 0.02, datum: 'A', confidence: 0.8, source: 'drawing' },
    ]);
  });

  it('has no GD&T when neither source has any', () => {
    expect(resolveGdtCallouts({}, { gdt_callouts: [] })).toEqual([]);
    expect(resolveGdtCallouts(null, null)).toEqual([]);
  });

  it('drops callouts without a real positive tolerance', () => {
    expect(resolveGdtCallouts(null, { gdt_callouts: [{ type: 'flatness', tolerance: 0 }, { type: '', tolerance: 0.1 }] })).toEqual([]);
  });
});
