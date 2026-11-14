/**
 * The auto_detect tolerance policy end to end, on real reference data (memory/ capability, ISO 286, operation links, machining calculators): what the part's
 * files state -> which of it reads as a requirement on a feature (auto-detect.ts) -> what the part's own process makes of it (process-profile.ts,
 * machining-need.ts) -> the cost lines (secondary-machining-cost.ts).
 *
 * Two halves on purpose: the cases that must add a machining cost, and the cases that must not. A tolerance alone never creates an operation.
 */
import { join } from 'path';
import * as rmp15 from '../../../../fixtures/rmp15-pmi-records.json';
import { specAsCalculators } from '../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import type { ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import type { MHRRateInput } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { drawingGdtCallouts, resolveGdtCallouts } from '../../../../../modules/bom-items/costing/shared/physics/gdt-callouts';
import { detectTolerances } from '../../../../../modules/bom-items/costing/shared/tolerance/auto-detect';
import { featureInstances, parseTolerancePolicy, resolveFeatureRequirements, type TolerancePolicy } from '../../../../../modules/bom-items/costing/shared/tolerance/feature-tolerances';
import { evaluateMachiningNeed, resolveOperationLinks } from '../../../../../modules/bom-items/costing/shared/tolerance/machining-need';
import { resolvePmiRecords, type PmiReviewRow } from '../../../../../modules/bom-items/costing/shared/tolerance/pmi-records';
import { resolveCapabilityTable, resolveIsoTable } from '../../../../../modules/bom-items/costing/shared/tolerance/process-capability';
import { evaluateToleranceDecisions, toleranceProfileOf } from '../../../../../modules/bom-items/costing/shared/tolerance/process-profile';
import { priceSecondaryMachining } from '../../../../../modules/bom-items/costing/shared/tolerance/secondary-machining-cost';
import { readMachiningMemoryCsv, realCapabilityRules, realDrillingTable, realSurfaceGrindingParams } from '../machining/real-reference-tables';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MEM = join(__dirname, '../../../../../../../memory');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(MEM, rel)).rows;
const capability = resolveCapabilityTable(csv('machining/lookup/tblGtolProcessCapabilities.csv'));
const iso = resolveIsoTable(csv('Standards/lookup/iso286_standard_tolerances.csv'));
const links = resolveOperationLinks(csv('machining/lookup/operation_capability_process.csv'));
const capabilityOf = new Map(links.map((l) => [l.operation, l.capabilityProcess]));

const FILE = 'f'.repeat(64);
// A part with a toleranced hole, a second hole, a flat face and a slot.
const featureGraph = (records: any[], extra: Record<string, unknown> = {}) => ({
  pmi: { status: 'read', source: { file_sha256: FILE }, gdt_callouts: [], records, ...extra },
  feature_graph_v2: { features: [
    { id: 'hole', feature_type: 'SimpleHole', variant: 'through', occurrences: [
      { face_ids: [1], source_face_stable_ids: ['a'], diameter_mm: 8, depth_mm: 16 },
      { face_ids: [2], source_face_stable_ids: ['b'], diameter_mm: 8, depth_mm: 16 },
    ] },
    { id: 'face', feature_type: 'PlanarFace', variant: 'default', occurrences: [{ face_ids: [0], source_face_stable_ids: ['p'], extent_mm: 50, extents_mm: [50, 40, 0] }] },
    { id: 'slot', feature_type: 'Slot', variant: 'default', occurrences: [{ face_ids: [5, 6], source_face_stable_ids: ['s', 't'], extent_mm: 15 }] },
  ] },
});

const native = { source: 'native_pmi', validation: { status: 'verified', automation_ready: true } };
const decoded = { source: 'decoded_graphics', validation: { status: 'decoded_cross_checked', automation_ready: false } };
const diameter = (ref: string, nominal: number, plusMinus: number, faces: number[], over: Record<string, unknown> = {}) => ({
  id: `pmi:${ref}`, annotation_ref: ref, record_type: 'dimension', dimension_type: 'diameter', nominal: { value: nominal, unit: 'mm' },
  tolerance: { lower_mm: -plusMinus, upper_mm: plusMinus, min_mm: nominal - plusMinus, max_mm: nominal + plusMinus }, basic: false,
  fingerprint: `fp-${ref}`, feature_ref: { face_ids: faces, association: 'engine diameter features of this size' }, ...native, ...over,
});
const frame = (ref: string, characteristic: string, zone: number, faces: number[], over: Record<string, unknown> = {}) => ({
  id: `pmi:${ref}`, annotation_ref: ref, record_type: 'gdt', characteristic, zone: { value: zone, unit: 'mm' }, modifiers: [], datum_refs: [],
  fingerprint: `fp-${ref}`, feature_ref: { face_ids: faces, association: 'through the dimension of its CAD feature' }, ...native, ...over,
});

const AUTO: TolerancePolicy = { mode: 'auto_detect' };
function run(input: { records: any[]; family: string; primaryProcess?: string; policy?: TolerancePolicy; drawing?: unknown; reviews?: PmiReviewRow[] }) {
  const graph = featureGraph(input.records);
  const instances = featureInstances(graph.feature_graph_v2);
  const callouts = resolveGdtCallouts(graph, input.drawing ?? null);
  const detection = detectTolerances({
    instances, records: resolvePmiRecords(graph, input.reviews ?? []), callouts, drawingCallouts: drawingGdtCallouts(input.drawing ?? null),
    generalTolerances: (input.drawing as any)?.general_tolerances ?? null,
  });
  const resolved = resolveFeatureRequirements({ instances, manual: [], policy: input.policy ?? AUTO, callouts, detection });
  const profile = toleranceProfileOf(input.family);
  // The process's own assessment, as FeatureToleranceService builds it: a casting by its capability row, a machined part by each feature's operation.
  const need = profile.capability === 'primary_process'
    ? evaluateMachiningNeed({ primaryProcess: input.primaryProcess!, features: resolved.instances, capability, iso, links })
    : profile.capability === 'feature_operation'
      ? evaluateMachiningNeed({
          primaryProcess: 'Machining', features: resolved.instances, capability, iso, links,
          primaryProcessOf: ({ instance }) => capabilityOf.get(instance.featureType === 'PlanarFace' ? 'Face Milling' : 'Drilling') ?? null,
        })
      : null;
  const decisions = evaluateToleranceDecisions({ profile, features: resolved.instances, need });
  return { detection, resolved, need, decisions, profile, instances };
}
const decision = (r: ReturnType<typeof run>, label: string) => r.decisions.find((d) => d.label === label)!;
const detected = (r: ReturnType<typeof run>, ref: string) => r.detection.detected.find((d) => d.annotationRef === ref)!;

// Pricing as the casting cost summary does it (the machine rates are inputs; HR Rates rows are not available offline).
const machine = (machineClass: string, machineName: string, rate: number): MHRRateInput => ({
  rate, source: 'mhr_database', machineClass, machineName, commodityCode: null, labourRate: 30, operators: 1, setupTimeHr: 1,
});
const mill = machine('3_axis_mill', 'Mill A', 60);
const grinder = machine('reciprocating_surface_grinder', 'Grinder B', 45);
function price(r: ReturnType<typeof run>) {
  if (!r.need || r.profile.cost !== 'priced') return { lines: [] as ProcessLineCost[], warnings: [] as string[] };
  return priceSecondaryMachining({
    need: r.need, instances: r.instances, calculators: specAsCalculators(),
    lookupContext: {
      matClass: 'aluminum' as const, drillingTable: realDrillingTable(),
      reamTable: readMachiningMemoryCsv('lookup/tblReaming.csv').map((x) => ({
        ...x, Hardness: Number(x['Hardness']), DiameterMm: Number(x['DiameterMm']), CuttingSpeedMPerMin: Number(x['CuttingSpeedMPerMin']), FeedMm: Number(x['FeedMm']),
      })),
      surfaceGrindingParams: realSurfaceGrindingParams('30.11'), capabilityRules: realCapabilityRules(),
    },
    machineFor: (calc) => (calc === 'Surface Grinding' ? grinder : ['Drilling', 'Reaming'].includes(calc) ? mill : undefined),
    batchSize: 100,
    costContext: { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 },
  });
}
const total = (r: ReturnType<typeof run>) => price(r).lines.reduce((t, l) => t + l.totalCost, 0);

describe('auto_detect: cases that add a machining cost', () => {
  it('1. a sand-cast Ø8 hole with native PMI ±0.010 is reamed, and the cost entry names the record, the feature and the reason', () => {
    const r = run({ records: [diameter('Diameter1@Hole1', 8, 0.01, [1])], family: 'sand_cast', primaryProcess: 'Sand Casting' });
    expect(detected(r, 'Diameter1@Hole1')).toMatchObject({ status: 'interpretable', category: 'diamTolerance', value: 0.01, basis: 'native_pmi', labels: ['SimpleHole:1'] });
    expect(decision(r, 'SimpleHole:1')).toMatchObject({ decision: 'add_operation', judgedAs: 'Sand Casting' });
    expect(decision(r, 'SimpleHole:1').operations).toContain('Reaming');
    const { lines } = price(r);
    const entry = lines.flatMap((l) => l.featureBreakdown ?? []).find((b) => b.name === 'SimpleHole:1')!;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.reduce((t, l) => t + l.totalCost, 0)).toBeGreaterThan(0);
    expect(entry.basis!.requirement).toContain('Diameter1@Hole1');
    expect(entry.basis!.source).toBe('model PMI (detected), native');
    expect(entry.basis!.reason).toMatch(/Sand Casting best is IT/);
    // The untoleranced second hole is not machined.
    expect(decision(r, 'SimpleHole:2').decision).toBe('no_requirement');
    expect(lines.flatMap((l) => l.featureBreakdown ?? []).some((b) => b.name === 'SimpleHole:2')).toBe(false);
  });

  it('2. a die-cast face with flatness 0.02 gets a finishing operation that holds it', () => {
    const r = run({ records: [frame('Flatness1@Plane1', 'flatness', 0.02, [0])], family: 'die_cast', primaryProcess: 'High Pressure Die Casting' });
    expect(decision(r, 'PlanarFace:1').decision).toBe('add_operation');
    expect(decision(r, 'PlanarFace:1').operations.length).toBeGreaterThan(0);
    expect(total(r)).toBeGreaterThan(0);
  });

  it('3. a sand-cast hole with position 0.05 is machined', () => {
    const r = run({ records: [frame('Position1@Hole1', 'position', 0.05, [1])], family: 'sand_cast', primaryProcess: 'Sand Casting' });
    expect(decision(r, 'SimpleHole:1')).toMatchObject({ decision: 'add_operation' });
    expect(decision(r, 'SimpleHole:1').requirements).toEqual([expect.objectContaining({ category: 'positionTolerance', value: 0.05, source: 'auto_detected' })]);
  });

  it('4. a decoded diameter an engineer approved for this content and file behaves like a native one', () => {
    const records = [diameter('Diameter1@Hole1', 8, 0.01, [1], decoded)];
    const approval: PmiReviewRow = {
      recordKey: 'pmi:Diameter1@Hole1', scope: 'record', decision: 'approved', recordFingerprint: 'fp-Diameter1@Hole1', fileSha256: FILE, reviewerId: 'u',
      reviewerEmail: null, reviewedAt: '2026-11-15T00:00:00Z', approvedValues: {}, decodedStatus: 'decoded_cross_checked', basis: 'engineering_drawing', notes: null, supersededAt: null,
    };
    const r = run({ records, family: 'sand_cast', primaryProcess: 'Sand Casting', reviews: [approval] });
    expect(detected(r, 'Diameter1@Hole1')).toMatchObject({ status: 'interpretable', basis: 'engineer_approved' });
    expect(decision(r, 'SimpleHole:1').decision).toBe('add_operation');
    expect(total(r)).toBeGreaterThan(0);
  });
});

describe('auto_detect: cases that must not add a machining cost', () => {
  const sand = (records: any[], over: Partial<Parameters<typeof run>[0]> = {}) => run({ records, family: 'sand_cast', primaryProcess: 'Sand Casting', ...over });
  const nothingCosted = (r: ReturnType<typeof run>) => {
    expect(r.decisions.some((d) => d.decision === 'add_operation')).toBe(false);
    expect(price(r).lines).toEqual([]);
  };

  it('5. a tolerance the process already holds is held: ±0.5 on a die-cast hole', () => {
    const r = run({ records: [diameter('Diameter1@Hole1', 8, 0.5, [1])], family: 'die_cast', primaryProcess: 'High Pressure Die Casting' });
    expect(decision(r, 'SimpleHole:1').decision).toBe('held');
    nothingCosted(r);
  });

  it('6. under the default policy the same PMI is detected and applies nothing', () => {
    const r = sand([diameter('Diameter1@Hole1', 8, 0.01, [1])], { policy: parseTolerancePolicy(null).policy! });
    expect(parseTolerancePolicy(null).policy).toEqual({ mode: 'assume_achieved' });
    expect(detected(r, 'Diameter1@Hole1').status).toBe('interpretable');
    expect(r.resolved.instances.every((i) => i.requirements.length === 0)).toBe(true);
    nothingCosted(r);
  });

  it('7. the cad policy reads what it read before: face-linked callouts only, records ignored', () => {
    const graph = featureGraph([diameter('Diameter1@Hole1', 8, 0.01, [1])], { gdt_callouts: [{ type: 'flatness', tolerance: 0.02, face_ids: ['p'] }] });
    const instances = featureInstances(graph.feature_graph_v2);
    const callouts = resolveGdtCallouts(graph, null);
    const policy: TolerancePolicy = { mode: 'cad', replaceBelow: null };
    const before = resolveFeatureRequirements({ instances, manual: [], policy, callouts });
    const after = resolveFeatureRequirements({ instances, manual: [], policy, callouts, detection: detectTolerances({ instances, records: resolvePmiRecords(graph), callouts, drawingCallouts: [] }) });
    expect(after.instances).toEqual(before.instances);
    expect(after.unappliedCad).toEqual(before.unappliedCad);
    expect(after.instances.flatMap((i) => i.requirements)).toEqual([{ category: 'flatness', value: 0.02, source: 'cad_model' }]);
  });

  it('8. a drawing-only callout, a decoded value nobody approved and a stale approval are left for review', () => {
    const drawing = { gdt_callouts: [{ type: 'flatness', tolerance: 0.02 }] };
    const fromDrawing = sand([], { drawing });
    expect(fromDrawing.detection.detected).toEqual([expect.objectContaining({ origin: 'drawing', status: 'review', reviewCode: 'drawing_only' })]);
    nothingCosted(fromDrawing);

    const unapproved = sand([diameter('Diameter1@Hole1', 8, 0.01, [1], decoded)]);
    expect(detected(unapproved, 'Diameter1@Hole1')).toMatchObject({ status: 'review', reviewCode: 'decoded_unapproved' });
    nothingCosted(unapproved);

    const stale: PmiReviewRow = {
      recordKey: 'pmi:Diameter1@Hole1', scope: 'record', decision: 'approved', recordFingerprint: 'an-earlier-fingerprint', fileSha256: FILE, reviewerId: 'u',
      reviewerEmail: null, reviewedAt: '2026-11-01T00:00:00Z', approvedValues: {}, decodedStatus: 'decoded_cross_checked', basis: 'engineering_drawing', notes: null, supersededAt: null,
    };
    const staleRun = sand([diameter('Diameter1@Hole1', 8, 0.01, [1], decoded)], { reviews: [stale] });
    expect(detected(staleRun, 'Diameter1@Hole1')).toMatchObject({ status: 'review', reviewCode: 'stale_or_rejected' });
    nothingCosted(staleRun);
  });

  it('9. a basic dimension is not a requirement; a tolerance tied to no feature, or to a feature it is not read on, is left for review', () => {
    const r = sand([
      diameter('Basic1@Hole1', 8, 0.01, [1], { basic: true }),
      frame('Flatness1@Nowhere', 'flatness', 0.02, []),
      frame('Flatness2@Slot1', 'flatness', 0.02, [5]),
    ]);
    expect(detected(r, 'Basic1@Hole1').status).toBe('not_a_requirement');
    expect(detected(r, 'Flatness1@Nowhere')).toMatchObject({ status: 'review', reviewCode: 'not_associated' });
    expect(detected(r, 'Flatness2@Slot1')).toMatchObject({ status: 'review', reviewCode: 'unsupported_feature' });
    nothingCosted(r);
  });

  it('10. runout, profile, a radius tolerance and a zone with a material-condition modifier are left for review', () => {
    const r = sand([
      frame('Runout1@Hole1', 'circular_runout', 0.01, [1]),
      frame('Profile1@Plane1', 'profile_of_surface', 0.01, [0]),
      { ...diameter('Radius1@Hole1', 4, 0.005, [1]), dimension_type: 'radius' },
      frame('Position1@Hole1', 'position', 0.01, [1], { modifiers: ['maximum_material_requirement'] }),
    ]);
    expect(detected(r, 'Runout1@Hole1').reviewCode).toBe('unsupported_characteristic');
    expect(detected(r, 'Profile1@Plane1').reviewCode).toBe('unsupported_characteristic');
    expect(detected(r, 'Radius1@Hole1').reviewCode).toBe('unsupported_characteristic');
    expect(detected(r, 'Position1@Hole1').reviewCode).toBe('modifier_not_modelled');
    nothingCosted(r);
  });

  it('11. a drawing value that disagrees with the model, and two differing values on one feature, are conflicts and apply nothing', () => {
    const disagree = sand([frame('Flatness1@Plane1', 'flatness', 0.02, [0])], { drawing: { gdt_callouts: [{ type: 'flatness', tolerance: 0.05 }] } });
    expect(disagree.detection.conflicts).toEqual([expect.objectContaining({ characteristic: 'flatness', drawingMm: 0.05, modelMm: [0.02] })]);
    expect(detected(disagree, 'Flatness1@Plane1')).toMatchObject({ status: 'review', reviewCode: 'drawing_cad_conflict' });
    nothingCosted(disagree);

    const agree = sand([frame('Flatness1@Plane1', 'flatness', 0.02, [0])], { drawing: { gdt_callouts: [{ type: 'flatness', tolerance: 0.02 }] } });
    expect(agree.detection.conflicts).toEqual([]);
    expect(detected(agree, 'Flatness1@Plane1').status).toBe('interpretable');

    const twice = sand([diameter('Diameter1@Hole1', 8, 0.01, [1]), diameter('Diameter2@Hole1', 8, 0.05, [1])]);
    expect(twice.detection.detected.map((d) => d.reviewCode)).toEqual(['duplicate_differs', 'duplicate_differs']);
    nothingCosted(twice);
  });

  it('12. a general tolerance is reported and applied to no feature', () => {
    for (const [text, standard] of [['ISO 2768-m', 'ISO 2768'], ['ISO 8062-3 - DCTG 10', 'ISO 8062-3'], ['ASME Y14.5-2009', 'unsupported']] as const) {
      const r = sand([], { drawing: { general_tolerances: text, gdt_callouts: [] } });
      expect(r.detection.general).toMatchObject({ text, standard, applied: false });
      expect(r.resolved.instances.every((i) => i.requirements.length === 0)).toBe(true);
      nothingCosted(r);
    }
  });

  it('13. a requirement no operation on file holds, and one on a feature with no size, are left for review with no line', () => {
    const impossible = sand([diameter('Diameter1@Hole1', 8, 0.00001, [1])]);
    expect(decision(impossible, 'SimpleHole:1')).toMatchObject({ decision: 'needs_review', operations: [] });
    nothingCosted(impossible);

    const graph = featureGraph([frame('Flatness1@Plane1', 'flatness', 0.02, [0])]);
    (graph.feature_graph_v2.features[1]!.occurrences[0] as any).extent_mm = undefined;
    const instances = featureInstances(graph.feature_graph_v2);
    const detection = detectTolerances({ instances, records: resolvePmiRecords(graph), callouts: [], drawingCallouts: [] });
    const resolved = resolveFeatureRequirements({ instances, manual: [], policy: AUTO, callouts: [], detection });
    const need = evaluateMachiningNeed({ primaryProcess: 'Sand Casting', features: resolved.instances, capability, iso, links });
    const decisions = evaluateToleranceDecisions({ profile: toleranceProfileOf('sand_cast'), features: resolved.instances, need });
    expect(decisions.find((d) => d.label === 'PlanarFace:1')).toMatchObject({ decision: 'needs_review' });
    expect(need.machiningRequired).toBe(false);
  });
});

describe('the same feature and tolerance, process by process', () => {
  const records = [diameter('Diameter1@Hole1', 8, 0.01, [1])];
  const of = (family: string, primaryProcess?: string) => run({ records, family, primaryProcess });

  it('14. castings price the operation; machining names it; sheet metal, moulding and an unsupported process review it', () => {
    const sand = of('sand_cast', 'Sand Casting');
    const hpdc = of('die_cast', 'High Pressure Die Casting');
    const milled = of('milled');
    for (const r of [sand, hpdc]) {
      expect(decision(r, 'SimpleHole:1').decision).toBe('add_operation');
      expect(total(r)).toBeGreaterThan(0);
    }
    expect(decision(sand, 'SimpleHole:1').judgedAs).toBe('Sand Casting');
    expect(decision(hpdc, 'SimpleHole:1').judgedAs).toBe('High Pressure Die Casting');

    // 16. A machined part: the finer operation is named, nothing is priced.
    expect(decision(milled, 'SimpleHole:1')).toMatchObject({ decision: 'needs_review', judgedAs: 'Drilling' });
    expect(decision(milled, 'SimpleHole:1').operations).toContain('Reaming');
    expect(decision(milled, 'SimpleHole:1').reason).toMatch(/not added to the cost yet/);
    expect(price(milled).lines).toEqual([]);

    for (const family of ['sheet_metal', 'plastic_molded', 'forged']) {
      const r = of(family);
      expect(r.profile.capability).toBe('not_validated');
      expect(decision(r, 'SimpleHole:1')).toMatchObject({ decision: 'needs_review', judgedAs: null, operations: [] });
      expect(decision(r, 'SimpleHole:1').reason).toMatch(/No validated tolerance capability/);
      expect(decision(r, 'SimpleHole:2').decision).toBe('no_requirement');
      expect(price(r).lines).toEqual([]);
    }
  });

  it('15. the same requirement is the same on every process: only the decision differs', () => {
    const requirements = ['sand_cast', 'milled', 'sheet_metal', 'forged'].map((f) => of(f, 'Sand Casting').resolved.instances.map((i) => i.requirements));
    for (const r of requirements) expect(r).toEqual(requirements[0]);
  });
});

describe('a real STEP file with PMI (RMP-00015)', () => {
  const graph = rmp15 as any;
  const instances = featureInstances(graph.feature_graph_v2);
  const detection = detectTolerances({ instances, records: resolvePmiRecords(graph), callouts: resolveGdtCallouts(graph, null), drawingCallouts: [] });
  const by = (ref: string) => detection.detected.find((d) => d.annotationRef === ref)!;

  it('reads the hole diameters, the position and the cylindricity as requirements on their holes', () => {
    const interpretable = detection.detected.filter((d) => d.status === 'interpretable');
    expect(interpretable.map((d) => d.category).sort()).toEqual(['cylindricity', 'diamTolerance', 'diamTolerance', 'diamTolerance', 'positionTolerance']);
    expect(by('Position1@Hole Pattern2')).toMatchObject({ value: 0.15, basis: 'native_pmi' });
    expect(by('Position1@Hole Pattern2').labels).toHaveLength(4);
    for (const d of interpretable) expect(d.labels.every((l) => l.startsWith('SimpleHole:'))).toBe(true);
  });

  it('leaves the rest for review, each with its reason', () => {
    expect(by('Flatness2@Plane10').reviewCode).toBe('not_associated');
    expect(by('Position2@Simple Hole8').reviewCode).toBe('not_associated');
    expect(by('Width2@Width1(15)').reviewCode).toBe('decoded_unapproved');
    expect(detection.detected.filter((d) => d.characteristic === 'radius').every((d) => d.reviewCode === 'unsupported_characteristic')).toBe(true);
    expect(detection.detected.every((d) => d.status === 'interpretable' || d.reason.length > 0)).toBe(true);
  });
});
