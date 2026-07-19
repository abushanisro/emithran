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
import {
  DEBURR_SEC_PER_METRE, DEBURR_SEC_PER_PIERCE, TAP_CYCLE_SEC,
  classifyMaterialFamily, INSPECTION_SAMPLING_DEFAULT,
} from '../../bom-items/costing/default-rates';
import { computeCycleTime } from '../../bom-items/costing/injection-molding/cycle-time';
import { CycleTimeLibraryService } from './cycle-time-library.service';

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

  constructor(private readonly ctLib: CycleTimeLibraryService) {}

  plan(brief: EngineeringBrief, candidates: CandidateSet): AbstractPlan {
    const template = brief.routingTemplate;
    if (!template) {
      throw new Error('No routing template available — use LLM fallback');
    }

    if (candidates.machines.length === 0) {
      throw new Error('No machine (MHR) candidates — add machine hour rate records to enable deterministic planning');
    }
    if (candidates.labour.length === 0) {
      throw new Error('No labour (LHR) candidates — add labour hour rate records to enable deterministic planning');
    }

    const proposedMasters: AbstractProposedMaster[] = [];
    const processLines: AbstractProcessLine[] = [];
    const defaultLabour: LabourCandidate = candidates.labour[0];
    const batchSize = monthlyBatch(brief);
    let pmCounter = 0;

    const steps: RouteStep[] = [...(template.routing_sequence ?? [])].sort((a, b) => a.step - b.step);

    // Pre-compute IM cycle phases once (Menges formula) — shared across all IM op steps.
    // Lazy-evaluated to avoid import overhead for non-IM routes.
    const imCycleCache: IMCycleCache = {};

    // What the route already covers — template steps first, merged ops appended.
    // mergeMandatoryOps dedups against this so rule-engine ops never duplicate steps.
    const coverage: CoverageEntry[] = [];

    for (const step of steps) {
      // Skip conditional steps when the triggering feature is absent.
      // Case-insensitive with '|'-separated alternatives ("ANODIZE|PLATE") —
      // seeded templates use lowercase, feature types are UPPER_SNAKE.
      const conditionFeature = step.condition_feature;
      if (!step.required && conditionFeature) {
        const wanted = conditionFeature.toUpperCase().split('|').map((s) => s.trim()).filter(Boolean);
        const featurePresent = (brief.featureGraph?.features ?? []).some(
          (f) => wanted.includes(String(f.type).toUpperCase()),
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

      // Compute physics-based cycle time for each machine type.
      // All physics ops are tagged timingSource = 'planner_physics' so the resolver
      // promotes them above the geometry-heuristic tier.
      const physicsResult = computePhysicsCycleSec(step.machine_type, step.process, brief, imCycleCache, this.ctLib);
      const cycleSec    = physicsResult?.sec;
      const timingSource = physicsResult ? 'planner_physics' : undefined;

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
        timingSource,
        reason: step.description || `${step.process} — Op ${step.step} per ${template.template_name}`,
      });
      coverage.push({ text: `${step.process} ${step.description ?? ''}`, machineType: step.machine_type });
    }

    // Merge rule-engine mandatory ops the template doesn't cover (Tapping,
    // Cleaning, Surface Treatment, CMM Inspection, ...). Without this pass,
    // feature-driven ops are computed but silently dropped — the cost engine
    // then charges for work (e.g. tapping) that never appears in the route.
    const templateCount = processLines.length;
    pmCounter = this.mergeMandatoryOps(
      brief, candidates, processLines, proposedMasters, coverage,
      batchSize, defaultLabour, pmCounter,
    );

    // Re-sequence into canonical manufacturing order. Template steps NEVER
    // reorder relative to each other (monotone rank clamp); merged ops insert
    // by manufacturing stage (tapping after machining, cleaning before
    // treatment, CMM before final inspection).
    const ranked = processLines.map((line, seq) => ({
      line, seq,
      rank: stageRank(line.machineCategoryHint ?? '', line.reason),
    }));
    let running = 0;
    for (const r of ranked) {
      if (r.seq < templateCount) r.rank = running = Math.max(running, r.rank);
    }
    ranked.sort((a, b) => (a.rank - b.rank) || (a.seq - b.seq));
    processLines.length = 0;
    ranked.forEach((r, i) => {
      r.line.opNbr = (i + 1) * 10;
      processLines.push(r.line);
    });

    // Link feature graph features to process lines (one feature per line, first-match wins).
    // Features already claimed by a merged mandatory-op line are skipped.
    const linkedFeatureIds = new Set(processLines.map((l) => l.featureId).filter(Boolean));
    for (const feature of (brief.featureGraph?.features ?? [])) {
      if (linkedFeatureIds.has(feature.id)) continue;
      const targetMachineType = machineTypeForFeatureType(feature.type, brief.scope.family);
      if (!targetMachineType) continue;
      // Threads prefer the Tapping/Thread line over the generic machining line
      const preferred = feature.type.startsWith('THREAD')
        ? processLines.find(
            (l) => l.machineCategoryHint === targetMachineType && !l.featureId && /\btap|thread/i.test(l.reason),
          )
        : undefined;
      const targetLine = preferred ?? processLines.find(
        (l) => l.machineCategoryHint === targetMachineType && !l.featureId,
      );
      if (targetLine) {
        targetLine.featureId = feature.id;
        targetLine.featureQty = feature.count ?? 1;
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

  /**
   * Appends rule-engine mandatory ops that no template step (or earlier merged
   * op) already covers. Returns the updated proposed-master counter.
   *
   * Skipped op kinds:
   *   - features priced inside the machining cycle (finish passes, pockets, bores)
   *   - hole-making ops when a milling/turning line exists (drilling is part of
   *     the CNC cycle in the cost engine — a separate line would double-count)
   *   - hints with no deterministic machine mapping ('any')
   */
  private mergeMandatoryOps(
    brief: EngineeringBrief,
    candidates: CandidateSet,
    processLines: AbstractProcessLine[],
    proposedMasters: AbstractProposedMaster[],
    coverage: CoverageEntry[],
    batchSize: number,
    defaultLabour: LabourCandidate,
    pmCounter: number,
  ): number {
    const features = brief.featureGraph?.features ?? [];
    const machiningLineExists = processLines.some(
      (l) => ['cnc_mill', 'cnc_lathe', 'cnc_mill_turn'].includes(l.machineCategoryHint ?? ''),
    );

    for (const op of brief.mandatoryOps ?? []) {
      const feature = features.find((f) => f.id === op.featureId);
      const featureType = feature?.type ?? null;

      if (featureType && FOLDED_INTO_MACHINING.has(featureType)) continue;
      if (featureType && DRILLING_TYPES.has(featureType) && machiningLineExists) continue;

      const machineType =
        machineTypeForCategoryHint(op.machineCategoryHint) ??
        (featureType === 'GRIND' ? 'cylindrical_grinder' : null);
      if (!machineType) continue;

      if (coverage.some((c) => opCoveredBy(op.operationHint, machineType, c))) {
        this.logger.debug(`[planner] Mandatory op "${op.operationHint}" already covered by route — skipped`);
        continue;
      }

      const opCand = findProcessCandidate(candidates.processes, op.operationHint);
      const macCand = findMachineCandidate(candidates.machines, machineType);

      let candidateId: string | undefined;
      let proposedMasterId: string | undefined;
      if (opCand) {
        candidateId = opCand.candidateId;
      } else {
        pmCounter++;
        proposedMasterId = `pm-${pmCounter}`;
        proposedMasters.push({
          kind: 'process',
          proposedMasterId,
          processGroup: groupFromMachineType(machineType),
          processRoute: routeFromMachineType(machineType),
          operation: op.operationHint,
          reason: `${op.reason} — required by manufacturing rule engine, not covered by the routing template. Add this to your process library to avoid re-proposing on next generation.`,
        });
      }

      processLines.push({
        opNbr: op.suggestedOpNbr,
        candidateId,
        proposedMasterId,
        machineCandidateId: macCand.candidateId,
        labourCandidateId: defaultLabour.candidateId,
        calculatorCandidateId: null,
        featureId: op.featureId,
        featureQty: feature?.count,
        machineCategoryHint: machineType,
        batchSize,
        heads: 1,
        partsPerCycle: 1,
        scrapPct: 3,
        reason: op.reason,
      });
      coverage.push({ text: op.operationHint, machineType });
      this.logger.log(`[planner] Merged mandatory op "${op.operationHint}" (${machineType}) — missing from template`);
    }
    return pmCounter;
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
  cmm:                 ['cmm', 'coordinate', 'video measuring', 'inspection', 'quality'],
  cleaning:            ['wash', 'clean', 'degreas', 'ultrasonic'],
  surface_treatment:   ['treatment', 'coating', 'plating', 'anodiz', 'passivat'],
  heat_treatment:      ['heat treat', 'furnace', 'temper', 'anneal', 'carburiz'],
  cylindrical_grinder: ['grinder', 'grinding'],
};

const MACHINE_TYPE_GROUP: Record<string, string> = {
  cnc_lathe: 'Machining',        cnc_mill: 'Machining',
  press_brake: 'Sheet Metal',    laser_cut: 'Sheet Metal',
  saw: 'Machining',              bench_manual: 'Finishing',
  inspection_bench: 'Quality',   cmm: 'Quality',
  cleaning: 'Finishing',         surface_treatment: 'Surface Treatment',
  heat_treatment: 'Heat Treatment', cylindrical_grinder: 'Grinding',
};

const MACHINE_TYPE_ROUTE: Record<string, string> = {
  cnc_lathe: 'CNC Turning',      cnc_mill: 'CNC Milling',
  press_brake: 'Press Brake',    laser_cut: 'Laser Cutting',
  saw: 'Band Saw',               bench_manual: 'Manual',
  inspection_bench: 'Inspection', cmm: 'CMM Inspection',
  cleaning: 'Cleaning',          surface_treatment: 'Surface Treatment',
  heat_treatment: 'Heat Treatment', cylindrical_grinder: 'Grinding',
};

// ── mandatoryOps merge helpers ────────────────────────────────────────────────

interface CoverageEntry {
  text: string;         // step process+description, or a merged op's operationHint
  machineType: string;
}

// Features whose work is priced inside the milling/turning cycle — a separate
// route line would double-count cycle time.
const FOLDED_INTO_MACHINING = new Set([
  'SHOULDER_TURN', 'SURFACE_FINISH_FINE', 'OD_TURN', 'FACE_TURN',
  'ID_BORE', 'POCKET', 'SLOT', 'FLAT_FACE',
]);

// Hole-making features — folded into machining when a milling/turning line exists.
const DRILLING_TYPES = new Set(['AXIAL_HOLE', 'CROSS_HOLE', 'COUNTERBORE', 'COUNTERSINK']);

// Non-machining categories where "same category" means "same route step".
// Machining types (cnc_mill/cnc_lathe) are deliberately absent — a Tapping op on
// the mill must NOT be deduped by the CNC Milling step; keywords decide instead.
const CATEGORY_GROUPS: Record<string, string> = {
  saw: 'saw', laser_cut: 'profile', turret_punch: 'profile', waterjet: 'profile',
  press_brake: 'form', bench_manual: 'bench', cleaning: 'cleaning',
  heat_treatment: 'heat', surface_treatment: 'surface',
  cmm: 'cmm', inspection: 'inspect', inspection_bench: 'inspect',
  cylindrical_grinder: 'grind',
};

// First pattern whose opMatch hits the mandatory op decides which stepMatch to
// test — order matters ("CMM Inspection" must match the cmm rule, not the
// generic inspection rule, or the Final Inspection step would swallow it).
const OP_KEYWORD_PATTERNS: Array<{ opMatch: RegExp; stepMatch: RegExp }> = [
  { opMatch: /\btap/i,              stepMatch: /\btap/i },
  { opMatch: /thread/i,             stepMatch: /thread/i },
  { opMatch: /\bcmm\b/i,            stepMatch: /\bcmm\b|coordinate/i },
  { opMatch: /clean|degreas|wash/i, stepMatch: /clean|degreas|wash/i },
  { opMatch: /anodi|plating|surface treatment|passivat|coating/i,
    stepMatch: /anodi|plating|\bplate\b|surface treat|passivat|coating/i },
  { opMatch: /deburr/i,             stepMatch: /deburr/i },
  { opMatch: /grind/i,              stepMatch: /grind/i },
  { opMatch: /heat treat/i,         stepMatch: /heat|anneal|temper|carburiz|harden/i },
  { opMatch: /saw|stock cut/i,      stepMatch: /\bsaw\b|stock cut|billet/i },
  { opMatch: /drill/i,              stepMatch: /drill/i },
  { opMatch: /inspect/i,            stepMatch: /inspect|quality/i },
];

function opCoveredBy(opHint: string, opMachineType: string, entry: CoverageEntry): boolean {
  const opGroup = CATEGORY_GROUPS[opMachineType];
  const entryGroup = CATEGORY_GROUPS[entry.machineType];
  if (opGroup && entryGroup && opGroup === entryGroup) return true;
  const kw = OP_KEYWORD_PATTERNS.find((p) => p.opMatch.test(opHint));
  return kw != null && kw.stepMatch.test(entry.text);
}

// MandatoryOp.machineCategoryHint → planner machine type. 'any' has no
// deterministic mapping and is left to the LLM path.
function machineTypeForCategoryHint(hint: string | undefined): string | null {
  switch (hint) {
    case 'cnc_lathe': case 'cnc_mill': case 'laser_cut': case 'press_brake':
    case 'saw': case 'bench_manual': case 'inspection_bench': case 'cmm':
    case 'cleaning': case 'surface_treatment': case 'heat_treatment':
      return hint;
    case 'inspection':
      return 'inspection_bench';
    default:
      return null;
  }
}

// Canonical manufacturing stage for route sequencing. Template steps are
// clamped to be monotone (never reordered); merged ops insert by this rank.
function stageRank(machineType: string, text: string): number {
  const t = (text ?? '').toLowerCase();
  switch (machineType) {
    case 'saw':                                      return 10;
    case 'laser_cut': case 'turret_punch': case 'waterjet': return 15;
    case 'press_brake':                              return 20;
    case 'cnc_mill': case 'cnc_lathe': case 'cnc_mill_turn':
      return /\btap|thread/.test(t) ? 35 : 30;
    case 'cylindrical_grinder':                      return 40;
    case 'bench_manual':
      return /clean|wash|degreas/.test(t) ? 55 : 50;
    case 'heat_treatment':                           return 52;
    case 'cleaning':                                 return 55;
    case 'surface_treatment':                        return 60;
    case 'cmm':                                      return 70;
    case 'inspection_bench': case 'inspection':      return 80;
    default:                                         return 45;
  }
}

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

// ── IM cycle-time cache ───────────────────────────────────────────────────────
// Avoids re-running the Menges formula for every IM op in the same route.

interface IMCycleCache {
  fillSec?:  number;
  packSec?:  number;
  coolSec?:  number;
  ejectSec?: number;
}

// ── Per-machine-type physics cycle-time dispatch ──────────────────────────────
// Returns { sec } when physics can be computed from brief geometry, or null
// to let the resolver fall back to its geometry heuristic / default tier.

function computePhysicsCycleSec(
  machineType: string,
  stepProcess: string,
  brief: EngineeringBrief,
  imCache: IMCycleCache,
  ctLib?: CycleTimeLibraryService,
): { sec: number } | null {
  const dfm = brief.dfm;
  const mat = brief.bomItem.materialHint ?? null;
  // DB-resolved material family (set by retrieval.service.ts before plan() is called).
  // Falls back to the regex classifier for parts where DB lookup returned null.
  const matFamily = brief.bomItem.materialFamily ?? classifyToSimpleFamily(mat);

  switch (machineType) {

    // ── Laser cutting — DB-backed speed + pierce time ─────────────────────────
    // Speed source priority: (1) process_cycle_time_library by mat + thickness,
    // (2) default-rates.ts LASER_SPEED_MM_PER_MIN × laserSpeedFactor (fallback).
    case 'laser_cut': {
      if (dfm.cutLengthMm <= 0) return null;
      const pierces = dfm.holeCount + dfm.slotCount;
      const thickMm = dfm.sheetThicknessMm > 0 ? dfm.sheetThicknessMm : 2;
      const pierceSec = pierces * (ctLib ? ctLib.getLaserPierceSec(thickMm) : 0.5);
      const speedMmPerMin = ctLib
        ? ctLib.getLaserSpeed(matFamily, thickMm)
        : 3000;
      const cutSec = (dfm.cutLengthMm / speedMmPerMin) * 60;
      return { sec: Math.max(10, Math.round((pierceSec + cutSec) * 1.25)) };
    }

    // ── Press brake — DB-backed seconds-per-bend ──────────────────────────────
    case 'press_brake': {
      if (dfm.bendCount <= 0) return null;
      const thickMm = dfm.sheetThicknessMm > 0 ? dfm.sheetThicknessMm : 2;
      const secPerBend = ctLib ? ctLib.getBrakeSecPerBend(thickMm) : 15;
      return { sec: Math.max(10, dfm.bendCount * secPerBend) };
    }

    // ── Deburring / bench manual ──────────────────────────────────────────────
    case 'bench_manual': {
      const isTap = /tap|thread/i.test(stepProcess);
      if (isTap) return null; // tapping handled separately below
      const edgeSec  = dfm.cutLengthMm > 0 ? (dfm.cutLengthMm / 1000) * DEBURR_SEC_PER_METRE : 30;
      const pierceSec = dfm.holeCount * DEBURR_SEC_PER_PIERCE;
      return { sec: Math.max(15, Math.round(edgeSec + pierceSec)) };
    }

    // ── CNC milling — DB-backed MRR (mm³/min) ────────────────────────────────
    // MRR source priority: (1) process_cycle_time_library rough-pass value,
    // (2) hardcoded baseline in CycleTimeLibraryService.getCncMrr fallback.
    case 'cnc_mill': {
      const bb    = dfm.boundingBox;
      const bbVol = bb ? (bb.lengthMm * bb.widthMm * bb.heightMm) : 0;
      if (bbVol <= 0 || dfm.volumeMm3 <= 0) return null;
      const fillRatio = Math.min(0.95, Math.max(0.05, dfm.volumeMm3 / bbVol));
      const removeVol = bbVol * (1 - fillRatio);
      const mrrMm3PerMin = ctLib
        ? (ctLib.getCncMrr('mill', matFamily) ?? 8000)
        : (classifyMaterialFamily(mat) === 'aluminum' ? 50000 : classifyMaterialFamily(mat) === 'stainless' ? 5000 : 12000);
      const machMin = removeVol / mrrMm3PerMin;
      return { sec: Math.max(30, Math.round((machMin * 1.35 + 30) * 60)) }; // 35% overhead + 30min setup
    }

    // ── CNC turning — DB-backed MRR (mm³/min) ────────────────────────────────
    case 'cnc_lathe': {
      const bb    = dfm.boundingBox;
      const bbVol = bb ? (bb.lengthMm * bb.widthMm * bb.heightMm) : 0;
      if (bbVol <= 0 || dfm.volumeMm3 <= 0) return null;
      const fillRatio = Math.min(0.95, Math.max(0.05, dfm.volumeMm3 / bbVol));
      const removeVol = bbVol * (1 - fillRatio);
      const mrrMm3PerMin = ctLib
        ? (ctLib.getCncMrr('turn', matFamily) ?? 12000)
        : (classifyMaterialFamily(mat) === 'aluminum' ? 70000 : classifyMaterialFamily(mat) === 'stainless' ? 7000 : 18000);
      const machMin = removeVol / mrrMm3PerMin;
      return { sec: Math.max(30, Math.round((machMin * 1.25 + 20) * 60)) }; // 25% overhead + 20min setup
    }

    // ── CMM / first-article inspection ────────────────────────────────────────
    case 'cmm':
    case 'inspection_bench': {
      const isFai = /first.*art|fai|dimension.*insp|cmm/i.test(stepProcess);
      if (isFai) return { sec: 300 }; // 5 min FAI: program recall + datum alignment + measure
      // In-process visual / go-no-go check — 2 min per part
      void INSPECTION_SAMPLING_DEFAULT; // referenced to prevent unused import
      return { sec: 120 };
    }

    // ── Cleaning / wash ───────────────────────────────────────────────────────
    case 'cleaning': {
      return { sec: 120 }; // 2 min takt: ultrasonic or solvent wipe
    }

    // ── Surface treatment (anodize, powder coat, zinc plate) ──────────────────
    case 'surface_treatment': {
      const areaMm2 = dfm.surfaceAreaMm2 > 0 ? dfm.surfaceAreaMm2 : 5000;
      const areaM2  = areaMm2 / 1e6;
      // Anodize rack: 300 s/m² treatment contact time (immersion + rinse cycles)
      return { sec: Math.max(60, Math.round(areaM2 * 300 + 60)) };
    }

    // ── IM — individual phase ops ─────────────────────────────────────────────
    case 'injection': {
      if (!imCache.fillSec) populateIMCache(imCache, dfm, mat);
      return imCache.fillSec != null ? { sec: Math.max(1, imCache.fillSec) } : null;
    }
    case 'packing_holding':
    case 'pack': {
      if (!imCache.packSec) populateIMCache(imCache, dfm, mat);
      return imCache.packSec != null ? { sec: Math.max(2, imCache.packSec) } : null;
    }
    case 'cooling': {
      if (!imCache.coolSec) populateIMCache(imCache, dfm, mat);
      return imCache.coolSec != null ? { sec: Math.max(3, imCache.coolSec) } : null;
    }
    case 'ejection': {
      return { sec: 3 }; // mold open + ejector stroke + part drop
    }
    case 'mold_setup': {
      return { sec: 3600 }; // 60 min mold change + purge + first-shot setup
    }

    default: {
      // Tapping — check if this step is a tap op even if machineType is cnc_mill/cnc_lathe
      if (/\btap|thread/i.test(stepProcess)) {
        // Default to M6 if no specific size detected (TAP_CYCLE_SEC is per-hole)
        const mSizeHit = stepProcess.match(/\bM(\d+)/i)?.[1];
        const mKey = mSizeHit ? `M${mSizeHit}` : 'M6';
        const secPerHole = TAP_CYCLE_SEC[mKey] ?? 10;
        const holeCount  = dfm.holeCount > 0 ? dfm.holeCount : 1;
        return { sec: Math.max(5, secPerHole * holeCount) };
      }
      return null;
    }
  }
}

// Populates IM cache once per plan call using Menges formula
function populateIMCache(cache: IMCycleCache, dfm: EngineeringBrief['dfm'], mat: string | null): void {
  // sheetThicknessMm is repurposed as wall thickness proxy for IM parts (the CAD engine
  // sets it from the uniform-wall analysis). Fall back to 2.5mm (typical consumer plastic).
  const wallMm   = dfm.sheetThicknessMm > 0 ? dfm.sheetThicknessMm : 2.5;
  const bb       = dfm.boundingBox;
  if (!bb) return;
  const dims     = [bb.lengthMm, bb.widthMm, bb.heightMm].filter((d) => d > 0).sort((a, b) => b - a);
  if (dims.length < 2) return;
  const result = computeCycleTime({
    wallMm,
    longestBboxMm:  dims[0],
    bboxMidMm:      dims[1],
    volumeMm3:      dfm.volumeMm3,
    projectedAreaMm2: null,
    grade: mat,
  });
  cache.fillSec  = result.fillSec;
  cache.packSec  = result.packSec;
  cache.coolSec  = result.coolSec;
  cache.ejectSec = result.ejectSec;
}

/**
 * Maps the DB `material_family` value (from raw_materials.material_family) or
 * falls back to the classifyMaterialFamily() regex classifier when materialFamily
 * is null. Used to pick the correct MRR and laser-speed band.
 */
function classifyToSimpleFamily(mat: string | null | undefined): string {
  return classifyMaterialFamily(mat);
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
    case 'THREAD_INTERNAL': case 'THREAD_EXTERNAL':
      return family === 'cnc_milled' ? 'cnc_mill' : 'cnc_lathe';
    case 'OD_TURN': case 'FACE_TURN': case 'SHOULDER_TURN': case 'ID_BORE':
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
