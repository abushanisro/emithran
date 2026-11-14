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
};
const PART: MachiningDfmPart = { dimensionsMm: [60, 50, 40], weightKg: 0.5 };

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
    const r = run([hole('h', 4, [8])], { dimensionsMm: [900, 60, 5], weightKg: 20 });
    expect(r.findings.map((f) => f.rule).sort()).toEqual(['DelicatePart', 'HeavyPart', 'HighAspectRatio']);
    expect(r.findings.find((f) => f.rule === 'HeavyPart')!.label).toBe('The part is too heavy to load by hand: highest 20 kg');
    expect(r.findings.every((f) => f.featureIds.length === 0)).toBe(true);
  });

  it('a limit that is not staged, or a measurement that is absent, is not evaluated: never passed', () => {
    const r = run([hole('h', 4, [8])], { dimensionsMm: [60, 50, null], weightKg: null }, { sizeRanges: null, variables: {}, drillSizesMm: null });
    expect(r.findings).toEqual([]);
    expect(r.checks.every((c) => c.status === 'not_evaluated')).toBe(true);
    expect(checkOf(r, 'HoleDepthToDiameter').detail).toContain('not staged');
    const measured = run([hole('h', 4, [8])], { dimensionsMm: [60, 50, null], weightKg: null });
    expect(checkOf(measured, 'DelicatePart').detail).toContain('no three bounding dimensions');
    expect(checkOf(measured, 'ToolReach').detail).toContain('no pocket or slot');
  });

  it('what the CAD analysis does not measure is listed with the reason', () => {
    const rules = run([hole('h', 4, [8])]).checks.filter((c) => c.status === 'not_evaluated').map((c) => c.rule);
    expect(rules).toEqual(expect.arrayContaining(['InternalCornerRadius', 'ThinWall', 'ToolAccess']));
  });
});
