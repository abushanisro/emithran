import { DFMScoringService } from './dfm-scoring.service';

function bendFeature(radiusMm: number, occOverrides: Record<string, any> = {}) {
  return {
    id: 'f1',
    feature_type: 'bend',
    radius_mm: radiusMm,
    occurrences: [{ ...occOverrides }],
  };
}

function holeFeature(diameterMm: number, occOverrides: Record<string, any> = {}) {
  return {
    id: 'f1',
    feature_type: 'hole',
    diameter_mm: diameterMm,
    occurrences: [{ ...occOverrides }],
  };
}

describe('DFMScoringService — material+thickness-aware bend radius', () => {
  const service = new DFMScoringService();

  it('flags a 0.9t radius on stainless steel as a crack risk (real minimum is 2.0t at <=6mm), even though it would pass the old flat 0.8t check', () => {
    const t = 4;
    const radius = 0.9 * t; // fails stainless (2.0t) but would have passed the old flat 0.8t threshold
    const result = service.score([bendFeature(radius)], t, 'Stainless Steel 304');
    const occ = result[0]!.occurrences[0]!;
    expect(occ.riskFactors.some((f) => f.code === 'CRACK_RISK')).toBe(true);
  });

  it('does not flag the same 0.9t radius on plain mild steel at <=6mm (real minimum is 0.8t there)', () => {
    const t = 4;
    const radius = 0.9 * t;
    const result = service.score([bendFeature(radius)], t, 'CRCA');
    const occ = result[0]!.occurrences[0]!;
    expect(occ.riskFactors.some((f) => f.code === 'CRACK_RISK')).toBe(false);
  });

  it('flags galvanized steel (SECC) far more conservatively than plain steel of the same grade family', () => {
    const t = 4;
    const radius = 1.5 * t; // passes plain steel (0.8-1.2t range) but fails galvanized's real 3.5t minimum
    const plainSteel = service.score([bendFeature(radius)], t, 'CRCA');
    const galvanized = service.score([bendFeature(radius)], t, 'SECC');

    expect(plainSteel[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'CRACK_RISK')).toBe(false);
    expect(galvanized[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'CRACK_RISK')).toBe(true);
  });

  it('escalates the required steel radius factor as thickness increases (0.8t/1.2t/1.5t brackets)', () => {
    const thin = service.score([bendFeature(0.9 * 5)], 5, 'MS');   // 0.9t at t=5 (<=6mm bracket, min 0.8t) -> passes
    const thick = service.score([bendFeature(0.9 * 20)], 20, 'MS'); // 0.9t at t=20 (<=25mm bracket, min 1.5t) -> fails

    expect(thin[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'CRACK_RISK')).toBe(false);
    expect(thick[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'CRACK_RISK')).toBe(true);
  });

  it('falls back to the plain-steel curve when no material grade is provided (disclosed baseline, not a guess)', () => {
    const t = 4;
    const radius = 0.9 * t;
    const result = service.score([bendFeature(radius)], t, null);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'CRACK_RISK')).toBe(false);
  });
});

describe('DFMScoringService — consolidated hole-to-bend distance (1.5t)', () => {
  const service = new DFMScoringService();

  it('flags a hole 1.2t from a bend (fails the real 1.5t minimum, would have passed the old 1.0t high-tier check)', () => {
    const t = 4;
    const result = service.score(
      [bendFeature(10, { nearest_hole_distance_mm: 1.2 * t })],
      t,
    );
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'BEND_HOLE_PROXIMITY')).toBe(true);
  });

  it('does not flag a hole 1.6t from a bend (passes the real 1.5t minimum)', () => {
    const t = 4;
    const result = service.score(
      [bendFeature(10, { nearest_hole_distance_mm: 1.6 * t })],
      t,
    );
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'BEND_HOLE_PROXIMITY')).toBe(false);
  });
});

describe('DFMScoringService — minimum bend length (real cad-engine data, previously never read)', () => {
  const service = new DFMScoringService();

  it('flags a bend shorter than the real 10mm press-brake minimum', () => {
    const result = service.score([bendFeature(10, { bend_length_mm: 7 })], 2);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'INSUFFICIENT_BEND_LENGTH')).toBe(true);
  });

  it('does not flag a bend at or above the 10mm minimum', () => {
    const result = service.score([bendFeature(10, { bend_length_mm: 12 })], 2);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'INSUFFICIENT_BEND_LENGTH')).toBe(false);
  });

  it('does not flag when bend_length_mm is absent (no guess when the cad-engine has no data for it)', () => {
    const result = service.score([bendFeature(10, {})], 2);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'INSUFFICIENT_BEND_LENGTH')).toBe(false);
  });
});

describe('DFMScoringService — minimum punched-hole diameter (real UTS-based punch-tooling data)', () => {
  const service = new DFMScoringService();

  it('does not flag a 1.2t hole on a low-UTS material (real minimum there is 1.0t)', () => {
    const t = 4;
    const result = service.score([holeFeature(1.2 * t)], t, 'Mild Steel', 220);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'UNDERSIZED_HOLE')).toBe(false);
  });

  it('flags the same 1.2t hole on a high-UTS material (real minimum there is 2.0t)', () => {
    const t = 4;
    const result = service.score([holeFeature(1.2 * t)], t, 'High Strength Steel', 700);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'UNDERSIZED_HOLE')).toBe(true);
  });

  it('does not flag when UTS is unresolved (no guess when the material lookup misses)', () => {
    const t = 4;
    const result = service.score([holeFeature(0.5 * t)], t, 'Unknown Alloy', null);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'UNDERSIZED_HOLE')).toBe(false);
  });
});

describe('DFMScoringService — missing real geometry is disclosed, never silently guessed', () => {
  const service = new DFMScoringService();

  it('flags INCOMPLETE_GEOMETRY_DATA when sheet thickness is unknown (null) for a sheet-metal part', () => {
    const result = service.score([holeFeature(5)], null);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'INCOMPLETE_GEOMETRY_DATA')).toBe(true);
  });

  it('does not flag INCOMPLETE_GEOMETRY_DATA when thickness is a real known value', () => {
    const result = service.score([holeFeature(5)], 3);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'INCOMPLETE_GEOMETRY_DATA')).toBe(false);
  });

  it('treats 0 as the CNC-part signal, not "missing thickness" — no flag from thickness alone', () => {
    const result = service.score([holeFeature(5)], 0);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'INCOMPLETE_GEOMETRY_DATA')).toBe(false);
  });

  it('flags INCOMPLETE_GEOMETRY_DATA when a hole has no real diameter_mm', () => {
    const feature = { id: 'f1', feature_type: 'hole', diameter_mm: undefined, occurrences: [{}] };
    const result = service.score([feature], 3);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'INCOMPLETE_GEOMETRY_DATA')).toBe(true);
  });

  it('flags INCOMPLETE_GEOMETRY_DATA when a bend has no real radius_mm', () => {
    const feature = { id: 'f1', feature_type: 'bend', radius_mm: undefined, occurrences: [{}] };
    const result = service.score([feature], 3);
    expect(result[0]!.occurrences[0]!.riskFactors.some((f) => f.code === 'INCOMPLETE_GEOMETRY_DATA')).toBe(true);
  });
});
