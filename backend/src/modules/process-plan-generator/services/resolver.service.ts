import { Injectable, Logger } from '@nestjs/common';

import type { AbstractPlan } from '../dto/abstract-plan.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type {
  DraftLine,
  DraftPackage,
  DraftLineReferences,
  CandidateConsidered,
  ProposedMaster,
} from '../dto/draft-line.dto';

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

  resolve(plan: AbstractPlan, candidates: CandidateSet): DraftPackage {
    const errors: string[] = [];

    // ── Index candidates by symbolic id for O(1) lookup
    const matIx = new Map(candidates.rawMaterials.map((c) => [c.candidateId, c]));
    const macIx = new Map(candidates.machines.map((c) => [c.candidateId, c]));
    const labIx = new Map(candidates.labour.map((c) => [c.candidateId, c]));
    const opIx = new Map(candidates.processes.map((c) => [c.candidateId, c]));
    const clIx = new Map(candidates.calculators.map((c) => [c.candidateId, c]));

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
          materialGrade: candidate?.grade ?? candidate?.material ?? extractProposedString(proposedMasters, newRef, 'grade', ''),
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
          ...buildCandidatesList(candidates.processes, line.candidateId, (c) => c.processName),
          ...buildCandidatesList(candidates.machines, line.machineCandidateId, (c) => c.machineName).map((c) => ({ ...c, candidateId: `[m]${c.candidateId}` })),
        ],
        newMasterRefs: newRef ? [newRef] : [],
      };

      const estimatedCost = computeProcessCost({
        setupMin: line.setupMin,
        setupManning: line.setupManning,
        cycleSec: line.cycleSec,
        partsPerCycle: line.partsPerCycle,
        batchSize: line.batchSize,
        heads: line.heads,
        machineRate: macCand.rateInrPerHour,
        labourRate: labCand.lhrInrPerHour,
        scrapPct: line.scrapPct,
      });

      // process_cost_records requires a non-null direct_rate. We compute it
      // as machine + labour-per-head (the same combined rate the existing
      // ProcessCostCalculationEngine uses internally) so post-apply
      // recalculation matches the cost preview shown in the draft panel.
      const directRate = macCand.rateInrPerHour + labCand.lhrInrPerHour * Math.max(line.heads, 1);

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
          machineRate: macCand.rateInrPerHour,
          labourRate: labCand.lhrInrPerHour,
          directRate,
          opNbr: line.opNbr,
          setupManning: line.setupManning,
          setupTimeMinutes: line.setupMin,
          batchSize: line.batchSize,
          heads: line.heads,
          cycleTimeSeconds: line.cycleSec,
          partsPerCycle: line.partsPerCycle,
          scrapPercentage: line.scrapPct,
        },
        references: refs,
        reason: line.reason,
        estimatedCost,
      });
      // Track calculator candidate considered (logged but not persisted —
      // process_cost_records has no calculator_id column).
      if (clCand) {
        refs.candidatesConsidered.push({
          candidateId: `[c]${clCand.candidateId}`,
          label: clCand.name,
          score: clCand.score,
          chosen: true,
        });
      }
    });

    // ── Tooling ───────────────────────────────────────────────────────────
    plan.tooling.forEach((line, idx) => {
      const estimatedCost = (line.unitCost * line.quantity * (line.usagePercentage / 100)) / Math.max(line.amortizationParts, 1);
      draftLines.push({
        kind: 'tooling',
        index: idx,
        data: {
          toolingType: line.toolingType,
          description: line.description,
          specifications: line.specifications,
          unitCost: line.unitCost,
          quantity: line.quantity,
          amortizationParts: line.amortizationParts,
          usagePercentage: line.usagePercentage,
          isCustom: line.isCustom,
        },
        references: { candidatesConsidered: [], newMasterRefs: [] },
        reason: line.reason,
        estimatedCost,
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

    return {
      draftLines,
      proposedMasters,
      validationErrors: errors,
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
