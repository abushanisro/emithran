import { DeterministicPlannerService } from './deterministic-planner.service';
import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { ManufacturingFeature, MandatoryOp } from '../dto/manufacturing-feature.dto';
import type { PartFamilyRoutingTemplate, RouteStep } from '../../manufacturing-knowledge/dto/kb.dto';

// ─── Fixtures — RMP-00028-A Boom Clamp analog ────────────────────────────────
// 6061-T6 milled block: 107 holes, 11× M4×0.7 tapped, Type III hardcoat anodize,
// position ⌀0.05 GD&T → CMM. The production bug: only the 3 template steps
// appeared while tapping was silently costed.

function makeTemplate(steps: RouteStep[]): PartFamilyRoutingTemplate {
  return {
    id: 'tpl-cnc-std',
    part_family: 'cnc_milled',
    template_name: 'CNC Milled (standard)',
    complexity_level: 'standard',
    routing_sequence: steps,
    applicable_materials: null,
    notes: null,
    is_system: true,
    owner_id: null,
    created_at: new Date().toISOString(),
  };
}

const BARE_TEMPLATE: RouteStep[] = [
  { step: 10, process: 'CNC Machining', required: true, machine_type: 'cnc_mill', description: 'Mill all features' },
  { step: 20, process: 'Deburring', required: true, machine_type: 'bench_manual', description: 'Deburr edges' },
  { step: 30, process: 'Final Inspection', required: true, machine_type: 'inspection_bench', description: 'Dimensional inspection' },
];

const BOOM_CLAMP_FEATURES: ManufacturingFeature[] = [
  { id: 'F1', type: 'AXIAL_HOLE', source: 'drawing', confidence: 0.95, diameter: 4, throughHole: true },
  { id: 'F2', type: 'THREAD_INTERNAL', source: 'drawing', confidence: 0.95, spec: 'M4×0.7', count: 11 },
  { id: 'F3', type: 'ANODIZE', source: 'drawing', confidence: 0.95, spec: 'Type III Hardcoat Black' },
  { id: 'F4', type: 'SAW_CUT', source: 'bom', confidence: 0.99 },
  { id: 'F5', type: 'DEBURR', source: 'bom', confidence: 0.99 },
  { id: 'F6', type: 'INSPECT', source: 'drawing', confidence: 0.99, inspectionMethod: 'cmm' },
];

const BOOM_CLAMP_OPS: MandatoryOp[] = [
  { featureId: 'F4', suggestedOpNbr: 10, operationHint: 'Sawing / Stock Cut', reason: 'billet saw cut', confidence: 0.99, machineCategoryHint: 'saw' },
  { featureId: 'F1', suggestedOpNbr: 40, operationHint: 'Drilling Ø4mm THRU', reason: 'drilling', confidence: 0.95, machineCategoryHint: 'cnc_mill' },
  { featureId: 'F2', suggestedOpNbr: 50, operationHint: 'Tapping M4×0.7', reason: 'internal thread requires tapping', confidence: 0.95, machineCategoryHint: 'cnc_mill' },
  { featureId: 'F5', suggestedOpNbr: 60, operationHint: 'Deburring', reason: 'mandatory deburr', confidence: 0.99, machineCategoryHint: 'bench_manual' },
  { featureId: 'clean_pre_treatment', suggestedOpNbr: 72, operationHint: 'Cleaning / Degreasing', reason: 'clean before anodize', confidence: 0.9, machineCategoryHint: 'cleaning' },
  { featureId: 'F3', suggestedOpNbr: 75, operationHint: 'Anodising: Type III Hardcoat Black', reason: 'drawing surface treatment', confidence: 0.95, machineCategoryHint: 'surface_treatment' },
  { featureId: 'F6_cmm', suggestedOpNbr: 90, operationHint: 'CMM Inspection', reason: 'GD&T requires CMM', confidence: 0.99, machineCategoryHint: 'cmm' },
  { featureId: 'F6', suggestedOpNbr: 99, operationHint: 'Final Inspection', reason: 'mandatory last op', confidence: 0.99, machineCategoryHint: 'inspection_bench' },
];

function makeBrief(overrides: {
  steps?: RouteStep[];
  features?: ManufacturingFeature[];
  mandatoryOps?: MandatoryOp[];
  family?: string;
} = {}): EngineeringBrief {
  return {
    bomItem: {
      partName: 'Boom Clamp', partNumber: 'RMP-00028-A', annualVolume: 1200,
      unitWeightKg: 0.27, materialHint: 'AL6061-T6',
    },
    dfm: { holeCount: 107, slotCount: 0, cutLengthMm: 0, pocketCount: 4 },
    drawing: { available: false },
    scope: { family: overrides.family ?? 'cnc_milled', inScope: true, reason: 'milled block', confidence: 0.95 },
    featureGraph: {
      features: overrides.features ?? BOOM_CLAMP_FEATURES,
      buildSources: ['drawing', 'bom'],
      overallConfidence: 0.9,
    },
    mandatoryOps: overrides.mandatoryOps ?? BOOM_CLAMP_OPS,
    context: { organizationLocation: 'India', currency: 'INR', language: 'en' },
    routingTemplate: makeTemplate(overrides.steps ?? BARE_TEMPLATE),
  } as unknown as EngineeringBrief;
}

const candidates: CandidateSet = {
  rawMaterials: [],
  machines: [{
    candidateId: 'mc-1', dbId: 'm1', machineName: 'Haas VF-2 VMC',
    commodityCode: 'CNC-VMC-3AX', description: null, rateInrPerHour: 900,
    location: 'India', processFamily: null, score: 0.9,
  }],
  labour: [{
    candidateId: 'lb-1', dbId: 'l1', labourType: 'Skilled', labourCode: null,
    lhrInrPerHour: 120, location: 'India', score: 0.9,
  }],
  processes: [],
  calculators: [],
  tooling: [],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DeterministicPlannerService — mandatoryOps merge', () => {
  const svc = new DeterministicPlannerService();

  it('appends Tapping / Cleaning / Surface Treatment / CMM missing from the template, in manufacturing order', () => {
    const plan = svc.plan(makeBrief(), candidates);
    const hints = plan.processes.map((l) => l.machineCategoryHint);

    // Saw → Milling → Tapping → Deburr → Cleaning → Anodize → CMM → Final Inspection
    expect(hints).toEqual([
      'saw', 'cnc_mill', 'cnc_mill', 'bench_manual',
      'cleaning', 'surface_treatment', 'cmm', 'inspection_bench',
    ]);
    // Tapping is the second cnc_mill line, feature-linked with quantity
    const tapping = plan.processes.find((l) => /tapping/i.test(l.reason));
    expect(tapping).toBeDefined();
    expect(tapping!.featureId).toBe('F2');
    expect(tapping!.featureQty).toBe(11);
    // Renumbered sequentially ×10
    expect(plan.processes.map((l) => l.opNbr)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it('folds drilling into the machining line instead of adding a duplicate op', () => {
    const plan = svc.plan(makeBrief(), candidates);
    expect(plan.processes.some((l) => /drilling/i.test(l.reason))).toBe(false);
  });

  it('does not let the Final Inspection step swallow the CMM op (distinct categories)', () => {
    const plan = svc.plan(makeBrief(), candidates);
    expect(plan.processes.filter((l) => l.machineCategoryHint === 'cmm')).toHaveLength(1);
    expect(plan.processes.filter((l) => l.machineCategoryHint === 'inspection_bench')).toHaveLength(1);
  });

  it('dedups mandatory ops the template already covers (no duplicate Tapping)', () => {
    const withTapping: RouteStep[] = [
      ...BARE_TEMPLATE.slice(0, 1),
      { step: 15, process: 'Tapping', required: false, machine_type: 'cnc_mill', condition_feature: 'THREAD_INTERNAL', description: 'Tap internal threads' },
      ...BARE_TEMPLATE.slice(1),
    ];
    const plan = svc.plan(makeBrief({ steps: withTapping }), candidates);
    const tapLines = plan.processes.filter((l) => /\btap/i.test(l.reason));
    expect(tapLines).toHaveLength(1);
    // The template's own tapping step gets the thread feature linked to it
    expect(tapLines[0].featureId).toBe('F2');
    expect(tapLines[0].featureQty).toBe(11);
  });

  it('emits proposed masters for merged ops with no process-library match', () => {
    const plan = svc.plan(makeBrief(), candidates);
    const operations = plan.proposedMasters
      .filter((pm) => pm.kind === 'process')
      .map((pm) => (pm as { operation: string }).operation);
    expect(operations).toEqual(expect.arrayContaining([
      'Tapping M4×0.7', 'Cleaning / Degreasing', 'Anodising: Type III Hardcoat Black', 'CMM Inspection',
    ]));
  });

  it('adds nothing when the template already covers every mandatory op', () => {
    const fullTemplate: RouteStep[] = [
      { step: 10, process: 'Saw Cut', required: true, machine_type: 'saw', description: 'Saw billet' },
      { step: 20, process: 'CNC Milling', required: true, machine_type: 'cnc_mill', description: 'Mill features' },
      { step: 30, process: 'Tapping', required: false, machine_type: 'cnc_mill', condition_feature: 'THREAD_INTERNAL', description: 'Tap threads' },
      { step: 40, process: 'Deburring', required: true, machine_type: 'bench_manual', description: 'Deburr' },
      { step: 50, process: 'Cleaning / Degreasing', required: false, machine_type: 'cleaning', condition_feature: 'ANODIZE|PLATE|HEAT_TREAT', description: 'Wash' },
      { step: 60, process: 'Surface Treatment', required: false, machine_type: 'surface_treatment', condition_feature: 'ANODIZE|PLATE', description: 'Anodize' },
      { step: 70, process: 'CMM Inspection', required: false, machine_type: 'cmm', condition_feature: 'INSPECT', description: 'CMM' },
      { step: 80, process: 'Final Inspection', required: true, machine_type: 'inspection_bench', description: 'Inspect' },
    ];
    const plan = svc.plan(makeBrief({ steps: fullTemplate }), candidates);
    expect(plan.processes).toHaveLength(8);
  });
});

describe('DeterministicPlannerService — conditional template steps', () => {
  const svc = new DeterministicPlannerService();

  it('matches condition_feature case-insensitively (the "bend" vs BEND seed bug)', () => {
    const steps: RouteStep[] = [
      { step: 10, process: 'CNC Machining', required: true, machine_type: 'cnc_mill', description: 'Mill' },
      { step: 20, process: 'Tapping', required: false, machine_type: 'cnc_mill', condition_feature: 'thread_internal', description: 'Tap' },
    ];
    const plan = svc.plan(makeBrief({ steps, mandatoryOps: [] }), candidates);
    expect(plan.processes.some((l) => /\btap/i.test(l.reason))).toBe(true);
  });

  it('supports |-separated alternatives and skips when none are present', () => {
    const steps: RouteStep[] = [
      { step: 10, process: 'CNC Machining', required: true, machine_type: 'cnc_mill', description: 'Mill' },
      { step: 20, process: 'Surface Treatment', required: false, machine_type: 'surface_treatment', condition_feature: 'ANODIZE|PLATE', description: 'Treat' },
    ];
    const withAnodize = svc.plan(makeBrief({ steps, mandatoryOps: [] }), candidates);
    expect(withAnodize.processes).toHaveLength(2);

    const noAnodize = svc.plan(
      makeBrief({
        steps,
        mandatoryOps: [],
        features: BOOM_CLAMP_FEATURES.filter((f) => f.type !== 'ANODIZE'),
      }),
      candidates,
    );
    expect(noAnodize.processes).toHaveLength(1);
  });
});

describe('DeterministicPlannerService — template order preservation', () => {
  const svc = new DeterministicPlannerService();

  it('never reorders template steps relative to each other, even out of canonical order', () => {
    // Deliberately unusual template: inspection before deburr (user-authored)
    const steps: RouteStep[] = [
      { step: 10, process: 'CNC Machining', required: true, machine_type: 'cnc_mill', description: 'Mill' },
      { step: 20, process: 'In-Process Check', required: true, machine_type: 'inspection_bench', description: 'Check' },
      { step: 30, process: 'Deburring', required: true, machine_type: 'bench_manual', description: 'Deburr' },
    ];
    const plan = svc.plan(makeBrief({ steps, mandatoryOps: [] }), candidates);
    const reasons = plan.processes.map((l) => l.reason);
    expect(reasons.findIndex((r) => /check/i.test(r))).toBeLessThan(
      reasons.findIndex((r) => /deburr/i.test(r)),
    );
  });
});
