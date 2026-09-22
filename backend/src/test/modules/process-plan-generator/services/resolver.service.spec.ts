
import { ResolverService } from '../../../../modules/process-plan-generator/services/resolver.service';
import type { CandidateSet } from '../../../../modules/process-plan-generator/dto/candidate-set.dto';
import type { AbstractPlan } from '../../../../modules/process-plan-generator/dto/abstract-plan.dto';
import type { ManufacturingRulesService } from '../../../../modules/manufacturing-rules/manufacturing-rules.service';

const candidates: CandidateSet = {
  rawMaterials: [
    { candidateId: 'rm-1', dbId: 'mat-1', materialGroup: 'Ferrous & Non-Ferrous', material: 'Aluminium 6061', grade: '6061-T6', densityKgPerM3: 2700, unitCostInrPerKg: 342, location: 'India-Bangalore', score: 0.9 },
    { candidateId: 'rm-2', dbId: 'mat-2', materialGroup: 'Ferrous & Non-Ferrous', material: 'EN8', grade: 'EN8', densityKgPerM3: 7850, unitCostInrPerKg: 78, location: 'India-Bangalore', score: 0.6 },
  ],
  machines: [
    { candidateId: 'mc-1', dbId: 'mhr-1', machineName: 'ASC Lathe 320', commodityCode: 'LATHE', description: 'CNC Lathe', rateInrPerHour: 540, location: 'India-Bangalore', processFamily: 'turned', score: 0.9 },
  ],
  labour: [
    { candidateId: 'lb-1', dbId: 'lhr-1', labourType: 'Skilled', labourCode: 'SKL', lhrInrPerHour: 62, location: 'India-Bangalore', score: 0.9 },
  ],
  processes: [
    { candidateId: 'op-1', dbId: 'proc-1', processGroup: 'CNC Machining', processRoute: 'Turning', operation: 'Turning', calculatorId: null, score: 0.9, referenceTables: [] },
  ],
  calculators: [
    { candidateId: 'cl-1', dbId: 'calc-1', name: 'Machining', calcCategory: 'process', description: null, score: 0.7, fields: [], formulas: [] },
  ],
  tooling: [],
};

const plan: AbstractPlan = {
  partFamily: 'turned',
  rawMaterials: [{
    candidateId: 'rm-1',
    grossUsageKg: 0.0033,
    netUsageKg: 0.0027,
    scrapPct: 22,
    overheadPct: 5,
    reason: 'Pin geometry, 6061-T6.',
  }],
  processes: [{
    opNbr: 10,
    candidateId: 'op-1',
    machineCandidateId: 'mc-1',
    labourCandidateId: 'lb-1',
    calculatorCandidateId: 'cl-1',
    setupMin: 20,
    setupManning: 1,
    batchSize: 250,
    heads: 1,
    cycleSec: 35,
    partsPerCycle: 1,
    scrapPct: 3,
    reason: 'Turn op.',
  }],
  tooling: [],
  logistics: [],
  procuredParts: [],
  proposedMasters: [],
};

describe('ResolverService', () => {
  const svc = new ResolverService();

  it('resolves candidate IDs to real DB IDs', () => {
    const out = svc.resolve(plan, candidates);
    expect(out.validationErrors).toEqual([]);

    const raw = out.draftLines.find((l) => l.kind === 'raw_material')!;
    expect((raw.data as any).materialId).toBe('mat-1');
    expect((raw.data as any).unitCost).toBe(342);

    const proc = out.draftLines.find((l) => l.kind === 'process')!;
    expect((proc.data as any).processId).toBe('proc-1');
    expect((proc.data as any).mhrId).toBe('mhr-1');
    expect((proc.data as any).lhrId).toBe('lhr-1');
    expect((proc.data as any).machineRate).toBe(540);
    expect((proc.data as any).labourRate).toBe(62);
    expect((proc.data as any).directRate).toBe(540 + 62 * 1);
  });

  it('attaches a candidates-considered trail per line', () => {
    const out = svc.resolve(plan, candidates);
    const raw = out.draftLines.find((l) => l.kind === 'raw_material')!;
    expect(raw.references.candidatesConsidered.length).toBeGreaterThan(0);
    const chosen = raw.references.candidatesConsidered.find((c) => c.chosen);
    expect(chosen?.candidateId).toBe('rm-1');
  });

  it('rolls up cost preview by section', () => {
    const out = svc.resolve(plan, candidates);
    expect(out.costPreview.rawMaterial).toBeGreaterThan(0);
    expect(out.costPreview.process).toBeGreaterThan(0);
    // Sections are independently rounded to 2 dp before the rollup, so the
    // total can differ from sum-of-sections by ±0.01 per rounded section.
    // toBeCloseTo(..., 1) → tolerance 0.05, which absorbs that drift.
    expect(out.costPreview.total).toBeCloseTo(
      out.costPreview.rawMaterial + out.costPreview.process,
      1,
    );
  });

  it('promotes proposed masters with approved=false initially', () => {
    const planWithProposed: AbstractPlan = {
      ...plan,
      proposedMasters: [{
        kind: 'process',
        proposedMasterId: 'pm-1',
        processGroup: 'CNC Machining',
        processRoute: 'Grinding',
        operation: 'Centerless Grinding',
        reason: 'IT8 needs grind.',
      }],
    };
    const out = svc.resolve(planWithProposed, candidates);
    expect(out.proposedMasters.length).toBe(1);
    expect(out.proposedMasters[0].approved).toBe(false);
  });

  it('reports validation error when a line references unknown machineCandidateId', () => {
    // Note: in real flow this would be caught by validateAbstractPlan first,
    // but resolver guards as defence in depth.
    const broken: AbstractPlan = {
      ...plan,
      processes: [{ ...plan.processes[0], machineCandidateId: 'mc-99' }],
    };
    const out = svc.resolve(broken, candidates);
    expect(out.validationErrors.length).toBeGreaterThan(0);
    expect(out.validationErrors.join(' ')).toMatch(/mc-99/);
  });

  // Root-caused live (2026-09-18): a matched raw-material candidate with a
  // blank real `grade` column used to fall back to `candidate.material`
  // (the generic family name, e.g. "Aluminium") as if it were a specific
  // costable grade -- the same shape of bug reported live (a generic
  // material string matching nothing in raw_materials, silently costing
  // $0). Fixed: no family->grade conflation; a genuinely blank grade stays
  // a disclosed blank (or the proposed-master's own real grade), never
  // substituted.
  it('does not conflate a candidate material family name with its grade when grade is blank', () => {
    const candidatesNoGrade: CandidateSet = {
      ...candidates,
      rawMaterials: [
        { candidateId: 'rm-3', dbId: 'mat-3', materialGroup: 'Ferrous & Non-Ferrous', material: 'Aluminium', grade: '', densityKgPerM3: 2700, unitCostInrPerKg: 300, location: 'India-Bangalore', score: 0.9 },
      ],
    };
    const planNoGrade: AbstractPlan = {
      ...plan,
      rawMaterials: [{ ...plan.rawMaterials[0], candidateId: 'rm-3' }],
    };
    const out = svc.resolve(planNoGrade, candidatesNoGrade);
    const raw = out.draftLines.find((l) => l.kind === 'raw_material')!;
    expect((raw.data as any).materialName).toBe('Aluminium');
    expect((raw.data as any).materialGrade).toBe('');
  });
});

// Root-caused live (2026-09-18): patchWithRulesEngine fabricated a whole
// generic part (materialGrade 'IS2062 E250', a 100x50x5mm block, an
// M8x1.25 thread, a 10mm cutter, 500mm cut length, ...) whenever the
// brief's own real data was absent, then fed those invented numbers into
// the rules engine -- which can produce a real-looking "machining_rules"
// result from fake inputs. Fixed: only ever pass fields traced to real
// brief/feature data; skip the upgrade (leave the line at its existing
// disclosed timing) when the real data isn't there.
describe('ResolverService.patchWithRulesEngine', () => {
  function makePkg() {
    return {
      draftLines: [{
        kind: 'process' as const,
        index: 0,
        data: {
          operation: 'Turning',
          processRoute: 'Turning',
          timingSource: 'ai_hint',
          featureId: 'f1',
          machineRate: 540,
          labourRate: 62,
          batchSize: 250,
        } as any,
        references: { candidatesConsidered: [], newMasterRefs: [] },
        reason: 'seed',
        estimatedCost: 10,
      }],
      validationErrors: [],
      proposedMasters: [],
      costPreview: { rawMaterial: 0, process: 10, total: 10 },
    };
  }

  it('skips the whole patch pass when no real materialGrade is on the brief (never substitutes a hardcoded default)', async () => {
    const evaluate = jest.fn();
    const svc = new ResolverService({ evaluate } as unknown as ManufacturingRulesService);
    const pkg = makePkg();
    const out = await svc.patchWithRulesEngine(pkg as any, { featureGraph: { features: [] } } as any);
    expect(evaluate).not.toHaveBeenCalled();
    expect(out).toBe(pkg);
  });

  it('skips a line with no real matched CAD feature instead of fabricating generic geometry', async () => {
    const evaluate = jest.fn();
    const svc = new ResolverService({ evaluate } as unknown as ManufacturingRulesService);
    const pkg = makePkg();
    const brief = {
      bomItem: { materialGrade: '6061-T6' },
      featureGraph: { features: [] }, // f1 not present -> no real feature match
      dfm: {},
    };
    const out = await svc.patchWithRulesEngine(pkg as any, brief as any);
    expect(evaluate).not.toHaveBeenCalled();
    expect(out.draftLines[0]).toBe(pkg.draftLines[0]);
  });

  it('only passes real feature/dfm-derived fields to the rules engine, never a fabricated default', async () => {
    const evaluate = jest.fn().mockResolvedValue({ timingSource: 'default', totalCycleTimeSec: 0 });
    const svc = new ResolverService({ evaluate } as unknown as ManufacturingRulesService);
    const pkg = makePkg();
    const brief = {
      bomItem: { materialGrade: '6061-T6' },
      featureGraph: { features: [{ id: 'f1', diameter: 12, depth: 25, count: 2, spec: 'M8x1.25' }] },
      dfm: { boundingBox: { lengthMm: 42 }, perimeterMm: 88 },
    };
    await svc.patchWithRulesEngine(pkg as any, brief as any);
    expect(evaluate).toHaveBeenCalledWith({
      operation: 'Turning',
      materialGrade: '6061-T6',
      featureGeometry: {
        diameterMm: 12,
        majorDiameterMm: 12,
        cutterDiameterMm: 12,
        depthMm: 25,
        holeCount: 2,
        threadSpec: 'M8x1.25',
        pitchMm: 1.25,
        lengthMm: 42,
        cuttingLengthMm: 88,
      },
    });
  });

  it('never invents materialRemovalMm, widthMm, or a default thread pitch when the real source data is absent', async () => {
    const evaluate = jest.fn().mockResolvedValue({ timingSource: 'default', totalCycleTimeSec: 0 });
    const svc = new ResolverService({ evaluate } as unknown as ManufacturingRulesService);
    const pkg = makePkg();
    const brief = {
      bomItem: { materialGrade: '6061-T6' },
      featureGraph: { features: [{ id: 'f1', diameter: 12 }] }, // no depth/count/spec
      dfm: {}, // no boundingBox/perimeter
    };
    await svc.patchWithRulesEngine(pkg as any, brief as any);
    const [[callArg]] = evaluate.mock.calls;
    const geometry = callArg.featureGeometry as Record<string, unknown>;
    expect(geometry).toEqual({ diameterMm: 12, majorDiameterMm: 12, cutterDiameterMm: 12 });
    expect(geometry.materialRemovalMm).toBeUndefined();
    expect(geometry.widthMm).toBeUndefined();
    expect(geometry.pitchMm).toBeUndefined();
    expect(geometry.threadSpec).toBeUndefined();
  });

  it('applies the real machining_rules cycle time when the rules engine validates real geometry', async () => {
    const evaluate = jest.fn().mockResolvedValue({ timingSource: 'machining_rules', totalCycleTimeSec: 40 });
    const svc = new ResolverService({ evaluate } as unknown as ManufacturingRulesService);
    const pkg = makePkg();
    const brief = {
      bomItem: { materialGrade: '6061-T6' },
      featureGraph: { features: [{ id: 'f1', diameter: 12, depth: 25 }] },
      dfm: {},
    };
    const out = await svc.patchWithRulesEngine(pkg as any, brief as any);
    const patched = out.draftLines[0].data as any;
    expect(patched.timingSource).toBe('machining_rules');
    expect(patched.cycleTimeSeconds).toBe(40);
  });
});
