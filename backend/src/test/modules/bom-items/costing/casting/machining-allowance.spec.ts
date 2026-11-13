import {
  resolveMachiningAllowance,
  mouldingMethodOf,
  type AllowanceDataset,
  type AllowanceDecision,
  type AllowanceFeature,
  type AllowanceProfile,
} from '../../../../../modules/bom-items/costing/casting/machining-allowance';

// Machining allowance: the stock left on a cast face that is machined afterwards (never pattern shrinkage). For each machined feature the
// value comes from the first source that has one, and says which: 1 the drawing / PMI / customer specification (an engineer's recorded
// decision), 2 a licensed standard dataset, 3 an approved foundry or customer profile, 4 an engineer's estimate, else 5 requires_review.
// Nothing is interpolated or invented; a decision made on an earlier file counts for nothing.
const hole = (over: Partial<AllowanceFeature> = {}): AllowanceFeature => ({
  featureKey: 'SimpleHole:h1', featureType: 'SimpleHole', label: 'Hole 1', faceIds: [4, 5], featureId: 'SimpleHole:1', occurrenceIndex: 0,
  sizeMm: 20, verdict: 'needs_machining', ...over,
});
const face = (over: Partial<AllowanceFeature> = {}): AllowanceFeature => ({
  featureKey: 'PlanarFace:p1', featureType: 'PlanarFace', label: 'Face 1', faceIds: [1], featureId: 'PlanarFace:1', occurrenceIndex: 0,
  sizeMm: null, verdict: 'needs_machining', ...over,
});
const decision = (over: Partial<AllowanceDecision> = {}): AllowanceDecision => ({
  id: 'd1', featureKey: 'SimpleHole:h1', machined: true, allowanceMm: 1.5, sides: 2, basis: 'engineering_drawing', reason: 'drawing note 4',
  geometryHash: 'geo-1', setByEmail: 'eng@example.com', setAt: '2026-11-13T10:00:00Z', ...over,
});
const dataset: AllowanceDataset = {
  id: 'ds1', standard: 'ISO 8062-3', edition: '2023', licenceReference: 'Order 123', importedAt: '2026-11-01T00:00:00Z',
  values: [{ rmag: 'F', sizeOverMm: 100, sizeUptoMm: 160, allowanceMm: 1.4 }, { rmag: 'F', sizeOverMm: 160, sizeUptoMm: 250, allowanceMm: 1.7 }],
};
const profile = (over: Partial<AllowanceProfile> = {}): AllowanceProfile => ({
  id: 'pr1', name: 'Foundry A', kind: 'foundry', version: 2, basis: 'capability sheet rev 4', reviewedAt: '2026-11-02T00:00:00Z',
  values: [
    { materialFamily: null, mouldingMethod: null, sizeOverMm: 0, sizeUptoMm: 250, allowanceMm: 3 },
    { materialFamily: 'Gray Iron', mouldingMethod: 'machine', sizeOverMm: 0, sizeUptoMm: 250, allowanceMm: 2 },
  ],
  ...over,
});
const base = {
  geometryHash: 'geo-1', largestDimensionMm: 150, rmag: null as string | null, materialFamily: 'Gray Iron', mouldingMethod: 'machine' as const,
  decisions: [] as AllowanceDecision[], datasets: [] as AllowanceDataset[], profiles: [] as AllowanceProfile[],
};
const one = (over: Partial<typeof base> & { features?: AllowanceFeature[] } = {}) =>
  resolveMachiningAllowance({ ...base, features: [hole()], ...over }).features[0]!;

describe('resolveMachiningAllowance: the source hierarchy', () => {
  it('1: an allowance from the drawing is specified, with who recorded it and why', () => {
    const r = one({ decisions: [decision()], datasets: [dataset], profiles: [profile()], rmag: 'F' });
    expect(r).toMatchObject({ status: 'specified', allowanceMm: 1.5, sides: 2, unit: 'mm' });
    expect(r.source).toMatchObject({ level: 1, kind: 'decision', basis: 'engineering_drawing', reason: 'drawing note 4', setBy: 'eng@example.com' });
  });

  it('2: a licensed dataset gives the value of the part\'s RMAG grade and size band, with the dataset\'s edition and licence', () => {
    const r = one({ datasets: [dataset], profiles: [profile()], rmag: 'F' });
    expect(r).toMatchObject({ status: 'standard_derived', allowanceMm: 1.4, sides: 2 });
    expect(r.source).toMatchObject({ level: 2, kind: 'dataset', id: 'ds1' });
    expect(r.source.ref).toContain('ISO 8062-3 2023');
    expect(r.source.ref).toContain('Order 123');
  });

  it('2: never interpolates: a size outside every band of the grade falls through', () => {
    const r = one({ datasets: [dataset], rmag: 'F', largestDimensionMm: 400 });
    expect(r.status).toBe('requires_review');
    expect(r.notes.join(' ')).toMatch(/no value for RMAG F at 400 mm/);
  });

  it('2: without an RMAG grade for the part, a dataset is not used and that is said', () => {
    const r = one({ datasets: [dataset], rmag: null });
    expect(r.status).toBe('requires_review');
    expect(r.notes.join(' ')).toMatch(/no RMAG grade/);
  });

  it('3: an approved profile gives its most specific value (material family and moulding method before the general one)', () => {
    const r = one({ profiles: [profile()] });
    expect(r).toMatchObject({ status: 'foundry_profile_derived', allowanceMm: 2 });
    expect(r.source).toMatchObject({ level: 3, kind: 'profile', id: 'pr1' });
    expect(r.source.ref).toContain('Foundry A v2');
    expect(one({ profiles: [profile()], materialFamily: 'Steel' }).allowanceMm).toBe(3);
  });

  it('3: two profiles that disagree are not chosen between: requires_review, with both named', () => {
    const r = one({ profiles: [profile(), profile({ id: 'pr2', name: 'Foundry B', version: 1, values: [{ materialFamily: null, mouldingMethod: null, sizeOverMm: 0, sizeUptoMm: 500, allowanceMm: 4 }] })] });
    expect(r.status).toBe('requires_review');
    expect(r.notes.join(' ')).toMatch(/Foundry A v2.*Foundry B v1|disagree/);
  });

  it('4: an engineer\'s estimate is used when no dataset or profile has a value', () => {
    const r = one({ decisions: [decision({ basis: 'engineering_estimate', reason: 'typical for grey iron', allowanceMm: 2.5 })] });
    expect(r).toMatchObject({ status: 'estimated', allowanceMm: 2.5 });
    expect(r.source).toMatchObject({ level: 4, kind: 'decision', basis: 'engineering_estimate' });
  });

  it('4: an estimate gives way to an approved profile, and the estimate on file is mentioned', () => {
    const r = one({ decisions: [decision({ basis: 'engineering_estimate', allowanceMm: 2.5 })], profiles: [profile()] });
    expect(r.status).toBe('foundry_profile_derived');
    expect(r.notes.join(' ')).toMatch(/estimate of 2.5 mm/);
  });

  it('5: with no source the feature requires review, with no value', () => {
    const r = one();
    expect(r).toMatchObject({ status: 'requires_review', allowanceMm: null, sides: null });
    expect(r.source).toMatchObject({ level: 5, kind: 'none' });
  });
});

describe('resolveMachiningAllowance: which features', () => {
  it('lists the features that need machining and those the engineer marked machined; leaves out those the casting holds', () => {
    const res = resolveMachiningAllowance({
      ...base,
      features: [hole(), face({ verdict: 'as_primary' }), face({ featureKey: 'PlanarFace:p2', verdict: 'as_primary' })],
      decisions: [decision({ featureKey: 'PlanarFace:p2', basis: 'engineering_estimate', allowanceMm: 2, sides: 1, reason: 'sealing face' })],
    });
    expect(res.features.map((f) => f.featureKey)).toEqual(['SimpleHole:h1', 'PlanarFace:p2']);
  });

  it('a feature the engineer marked not machined is left out and listed as such, whatever its tolerance says', () => {
    const res = resolveMachiningAllowance({ ...base, features: [hole()], decisions: [decision({ machined: false, allowanceMm: null, sides: null, basis: 'not_machined', reason: 'cast to size' })] });
    expect(res.features).toEqual([]);
    expect(res.notMachined).toEqual([expect.objectContaining({ featureKey: 'SimpleHole:h1', reason: 'cast to size' })]);
  });

  it('an undecided feature is listed as requires_review: whether it is machined is not known', () => {
    const r = one({ features: [hole({ verdict: 'undecided' })], profiles: [profile()] });
    expect(r.status).toBe('requires_review');
    expect(r.notes.join(' ')).toMatch(/whether it is machined/);
  });

  it('a decision made on an earlier file counts for nothing and says so', () => {
    const r = one({ decisions: [decision({ geometryHash: 'geo-0' })] });
    expect(r.status).toBe('requires_review');
    expect(r.notes.join(' ')).toMatch(/earlier file/);
  });
});

describe('resolveMachiningAllowance: the as-cast size', () => {
  it('a hole (internal) is cast smaller: diameter minus twice the allowance', () => {
    expect(one({ decisions: [decision({ allowanceMm: 1.5 })] }).asCast).toMatchObject({ rule: 'internal', finishedMm: 20, asCastMm: 17 });
  });

  it('an allowance that closes the hole requires review', () => {
    const r = one({ features: [hole({ sizeMm: 2 })], decisions: [decision({ allowanceMm: 1.5 })] });
    expect(r.status).toBe('requires_review');
    expect(r.notes.join(' ')).toMatch(/closes the hole/);
  });

  it('a planar face is offset along its normal by the allowance, one side', () => {
    const r = one({ features: [face()], decisions: [decision({ featureKey: 'PlanarFace:p1', allowanceMm: 2, sides: 1 })] });
    expect(r.asCast).toMatchObject({ rule: 'planar' });
    expect(r.asCast!.detail).toMatch(/2 mm along its normal/);
  });

  it('a dataset or profile value on a hole applies to both sides of the diameter; on a face, one side', () => {
    expect(one({ profiles: [profile()] }).sides).toBe(2);
    expect(one({ features: [face()], profiles: [profile()] }).sides).toBe(1);
  });
});

describe('mouldingMethodOf', () => {
  it('maps the sand moulding processes to hand or machine moulding; anything else is unknown', () => {
    expect(mouldingMethodOf('Horizontal Automatic')).toBe('machine');
    expect(mouldingMethodOf('Vertical Automatic')).toBe('machine');
    expect(mouldingMethodOf('Manual Floor Moldmaking')).toBe('hand');
    expect(mouldingMethodOf('Something')).toBeNull();
    expect(mouldingMethodOf(null)).toBeNull();
  });
});
