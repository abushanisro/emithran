import { pickRegionalReferenceRow, specsReferenceDetail } from '../../../modules/mhr/specs-reference-detail';

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

describe('pickRegionalReferenceRow', () => {
  // Migration 836 staged India/China/Mexico/France rows under the same
  // "<Category>:<Name>" key as the USA machine_library row.
  const key = '2-Axis Router:Multicam 103';
  const rows = ['USA', 'IND', 'CHN', 'MEX', 'FRA'].map((source_region) => ({ key, source_region }));

  it('resolves a key staged once per region to the USA machine_library row', () => {
    expect(pickRegionalReferenceRow(rows, 'USA')?.source_region).toBe('USA');
    expect(pickRegionalReferenceRow(rows, 'India')?.source_region).toBe('USA');
  });

  it('falls back to the machine\'s own region when there is no USA row', () => {
    expect(pickRegionalReferenceRow(rows.filter((r) => r.source_region !== 'USA'), 'India')?.source_region).toBe('IND');
  });

  it('keeps a single match, and refuses two candidates in one region', () => {
    expect(pickRegionalReferenceRow([{ key, source_region: 'CHN' }], 'USA')?.source_region).toBe('CHN');
    expect(pickRegionalReferenceRow([{ key, source_region: 'USA' }, { key: 'x', source_region: 'USA' }], 'USA')).toBeNull();
    expect(pickRegionalReferenceRow([], 'USA')).toBeNull();
  });
});
