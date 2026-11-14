import { evaluateMachiningDfm, type MachiningDfmPart, type MachiningDfmReference } from '../../../../../../modules/bom-items/costing/machining/dfm/machining-dfm';

// The limits as the machining reference stages them (tblOperationSizeRanges, variables.csv, tblDrillSizeChart).
const REF: MachiningDfmReference = {
  sizeRanges: [
    { OperationName: 'Standard Drilling', Comment: 'Ratio of L/D', LowerBound: -1, UpperBound: 3 },
    { OperationName: 'Gun Drilling', Comment: 'Ratio of L/D', LowerBound: 10, UpperBound: -1 },
    { OperationName: 'Drilling', Comment: 'Straight Drill', LowerBound: 0, UpperBound: 101.6 },
    { OperationName: 'Tapping', Comment: 'Hole diameter', LowerBound: 0.25, UpperBound: 25.4 },
    { OperationName: 'Groove Milling', Comment: 'Keyseat Mill, Width', LowerBound: 0.254, UpperBound: -1 },
  ],
  variables: { easyL2DRatio: 3, maxMillingLToDRatio: 6, difficultL2DRatio: 12, imposedLowerToolDiameterLimitForMilling: 2, delicatePartRatio: 8, aspectRatioLimitRatio: 10, pickWeight: 15.87 },
  drillSizesMm: [2.5, 4, 6, 18.5],
  setupRule: { perpendicularCountFor3AM: 4, maxOblique4AMSetups: 0, allowedAngleDeviationDeg: 0 },
  minWall: { recommendedMm: 0.8, feasibleMm: 0.5 },
};
const PART: MachiningDfmPart = { dimensionsMm: [60, 50, 40], weightKg: 0.5, accessMeasured: true };

const hole = (id: string, diameter: number, depths: number[], variant = 'blind') =>
  ({ id, feature_type: 'SimpleHole', variant, diameter_mm: diameter, occurrences: depths.map((d, i) => ({ depth_mm: d, face_ids: [100 + i] })) });
const pocket = (id: string, sizes: Array<[number, number, number]>) =>
  ({ id, feature_type: 'PocketV2', variant: 'default', occurrences: sizes.map(([l, w, depth], i) => ({ extents_mm: [l, w, 0], material_removed_mm3: l * w * depth, face_ids: [200 + i] })) });

const run = (features: object[], part = PART, ref = REF) => evaluateMachiningDfm(features, part, ref);
const checkOf = (r: ReturnType<typeof run>, rule: string) => r.checks.find((c) => c.rule === rule)!;

describe('evaluateMachiningDfm', () => {
  it('grades hole depth to diameter by the standard drilling and gun drilling ratios, and names the offending instances', () => {
    const r = run([hole('h', 4, [8, 20, 48])]);
    const found = r.findings.filter((f) => f.rule === 'HoleDepthToDiameter');
    expect(found.map((f) => [f.severity, f.occurrences.map((o) => o.occurrenceIndex), f.faces])).toEqual([
      ['major', [2], [102]],
      ['minor', [1], [101]],
    ]);
    expect(found[0]!.label).toBe('1 of 3 holes are deeper than standard drilling reaches: highest 12 : 1');
    expect(found[0]!.source).toContain('tblOperationSizeRanges');
    expect(checkOf(r, 'HoleDepthToDiameter').status).toBe('failed');
  });

  it('a hole that is not a standard drill size is flagged; one above the drilling range is not judged as a drill', () => {
    const r = run([hole('a', 18.4, [10]), hole('b', 4, [8]), hole('c', 150, [10])]);
    const f = r.findings.find((x) => x.rule === 'NonStandardHoleDiameter')!;
    expect(f.featureIds).toEqual(['a']);
    expect(checkOf(r, 'NonStandardHoleDiameter').detail).toContain('over 2 measured');
  });

  it('pocket depth to width: above the easy ratio minor, above the difficult ratio critical', () => {
    const r = run([pocket('p', [[40, 20, 10], [40, 5, 20], [40, 1, 20]])]);
    const reach = r.findings.filter((f) => f.rule === 'ToolReach');
    expect(reach.map((f) => [f.severity, f.occurrences.map((o) => o.occurrenceIndex)])).toEqual([['critical', [2]], ['minor', [1]]]);
    const narrow = r.findings.find((f) => f.rule === 'NarrowMilledFeature')!;
    expect(narrow.severity).toBe('major');
    expect(narrow.label).toContain('lowest 1 mm');
  });

  it('findings come most severe first', () => {
    const r = run([hole('h', 4, [20]), pocket('p', [[40, 1, 20]])]);
    expect(r.findings.map((f) => f.severity)).toEqual(['critical', 'major', 'minor']);
  });

  it('a part with nothing wrong passes every check it could measure', () => {
    const r = run([hole('h', 4, [8]), hole('t', 2.5, [5], 'threaded'), pocket('p', [[40, 20, 10]])]);
    expect(r.findings).toEqual([]);
    expect(r.checks.filter((c) => c.status === 'failed')).toEqual([]);
    expect(checkOf(r, 'ToolReach').status).toBe('passed');
    expect(checkOf(r, 'ThreadBelowTappingRange').status).toBe('passed');
  });

  it('a thin, long or heavy part is flagged against the reference ratios and the lifting weight', () => {
    const r = run([hole('h', 4, [8])], { dimensionsMm: [900, 60, 5], weightKg: 20, accessMeasured: true });
    expect(r.findings.map((f) => f.rule).sort()).toEqual(['DelicatePart', 'HeavyPart', 'HighAspectRatio']);
    expect(r.findings.find((f) => f.rule === 'HeavyPart')!.label).toBe('The part is too heavy to load by hand: highest 20 kg');
    expect(r.findings.every((f) => f.featureIds.length === 0)).toBe(true);
  });

  it('a limit that is not staged, or a measurement that is absent, is not evaluated: never passed', () => {
    const r = run([hole('h', 4, [8])], { dimensionsMm: [60, 50, null], weightKg: null, accessMeasured: true }, { sizeRanges: null, variables: {}, drillSizesMm: null, setupRule: null, minWall: null });
    expect(r.findings).toEqual([]);
    // The sharp-corner check has no staged limit (a cutter cannot make a sharp inside corner): it alone is still judged.
    expect(r.checks.filter((c) => c.rule !== 'SharpInternalCorner').every((c) => c.status === 'not_evaluated')).toBe(true);
    expect(checkOf(r, 'HoleDepthToDiameter').detail).toContain('not staged');
    const measured = run([hole('h', 4, [8])], { dimensionsMm: [60, 50, null], weightKg: null, accessMeasured: true });
    expect(checkOf(measured, 'DelicatePart').detail).toContain('no three bounding dimensions');
    expect(checkOf(measured, 'ToolReach').detail).toContain('no pocket or slot');
  });

  // ── Corners, walls and tool access: read from what the CAD analysis measured per occurrence ──
  const cornered = (radius: number | undefined, depth: number, extra: object = {}) =>
    ({ id: 'c', feature_type: 'PocketV2', variant: 'default', occurrences: [{ extents_mm: [40, 20, 0], material_removed_mm3: 40 * 20 * depth, face_ids: [300], ...(radius === undefined ? {} : { corner_radius_mm: radius }), ...extra }] });

  it('a sharp inside corner is critical; a rounded one is graded by the pocket depth over the corner cutter', () => {
    const sharp = run([cornered(0, 10)]);
    expect(sharp.findings.find((f) => f.rule === 'SharpInternalCorner')).toMatchObject({ severity: 'critical', faces: [300] });
    // R1 corner in a 16 deep pocket: the Ø2 cutter reaches 8 diameters.
    const tight = run([cornered(1, 16)]);
    expect(tight.findings.find((f) => f.rule === 'CornerCutterReach')).toMatchObject({ severity: 'major', label: '1 of 1 pockets have corners too tight for their depth: highest 8 : 1' });
    expect(checkOf(tight, 'SharpInternalCorner').status).toBe('passed');
    expect(run([cornered(4, 10)]).findings).toEqual([]);
  });

  it('a pocket with no inside corner passes when the analysis looked, and is not evaluated when it did not', () => {
    expect(checkOf(run([cornered(undefined, 10)]), 'SharpInternalCorner')).toMatchObject({ status: 'passed', detail: 'No pocket has an inside corner between its walls.' });
    const stale = run([cornered(undefined, 10)], { ...PART, accessMeasured: false });
    for (const rule of ['SharpInternalCorner', 'CornerCutterReach', 'ThinWall', 'ToolAccess']) {
      expect(checkOf(stale, rule)).toMatchObject({ status: 'not_evaluated', detail: expect.stringContaining('Refresh analysis') });
    }
  });

  it('a thin wall behind a feature: below the recommended minimum major, below the feasible minimum critical', () => {
    const walls = (...mm: number[]) => ({ id: 'w', feature_type: 'PlanarFace', variant: 'default', occurrences: mm.map((m, i) => ({ area_mm2: 10, min_wall_mm: m, face_ids: [400 + i] })) });
    const r = run([walls(2, 0.7, 0.4)]);
    expect(r.findings.filter((f) => f.rule === 'ThinWall').map((f) => [f.severity, f.faces])).toEqual([['critical', [402]], ['major', [401]]]);
    expect(checkOf(run([walls(0.8, 3)]), 'ThinWall').status).toBe('passed');
    // No limit staged for the material: not evaluated.
    expect(checkOf(run([walls(0.4)], PART, { ...REF, minWall: null }), 'ThinWall').status).toBe('not_evaluated');
  });

  it('tool access: setups square to each other pass; a feature at an angle to the part\'s main direction needs a 5 axis mill and is the one highlighted', () => {
    const along = (axis: number[], n: number, id: string, face: number) => ({ id, feature_type: 'SimpleHole', variant: 'blind', diameter_mm: 4, occurrences: Array.from({ length: n }, (_, i) => ({ depth_mm: 8, tool_axis: axis, face_ids: [face + i] })) });
    const square = run([along([0, 0, 1], 3, 'top', 500), along([1, 0, 0], 1, 'side', 510)]);
    expect(checkOf(square, 'ToolAccess')).toMatchObject({ status: 'passed', detail: '2 perpendicular, 0 oblique setups' });
    const angled = run([along([0, 0, 1], 3, 'top', 500), along([0, 0.6428, 0.766], 1, 'angled', 520)]);
    expect(angled.findings.find((f) => f.rule === 'ToolAccess')).toMatchObject({ severity: 'major', featureIds: ['angled'], faces: [520] });
    expect(checkOf(angled, 'ToolAccess').status).toBe('failed');
  });
});
