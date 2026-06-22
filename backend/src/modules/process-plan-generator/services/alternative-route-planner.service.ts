import { Injectable, Logger } from '@nestjs/common';

import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { AlternativeRoute } from '../dto/alternative-route.dto';
import type { DraftLine } from '../dto/draft-line.dto';
import type {
  PartFamilyRoutingTemplate,
  ProcessRoutingRule,
  MachineCapability,
} from '../../manufacturing-knowledge/dto/kb.dto';

import { DeterministicPlannerService } from './deterministic-planner.service';
import { ResolverService } from './resolver.service';
import { ProcessValidationService } from '../../manufacturing-knowledge/services/process-validation.service';

@Injectable()
export class AlternativeRoutePlannerService {
  private readonly logger = new Logger(AlternativeRoutePlannerService.name);

  constructor(
    private readonly deterministicPlanner: DeterministicPlannerService,
    private readonly resolver: ResolverService,
    private readonly processValidation: ProcessValidationService,
  ) {}

  /**
   * Generates one resolved DraftPackage per template, ranks them by a composite
   * score (cost 50%, lead time 25%, risk 25%), and returns them sorted with the
   * recommended route first.
   *
   * Called synchronously inside OrchestratorService after the main plan is
   * already resolved. kbRules and capabilities are pre-fetched by the orchestrator
   * to avoid extra DB round-trips here.
   */
  planAll(
    brief: EngineeringBrief,
    candidates: CandidateSet,
    templates: PartFamilyRoutingTemplate[],
    kbRules: ProcessRoutingRule[],
    capabilities: MachineCapability[],
  ): AlternativeRoute[] {
    if (templates.length < 2) return [];

    const partFamily = brief.scope.family !== 'out_of_scope' ? brief.scope.family : '';

    type RawResult = {
      template: PartFamilyRoutingTemplate;
      draftLines: DraftLine[];
      proposedMasters: any[];
      validationErrors: string[];
      routeValidationIssues: any[];
      costPreview: AlternativeRoute['costPreview'];
      estimatedLeadTimeHours: number;
      riskScore: number;
    };

    const rawResults: RawResult[] = [];

    for (const template of templates) {
      try {
        const modifiedBrief: EngineeringBrief = { ...brief, routingTemplate: template };
        const abstractPlan = this.deterministicPlanner.plan(modifiedBrief, candidates);
        const draft = this.resolver.resolve(abstractPlan, candidates, modifiedBrief);

        // Build process sequence for validation
        const processLines = draft.draftLines
          .filter((l) => l.kind === 'process')
          .sort((a, b) => ((a.data as any).opNbr ?? a.index) - ((b.data as any).opNbr ?? b.index));

        const processSequence = processLines.map(
          (l) => (l.data as any).operation ?? (l.data as any).processRoute ?? '',
        );

        const machineAssignments: Record<string, string> = {};
        for (const l of processLines) {
          const op = (l.data as any).operation;
          const machine = (l.data as any).processRoute;
          if (op && machine) machineAssignments[op] = machine;
        }

        const routeIssues = kbRules.length > 0 && partFamily
          ? this.processValidation.validateRoute(processSequence, partFamily, kbRules)
          : [];
        const machineIssues = capabilities.length > 0
          ? this.processValidation.validateMachines(processSequence, machineAssignments, capabilities)
          : [];
        const allIssues = [...routeIssues, ...machineIssues];

        // Risk score: validation severity + machine fallback count
        const errCount = allIssues.filter((i) => i.severity === 'error').length;
        const warnCount = allIssues.filter((i) => i.severity === 'warning').length;
        const fallbackCount = processLines.filter((l) => {
          const considered = (l.references?.candidatesConsidered ?? []);
          return considered.length === 0 || !considered.some((c: any) => c.chosen && c.score > 0.5);
        }).length;
        const riskScore = Math.min(errCount * 20 + warnCount * 8 + fallbackCount * 5, 100);

        // Lead time: sum of cycleTimeSeconds across process lines
        const totalCycleSeconds = processLines.reduce(
          (sum, l) => sum + ((l.data as any).cycleTimeSeconds ?? 0),
          0,
        );
        const estimatedLeadTimeHours = totalCycleSeconds / 3600;

        rawResults.push({
          template,
          draftLines: draft.draftLines,
          proposedMasters: draft.proposedMasters,
          validationErrors: draft.validationErrors,
          routeValidationIssues: allIssues,
          costPreview: draft.costPreview,
          estimatedLeadTimeHours,
          riskScore,
        });
      } catch (err: any) {
        this.logger.warn(
          `Alternative route for template "${template.template_name}" failed: ${err?.message}`,
        );
      }
    }

    if (rawResults.length === 0) {
      this.logger.warn('All alternative templates failed to plan — returning empty alternatives');
      return [];
    }

    // Min-max normalise cost and lead time so they contribute equally to composite rank
    const costs = rawResults.map((r) => r.costPreview.total);
    const leads = rawResults.map((r) => r.estimatedLeadTimeHours);
    const minCost = Math.min(...costs), maxCost = Math.max(...costs);
    const minLead = Math.min(...leads), maxLead = Math.max(...leads);

    const scored = rawResults.map((r) => {
      const costScore = maxCost > minCost ? (r.costPreview.total - minCost) / (maxCost - minCost) : 0;
      const leadScore = maxLead > minLead ? (r.estimatedLeadTimeHours - minLead) / (maxLead - minLead) : 0;
      const compositeRank = 0.5 * costScore + 0.25 * leadScore + 0.25 * (r.riskScore / 100);
      return { ...r, compositeRank };
    });

    // Sort ascending — lowest compositeRank = recommended
    scored.sort((a, b) => a.compositeRank - b.compositeRank);

    // Build final AlternativeRoute array with A/B/C labels
    const alternatives: AlternativeRoute[] = scored.map((r, idx) => {
      const letter = String.fromCharCode(65 + idx); // A, B, C…
      const routeId = `route-${letter.toLowerCase()}`;
      const isRecommended = idx === 0;
      const routeLabel = `Route ${letter} — ${r.template.template_name}${isRecommended ? ' (Recommended)' : ''}`;
      return {
        routeId,
        routeLabel,
        complexityLevel: r.template.complexity_level ?? '',
        templateName: r.template.template_name ?? '',
        draft: {
          draftLines: r.draftLines,
          proposedMasters: r.proposedMasters,
          validationErrors: r.validationErrors,
          routeValidationIssues: r.routeValidationIssues,
          hasValidationErrors: r.routeValidationIssues.some((i: any) => i.severity === 'error'),
          partFamily,
          templateUsed: r.template.template_name,
          costPreview: r.costPreview,
        },
        costPreview: r.costPreview,
        estimatedLeadTimeHours: r.estimatedLeadTimeHours,
        riskScore: r.riskScore,
        compositeRank: r.compositeRank,
        isRecommended,
        rationale: '',
      };
    });

    // Generate rationale for the recommended route vs the next-best
    if (alternatives.length > 1) {
      const rec = alternatives[0]!;
      const next = alternatives[1]!;
      const nextLetter = String.fromCharCode(66); // B
      const costDiff = next.costPreview.total - rec.costPreview.total;
      const costPct = next.costPreview.total > 0
        ? Math.round((costDiff / next.costPreview.total) * 100)
        : 0;
      const riskDiff = next.riskScore - rec.riskScore;
      const leadDiff = next.estimatedLeadTimeHours - rec.estimatedLeadTimeHours;

      if (costDiff >= 0 && costPct >= 10) {
        alternatives[0]!.rationale = `₹${Math.round(costDiff)} (${costPct}%) lower cost than Route ${nextLetter}`;
      } else if (riskDiff >= 10) {
        alternatives[0]!.rationale = `Risk score ${rec.riskScore} vs ${next.riskScore} for Route ${nextLetter}`;
      } else if (leadDiff >= 0.1) {
        alternatives[0]!.rationale = `${leadDiff.toFixed(1)} hrs shorter lead time than Route ${nextLetter}`;
      } else {
        alternatives[0]!.rationale = 'Best balance of cost, lead time, and risk';
      }
    }

    this.logger.log(
      `[AlternativeRoutePlanner] ${alternatives.length} routes ranked — ` +
      `recommended: ${alternatives[0]?.routeId} (composite rank ${alternatives[0]?.compositeRank.toFixed(3)})`,
    );

    return alternatives;
  }
}
