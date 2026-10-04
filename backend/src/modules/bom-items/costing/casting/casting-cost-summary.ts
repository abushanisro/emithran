// Cost Summary for a casting part. Pure: the caller resolves the material,
// the casting reference, the machines and the measured casting geometry.
//
// Material: the part's own metal at the material's price per kg (the same
// resolved raw_materials row every family prices from). Die casting: the
// Net Material Usage calculator (part volume x alloy density) and the Gross
// Material Usage calculator (x the alloy Yield Loss Factor) give the part and
// the charged metal; overflow, runner and gating metal is remelted in-house
// (shown as melted, not charged) and biscuit metal is a named gap.
//
// Process: one line per casting process. Die casting is priced by the HPDC
// engine; any other casting process (gravity die, sand, investment) has no
// engine yet and is a named, uncosted line -- never priced as something else.

import type { CalculatorRunDto, CostSummaryDto, DieCastingProcessChoiceDto, DieToolingDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { runReferenceCalculator, type ReferenceCalculators } from '../shared/calculators/reference-calculator';
import { castingSeed, runView } from './casting-calculator-seeds';
import type { DieToolingResult } from './die-tooling';
import { computeSustainability } from '../shared/core/cost-engine';
import { HPDC_PROCESS, type HpdcResult } from './hpdc-engine';

export type CastingProcess = 'die_casting' | 'sand_casting' | 'investment_casting';

const PROCESS_LABEL: Record<CastingProcess, string> = {
  die_casting: 'High Pressure Die Casting',
  sand_casting: 'Sand Casting',
  investment_casting: 'Investment Casting',
};

/** The cad-engine casting families (shared/part_family.py CASTING_FAMILY_DOMAIN). */
export const CASTING_FAMILY_PROCESS: Readonly<Record<string, CastingProcess>> = {
  die_cast: 'die_casting',
  sand_cast: 'sand_casting',
  investment_cast: 'investment_casting',
};

/** The process name of a casting process as tblGtolProcessCapabilities and the HR Rates lines name it. */
export function castingProcessLabel(process: CastingProcess): string {
  return PROCESS_LABEL[process];
}

export function castingProcessOfFamily(family: string): CastingProcess | null {
  return CASTING_FAMILY_PROCESS[family] ?? null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function unmodelledCastingLine(process: CastingProcess): ProcessLineCost {
  const label = PROCESS_LABEL[process];
  return {
    process: label,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0,
    hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: process, machineName: null, commodityCode: null, labourRate: null,
    physicsGap: {
      gapType: 'unsupported_operation', process: label, machineClass: process,
      reason: `${label} has no cost engine yet: the line is shown, not priced.`,
    },
  };
}

export function buildCastingCostSummary(input: {
  family: string;
  process: CastingProcess;
  hpdc: HpdcResult | null;
  materialGrade: string | null;
  materialCostPerKg: number;
  materialDensityKgM3: number;
  materialSource: 'db' | 'default';
  partVolumeMm3: number;
  batchSize: number;
  warnings: string[];
  ratesSource: string;
  /** Machining after the casting (secondary-machining-cost.ts): its lines run after the casting line. */
  secondaryMachining?: { lines: ProcessLineCost[]; warnings: string[] } | null;
  /** Cleaning after the casting and Visual Inspection at the end (casting-finishing.ts). */
  finishing?: {
    melting: ProcessLineCost | null;
    trim: ProcessLineCost | null;
    grinding: ProcessLineCost | null;
    cleaning: ProcessLineCost | null;
    inspection: ProcessLineCost | null;
    warnings: string[];
  } | null;
  /** The die, amortised over its life (die-tooling.ts); separate from the piece cost. */
  dieTooling?: DieToolingResult | null;
  /** How the die-casting process (HPDC / GDC) on this summary was chosen. */
  processChoice?: DieCastingProcessChoiceDto | null;
  /** Sand cores (coremaking.ts): their lines run before the casting line; coreboxes beside the die. */
  cores?: { lines: ProcessLineCost[]; corebox: { boxes: number; costUsd: number; perPartUsd: number | null; detail: string; run: CalculatorRunDto } | null; warnings: string[] } | null;
  /** Die casting: the calculators and the alloy the metal is computed from. */
  calculators?: ReferenceCalculators | null;
  alloy?: { name: string; densityKgM3: number | null; yieldLossFactor: number | null } | null;
  /** Die casting: melted metal per part (the Melting calculator); null when not derived. */
  meltedKg?: number | null;
  /** Calculator runs behind other values of this summary (trim force, ...). */
  calculatorRuns?: Record<string, CalculatorRunDto>;
}): CostSummaryDto {
  const warnings = [...input.warnings];
  const calculatorRuns: Record<string, CalculatorRunDto> = { ...(input.hpdc?.calculatorRuns ?? {}), ...(input.calculatorRuns ?? {}) };
  const dc = input.process === 'die_casting' ? input.hpdc : null;
  const isHpdc = dc?.processName === HPDC_PROCESS;

  // Die casting metal (user decisions 2026-10-04/05): metal melted beyond the
  // part returns to the furnace and is remelted in-house, so the charge is the
  // part metal x the alloy Yield Loss Factor (Gross Material Usage); the melted
  // metal is shown, not charged. Other casting processes: part volume x density.
  let netKg = 0;
  let chargedKg = 0;
  if (input.process === 'die_casting' && input.alloy) {
    const alloy = input.alloy;
    const net = runReferenceCalculator(input.calculators, 'Net Material Usage', {
      ...(input.partVolumeMm3 > 0 ? { 'Part Volume': castingSeed.cad(input.partVolumeMm3, 'part volume (mm³)') } : {}),
      ...(alloy.densityKgM3 != null && alloy.densityKgM3 > 0 ? { Density: castingSeed.alloy(alloy.name, 'Density (kg/m^3)', alloy.densityKgM3) } : {}),
    }, 'Net Usage');
    calculatorRuns['Net Material Usage'] = runView('Die Casting - Net Material Usage', 'Net Usage', net);
    if (net.value == null) warnings.push(`Part weight not derived (${net.missing.join('; ')}): material not costed.`);
    else {
      netKg = net.value;
      const gross = runReferenceCalculator(input.calculators, 'Gross Material Usage', {
        'Net Usage': castingSeed.calculator(net.value, 'Net Material Usage'),
        ...(alloy.yieldLossFactor != null ? { 'Yield Loss Factor': castingSeed.alloy(alloy.name, 'Yield Loss Factor', alloy.yieldLossFactor) } : {}),
      }, 'Gross Usage');
      calculatorRuns['Gross Material Usage'] = runView('Die Casting - Gross Material Usage', 'Gross Usage', gross);
      if (gross.value != null) chargedKg = gross.value;
      else {
        chargedKg = netKg;
        warnings.push(`Gross Material Usage not derived (${gross.missing.join('; ')}): the part metal is charged with no melt loss.`);
      }
    }
  } else {
    netKg = input.materialDensityKgM3 > 0 && input.partVolumeMm3 > 0 ? (input.partVolumeMm3 / 1e9) * input.materialDensityKgM3 : 0;
    chargedKg = netKg;
    if (netKg === 0) warnings.push('Part weight not derived (no part volume or no material density on file): material not costed.');
  }
  const meltedKg = dc ? input.meltedKg ?? null : null;
  if (dc && meltedKg != null && netKg > 0) {
    warnings.push(`${isHpdc ? 'Overflow and runner' : 'Gating and riser'} metal (${r3(meltedKg - netKg)} kg per part) returns to the furnace and is remelted in-house: not charged.`);
  }
  if (isHpdc) warnings.push('Biscuit metal not in the shot: memory/Die Casting gives the plunger diameter but no biscuit thickness.');
  const materialCost = chargedKg * input.materialCostPerKg;
  const grossKg = meltedKg ?? netKg;
  if (input.dieTooling) Object.assign(calculatorRuns, input.dieTooling.runs);
  if (input.cores?.corebox) calculatorRuns['Corebox'] = input.cores.corebox.run;

  let processLines: ProcessLineCost[];
  if (input.process === 'die_casting' && input.hpdc) {
    processLines = input.hpdc.processLines;
    warnings.push(...input.hpdc.warnings);
  } else {
    processLines = [unmodelledCastingLine(input.process)];
    warnings.push(`${PROCESS_LABEL[input.process]} has no cost engine yet: the line is shown, not priced.`);
  }

  // Route order: melt, cores (make, coat, dry), cast, trim, grind, clean, machine (deburr, bench), inspect.
  if (input.cores) {
    processLines = [...input.cores.lines, ...processLines];
    warnings.push(...input.cores.warnings);
  }
  if (input.finishing?.melting) processLines = [input.finishing.melting, ...processLines];
  if (input.finishing?.trim) processLines = [...processLines, input.finishing.trim];
  if (input.finishing?.grinding) processLines = [...processLines, input.finishing.grinding];
  if (input.finishing?.cleaning) processLines = [...processLines, input.finishing.cleaning];
  if (input.secondaryMachining) {
    processLines = [...processLines, ...input.secondaryMachining.lines];
    warnings.push(...input.secondaryMachining.warnings);
  }
  if (input.finishing?.inspection) processLines = [...processLines, input.finishing.inspection];
  if (input.finishing) warnings.push(...input.finishing.warnings);
  if (input.dieTooling) warnings.push(...input.dieTooling.warnings);

  const cav = input.process === 'die_casting' ? input.hpdc?.cavities ?? null : null;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const totalMin = processLines.reduce((s, l) => s + l.cycleTimeMin, 0);
  return {
    materialCost: r2(materialCost),
    materialGrade: input.materialGrade ?? 'Unknown',
    grossWeightKg: r3(grossKg),
    materialCostPerKg: input.materialCostPerKg,
    materialSource: input.materialSource,
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(materialCost + totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(totalMin) },
    batchSize: input.batchSize,
    family: input.family,
    sustainability: computeSustainability(input.materialGrade, input.materialCostPerKg, netKg, grossKg, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(input.dieTooling ? { dieTooling: dieToolingDto(input.dieTooling) } : {}),
    ...(input.processChoice ? { dieCastingProcess: input.processChoice } : {}),
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    ...(input.cores?.corebox ? {
      coreboxTooling: {
        boxes: input.cores.corebox.boxes, detail: input.cores.corebox.detail,
        costUsd: Math.round(input.cores.corebox.costUsd * 100) / 100,
        perPartUsd: input.cores.corebox.perPartUsd != null ? Math.round(input.cores.corebox.perPartUsd * 10000) / 10000 : null,
      },
    } : {}),
    ...(cav ? {
      dieCasting: {
        cavityCount: cav.count,
        cavityConstrainedBy: cav.constrainedBy,
        cavityLayouts: cav.layouts,
        defaultCavityCount: cav.defaultCount,
        requiredClampKn: input.hpdc!.requiredClampKn != null ? r2(input.hpdc!.requiredClampKn) : null,
        shotVolumeMm3: input.hpdc!.shotVolumeMm3 != null ? r2(input.hpdc!.shotVolumeMm3) : null,
        metal: {
          partKg: r3(netKg),
          chargedKg: r3(chargedKg),
          yieldLossFactor: input.hpdc!.yieldLossFactor,
          meltedKg: meltedKg != null ? r3(meltedKg) : null,
          returnedKg: meltedKg != null ? r3(meltedKg - netKg) : null,
        },
      },
    } : {}),
  };
}

const rn = (n: number | null, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

function dieToolingDto(t: DieToolingResult): DieToolingDto {
  return {
    ok: t.ok, reason: t.reason, dieSizeMm: t.dieSizeMm, pressForceKn: t.pressForceKn,
    complexity: t.complexity, featureCount: t.featureCount,
    steelKg: rn(t.steelKg), steelUsd: rn(t.steelUsd), designHr: rn(t.designHr), machiningHr: rn(t.machiningHr),
    assemblyHr: rn(t.assemblyHr), ejectorPins: t.ejectorPins, ejectorPinsUsd: rn(t.ejectorPinsUsd),
    labourUsd: rn(t.labourUsd), markupPct: t.markupPct, dieCostUsd: rn(t.dieCostUsd),
    shotsPerDie: t.shotsPerDie, diesRequired: t.diesRequired, totalToolingUsd: rn(t.totalToolingUsd),
    perPartUsd: rn(t.perPartUsd, 4), trace: t.trace,
  };
}
