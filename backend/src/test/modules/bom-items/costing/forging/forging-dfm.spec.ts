import { evaluateForgingDfm, type ForgingDfmPart, type ForgingDfmReference } from '../../../../../modules/bom-items/costing/forging/dfm/forging-dfm';
import { realForgingReference } from './forging-test-data';

// The design-for-forging checks on the real memory/Forging rules (forging_manufacturabilitySeverity, forging_adviceRules). The part: a steel
// forging with a 2,000 mm² outline, its faces, edges and holes as the forging analysis measures them.
const ref = (): ForgingDfmReference => {
  const r = realForgingReference();
  return {
    severity: r.table('forging_manufacturabilitySeverity'),
    enabledRules: new Set(r.table('forging_adviceRules').filter((x) => String(x['Enabled']) === 'true').map((x) => String(x['Advice Rule Name']))),
    variables: { minForgeableHoleDiameter: r.number('minForgeableHoleDiameter') },
  };
};
const part = (over: Partial<ForgingDfmPart> = {}): ForgingDfmPart => ({
  materialType: 'Steel', projectedAreaMm2: 2000,
  draftFaces: [{ faceId: 1, draftDeg: 7, undercutFraction: 0 }, { faceId: 2, draftDeg: 7, undercutFraction: 0 }],
  thicknessFaces: [{ faceId: 1, thicknessMm: 12 }, { faceId: 2, thicknessMm: 12 }],
  radii: [{ kind: 'fillet', radiusMm: 8, faceIds: [5] }, { kind: 'corner', radiusMm: 4, faceIds: [6] }],
  sharpEdges: { internal: [], externalCount: 0 },
  undercutAreaMm2: 0, trappedVolumes: 0, holes: [], threads: 0,
  tolerances: { assessed: true, short: [] },
  ...over,
});
const run = (over: Partial<ForgingDfmPart> = {}) => evaluateForgingDfm(part(over), ref());
const check = (r: ReturnType<typeof run>, name: string) => r.checks.find((c) => c.name === name)!;

describe('forging DFM on the real reference rules', () => {
  it('a well drafted, rounded, thick steel forging passes every check it can judge', () => {
    const r = run();
    expect(r.findings).toEqual([]);
    expect(r.checks.filter((c) => c.status === 'failed')).toEqual([]);
    // The two rules the data names without a limit are listed, not passed.
    expect(r.checks.filter((c) => c.status === 'not_evaluated').map((c) => c.rule).sort()).toEqual(['ThickSlug', 'ThickWalledHole']);
  });

  it('judges a section by the material and the outline band: steel up to 3,270.8 mm² must be 3.81 mm', () => {
    const r = run({ thicknessFaces: [{ faceId: 1, thicknessMm: 2.5 }, { faceId: 2, thicknessMm: 12 }] });
    const f = r.findings.find((x) => x.rule === 'ThinSection')!;
    expect(f).toMatchObject({ severity: 'major', faces: [1] });
    expect(f.label).toBe('1 face with a section under 3.81 mm, thinnest 2.5 mm');
    expect(check(r, 'Section thickness').limit).toMatch(/below 3\.81 \(major\) mm for Steel, outline up to 3270\.8 mm²/);
    // The same section on aluminium of a smaller outline (up to 654.16 mm²: 2.54 mm) passes.
    expect(run({ materialType: 'Aluminum', projectedAreaMm2: 600, thicknessFaces: [{ faceId: 1, thicknessMm: 2.6 }] }).findings.filter((x) => x.rule === 'ThinSection')).toEqual([]);
  });

  it('draft: a wall with none is critical, one under the material limit major (steel 5°, aluminium 3°)', () => {
    const r = run({ draftFaces: [{ faceId: 1, draftDeg: 0, undercutFraction: 0 }, { faceId: 2, draftDeg: 4, undercutFraction: 0 }] });
    expect(r.findings.filter((x) => x.rule === 'InsufficientDraftAngle').map((x) => [x.severity, x.faces])).toEqual([['critical', [1]], ['major', [2]]]);
    expect(run({ materialType: 'Aluminum', draftFaces: [{ faceId: 2, draftDeg: 4, undercutFraction: 0 }] }).findings.filter((x) => x.rule === 'InsufficientDraftAngle')).toEqual([]);
  });

  it('draft in a forged hole is judged by its own rule (steel 7°); a drilled hole is not a forged one', () => {
    const forged = { featureId: 'hole-1', occurrenceIndex: 0, diameterMm: 30, depthMm: 20, variant: 'through', angleToDieDeg: 0, faces: [9] };
    const r = run({ holes: [forged, { ...forged, featureId: 'hole-2', diameterMm: 3, faces: [10] }], draftFaces: [{ faceId: 9, draftDeg: 6, undercutFraction: 0 }, { faceId: 10, draftDeg: 0, undercutFraction: 0 }] });
    const holeDraft = r.findings.filter((x) => x.rule === 'InsufficientDraftAngle');
    expect(holeDraft.map((x) => [x.severity, x.faces])).toEqual([['major', [9]]]);
    expect(holeDraft[0]!.label).toMatch(/forged hole wall/);
    // Two checks of one rule: each finding names its own, so the Validation list keys and highlights each row by it (a duplicate React key
    // "InsufficientDraftAngle" before).
    expect(holeDraft[0]!.check).toBe('Draft in forged holes');
    const names = r.checks.filter((c) => c.rule === 'InsufficientDraftAngle').map((c) => c.name);
    expect(names).toEqual(['Draft on walls', 'Draft in forged holes']);
    expect(new Set(r.checks.map((c) => `${c.rule}:${c.name}`)).size).toBe(r.checks.length);
  });

  it('radii: a fillet under 5.84 mm or an inside edge with none, a corner under 2.79 mm or an outside edge with none (steel)', () => {
    const r = run({
      radii: [{ kind: 'fillet', radiusMm: 2, faceIds: [5] }, { kind: 'corner', radiusMm: 1, faceIds: [6] }],
      sharpEdges: { internal: [{ faceIds: [7, 8], lengthMm: 20 }], externalCount: 4 },
    });
    const fillet = r.findings.filter((x) => x.rule === 'InsufficientFilletRadius');
    expect(fillet).toHaveLength(1);
    expect(fillet[0]).toMatchObject({ severity: 'major', faces: [5, 7, 8] });
    const corner = r.findings.filter((x) => x.rule === 'InsufficientCornerRadius').map((x) => x.label);
    expect(corner).toEqual(['1 outside edge under 2.79 mm, least 1 mm', '4 outside edges with no radius']);
  });

  it('a forged blind hole deeper than 1.5 diameters is major, deeper than 0.75 minor', () => {
    const hole = (id: string, depth: number) => ({ featureId: id, occurrenceIndex: 0, diameterMm: 30, depthMm: depth, variant: 'blind', angleToDieDeg: 0, faces: [] });
    const r = run({ holes: [hole('a', 60), hole('b', 30), hole('c', 15)] });
    expect(r.findings.filter((x) => x.rule === 'HighBlindHoleLengthToDiameterRatio').map((x) => [x.severity, x.occurrences.map((o) => o.featureId)])).toEqual([['major', ['a']], ['minor', ['b']]]);
  });

  it('a die lock, a thread and a tolerance forging does not hold are named with the faces and features they are on', () => {
    const r = run({
      undercutAreaMm2: 120, draftFaces: [{ faceId: 3, draftDeg: null, undercutFraction: 1 }], threads: 2,
      tolerances: { assessed: true, short: [{ featureId: 'hole-1', occurrenceIndex: 0, label: 'SimpleHole:1', faces: [9], categories: ['diamTolerance'] }] },
    });
    expect(r.findings.find((x) => x.rule === 'InaccessibleFeature')).toMatchObject({ severity: 'critical', faces: [3] });
    expect(r.findings.find((x) => x.rule === 'Threaded')).toMatchObject({ severity: 'critical' });
    expect(r.findings.find((x) => x.rule === 'TightToleranceDiamTolerance')).toMatchObject({ severity: 'major', occurrences: [{ featureId: 'hole-1', occurrenceIndex: 0 }] });
  });

  it('an analysis without the per-face measurements is not judged: it says to refresh it, never passes', () => {
    const r = run({ draftFaces: null, thicknessFaces: null, radii: null, sharpEdges: null });
    for (const name of ['Section thickness', 'Draft on walls', 'Fillet radius (inside edges)', 'Corner radius (outside edges)']) {
      expect(check(r, name)).toMatchObject({ status: 'not_evaluated' });
      expect(check(r, name).detail).toMatch(/Refresh analysis/);
    }
  });

  it('a material that is not a forging material is not judged for its section (the limits are kept by material type)', () => {
    expect(check(run({ materialType: null }), 'Section thickness')).toMatchObject({ status: 'not_evaluated' });
  });
});
