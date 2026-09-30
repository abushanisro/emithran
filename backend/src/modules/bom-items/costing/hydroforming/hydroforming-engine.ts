/**
 * Sheet-metal hydroforming: Offline Blank + Hydroform (Deep Draw or Fluid Cell).
 *
 * Pure: every number comes in as data, from memory/Sheetmetal Hydroforming
 * (machining_reference_data source_version 2026-Hydroform, migration 823; the
 * presses in mhr_records, migration 828) and from the part's own drawn shell
 * (CAD engine sheet_metal/features/drawn_shell.py).
 *
 * Process choice   depth/width vs fluidCellFormingRatioThreshold: at or above
 *                  it Deep Draw, below it Fluid Cell (the variable's own note:
 *                  "used to differentiate between Fluid Cell and Deep Draw").
 * Blank            the equal-area round blank of the part's developed area,
 *                  D0 = sqrt(4A/pi) (constant-area drawing).
 * Draws            Deep Draw only: drawReductionPercentage by thickness gives
 *                  the first-draw and redraw punch ratios; draws = the fewest
 *                  whose D0 x r0 x r1 x ... reaches the opening width. Above
 *                  highStrengthMatlThreshold UTS the reduction (100 - ratio) is
 *                  derated by highStrengthMatlDeratePercent.
 * Hydroform cycle  per catalog operation: Loading + Unloading (tblMaterialHandling
 *                  by weight), Clean Tooling (developed area / tblCleanRate, at
 *                  least minimumToolCleanTime), Visual Inspection
 *                  (defaultInspectionTime), throw pad on Fluid Cell (area /
 *                  application + removal rates), x cycleTimeAdjustmentFactor.
 *                  The forming stroke itself has NO time in the source data: it
 *                  is a disclosed gap, never a guessed time. Hand Adjusting has
 *                  no time either.
 * Hydroform cost   none: the presses have no hour rate in the source (migration
 *                  828 seeded them NULL by design) -- a disclosed gap.
 * Offline Blank    strokes/min from pressMaterialAdvanceRate by blank length
 *                  (one stroke blanks and pierces), on the cheapest press whose
 *                  force covers the blanking force (perimeter x t x shear
 *                  strength), priced by that press's own rates through the
 *                  shared eMithranTerms.
 *
 * Source "Time" units are seconds: the same source states its handling times
 * in "(s)" and its clean rate in mm^2/s. Every step lands in the trace.
 */
import type { ProcessLineCost, FeatureOp } from '../../dto/cost-breakdown.dto';
import { eMithranTerms, type EMithranTermsArgs } from '../shared/core/engine-kernel';

export interface DrawnShell {
  depthMm: number;
  openingWidthMm: number;
  developedAreaMm2: number;
}

/** A breakpoint table: the first row whose key is at or above the value. */
export type StepTable = ReadonlyArray<{ key: number; value: number }>;

export interface HydroformingReference {
  variables: ReadonlyMap<string, number>;
  materialHandling: StepTable;        // weight kg -> load time s
  cleanRate: StepTable;               // component area mm^2 -> mm^2/s
  pressAdvance: StepTable;            // part length mm -> strokes/min
  drawReduction: ReadonlyArray<{ thicknessMm: number; ratiosPct: number[] }>;
}

export interface HydroformPress {
  id: string;
  name: string;
  formingType: 'deep draw' | 'fluid cell' | string;
  maxDrawDepthMm: number | null;
  formingAreaDiaMm: number | null;
  formingAreaLengthMm: number | null;
  formingAreaWidthMm: number | null;
  maxToolDiaMm: number | null;
  isPreferred: boolean;
}

export interface BlankPress {
  id: string;
  name: string;
  pressForceKn: number | null;
  machineRatePerHr: number | null;
  labourRatePerHr: number | null;
  operators: number | null;
  setupTimeHr: number | null;
}

export interface HydroformingInput {
  shell: DrawnShell;
  thicknessMm: number;
  densityKgM3: number;
  utsMpa: number | null;
  shearStrengthMpa: number | null;
  batchSize: number;
  reference: HydroformingReference;
  hydroformPresses: readonly HydroformPress[];
  blankPresses: readonly BlankPress[];
  /** Everything eMithranTerms needs besides the press own rates and times. */
  costContext: Omit<EMithranTermsArgs, 'mhrPerHr' | 'dlrPerHr' | 'setupNDL' | 'cycleNDL' | 'cycleTimeMin' | 'setupTimeMin'>;
}

export interface TraceStep { label: string; value: string }

export interface HydroformingResult {
  process: 'Hydroform Deep Draw' | 'Hydroform Fluid Cell';
  processLines: ProcessLineCost[];
  draws: number | null;
  blankDiameterMm: number;
  trace: TraceStep[];
  warnings: string[];
}

export function stepLookup(table: StepTable, value: number): number | null {
  const row = [...table].sort((a, b) => a.key - b.key).find((r) => r.key >= value);
  return row ? row.value : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Fewest draws from blank D0 down to the opening width, or null without data. */
export function drawCount(
  blankDiaMm: number,
  targetDiaMm: number,
  thicknessMm: number,
  table: HydroformingReference['drawReduction'],
  derateFraction: number,
): { draws: number; ratiosPct: number[] } | null {
  const row = [...table].sort((a, b) => a.thicknessMm - b.thicknessMm).find((r) => r.thicknessMm >= thicknessMm);
  if (!row || row.ratiosPct.length === 0) return null;
  const ratios = row.ratiosPct.map((p) => 100 - (100 - p) * (1 - derateFraction));
  let dia = blankDiaMm;
  for (let n = 1; n <= 20; n++) {
    dia *= ratios[Math.min(n - 1, ratios.length - 1)]! / 100;
    if (dia <= targetDiaMm) return { draws: n, ratiosPct: ratios };
  }
  return null;
}

export function computeHydroforming(input: HydroformingInput): HydroformingResult {
  const { shell, thicknessMm, reference: ref } = input;
  const v = (k: string) => ref.variables.get(k) ?? null;
  const trace: TraceStep[] = [];
  const warnings: string[] = [];

  const threshold = v('fluidCellFormingRatioThreshold');
  const ratio = shell.openingWidthMm > 0 ? shell.depthMm / shell.openingWidthMm : 0;
  const deepDraw = threshold != null && ratio >= threshold;
  const process = deepDraw ? 'Hydroform Deep Draw' : 'Hydroform Fluid Cell';
  trace.push({ label: 'Depth / opening width', value: `${r2(shell.depthMm)} / ${r2(shell.openingWidthMm)} mm = ${r3(ratio)}` });
  trace.push({ label: 'fluidCellFormingRatioThreshold', value: threshold == null ? 'not on file — Fluid Cell assumed not decidable' : `${threshold} → ${process}` });
  if (threshold == null) warnings.push('fluidCellFormingRatioThreshold is not staged: Deep Draw vs Fluid Cell could not be decided from data.');

  const blankDia = Math.sqrt((4 * shell.developedAreaMm2) / Math.PI);
  const blankKg = (shell.developedAreaMm2 * thicknessMm / 1e9) * input.densityKgM3;
  trace.push({ label: 'Blank (equal-area round)', value: `D0 = √(4 × ${r2(shell.developedAreaMm2)} / π) = ${r2(blankDia)} mm, ${r3(blankKg)} kg` });

  // ── Draws (Deep Draw) ────────────────────────────────────────────────────
  let draws: number | null = 1;
  if (deepDraw) {
    const uts = input.utsMpa;
    const hsThreshold = v('highStrengthMatlThreshold');
    const derate = uts != null && hsThreshold != null && uts > hsThreshold ? (v('highStrengthMatlDeratePercent') ?? 0) / 100 : 0;
    const dc = drawCount(blankDia, shell.openingWidthMm, thicknessMm, ref.drawReduction, derate);
    draws = dc?.draws ?? null;
    trace.push({
      label: 'Draws (drawReductionPercentage)',
      value: dc
        ? `${dc.draws} (punch ratios ${dc.ratiosPct.map((p) => `${r2(p)}%`).join(' → ')}${derate > 0 ? `, derated ${derate * 100}% for UTS ${uts} MPa` : ''})`
        : 'not resolved — no drawReductionPercentage row for this thickness',
    });
    if (!dc) warnings.push(`No drawReductionPercentage row covers ${thicknessMm} mm: number of draws not resolved.`);
  }

  // ── Hydroform press (fit only: no hour rate exists) ─────────────────────
  const type = deepDraw ? 'deep draw' : 'fluid cell';
  const fits = (p: HydroformPress): boolean =>
    p.formingType === type
    && (p.maxDrawDepthMm == null || p.maxDrawDepthMm === 0 || p.maxDrawDepthMm >= shell.depthMm)
    && (deepDraw
      ? (p.formingAreaDiaMm ?? 0) >= blankDia && (p.maxToolDiaMm == null || p.maxToolDiaMm === 0 || p.maxToolDiaMm >= shell.openingWidthMm)
      : Math.min(p.formingAreaLengthMm ?? 0, p.formingAreaWidthMm ?? 0) >= blankDia);
  const capable = input.hydroformPresses.filter(fits)
    .sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred)
      || (deepDraw ? (a.formingAreaDiaMm ?? 0) - (b.formingAreaDiaMm ?? 0)
        : (a.formingAreaLengthMm ?? 0) * (a.formingAreaWidthMm ?? 0) - (b.formingAreaLengthMm ?? 0) * (b.formingAreaWidthMm ?? 0)));
  const press = capable[0] ?? null;
  trace.push({ label: `${type} press`, value: press ? `${press.name} (${capable.length} capable of ${input.hydroformPresses.filter((p) => p.formingType === type).length})` : 'none capable' });
  if (!press) warnings.push(`No ${type} press in HR Rates fits a ${r2(blankDia)} mm blank drawn ${r2(shell.depthMm)} mm deep.`);

  // ── Hydroform operation times (s) ────────────────────────────────────────
  const adj = v('cycleTimeAdjustmentFactor') ?? 1;
  const handling = stepLookup(ref.materialHandling, blankKg);
  const cleanRate = stepLookup(ref.cleanRate, shell.developedAreaMm2);
  const minClean = v('minimumToolCleanTime');
  const clean = cleanRate ? Math.max(shell.developedAreaMm2 / cleanRate, minClean ?? 0) : null;
  const inspection = v('defaultInspectionTime');
  const ops: FeatureOp[] = [];
  const op = (name: string, sec: number | null, note: string) => {
    trace.push({ label: name, value: sec == null ? `not costed — ${note}` : `${r2(sec)} s (${note})` });
    if (sec != null) ops.push({ name, featureType: 'Form', timeSec: r2(sec * adj), count: 1 });
  };
  op('Loading', handling, `tblMaterialHandling at ${r3(blankKg)} kg`);
  if (!deepDraw && (v('requiredThrowPadDefault') ?? 1) !== 0) {
    const apply = v('throwPadApplicationRate');
    const remove = v('throwPadRemovalRate');
    op('Throw pad', apply && remove ? shell.developedAreaMm2 / apply + shell.developedAreaMm2 / remove : null,
      'area / throwPadApplicationRate + area / throwPadRemovalRate');
  }
  op(deepDraw ? 'Deep Draw Forming' : 'Fluid Cell Forming', null,
    'no forming cycle time (press speed / dwell / pressure ramp) exists in memory/Sheetmetal Hydroforming');
  op('Hand Adjusting', null, 'no hand-adjusting time exists in the source data');
  op('Clean Tooling', clean, `${r2(shell.developedAreaMm2)} mm² / tblCleanRate ${cleanRate ?? '—'} mm²/s, min minimumToolCleanTime ${minClean ?? '—'} s`);
  op('Visual Inspection', inspection, 'defaultInspectionTime');
  op('Unloading', handling, `tblMaterialHandling at ${r3(blankKg)} kg`);
  if (adj !== 1) trace.push({ label: 'cycleTimeAdjustmentFactor', value: String(adj) });

  const knownSec = ops.reduce((s, o) => s + o.timeSec, 0) * (draws ?? 1);
  const formingReason =
    'Hydroform forming has no cycle time in memory/Sheetmetal Hydroforming and the presses have no hour rate '
    + '(migration 828 seeded them NULL): the line shows its real handling, cleaning and inspection times but is not costed.';
  warnings.push(formingReason);

  const hydroformLine: ProcessLineCost = {
    process,
    setupCost: 0,
    runCost: 0,
    totalCost: 0,
    cycleTimeMin: r3(knownSec / 60),
    hourlyRate: 0,
    rateSource: 'no_db_rate',
    machineClass: 'hydroform',
    machineName: press?.name ?? null,
    commodityCode: null,
    labourRate: null,
    ...(press ? { mhrId: press.id } : {}),
    featureBreakdown: ops,
    physicsGap: { gapType: 'unsupported_operation', process, machineClass: 'hydroform', reason: formingReason },
  };

  // ── Offline Blank (costed) ───────────────────────────────────────────────
  const perimeter = Math.PI * blankDia;
  const forceKn = input.shearStrengthMpa != null ? (perimeter * thicknessMm * input.shearStrengthMpa) / 1000 : null;
  const spm = stepLookup(ref.pressAdvance, blankDia);
  trace.push({ label: 'Blanking force', value: forceKn == null ? 'not resolved — material has no shear strength' : `π × ${r2(blankDia)} × ${thicknessMm} × ${input.shearStrengthMpa} MPa = ${r2(forceKn)} kN` });
  trace.push({ label: 'Strokes/min (pressMaterialAdvanceRate)', value: spm == null ? 'not resolved' : `${spm} at ${r2(blankDia)} mm blank length` });

  const blankCandidates = input.blankPresses
    // A press needs its own rate and crew to be priced; one missing either is skipped, never filled in.
    .filter((p): p is BlankPress & { machineRatePerHr: number; operators: number } =>
      p.machineRatePerHr != null && p.machineRatePerHr > 0 && p.operators != null
      && (forceKn == null || p.pressForceKn == null || p.pressForceKn >= forceKn))
    .sort((a, b) => (a.machineRatePerHr + (a.labourRatePerHr ?? 0) * a.operators)
      - (b.machineRatePerHr + (b.labourRatePerHr ?? 0) * b.operators));
  const blankPress = blankCandidates[0] ?? null;
  if (forceKn == null) warnings.push('Blanking force not checked: the material has no shear strength on file.');

  const processLines: ProcessLineCost[] = [];
  if (blankPress && spm) {
    const cycleMin = (1 / spm) * adj;
    const setupMin = (blankPress.setupTimeHr ?? 0) * 60 / Math.max(input.batchSize, 1);
    const terms = eMithranTerms({
      ...input.costContext,
      mhrPerHr: blankPress.machineRatePerHr,
      dlrPerHr: blankPress.labourRatePerHr ?? 0,
      setupNDL: blankPress.operators,
      cycleNDL: blankPress.operators,
      cycleTimeMin: cycleMin,
      setupTimeMin: setupMin,
    });
    trace.push({ label: 'Offline Blank press', value: `${blankPress.name} (${blankCandidates.length} capable)` });
    processLines.push({
      process: 'Offline Blank',
      setupCost: r2(terms.setupCost),
      runCost: r2(terms.total - terms.setupCost),
      totalCost: r2(terms.total),
      cycleTimeMin: r3(cycleMin),
      setupTimeMin: r3((blankPress.setupTimeHr ?? 0) * 60),
      setupTimeSource: 'machine',
      hourlyRate: blankPress.machineRatePerHr,
      rateSource: 'mhr_database',
      machineClass: 'hydroform_offline_blank',
      machineName: blankPress.name,
      commodityCode: null,
      labourRate: blankPress.labourRatePerHr,
      mhrId: blankPress.id,
      featureBreakdown: [{ name: 'Blanking // Blank', featureType: 'Blank', timeSec: r2(60 / spm), count: 1 }],
    });
  } else {
    warnings.push(blankPress ? 'No pressMaterialAdvanceRate row for this blank length.' : 'No Offline Blank press in HR Rates has a rate and enough force for this blank.');
  }
  processLines.push(hydroformLine);

  return { process, processLines, draws, blankDiameterMm: r2(blankDia), trace, warnings };
}
