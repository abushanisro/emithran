import { specsReferenceDetail } from '../../../modules/mhr/specs-reference-detail';

describe('specsReferenceDetail', () => {
  it('returns a Die Casting machine\'s own specs, with its source csv as the source key', () => {
    const specs = {
      source: 'memory/Die Casting/Machine/high_pressure_die_casting_machines.csv',
      clamping_force_kn: 240,
      plunger_diameter_mm: 45,
      tie_bar_distance_hor_mm: 250,
      is_preferred: false,
    };
    expect(specsReferenceDetail(specs, 'High Pressure Die Casting:Frech DAW 20 S DCRC')).toEqual({
      found: true,
      sourceKey: 'memory/Die Casting/Machine/high_pressure_die_casting_machines.csv',
      raw: { clamping_force_kn: 240, plunger_diameter_mm: 45, tie_bar_distance_hor_mm: 250, is_preferred: false },
    });
  });

  it('falls back to the benchmark source key when specs names no source file', () => {
    expect(specsReferenceDetail({ dry_cycle_time_s: 7 }, 'Gravity Die Casting:IMR C40H').sourceKey)
      .toBe('Gravity Die Casting:IMR C40H');
  });

  it('is not found when specs is empty, provenance only, or not an object', () => {
    for (const specs of [null, undefined, {}, { source: 'memory/x.csv' }, [], 'x']) {
      expect(specsReferenceDetail(specs, 'k')).toEqual({ found: false, sourceKey: null, raw: null });
    }
  });
});
