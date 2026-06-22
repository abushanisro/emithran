import { Injectable, Logger } from '@nestjs/common';
import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type { CandidateSet, ProcessCandidate, MachineCandidate, LabourCandidate } from '../dto/candidate-set.dto';
import type {
  AbstractPlan,
  AbstractProcessLine,
  AbstractRawMaterialLine,
  AbstractProposedMaster,
  PartFamilyHint,
} from '../dto/abstract-plan.dto';
import type { RouteStep } from '../../manufacturing-knowledge/dto/kb.dto';

/**
 * Builds an AbstractPlan deterministically from the routing template + candidate set.
 *
 * Replaces Stage 2 LLM reasoning for all in-scope families that have a routing
 * template loaded. The output shape is identical to what ReasoningService emits
 * via save_draft — ResolverService and the rest of the pipeline are unchanged.
 *
 * Decision priority for each template step:
 *   1. Match a ProcessCandidate from the user's process library by keyword
 *   2. If no match → emit a ProposedMaster so the user can approve + link it
 *
 * Machine selection priority:
 *   1. Match MachineCandidate by machine_type keywords
 *   2. Fallback to candidates.machines[0] (highest-ranked available)
 *
 * Guard: throws if candidates.machines or candidates.labour is empty.
 * Orchestrator catches this and falls back to LLM reasoning.
 */
@Injectable()
export class DeterministicPlannerService {
  private readonly logger = new Logger(DeterministicPlannerService.name);

  plan(brief: EngineeringBrief, candidates: CandidateSet): AbstractPlan {
    const template = brief.routingTemplate;
    if (!template) {
      throw new Error('No routing template available — use LLM fallback');
    }

    if (candidates.machines.length === 0) {
      throw new Error('No machine (MHR) candidates — add machine hour rate records to enable deterministic planning');
    }
    if (candidates.labour.length === 0) {
      throw new Error('No labour (LSR) candidates — add labour hour rate records to enable deterministic planning');
    }

    const proposedMasters: AbstractProposedMaster[] = [];
    const processLines: AbstractProcessLine[] = [];
    const defaultLabour: LabourCandidate = candidates.labour[0];
    const batchSize = monthlyBatch(brief);
    let pmCounter = 0;

    const steps: RouteStep[] = [...(template.routing_sequence ?? [])].sort((a, b) => a.step - b.step);

    for (const step of steps) {
      // Skip conditional steps when the triggering feature is absent
      const conditionFeature = (step as any).condition_feature as string | undefined;
      if (!step.required && conditionFeature) {
        const featurePresent = (brief.featureGraph?.features ?? []).some(
          (f: any) => f.type === conditionFeature,
        );
        if (!featurePresent) {
          this.logger.debug(`[planner] Skipping conditional Op ${step.step} "${step.process}" — feature ${conditionFeature} not present`);
          continue;
        }
      }

      const opCand = findProcessCandidate(candidates.processes, step.process);
      const macCand = findMachineCandidate(candidates.machines, step.machine_type);
      const labCand = defaultLabour;

      let candidateId: string | undefined;
      let proposedMasterId: string | undefined;

      if (opCand) {
        candidateId = opCand.candidateId;
        this.logger.debug(`[planner] Op ${step.step} "${step.process}" → matched op-${opCand.candidateId} (${opCand.operation})`);
      } else {
        pmCounter++;
        proposedMasterId = `pm-${pmCounter}`;
        proposedMasters.push({
          kind: 'process',
          proposedMasterId,
          processGroup: groupFromMachineType(step.machine_type),
          processRoute: routeFromMachineType(step.machine_type),
          operation: step.process,
          reason: `Required by "${template.template_name}" routing template — Op ${step.step}. Add this to your process library to avoid re-proposing on next generation.`,
        });
        this.logger.debug(`[planner] Op ${step.step} "${step.process}" → no match, proposed master ${proposedMasterId}`);
      }

      // Compute laser cycle time from geometry when cut_length is available
      let cycleSec: number | undefined;
      if (step.machine_type === 'laser_cut' && brief.dfm.cutLengthMm > 0) {
        const pierces = brief.dfm.holeCount + brief.dfm.slotCount;
        const pierceSec = pierces * 1.5;
        // Use lookup-table speed if machine candidate carries it (P1 enhancement);
        // fall back to 250 mm/sec = 15 m/min (6kW fiber laser, mild steel 2mm baseline).
        const speedMmPerSec = (macCand as any).cuttingSpeedMmPerSec ?? 250;
        const cutSec = brief.dfm.cutLengthMm / speedMmPerSec;
        cycleSec = Math.max(10, Math.round((pierceSec + cutSec) * 1.25)); // +25% rapids
      }

      processLines.push({
        opNbr: step.step,
        candidateId,
        proposedMasterId,
        machineCandidateId: macCand.candidateId,
        labourCandidateId: labCand.candidateId,
        calculatorCandidateId: null,
        machineCategoryHint: step.machine_type,
        batchSize,
        heads: 1,
        partsPerCycle: 1,
        scrapPct: 3,
        cycleSec,
        reason: step.description || `${step.process} — Op ${step.step} per ${template.template_name}`,
      });
    }

    // Link feature graph features to process lines (one feature per line, first-match wins)
    for (const feature of (brief.featureGraph?.features ?? [])) {
      const targetMachineType = machineTypeForFeatureType(feature.type, brief.scope.family);
      if (!targetMachineType) continue;
      const targetLine = processLines.find(
        (l) => l.machineCategoryHint === targetMachineType && !l.featureId,
      );
      if (targetLine) {
        targetLine.featureId = feature.id;
        this.logger.debug(`[planner] Linked feature ${feature.id} (${feature.type}) → Op ${targetLine.opNbr}`);
      }
    }

    // Material: pick the best-ranked candidate if available
    const rawMaterials: AbstractRawMaterialLine[] = [];
    let materialWarning = '';
    if (candidates.rawMaterials.length > 0) {
      const mat = candidates.rawMaterials[0];
      const netKg = brief.bomItem.unitWeightKg > 0 ? brief.bomItem.unitWeightKg : 0.1;
      rawMaterials.push({
        candidateId: mat.candidateId,
        grossUsageKg: +(netKg * 1.15).toFixed(4),
        netUsageKg: +netKg.toFixed(4),
        scrapPct: 15,
        overheadPct: 5,
        reason: `${mat.material}${mat.grade ? ' ' + mat.grade : ''} — top-ranked material for ${brief.scope.family}`,
      });
      if (mat.score < 0.4) {
        const suggestion = brief.scope.family === 'sheet_metal'
          ? 'CRCA/MS/GI/SS304 Sheet'
          : brief.scope.family === 'cnc_turned'
          ? 'Mild Steel/EN8/Stainless'
          : 'suitable material';
        materialWarning =
          ` ⚠ Material "${mat.material}${mat.grade ? ' ' + mat.grade : ''}" has low fit score` +
          ` (${mat.score.toFixed(2)}) for ${brief.scope.family} —` +
          ` add ${suggestion} records to the raw materials master for accurate costing.`;
      }
    }

    this.logger.log(
      `[planner] Built deterministic plan: ${processLines.length} ops, ` +
      `${pmCounter} proposed masters, template="${template.template_name}"`,
    );

    return {
      partFamily: brief.scope.family as PartFamilyHint,
      rawMaterials,
      processes: processLines,
      tooling: [],
      logistics: [],
      procuredParts: [],
      proposedMasters,
      notes: `Deterministic plan from routing template "${template.template_name}".` +
        (pmCounter > 0
          ? ` ${pmCounter} new process master(s) proposed — approve in the masters panel to avoid re-proposing next time.`
          : '') +
        materialWarning,
    };
  }
}

// ── Machine type → keyword / label helpers ────────────────────────────────────

const MACHINE_TYPE_KEYWORDS: Record<string, string[]> = {
  cnc_lathe:           ['lathe', 'turning center', 'turn'],
  cnc_mill:            ['mill', 'machining center', 'vmc', 'hmc', 'milling'],
  press_brake:         ['press brake', 'brake', 'bending'],
  laser_cut:           ['laser'],
  saw:                 ['saw', 'band saw'],
  bench_manual:        ['bench', 'workstation', 'manual', 'deburr'],
  inspection_bench:    ['inspection', 'cmm', 'quality'],
  surface_treatment:   ['treatment', 'coating', 'plating', 'anodiz', 'passivat'],
  heat_treatment:      ['heat treat', 'furnace', 'temper', 'anneal', 'carburiz'],
  cylindrical_grinder: ['grinder', 'grinding'],
};

const MACHINE_TYPE_GROUP: Record<string, string> = {
  cnc_lathe: 'Machining',        cnc_mill: 'Machining',
  press_brake: 'Sheet Metal',    laser_cut: 'Sheet Metal',
  saw: 'Machining',              bench_manual: 'Finishing',
  inspection_bench: 'Quality',   surface_treatment: 'Surface Treatment',
  heat_treatment: 'Heat Treatment', cylindrical_grinder: 'Grinding',
};

const MACHINE_TYPE_ROUTE: Record<string, string> = {
  cnc_lathe: 'CNC Turning',      cnc_mill: 'CNC Milling',
  press_brake: 'Press Brake',    laser_cut: 'Laser Cutting',
  saw: 'Band Saw',               bench_manual: 'Manual',
  inspection_bench: 'Inspection', surface_treatment: 'Surface Treatment',
  heat_treatment: 'Heat Treatment', cylindrical_grinder: 'Grinding',
};

function findMachineCandidate(machines: MachineCandidate[], machineType: string): MachineCandidate {
  // Phase 1: exact process_family match — deterministic, no keyword guessing
  const familyMatch = machines.find((m) => m.processFamily === machineType);
  if (familyMatch) return familyMatch;

  // Phase 2: keyword match within the candidate set
  const keywords = MACHINE_TYPE_KEYWORDS[machineType] ?? [machineType.replace(/_/g, ' ')];
  const keywordMatch = machines.find((m) => {
    const hay = `${m.machineName} ${m.commodityCode ?? ''}`.toLowerCase();
    return keywords.some((kw) => hay.includes(kw));
  });
  if (keywordMatch) return keywordMatch;

  // Phase 3: last resort — highest-ranked (resolver zeroes rate if category mismatch)
  return machines[0];
}

function findProcessCandidate(procs: ProcessCandidate[], stepProcess: string): ProcessCandidate | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Filter words shorter than 4 chars to prevent short generic words like "cut", "saw", "tap"
  // from producing false-positive matches (e.g. "cut" in "Fiber Laser Cut" matching "Parting/Cut-off")
  const stepWords = norm(stepProcess).split(' ').filter((w) => w.length > 3);
  if (stepWords.length === 0) return undefined;
  return procs.find((p) => {
    const hayWords = new Set(norm(`${p.processGroup} ${p.processRoute} ${p.operation}`).split(' '));
    return stepWords.some((w) => hayWords.has(w));
  });
}

function groupFromMachineType(mt: string): string {
  return MACHINE_TYPE_GROUP[mt] ?? 'General';
}

function routeFromMachineType(mt: string): string {
  return MACHINE_TYPE_ROUTE[mt] ?? mt.replace(/_/g, ' ');
}

function monthlyBatch(brief: EngineeringBrief): number {
  const annual = brief.bomItem.annualVolume ?? 0;
  return Math.max(10, Math.min(Math.round(annual / 12), 500));
}

function machineTypeForFeatureType(featureType: string, family: string): string | null {
  switch (featureType) {
    case 'LASER_CUT': case 'SLOT': case 'FLAT_FACE':
      return 'laser_cut';
    case 'AXIAL_HOLE': case 'CROSS_HOLE': case 'COUNTERBORE': case 'COUNTERSINK':
      return family === 'sheet_metal' ? 'laser_cut'
           : family === 'cnc_turned'  ? 'cnc_lathe'
           : 'cnc_mill';
    case 'POCKET':
      return family === 'sheet_metal' ? 'laser_cut' : 'cnc_mill';
    case 'BEND': case 'FORM':
      return 'press_brake';
    case 'OD_TURN': case 'FACE_TURN': case 'SHOULDER_TURN':
    case 'ID_BORE': case 'THREAD_INTERNAL': case 'THREAD_EXTERNAL':
      return 'cnc_lathe';
    case 'GRIND': case 'SURFACE_FINISH_FINE': case 'HONE': case 'LAPP':
      return 'cylindrical_grinder';
    case 'HEAT_TREAT':
      return 'heat_treatment';
    case 'ANODIZE': case 'PLATE':
      return 'surface_treatment';
    case 'SAW_CUT':
      return 'saw';
    case 'DEBURR':
      return 'bench_manual';
    case 'INSPECT':
      return 'inspection_bench';
    default:
      return null;
  }
}
