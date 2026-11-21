import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { resolveGdtCallouts } from '../costing/shared/physics/gdt-callouts';

/** Lookup tables read by the generic spec resolver (specLookupSeeds), not by a resolver of their own. */
const SPEC_RESOLVED_TABLES: ReadonlySet<string> = new Set(['tblRotarySurfaceGrinding', 'tblStraightBevelGearCutting', 'tblSpiralBevelGearCutting', 'tblShaping', 'tblChamfering', 'tblCornerRoundingMill', 'tblChemicalMilling', 'tblChemicalMillingEtchingRates']);
// Platform Architecture Remediation Phase 1 (engine registry unification,
// Rule 8) — getRouteComparison()'s Press Brake/Deburring/Hole Extrusion/
// Tapping lines now call the exact same registered engines
// computeCostSummary() uses, instead of hand-rolled arithmetic that omitted
// labor/inspection-sampling/yield-loss cost (see each engine file's own doc
// comment for the specific divergence this closes).
import type { CostSummaryDto, ProcessLineCost } from '../dto/cost-breakdown.dto';
import { resolveInspectionRule, SEVERITY_RANK } from '../costing/shared/physics/gdt-severity';
import type { GdtSeverity, InspectionMethod } from '../costing/shared/physics/gdt-severity';
import { InspectionKnowledgeService } from '../../manufacturing-knowledge/services/inspection-knowledge.service';
import type { GdtAnalysisDto, GdtFeatureDto } from '../dto/gdt-analysis.dto';

/** A quote with extra lines appended: process total, total, cycle time and completeness follow. */
function appendLines<T extends CostSummaryDto>(dto: T, lines: ProcessLineCost[]): T {
  if (lines.length === 0) return dto;
  const extra = lines.reduce((t, l) => t + l.totalCost, 0);
  const gaps = lines.filter((l) => l.physicsGap).map((l) => l.process);
  const incomplete = [...(dto.incompleteProcesses ?? []), ...gaps];
  return {
    ...dto,
    processLines: [...dto.processLines, ...lines],
    totalProcessCost: dto.totalProcessCost + extra,
    totalCost: dto.totalCost + extra,
    cycleTimes: { ...dto.cycleTimes, totalMin: dto.cycleTimes.totalMin + lines.reduce((t, l) => t + l.cycleTimeMin, 0) },
    ...(incomplete.length ? { incompleteProcesses: incomplete, costStatus: 'incomplete' as const } : {}),
    ...(gaps.length ? { uncostedOperations: [...new Set([...(dto.uncostedOperations ?? []), ...gaps])] } : {}),
  };
}

/** The money of a process line in another currency: every amount the line states, converted by one function. */
function convertLineMoney(l: ProcessLineCost, conv: (n: number) => number) {
  return {
    setupCost: conv(l.setupCost),
    runCost: conv(l.runCost),
    totalCost: conv(l.totalCost),
    hourlyRate: conv(l.hourlyRate),
    labourRate: l.labourRate != null ? conv(l.labourRate) : l.labourRate,
    ...(l.machineCostPerPart != null ? { machineCostPerPart: conv(l.machineCostPerPart) } : {}),
    ...(l.laborCostPerPart != null ? { laborCostPerPart: conv(l.laborCostPerPart) } : {}),
  };
}


/** The GD&T analysis of a part: its tolerance callouts from the model or the drawing, each with its severity and inspection method. */
@Injectable()
export class GdtAnalysisService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly inspectionKnowledge: InspectionKnowledgeService,
  ) { }

  async getGdtAnalysis(id: string, accessToken: string): Promise<GdtAnalysisDto> {
    const client = this.databaseService.getClient(accessToken);
    const { data: rows, error } = await client
      .from("bom_items")
      .select("id, drawing_intelligence, feature_graph")
      .eq("id", id)
      .limit(1);
    if (error) throw new NotFoundException(`BOM item ${id} not found`);
    const item = Array.isArray(rows) ? rows[0] : rows;
    if (!item) throw new NotFoundException(`BOM item ${id} not found`);

    const di = (item as any).drawing_intelligence as Record<string, any> | null;
    const callouts = resolveGdtCallouts((item as any).feature_graph, di);
    const generalTolerance: string | null = di?.general_tolerances ?? null;

    const INSPECTION_PRIORITY: InspectionMethod[] = ["cmm", "height_gauge", "caliper", "visual"];

    if (callouts.length === 0) {
      return {
        bomItemId: id,
        source: "no_data",
        features: [],
        overallSeverity: null,
        maxCostImpactPercent: 0,
        maxCostImpactRange: "none",
        inspectionMethods: [],
        recommendedInspectionMethod: null,
        totalInspectionTimeMin: 0,
        analysisConfidence: 0,
        generalTolerance,
      };
    }

    // DB-backed rule bands (inspection_rules) with the code matrix as fallback —
    // the same resolution the cost engine's inspection line uses.
    const inspectionRules = await this.inspectionKnowledge.getInspectionRules(accessToken);
    const features: GdtFeatureDto[] = callouts.map((c) => ({
      type: c.type,
      toleranceMm: c.toleranceMm,
      datum: c.datum,
      confidence: c.confidence,
      ...resolveInspectionRule(inspectionRules, c.type, c.toleranceMm),
    }));

    const overallSeverity = features.reduce<GdtSeverity>(
      (best, f) => SEVERITY_RANK[f.severity] > SEVERITY_RANK[best] ? f.severity : best,
      "low",
    );

    const maxFeature = features.reduce((a, b) =>
      a.costImpactPercent >= b.costImpactPercent ? a : b,
    );

    const methodSet = new Set(features.map((f) => f.inspectionMethod));
    const inspectionMethods = INSPECTION_PRIORITY.filter((m) => methodSet.has(m));
    const recommendedInspectionMethod = inspectionMethods[0] ?? null;

    const totalInspectionTimeMin = features.reduce((s, f) => s + f.inspectionTimeMin, 0);

    const withConfidence = features.filter((f) => f.confidence !== null);
    const analysisConfidence =
      withConfidence.length > 0
        ? withConfidence.reduce((s, f) => s + (f.confidence as number), 0) / withConfidence.length
        : 0;

    return {
      bomItemId: id,
      source: callouts[0]!.source === "step_pmi" ? "step_pmi" : "drawing_intelligence",
      features,
      overallSeverity,
      maxCostImpactPercent: maxFeature.costImpactPercent,
      maxCostImpactRange: maxFeature.costImpactRange,
      inspectionMethods,
      recommendedInspectionMethod,
      totalInspectionTimeMin,
      analysisConfidence: Math.round(analysisConfidence * 100) / 100,
      generalTolerance,
    };
  }

}
