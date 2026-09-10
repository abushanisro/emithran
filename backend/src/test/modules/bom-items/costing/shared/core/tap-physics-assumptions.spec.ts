import { resolveTapPhysicsInputs } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';

// Tap physics feeds cycle time: feed = RPM x pitch, RPM from diameter. Two of
// its three inputs used to be fabricated in silence when the real value was
// missing, while the calculator's provenance line reported them as measured:
//
//   diameter  an unparseable size string became M4, labelled
//             'Parsed from thread size "<size>"'.
//   pitch     a nominal outside the ISO 261 coarse series got 1.0mm, labelled
//             'Standard pitch for this nominal diameter'.
//
// Depth already carried a depthIsAssumed flag and disclosed itself correctly;
// these tests hold the other two to the same standard. The assumed VALUES are
// unchanged — only whether the system admits to using them.

describe('tap physics reports which of its inputs were assumed', () => {
  it('flags an unparseable thread size instead of quietly tapping M4', () => {
    const r = resolveTapPhysicsInputs('1/4-20 UNC', null, 5, 5, 'SECC');
    expect(r.diameterIsAssumed).toBe(true);
    expect(r.diameterMm).toBe(4);
  });

  it('does not flag a size it really parsed', () => {
    const r = resolveTapPhysicsInputs('M6', null, 5, 5, 'SECC');
    expect(r.diameterIsAssumed).toBe(false);
    expect(r.diameterMm).toBe(6);
  });

  it('uses the real ISO 261 coarse pitch without flagging an assumption', () => {
    // M4 coarse really is 0.7 — reference data, not a guess.
    const r = resolveTapPhysicsInputs('M4', null, 5, 5, 'SECC');
    expect(r.pitchMm).toBeCloseTo(0.7, 10);
    expect(r.pitchIsAssumed).toBe(false);
  });

  it('flags a nominal that is not in the coarse series', () => {
    // M7 is a real thread but off the common coarse series this table carries.
    const r = resolveTapPhysicsInputs('M7', null, 5, 5, 'SECC');
    expect(r.pitchIsAssumed).toBe(true);
    expect(r.pitchMm).toBe(1.0);
  });

  it('never flags a pitch the drawing actually stated', () => {
    const r = resolveTapPhysicsInputs('M7', 1.25, 5, 5, 'SECC');
    expect(r.pitchIsAssumed).toBe(false);
    expect(r.pitchMm).toBe(1.25);
  });
});
