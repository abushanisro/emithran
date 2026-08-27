import { classifyInspectionResource, benchmarkRateWarning, lhrRateWarning, DEFAULT_RATE_WARN_THRESHOLDS, classifySurfaceTreatment } from './default-rates';

describe('classifySurfaceTreatment — chemical conversion coating', () => {
  // Migration 490 seeded a real, region-specific rate for this treatment —
  // must route there instead of the generic '__default__' catch-all, even
  // though "chrom" (from "chromate") would otherwise match that bucket.
  it('routes "Chemical Conversion Coating" to its own real rate, not the generic bucket', () => {
    expect(classifySurfaceTreatment('Chemical Conversion Coating')).toBe('chem_conversion_coating');
  });

  it('routes "Chromate Conversion per MIL-DTL-5541" to the same real rate', () => {
    expect(classifySurfaceTreatment('Chromate Conversion per MIL-DTL-5541')).toBe('chem_conversion_coating');
  });

  it('routes the trade name "Alodine 1200S" to the same real rate', () => {
    expect(classifySurfaceTreatment('Alodine 1200S')).toBe('chem_conversion_coating');
  });

  it('still routes an unrelated chrome-plating callout to the generic bucket (chrom alone should not over-match)', () => {
    expect(classifySurfaceTreatment('Hard Chrome Plating')).toBe('__default__');
  });
});

describe('classifyInspectionResource', () => {
  // 1 & 4. Explicit machine_class='cmm' wins even when the machine's own name
  // has no CMM-indicating word — real row: "Axiom Zenith 1000
  // (X1500 x Y1000 x Z1000)", USA, machine_class='cmm', $16.89/hr.
  it('classifies an explicit machine_class=cmm row as CMM even when the name has no CMM-indicating word', () => {
    expect(classifyInspectionResource('cmm', 'Axiom Zenith 1000 (X1500 x Y1000 x Z1000)')).toBe('CMM');
  });

  // 2 & 3. Real row "Manual Inspection" is tagged machine_class='cmm' in this
  // schema (migration 367 maps any name containing "Inspection" into 'cmm'
  // too), but is a manual bench resource, not a CMM. The known-manual-name
  // check must win over the over-broad machine_class tag.
  it('classifies a known manual-inspection resource as MANUAL_INSPECTION even when machine_class is (over-broadly) cmm', () => {
    expect(classifyInspectionResource('cmm', 'Manual Inspection')).toBe('MANUAL_INSPECTION');
  });

  it('does not classify a known manual-inspection resource as CMM (excluded from CMM-specific pricing)', () => {
    expect(classifyInspectionResource('cmm', 'Manual Inspection')).not.toBe('CMM');
  });

  it('classifies "Manual Inspection Bench" as MANUAL_INSPECTION too', () => {
    expect(classifyInspectionResource('cmm', 'Manual Inspection Bench')).toBe('MANUAL_INSPECTION');
  });

  // 5. Pre-existing behavior for rows without machine_class (legacy / older
  // benchmark rows): fall back to the CMM_NAME_PATTERN name-text heuristic.
  // Real row: "CMM (X1500×Y1000×Z1000)".
  it('falls back to the CMM name-pattern heuristic when machine_class is null', () => {
    expect(classifyInspectionResource(null, 'CMM (X1500×Y1000×Z1000)')).toBe('CMM');
  });

  it('falls back to the CMM name-pattern heuristic when machine_class is undefined', () => {
    expect(classifyInspectionResource(undefined, 'Zeiss Contura G2 CMM')).toBe('CMM');
  });

  // Explicit structured data beats name inference: a row explicitly tagged
  // with a different, real machine_class must never be reclassified as CMM
  // just because its name happens to look CMM-like.
  it('does not let a CMM-looking name override an explicit non-CMM machine_class', () => {
    expect(classifyInspectionResource('turret_punch', 'CMM Deluxe 3000')).toBe('OTHER');
  });

  it('returns OTHER for null machine_class and a name matching neither pattern', () => {
    expect(classifyInspectionResource(null, 'Generic 30 Ton Press')).toBe('OTHER');
  });
});

describe('benchmarkRateWarning', () => {
  it('returns null when no benchmark is available (degrades gracefully)', () => {
    expect(benchmarkRateWarning('fiber_laser', 'India', 1200, 'Salvagnini L3-30', undefined)).toBeNull();
  });

  it('returns null for a rate within the plausible band', () => {
    expect(benchmarkRateWarning('fiber_laser', 'India', 1200, 'Salvagnini L3-30', 1000)).toBeNull();
  });

  it('flags a rate below the low-fraction threshold', () => {
    const warning = benchmarkRateWarning('fiber_laser', 'India', 400, 'Salvagnini L3-30', 1000);
    expect(warning).toMatch(/below the India fiber laser benchmark/);
  });

  it('flags a rate above the high-fraction threshold', () => {
    const warning = benchmarkRateWarning('fiber_laser', 'India', 3500, 'Salvagnini L3-30', 1000);
    expect(warning).toMatch(/over 3× the India fiber laser benchmark/);
  });

  it('respects custom thresholds instead of the hardcoded default', () => {
    // 1.5x the benchmark — within the DEFAULT high fraction (3x) but outside a tighter 1.2x policy.
    const rate = 1500;
    const benchmark = 1000;
    expect(benchmarkRateWarning('fiber_laser', 'India', rate, null, benchmark)).toBeNull();
    expect(benchmarkRateWarning('fiber_laser', 'India', rate, null, benchmark, { lowFraction: 0.5, highFraction: 1.2 })).toMatch(/over 1.2×/);
  });
});

describe('lhrRateWarning', () => {
  it('returns null when no benchmark is available (degrades gracefully)', () => {
    expect(lhrRateWarning('Sheet Metal', 'India', 144.46, undefined)).toBeNull();
  });

  it('returns null for a rate within the plausible band', () => {
    expect(lhrRateWarning('Sheet Metal', 'India', 144.46, 144.46)).toBeNull();
  });

  // The exact live bug this guard exists to catch: a stale lhr_records import
  // artifact (migration 348) reached a real quote as ₹12,062/hr against a
  // correct ₹144.46/hr benchmark — over 80× too large.
  it('flags the exact ₹12,062/hr-vs-₹144.46/hr live anomaly', () => {
    const warning = lhrRateWarning('Sheet Metal', 'India', 12062, 144.46);
    expect(warning).toMatch(/over 3× the India Sheet Metal benchmark/);
  });

  it('flags a rate below the low-fraction threshold', () => {
    const warning = lhrRateWarning('Deburr', 'India', 40, 137.78);
    expect(warning).toMatch(/below the India Deburr benchmark/);
  });

  it('respects custom thresholds instead of the hardcoded default', () => {
    expect(lhrRateWarning('Sheet Metal', 'India', 200, 144.46)).toBeNull();
    expect(lhrRateWarning('Sheet Metal', 'India', 200, 144.46, { lowFraction: 0.5, highFraction: 1.2 })).toMatch(/over 1.2×/);
  });

  it('DEFAULT_RATE_WARN_THRESHOLDS matches the documented 50%/300% band', () => {
    expect(DEFAULT_RATE_WARN_THRESHOLDS).toEqual({ lowFraction: 0.5, highFraction: 3.0 });
  });
});
