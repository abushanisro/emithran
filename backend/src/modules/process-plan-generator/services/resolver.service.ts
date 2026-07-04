import { Injectable, Logger } from '@nestjs/common';

import type { AbstractPlan } from '../dto/abstract-plan.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type {
  DraftLine,
  DraftPackage,
  DraftLineReferences,
  CandidateConsidered,
  DraftProcessPayload,
  ProposedMaster,
} from '../dto/draft-line.dto';
import type { RouteIssue } from '../../manufacturing-knowledge/dto/kb.dto';
import { executeCalculator, type BriefGeometry } from './calculator-executor';
import { featureGroupFromType } from '../utils/feature-group.util';

/**
 * Stage 3 — resolves the LLM's AbstractPlan to a DraftPackage.
 *
 * Responsibilities:
 *   1. Map symbolic candidateIds → real DB IDs (using the CandidateSet
 *      snapshot already validated against in Stage 2).
 *   2. Attach a "candidatesConsidered" trail per line so the UI can show
 *      what alternatives were ranked + which one the LLM picked.
 *   3. Map proposedMasterIds to ProposedMaster entries with `approved=false`.
 *   4. Compute a rough cost preview (uses backend's standard formulas, NOT
 *      the calculator engine — final cost is computed post-apply by the
 *      existing BomItemCostService aggregator).
 *
 * Stateless and pure — easy to unit-test.
 */
@Injectable()
export class ResolverService {
  private readonly logger = new Logger(ResolverService.name);

  resolve(plan: AbstractPlan, candidates: CandidateSet, brief?: EngineeringBrief): DraftPackage {
    const briefGeometry: BriefGeometry | undefined = brief ? (() => {
      const L = brief.dfm.boundingBox.lengthMm;
      const W = brief.dfm.boundingBox.widthMm;
      const H = brief.dfm.boundingBox.heightMm;
      const holeCount = brief.dfm.holeCount;
      return {
        volumeMm3:      brief.dfm.volumeMm3,
        lengthMm:       L,
        widthMm:        W,
        heightMm:       H,
        holeCount,
        holes:          brief.drawing?.holes ?? [],
        surfaceAreaMm2: brief.dfm.surfaceAreaMm2,
        thicknessMm:    Math.min(L, W, H),
        perimeterMm:    2 * (L + W),       // outer cut length estimate (no DXF)
        pierceCount:    holeCount + 1,     // holes + 1 outer-profile lead-in
      };
    })() : undefined;
    const errors: string[] = [];

    // ── Index candidates by symbolic id for O(1) lookup
    const matIx = new Map(candidates.rawMaterials.map((c) => [c.candidateId, c]));
    const macIx = new Map(candidates.machines.map((c) => [c.candidateId, c]));
    const labIx = new Map(candidates.labour.map((c) => [c.candidateId, c]));
    const opIx = new Map(candidates.processes.map((c) => [c.candidateId, c]));
    const clIx = new Map(candidates.calculators.map((c) => [c.candidateId, c]));
    const tcIx = new Map(candidates.tooling.map((c) => [c.candidateId, c]));

    const proposedMasters: ProposedMaster[] = plan.proposedMasters.map((pm) => ({
      proposedMasterId: pm.proposedMasterId,
      kind: pm.kind,
      data: pm,
      reason: pm.reason,
      approved: false,
    }));

    const draftLines: DraftLine[] = [];

    // ── Raw materials ─────────────────────────────────────────────────────
    plan.rawMaterials.forEach((line, idx) => {
      const refs: DraftLineReferences = {
        candidatesConsidered: buildCandidatesList(candidates.rawMaterials, line.candidateId, (c) => `${c.material} ${c.grade ?? ''}`.trim()),
        newMasterRefs: line.proposedMasterId ? [line.proposedMasterId] : [],
      };

      const candidate = line.candidateId ? matIx.get(line.candidateId) : undefined;
      const newRef = line.proposedMasterId ?? null;

      if (!candidate && !newRef) {
        errors.push(`rawMaterials[${idx}]: neither candidateId nor proposedMasterId resolved`);
        return;
      }

      const unitCost = candidate?.unitCostInrPerKg ?? extractProposedNumber(proposedMasters, newRef, 'unitCostInrPerKg', 0);
      const estimatedCost = computeRawMaterialCost(line.grossUsageKg, unitCost, line.scrapPct, line.overheadPct);

      draftLines.push({
        kind: 'raw_material',
        index: idx,
        data: {
          materialId: candidate?.dbId ?? null,
          newMasterRef: newRef,
          materialCategory: candidate?.materialGroup?.toLowerCase().includes('plastic') ? 'PLASTIC_RUBBER' : 'FERROUS_NON_FERROUS',
          materialName: candidate?.material || extractProposedString(proposedMasters, newRef, 'material', ''),
          materialGrade: candidate?.grade || candidate?.material || extractProposedString(proposedMasters, newRef, 'grade', ''),
          unitCost,
          grossUsage: line.grossUsageKg,
          netUsage: line.netUsageKg,
          scrapPercentage: line.scrapPct,
          overheadPercentage: line.overheadPct,
        },
        references: refs,
        reason: line.reason,
        estimatedCost,
      });
    });

    // ── Processes ─────────────────────────────────────────────────────────
    plan.processes.forEach((line, idx) => {
      const opCand = line.candidateId ? opIx.get(line.candidateId) : undefined;
      const macCand = macIx.get(line.machineCandidateId);
      const labCand = labIx.get(line.labourCandidateId);
      const clCand = line.calculatorCandidateId ? clIx.get(line.calculatorCandidateId) : undefined;
      const newRef = line.proposedMasterId ?? null;

      if (!opCand && !newRef) {
        errors.push(`processes[${idx}]: op candidate or proposedMasterId not found`);
        return;
      }
      if (!macCand) {
        errors.push(`processes[${idx}]: machineCandidateId ${line.machineCandidateId} not found`);
        return;
      }
      if (!labCand) {
        errors.push(`processes[${idx}]: labourCandidateId ${line.labourCandidateId} not found`);
        return;
      }

      const refs: DraftLineReferences = {
        candidatesConsidered: [
          ...buildCandidatesList(candidates.processes, line.candidateId, (c) => c.operation),
          ...buildCandidatesList(candidates.machines, line.machineCandidateId, (c) => c.machineName).map((c) => ({ ...c, candidateId: `[m]${c.candidateId}` })),
        ],
        newMasterRefs: newRef ? [newRef] : [],
      };

      // Timing resolution priority: calculator > feature geometry > AI hint > bounding-box estimate > default
      const aiSetupMin = (line.setupMin != null && line.setupMin > 0) ? line.setupMin : null;
      const aiCycleSec = (line.cycleSec != null && line.cycleSec > 0) ? line.cycleSec : null;
      const resolvedSetupManning = line.setupManning ?? 1;

      // Build full operation context for geometry estimate gating
      const opName = opCand?.operation ?? extractProposedString(proposedMasters, newRef, 'operation', '');
      const processGroup = opCand?.processGroup ?? extractProposedString(proposedMasters, newRef, 'processGroup', '');
      const processRoute = opCand?.processRoute ?? extractProposedString(proposedMasters, newRef, 'processRoute', '');
      const opFullContext = `${processGroup} ${processRoute} ${opName} ${line.reason}`;

      // Skip geometry estimate for bench/manual ops (deburr, inspect, surface treat, heat treat)
      // even when the AI incorrectly assigns a CNC machine candidate.
      const linkedMandatoryOp = brief?.mandatoryOps.find((op) => op.featureId === line.featureId);
      const BENCH_HINTS = new Set([
        'bench_manual', 'inspection_bench', 'cmm', 'inspection',
        'cleaning', 'surface_treatment', 'heat_treatment',
      ]);
      const isBenchOp =
        BENCH_HINTS.has(linkedMandatoryOp?.machineCategoryHint ?? '') ||
        BENCH_HINTS.has(line.machineCategoryHint ?? '');

      // Feature-specific timing: uses actual hole diameter/depth/count from the feature graph.
      // Takes priority over AI hints because the AI frequently stamps total batch time on every
      // sub-operation (e.g. total drilling time for 7 holes assigned to both 6-hole and 1-hole ops).
      let featureCycleSec: number | null = null;
      if (!isBenchOp && line.featureId && brief?.featureGraph?.features) {
        const feat = (brief.featureGraph.features as any[]).find((f: any) => f.id === line.featureId);
        if (feat) featureCycleSec = estimateFeatureCycleSecFromGeometry(opFullContext, feat, briefGeometry);
      }

      const geoCycleSec = !isBenchOp && briefGeometry ? estimateCycleSec(opFullContext, briefGeometry) : null;

      // Per-category defaults: bench/inspect/saw ops don't need CNC-level setup time
      const categoryHint = linkedMandatoryOp?.machineCategoryHint ?? line.machineCategoryHint ?? 'any';
      const defaultSetupMin =
        categoryHint === 'bench_manual'      ? 2  :
        categoryHint === 'inspection_bench'  ? 5  :
        categoryHint === 'inspection'        ? 5  :
        categoryHint === 'cmm'               ? 10 :
        categoryHint === 'cleaning'          ? 5  :
        categoryHint === 'saw'               ? 5  :
        categoryHint === 'surface_treatment' ? 10 :
        categoryHint === 'heat_treatment'    ? 10 :
        15;
      const defaultCycleSec =
        categoryHint === 'bench_manual'      ? 120 :
        categoryHint === 'inspection_bench'  ? 300 :
        categoryHint === 'inspection'        ? 300 :
        categoryHint === 'cmm'               ? 480 :  // ~8 min CMM routine per part
        categoryHint === 'cleaning'          ? 90  :
        categoryHint === 'saw'               ? 30  :
        60;

      const resolvedSetupMin = aiSetupMin ?? defaultSetupMin;
      const resolvedCycleSec = featureCycleSec ?? aiCycleSec ?? geoCycleSec ?? defaultCycleSec;

      // When a bench/inspection op falls back to the wrong machine (no bench MHR in DB),
      // zero out the machine rate so we only charge labour. A laser cutter at ₹4800/hr
      // billing for manual deburring is physically wrong and inflates cost ×100.
      // Once the user adds a Deburring Bench or Inspection Bench MHR record, the machine
      // ranker will match it and its real rate will be used instead.
      const benchCategoryHints = ['bench_manual', 'inspection_bench', 'cmm', 'cleaning', 'surface_treatment', 'heat_treatment'];
      const machineIsBench = benchCategoryHints.some((kw) =>
        `${macCand.machineName} ${macCand.commodityCode ?? ''}`.toLowerCase().includes(kw.replace(/_/g, ' '))
        || ['bench', 'deburr', 'workstation', 'inspection', 'cmm', 'quality', 'treatment', 'plating', 'furnace', 'wash', 'clean', 'degreas'].some(
          (mk) => `${macCand.machineName}`.toLowerCase().includes(mk),
        ),
      );
      const effectiveMachineRate = (isBenchOp && !machineIsBench) ? 0 : macCand.rateInrPerHour;
      if (isBenchOp && !machineIsBench) {
        this.logger?.log?.(
          `[resolver] Op ${line.opNbr} is a bench op (${categoryHint}) but machine is "${macCand.machineName}" — zeroing MHR, charging labour only`,
        );
      }

      const calcParams = {
        machineRate: effectiveMachineRate,
        labourRate: labCand.lhrInrPerHour,
        setupMin: resolvedSetupMin,
        cycleSec: resolvedCycleSec,
        batchSize: line.batchSize,
        heads: line.heads,
        setupManning: resolvedSetupManning,
        partsPerCycle: line.partsPerCycle,
        scrapPct: line.scrapPct,
      };
      const calcResult = clCand ? executeCalculator(clCand, calcParams, briefGeometry) : null;
      const estimatedCost = calcResult !== null
        ? calcResult * (1 + line.scrapPct / 100)
        : computeProcessCost(calcParams);

      const timingSource: 'calculator' | 'feature_geometry' | 'ai_hint' | 'geometry_estimate' | 'default' =
        calcResult !== null ? 'calculator' :
        featureCycleSec !== null ? 'feature_geometry' :
        (aiCycleSec !== null || aiSetupMin !== null) ? 'ai_hint' :
        geoCycleSec !== null ? 'geometry_estimate' :
        'default';

      // process_cost_records requires a non-null direct_rate. We compute it
      // as machine + labour-per-head (the same combined rate the existing
      // ProcessCostCalculationEngine uses internally) so post-apply
      // recalculation matches the cost preview shown in the draft panel.
      const directRate = effectiveMachineRate + labCand.lhrInrPerHour * Math.max(line.heads, 1);

      draftLines.push({
        kind: 'process',
        index: idx,
        data: {
          processId: opCand?.dbId ?? null,
          newMasterRef: newRef,
          mhrId: macCand.dbId,
          lsrId: labCand.dbId,
          machineName: macCand.machineName,
          labourType: labCand.labourType,
          machineRate: effectiveMachineRate,
          labourRate: labCand.lhrInrPerHour,
          directRate,
          opNbr: line.opNbr,
          setupManning: resolvedSetupManning,
          setupTimeMinutes: resolvedSetupMin,
          batchSize: line.batchSize,
          heads: line.heads,
          cycleTimeSeconds: resolvedCycleSec,
          partsPerCycle: line.partsPerCycle,
          scrapPercentage: line.scrapPct,
          processGroup: opCand?.processGroup ?? extractProposedString(proposedMasters, newRef, 'processGroup', ''),
          processRoute: opCand?.processRoute ?? extractProposedString(proposedMasters, newRef, 'processRoute', ''),
          operation: opCand?.operation ?? extractProposedString(proposedMasters, newRef, 'operation', ''),
          calculatorName: clCand?.name ?? null,
          timingSource,
          featureId:    line.featureId ?? null,
          featureType:  line.featureId ? (brief?.featureGraph?.features?.find((f: any) => f.id === line.featureId)?.type ?? null) : null,
          featureGroup: line.featureId ? featureGroupFromType(brief?.featureGraph?.features?.find((f: any) => f.id === line.featureId)?.type) : null,
          featureQty:   line.featureQty ?? (line.featureId ? brief?.featureGraph?.features?.find((f: any) => f.id === line.featureId)?.count : undefined),
        },
        references: refs,
        reason: line.reason,
        estimatedCost,
      });
      // Track calculator candidate in candidatesConsidered trail
      if (clCand) {
        refs.candidatesConsidered.push({
          candidateId: `[c]${clCand.candidateId}`,
          label: clCand.name,
          score: clCand.score,
          chosen: true,
        });
      }
    });

    // ── Tooling — all values from DB record via tc-N candidateId ─────────
    plan.tooling.forEach((line, idx) => {
      const tc = tcIx.get(line.candidateId);
      if (!tc) {
        errors.push(`tooling[${idx}]: candidateId ${line.candidateId} not found in tooling CandidateSet`);
        return;
      }
      draftLines.push({
        kind: 'tooling',
        index: idx,
        data: {
          toolingType: tc.toolingType,
          description: tc.description,
          specifications: tc.specifications ?? '',
          unitCost: tc.unitCostInr,
          quantity: tc.quantity,
          amortizationParts: tc.amortizationParts,
          usagePercentage: tc.usagePercentage,
          isCustom: tc.isCustom,
          supplier: tc.supplier,
          costPerPart: tc.costPerPart,
          dbRecordId: tc.dbId,
        },
        references: {
          candidatesConsidered: buildCandidatesList(candidates.tooling, line.candidateId, (c) => c.description),
          newMasterRefs: [],
        },
        reason: line.reason,
        estimatedCost: tc.costPerPart,
      });
    });

    // ── Logistics ─────────────────────────────────────────────────────────
    plan.logistics.forEach((line, idx) => {
      const estimatedCost = line.unitCost * line.quantity;
      draftLines.push({
        kind: 'logistics',
        index: idx,
        data: {
          costName: line.costName,
          logisticsType: line.logisticsType,
          modeOfTransport: line.modeOfTransport,
          costBasis: line.costBasis,
          unitCost: line.unitCost,
          quantity: line.quantity,
          parameters: line.parameters,
        },
        references: { candidatesConsidered: [], newMasterRefs: [] },
        reason: line.reason,
        estimatedCost,
      });
    });

    // ── Procured parts ────────────────────────────────────────────────────
    plan.procuredParts.forEach((line, idx) => {
      const base = line.unitCost * line.quantity;
      const estimatedCost = base * (1 + line.scrapPct / 100 + line.overheadPct / 100);
      draftLines.push({
        kind: 'procured_part',
        index: idx,
        data: {
          partName: line.partName,
          partNumber: line.partNumber,
          supplierName: line.supplierName,
          unitCost: line.unitCost,
          quantity: line.quantity,
          scrapPercentage: line.scrapPct,
          overheadPercentage: line.overheadPct,
          leadTimeDays: line.leadTimeDays,
        },
        references: { candidatesConsidered: [], newMasterRefs: [] },
        reason: line.reason,
        estimatedCost,
      });
    });

    // ── Cost preview rollup ───────────────────────────────────────────────
    const costPreview = {
      rawMaterial: sumOfKind(draftLines, 'raw_material'),
      process: sumOfKind(draftLines, 'process'),
      tooling: sumOfKind(draftLines, 'tooling'),
      logistics: sumOfKind(draftLines, 'logistics'),
      procuredPart: sumOfKind(draftLines, 'procured_part'),
      total: 0,
    };
    costPreview.total =
      costPreview.rawMaterial + costPreview.process + costPreview.tooling +
      costPreview.logistics + costPreview.procuredPart;

    // ── Template route validation ──────────────────────────────────────────
    const routeValidationIssues: RouteIssue[] = [];
    if (brief?.routingTemplate?.routing_sequence?.length) {
      const resolvedOps = draftLines
        .filter((d) => d.kind === 'process')
        .map((d) => (d.data as DraftProcessPayload).operation?.toLowerCase().replace(/[^a-z0-9]/g, '_') ?? '');

      for (const step of brief.routingTemplate.routing_sequence) {
        if (!step.required) continue;
        const hint = step.process.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const firstToken = hint.split('_').find((t) => t.length > 2) ?? hint;
        const covered = resolvedOps.some((op) => op.includes(firstToken) || firstToken.includes(op.split('_')[0]));
        if (!covered) {
          routeValidationIssues.push({
            ruleId: `template_required_op_${step.step}`,
            ruleName: 'routing_template_required_op',
            severity: 'warning',
            message: `Required op "${step.process}" (Op ${step.step}) from routing template not found in plan`,
            affectedProcesses: [step.process],
            suggestedFix: `Add a "${step.process}" operation using a ${step.machine_type} machine`,
          });
        }
      }
    }

    return {
      draftLines,
      proposedMasters,
      validationErrors: errors,
      routeValidationIssues: routeValidationIssues.length > 0 ? routeValidationIssues : undefined,
      hasValidationErrors: errors.length > 0,
      partFamily: brief?.scope?.family,
      templateUsed: brief?.routingTemplate?.template_name ?? null,
      costPreview: roundCostPreview(costPreview),
    };
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function buildCandidatesList<C extends { candidateId: string; score: number }>(
  pool: C[],
  chosenId: string | undefined,
  labelOf: (c: C) => string,
): CandidateConsidered[] {
  return pool.slice(0, 5).map((c) => ({
    candidateId: c.candidateId,
    label: labelOf(c),
    score: c.score,
    chosen: c.candidateId === chosenId,
  }));
}

function extractProposedNumber(
  proposedMasters: ProposedMaster[],
  ref: string | null,
  key: string,
  fallback: number,
): number {
  if (!ref) return fallback;
  const pm = proposedMasters.find((p) => p.proposedMasterId === ref);
  const v = (pm?.data as any)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function extractProposedString(
  proposedMasters: ProposedMaster[],
  ref: string | null,
  key: string,
  fallback: string,
): string {
  if (!ref) return fallback;
  const pm = proposedMasters.find((p) => p.proposedMasterId === ref);
  const v = (pm?.data as any)?.[key];
  return typeof v === 'string' ? v : fallback;
}

/**
 * Per-feature cycle time estimate using the feature's own geometry (diameter, depth, count).
 * More accurate than the bounding-box estimate for drilling and tapping because it scales
 * by the number of holes/threads in THIS operation, preventing the AI from accidentally
 * assigning the total batch time to every sub-operation.
 *
 * Returns null when the feature lacks usable geometry, so callers fall through to the
 * next estimator in the priority chain.
 */
function estimateFeatureCycleSecFromGeometry(
  opContext: string,
  feat: any,
  geo?: BriefGeometry,
): number | null {
  const count   = Math.max(Number(feat.count) || 1, 1);
  const diam    = Number(feat.diameter)  || 0;
  const depth   = Number(feat.depth)     || 0;
  const thru    = feat.throughHole === true;
  const lc      = opContext.toLowerCase();

  // ── Drilling (AXIAL_HOLE, CROSS_HOLE, COUNTERBORE, COUNTERSINK, ID_BORE) ──
  if (/drill|bore|countersink|counterbore/i.test(lc)) {
    if (diam < 0.5) return null;
    // Cutting speed: 130 m/min conservative for Al/steel HSS
    const vc       = 130;
    const f        = Math.min(0.03 + diam * 0.012, 0.20); // feed scales with diameter (mm/rev)
    const rpm      = (vc * 1000) / (Math.PI * diam);
    const feedRate = Math.max(rpm * f, 1);                 // mm/min
    // Effective hole depth: use feature depth when known; for through-holes use min bbox dimension
    const effectiveDepth = depth > 0 ? depth : (thru && geo ? Math.min(geo.lengthMm, geo.widthMm, geo.heightMm) : 15);
    const holeDepthMm    = effectiveDepth + diam * 0.3;   // add lead-in (30 % of diameter)
    const timePerHoleSec = (holeDepthMm / feedRate) * 60 + 4; // +4 s rapid / position
    return Math.round(timePerHoleSec * count);
  }

  // ── Tapping / thread milling (THREAD_INTERNAL) ──────────────────────────
  if (/tap|thread/i.test(lc)) {
    if (diam < 1) return null;
    // Extract pitch from spec string (e.g. "M4×0.7" → 0.7)
    const pitchMatch = (String(feat.spec ?? '')).match(/[×xX]([\d.]+)/);
    const pitch = pitchMatch
      ? parseFloat(pitchMatch[1])
      : (diam > 8 ? 1.25 : diam > 4 ? 0.75 : 0.70); // standard metric pitch fallback
    if (pitch <= 0) return null;
    // Tapping speed: 10 m/min HSS in Al (conservative; avoids tap breakage)
    const vc        = 10;
    const rpm       = (vc * 1000) / (Math.PI * diam);
    const feedRate  = Math.max(rpm * pitch, 1);
    const effectiveDepth = depth > 0 ? depth : (thru && geo ? Math.min(geo.lengthMm, geo.widthMm, geo.heightMm) : 1.5 * diam);
    const threadDepthMm  = effectiveDepth + 3; // approach
    // Rigid tapping: forward + reverse at same feed
    const timePerHoleSec = (threadDepthMm / feedRate) * 60 * 2 + 5; // *2 for retract + 5 s
    return Math.round(timePerHoleSec * count);
  }

  return null; // other op types: fall through to AI hint / bounding-box estimate
}

/**
 * Estimates CNC cycle time (seconds) from part geometry using conservative cutting physics.
 * Returns null for manual bench ops (deburr, inspect) where CNC physics don't apply.
 *
 * Parameters: 120 m/min cutting speed, 0.2 mm/rev feed — conservative defaults valid for
 * steel, aluminium, and copper alloys at finish-turning conditions.
 *
 * Priority: fills the gap between "calculator returned null" and the flat 60 s default.
 * The estimate will be replaced by a real calculator result once one is configured.
 */
function estimateCycleSec(opContext: string, geo: BriefGeometry): number | null {
  // Return null for any manual/bench/non-machining operations so they fall through to the 60 s default.
  // opContext includes processGroup + processRoute + operation + AI reason — cast a wide net.
  if (/deburr|inspect|clean|mark|packag|label|post.?process|quality|bench|visual|assembl|surface.?treat|anodiz|plat|heat.?treat|paint|coat/i.test(opContext)) return null;

  const opName = opContext; // kept for cutting-length selection below

  const { widthMm, heightMm, lengthMm } = geo;
  if (!widthMm || !heightMm || !lengthMm) return null;

  const diameter = (widthMm + heightMm) / 2;
  if (diameter <= 0) return null;

  const cuttingSpeedMpm = 120;  // conservative for steel/Cu/Al
  const feedMmRev = 0.2;
  const rpm = (cuttingSpeedMpm * 1000) / (Math.PI * diameter);
  const feedRateMmMin = Math.max(rpm * feedMmRev, 1);

  // Cutting length by operation type
  let cuttingLengthMm: number;
  if (/face|facing/i.test(opName)) {
    cuttingLengthMm = diameter / 2;                              // radial inward cut
  } else if (/saw|cut.?off|part.?off|parting/i.test(opName)) {
    cuttingLengthMm = diameter / 2;                              // grooves through radius
  } else if (/drill|bore/i.test(opName)) {
    // Use shortest bounding-box dimension as proxy for hole depth — holes don't span
    // the longest axis. Fall back to average known hole depth when available.
    const minDim = Math.min(lengthMm, widthMm, heightMm);
    const avgHoleDepth = geo.holes.length > 0
      ? geo.holes.reduce((s, h) => s + (h.depth ?? minDim), 0) / geo.holes.length
      : minDim;
    cuttingLengthMm = Math.max(avgHoleDepth, 5);
  } else {
    cuttingLengthMm = Math.max(lengthMm, widthMm, heightMm);    // OD turn, mill: longest axis
  }

  // Add 6 s overhead (rapid traverse, tool change, approach, dwell)
  const cuttingMin = (cuttingLengthMm * 1.1) / feedRateMmMin;
  return Math.max((cuttingMin + 0.1) * 60, 3);
}

function computeRawMaterialCost(grossKg: number, unitCostPerKg: number, scrapPct: number, overheadPct: number): number {
  const base = grossKg * unitCostPerKg;
  return base * (1 + overheadPct / 100);
}

function computeProcessCost(args: {
  setupMin: number;
  setupManning: number;
  cycleSec: number;
  partsPerCycle: number;
  batchSize: number;
  heads: number;
  machineRate: number;
  labourRate: number;
  scrapPct: number;
}): number {
  const setupHrs = args.setupMin / 60;
  // Setup cost per part (amortised over batch)
  const setupCostPerPart = (setupHrs * (args.machineRate + args.labourRate * args.setupManning)) / Math.max(args.batchSize, 1);
  // Cycle cost per part
  const cycleHrs = args.cycleSec / 3600;
  const cycleCostPerPart = (cycleHrs * (args.machineRate + args.labourRate * args.heads)) / Math.max(args.partsPerCycle, 1);
  const subtotal = setupCostPerPart + cycleCostPerPart;
  return subtotal * (1 + args.scrapPct / 100);
}

function sumOfKind(lines: DraftLine[], kind: DraftLine['kind']): number {
  return lines.filter((l) => l.kind === kind).reduce((acc, l) => acc + (l.estimatedCost ?? 0), 0);
}

function roundCostPreview(p: { rawMaterial: number; process: number; tooling: number; logistics: number; procuredPart: number; total: number }) {
  const r = (n: number) => Number(n.toFixed(2));
  return {
    rawMaterial: r(p.rawMaterial),
    process: r(p.process),
    tooling: r(p.tooling),
    logistics: r(p.logistics),
    procuredPart: r(p.procuredPart),
    total: r(p.total),
  };
}
