import { AlternativeRoutePlannerService } from './alternative-route-planner.service';
import { DeterministicPlannerService } from './deterministic-planner.service';
import { ResolverService } from './resolver.service';
import { ProcessValidationService } from '../../manufacturing-knowledge/services/process-validation.service';
import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { DraftPackage } from '../dto/draft-line.dto';
import type { PartFamilyRoutingTemplate } from '../../manufacturing-knowledge/dto/kb.dto';

// ─── Minimal fixtures ────────────────────────────────────────────────────────

// Only the fields AlternativeRoutePlannerService actually reads from brief
const brief = {
  scope: { family: 'sheet_metal', inScope: true, reason: 'flat blank', confidence: 0.95 },
} as unknown as EngineeringBrief;

const candidates = {} as unknown as CandidateSet;

function makeTemplate(name: string, complexity: 'simple' | 'standard' | 'complex'): PartFamilyRoutingTemplate {
  return {
    id: `tpl-${complexity}`,
    part_family: 'sheet_metal',
    template_name: name,
    complexity_level: complexity,
    routing_sequence: [],
    applicable_materials: null,
    notes: null,
    is_system: true,
    owner_id: null,
    created_at: new Date().toISOString(),
  };
}

function makeDraft(totalCost: number, cycleSeconds: number): DraftPackage {
  return {
    draftLines: [
      {
        kind: 'process',
        index: 0,
        // Cast so test fixtures don't need every field of DraftProcessPayload
        data: { opNbr: 10, operation: 'Laser Cutting', cycleTimeSeconds: cycleSeconds } as any,
        references: {
          candidatesConsidered: [{ candidateId: 'mc-1', label: 'Laser Cutter', score: 0.9, chosen: true }],
          newMasterRefs: [],
        },
        reason: '',
        estimatedCost: totalCost,
      },
    ],
    proposedMasters: [],
    validationErrors: [],
    costPreview: {
      rawMaterial: totalCost * 0.6,
      process: totalCost * 0.4,
      tooling: 0, logistics: 0, procuredPart: 0,
      total: totalCost,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AlternativeRoutePlannerService', () => {
  let svc: AlternativeRoutePlannerService;
  let plannerMock: jest.Mocked<DeterministicPlannerService>;
  let resolverMock: jest.Mocked<ResolverService>;
  let validationMock: jest.Mocked<ProcessValidationService>;

  beforeEach(() => {
    plannerMock = { plan: jest.fn() } as any;
    resolverMock = { resolve: jest.fn() } as any;
    validationMock = {
      validateRoute: jest.fn().mockReturnValue([]),
      validateMachines: jest.fn().mockReturnValue([]),
    } as any;
    svc = new AlternativeRoutePlannerService(plannerMock, resolverMock, validationMock);
  });

  it('returns [] when only one template is provided', () => {
    const result = svc.planAll(brief, candidates, [makeTemplate('Laser', 'standard')], [], []);
    expect(result).toEqual([]);
    expect(plannerMock.plan).not.toHaveBeenCalled();
  });

  it('assigns A/B labels and marks lowest compositeRank as recommended', () => {
    // Route A: cheap (₹500, 1 hr), Route B: expensive (₹1000, 2 hrs)
    const templates = [makeTemplate('Laser', 'standard'), makeTemplate('Turret Punch', 'simple')];
    plannerMock.plan.mockReturnValue({} as any);
    resolverMock.resolve
      .mockReturnValueOnce(makeDraft(500, 3600))   // template 1 → ₹500, 1 hr
      .mockReturnValueOnce(makeDraft(1000, 7200));  // template 2 → ₹1000, 2 hrs

    const routes = svc.planAll(brief, candidates, templates, [], []);

    expect(routes).toHaveLength(2);
    expect(routes[0].routeId).toBe('route-a');
    expect(routes[0].isRecommended).toBe(true);
    expect(routes[1].routeId).toBe('route-b');
    expect(routes[1].isRecommended).toBe(false);
    // Cheaper route must rank first
    expect(routes[0].compositeRank).toBeLessThan(routes[1].compositeRank);
    expect(routes[0].costPreview.total).toBe(500);
  });

  it('generates a cost-savings rationale when gap ≥ 10%', () => {
    const templates = [makeTemplate('Laser', 'standard'), makeTemplate('Waterjet', 'complex')];
    plannerMock.plan.mockReturnValue({} as any);
    // Recommended: ₹800, next-best: ₹1000 → 20% savings
    resolverMock.resolve
      .mockReturnValueOnce(makeDraft(800, 3600))
      .mockReturnValueOnce(makeDraft(1000, 3600));

    const routes = svc.planAll(brief, candidates, templates, [], []);
    expect(routes[0].rationale).toMatch(/lower cost than Route B/);
    expect(routes[0].rationale).toMatch(/₹200/);
  });

  it('skips one failing template and returns the remaining routes', () => {
    const templates = [
      makeTemplate('Laser', 'standard'),
      makeTemplate('Bad Template', 'simple'),
      makeTemplate('Turret Punch', 'complex'),
    ];
    plannerMock.plan.mockReturnValue({} as any);
    resolverMock.resolve
      .mockReturnValueOnce(makeDraft(500, 3600))
      .mockImplementationOnce(() => { throw new Error('No machines found'); })
      .mockReturnValueOnce(makeDraft(700, 5400));

    const routes = svc.planAll(brief, candidates, templates, [], []);
    // Bad template skipped — 2 routes returned
    expect(routes).toHaveLength(2);
    expect(routes.every((r) => r.routeId)).toBe(true);
  });

  it('returns [] when ALL templates throw', () => {
    const templates = [makeTemplate('A', 'standard'), makeTemplate('B', 'simple')];
    plannerMock.plan.mockReturnValue({} as any);
    resolverMock.resolve.mockImplementation(() => { throw new Error('boom'); });

    const routes = svc.planAll(brief, candidates, templates, [], []);
    expect(routes).toEqual([]);
  });

  it('computes riskScore from validation issues', () => {
    const templates = [makeTemplate('A', 'standard'), makeTemplate('B', 'simple')];
    plannerMock.plan.mockReturnValue({} as any);
    resolverMock.resolve.mockReturnValue(makeDraft(500, 3600));
    // First call: 1 error (20pts) + 1 warning (8pts) = 28; second call: 0
    validationMock.validateRoute
      .mockReturnValueOnce([
        { severity: 'error', ruleId: 'r1', ruleName: 'Test', message: 'err', affectedProcesses: [] },
        { severity: 'warning', ruleId: 'r2', ruleName: 'Test', message: 'warn', affectedProcesses: [] },
      ])
      .mockReturnValueOnce([]);

    const routes = svc.planAll(brief, candidates, templates, [{ id: 'r1' } as any], []);
    const scores = new Set(routes.map((r) => r.riskScore));
    expect(scores).toContain(0);
    expect(scores).toContain(28);
  });
});
