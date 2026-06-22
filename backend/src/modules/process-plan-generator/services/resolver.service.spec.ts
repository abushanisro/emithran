
import { ResolverService } from './resolver.service';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { AbstractPlan } from '../dto/abstract-plan.dto';

const candidates: CandidateSet = {
  rawMaterials: [
    { candidateId: 'rm-1', dbId: 'mat-1', materialGroup: 'Ferrous & Non-Ferrous', material: 'Aluminium 6061', grade: '6061-T6', densityKgPerM3: 2700, unitCostInrPerKg: 342, location: 'India-Bangalore', score: 0.9 },
    { candidateId: 'rm-2', dbId: 'mat-2', materialGroup: 'Ferrous & Non-Ferrous', material: 'EN8', grade: 'EN8', densityKgPerM3: 7850, unitCostInrPerKg: 78, location: 'India-Bangalore', score: 0.6 },
  ],
  machines: [
    { candidateId: 'mc-1', dbId: 'mhr-1', machineName: 'ASC Lathe 320', commodityCode: 'LATHE', description: 'CNC Lathe', rateInrPerHour: 540, location: 'India-Bangalore', processFamily: 'cnc_turned', score: 0.9 },
  ],
  labour: [
    { candidateId: 'lb-1', dbId: 'lsr-1', labourType: 'Skilled', labourCode: 'SKL', lhrInrPerHour: 62, location: 'India-Bangalore', score: 0.9 },
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
  partFamily: 'cnc_turned',
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
    expect((proc.data as any).lsrId).toBe('lsr-1');
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
});
