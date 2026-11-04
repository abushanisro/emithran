import { PUBLISHED_INGATE_VELOCITY_LIMITS, RISER_EFFICIENCY_NOTE, ingateVelocityNote } from '../../../../../modules/bom-items/costing/casting/sand/sand-velocity';

describe('ingateVelocityNote: a limit is applied only where a published one is held', () => {
  it('holds exactly one limit, aluminium\'s 0.5 m/s, with its source', () => {
    expect(PUBLISHED_INGATE_VELOCITY_LIMITS).toHaveLength(1);
    expect(PUBLISHED_INGATE_VELOCITY_LIMITS[0]).toMatchObject({ materialType: 'Aluminum', limitMetresPerSecond: 0.5 });
    expect(PUBLISHED_INGATE_VELOCITY_LIMITS[0]!.source).toMatch(/Campbell.*Baghani/);
  });

  it('aluminium over 0.5 m/s is flagged with the cause and the source; at or under, it is within', () => {
    expect(ingateVelocityNote('Aluminum', 0.8, 1.6)).toMatch(/0\.80 m\/s through the ingates \(1\.60 m\/s at the choke\)\. That is above 0\.5 m\/s .*Campbell.*oxide film.*larger ingates would slow it/);
    expect(ingateVelocityNote('Aluminum', 0.5, 1)).toMatch(/Within 0\.5 m\/s/);
    expect(ingateVelocityNote('Aluminum', 0.3, 1)).toMatch(/Within 0\.5 m\/s/);
  });

  it('a material with no published limit is reported but not judged, whatever the speed', () => {
    for (const type of ['Gray Iron', 'Steel', 'Brass', null]) {
      const note = ingateVelocityNote(type, 5, 6);
      expect(note).toMatch(/5\.00 m\/s through the ingates/);
      expect(note).toMatch(/No published limit is held for .*so it is not judged/);
      expect(note).not.toMatch(/above|Within/);
    }
  });

  it('the riser note says the 14 % has no verifiable source and what has', () => {
    expect(RISER_EFFICIENCY_NOTE).toMatch(/14 %.*no published source that could be verified/);
    expect(RISER_EFFICIENCY_NOTE).toMatch(/1\.2/);
  });
});
