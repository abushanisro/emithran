// Closed-die hot forging: the material, the route's process lines and the die
// amortisation for one part. Pure. Phase 1 of the forging domain
// (docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE_v1.1.md): it is not in
// the process registry and nothing on the quote path calls it.
//
// Costed from memory/Forging (migration 823) and the Forging raw materials
// (migration 855):
//   material   net, flash, scale, kerf and gross weight on the cheapest valid
//              round bar (forging-weights.ts, forging-stock.ts)
//   tooling    die sets from tool life, per part (forging-tooling.ts), on
//              entered die costs
// Not costed, each returned as a gap line naming what memory lacks:
//   Band Saw   cut-code -> forging_bandSawCutting family rule and the row rule
//              outside the table (v1.1 D8)
//   Heat       induction heat-time section term and coil throughput; furnace
//              heat-time model (v1.1 6.8)
//   Forge      closed-die force / hammer energy formulas, strain rate and the
//              hits adjustment, so no machine's capability or cycle can be
//              decided (v1.1 6.7-6.8)
//   Trim       trim force formula (v1.1 6.9)
// The inputs memory does not derive (complexity score, heating method, forge
// machine class, die costs, volumes) are the caller's; none has a default.
//
// A gap line costs 0, so the sum of a result with gaps is a partial figure,
// not a quote. costStatus says which (the CostStatus convention of
// cost-breakdown.dto.ts and bom-items.service.ts): 'incomplete' when any
// process line has a physicsGap (listed in incompleteProcesses) or anything
// else is not costed (material, scrap credit, a die; listed in gaps). Callers
// gate on it before showing a total.

import { FORGING_STEPS, forgingGapLine, type ForgeClass } from './forging-line';
import { chooseRoundBar, type BarCheck } from './forging-stock';
import { amortiseForgingDie, type DieAmortisation } from './forging-tooling';

import type { ForgingMaterial, ForgingReference } from './forging-reference';
import type { ForgingWeights, HeatingMethod, TraceStep } from './forging-weights';
import type { CostStatus, ProcessLineCost } from '../../dto/cost-breakdown.dto';

export interface ForgingMaterialCost {
  weights: ForgingWeights;
  /** Gross material cost (USD per part). */
  grossCostUsd: number;
  /** Scrap credit (USD per part): 0 when enableScrapMaterialCredit is false; null when it cannot be derived. */
  scrapCreditUsd: number | null;
  /** Gross cost less scrap credit; null when the credit cannot be derived. */
  netMaterialCostUsd: number | null;
}

export interface ClosedDieForgingResult {
  /** 'incomplete' when any line is a gap line or anything in `gaps` is not costed: the total is then partial. */
  costStatus: CostStatus;
  /** Process name of every gap line (a physicsGap), in route order. */
  incompleteProcesses: string[];
  material: ForgingMaterialCost | null;
  barChecks: BarCheck[];
  processLines: ProcessLineCost[];
  forgeDie: DieAmortisation | null;
  trimDie: DieAmortisation | null;
  /** Everything not costed, by name. */
  gaps: string[];
  trace: TraceStep[];
  warnings: string[];
}

export interface DieInput {
  dieCostUsd: number | null;
  replacementDieCostUsd: number | null;
  coating: string | null;
}

const NOT_IN_MEMORY = {
  bandSaw: 'Band Saw cut time not derivable: memory gives cutting rates by Material Cut Code Family (forging_bandSawCutting) but not how a material Cut Code maps to a family, nor which row applies outside the table (v1.1 D8).',
  inductionHeat: 'Conveyor Induction Heat time not derivable: forging_inductionHeating gives a Heat Time Coefficient (s/mm²) but not the section it multiplies (diameter² or bar area), nor how many mults the coil holds (v1.1 6.8, D1).',
  furnaceHeat: 'Preheat time not derivable: the furnace heat-transfer model behind ovenTemperatureOffset, numTemperatureIntervals and ovenPartSpacingFactor is not in memory (v1.1 6.8).',
  press: 'Press not costed: the closed-die forging force formula, the strain rate for flow stress and the hits adjustment (baseNumberOfHits by partMultHeightRatio / materialTypeMultiplier) are not in memory, so no press can be checked for force or given a cycle (v1.1 6.7, 6.8).',
  mechanicalPress: 'Mechanical Press not costed: the required forging force and the die-block sizing for the table and shut height are not in memory, so no press can be checked as capable (v1.1 6.7); its stroke rate alone does not decide the line.',
  hammer: 'Hammer not costed: the blow-energy formula using the Impact Energy Factor (forging_materialTypeFactor) and the hits adjustment are not in memory, so no hammer can be checked for energy or given a cycle (v1.1 6.7, 6.8).',
  trim: 'Trim not costed: the trim force formula is not in memory, so no trim press can be checked as capable (v1.1 6.9).',
} as const;

export function computeClosedDieForging(input: {
  reference: ForgingReference | null;
  referenceMissing: string[];
  material: ForgingMaterial | null;
  materialGrade: string | null;
  partVolumeMm3: number | null;
  complexityScore: number | null;
  heating: HeatingMethod | null;
  forgeClass: ForgeClass | null;
  annualVolume: number | null;
  productionLifeYears: number | null;
  forgeDie: DieInput;
  trimDie: DieInput;
}): ClosedDieForgingResult {
  const trace: TraceStep[] = [];
  const warnings: string[] = [];
  const gaps: string[] = [];
  type Costed = Omit<ClosedDieForgingResult, 'costStatus' | 'incompleteProcesses' | 'gaps' | 'trace' | 'warnings'>;
  const out = (rest: Partial<Costed>): ClosedDieForgingResult => {
    const r: Costed = { material: null, barChecks: [], processLines: [], forgeDie: null, trimDie: null, ...rest };
    // The same rule as bom-items.service.ts (costStatus), plus the non-line gaps.
    const incompleteProcesses = r.processLines.filter((l) => !!l.physicsGap).map((l) => l.process);
    const costStatus: CostStatus = incompleteProcesses.length > 0 || gaps.length > 0 ? 'incomplete' : 'complete';
    return { costStatus, incompleteProcesses, ...r, gaps, trace, warnings };
  };

  if (!input.reference) {
    gaps.push(`Forging reference data not staged: ${input.referenceMissing.join(', ')} (migration 823).`);
    return out({});
  }
  if (!input.material) {
    gaps.push(`Material "${input.materialGrade ?? '(none)'}" is not a Forging material in Raw Materials (material group Forging, migration 855).`);
    return out({});
  }
  const ref = input.reference;
  const mat = input.material;
  trace.push({ label: 'Material', value: `${mat.name} (${mat.materialType ?? 'type not on file'})` });

  // ── Material ───────────────────────────────────────────────────────────────
  let material: ForgingMaterialCost | null = null;
  const stock = chooseRoundBar({ reference: ref, material: mat, partVolumeMm3: input.partVolumeMm3, complexityScore: input.complexityScore, heating: input.heating });
  if (!stock.ok) gaps.push(`Material not costed: ${stock.reason}`);
  else {
    const w = stock.chosen;
    trace.push(...stock.trace);
    let scrapCreditUsd: number | null = 0;
    if (ref.switches.enableScrapMaterialCredit) {
      scrapCreditUsd = null;
      gaps.push('Scrap credit not derivable: enableScrapMaterialCredit is true, but memory does not define how "Scrap Cost Percent" values flash and kerf scrap (v1.1 6.6).');
    } else {
      trace.push({ label: 'Scrap credit', value: 'none: enableScrapMaterialCredit is false' });
    }
    material = {
      weights: w,
      grossCostUsd: w.grossCostUsd,
      scrapCreditUsd,
      netMaterialCostUsd: scrapCreditUsd == null ? null : w.grossCostUsd - scrapCreditUsd,
    };
    warnings.push('Material excludes bar-end loss over a stock length: memory names standardStockLength and multLengthElongationFactor but not their formula (v1.1 6.5).');
  }

  // ── Process lines ──────────────────────────────────────────────────────────
  const processLines: ProcessLineCost[] = [];
  const gapLine = (key: keyof typeof NOT_IN_MEMORY) => {
    processLines.push(forgingGapLine(FORGING_STEPS[key], NOT_IN_MEMORY[key]));
    gaps.push(NOT_IN_MEMORY[key]);
  };
  gapLine('bandSaw');
  if (input.heating === 'induction') gapLine('inductionHeat');
  else if (input.heating === 'furnace') gapLine('furnaceHeat');
  else {
    const reason = 'Heating method (induction or furnace) not chosen.';
    processLines.push(forgingGapLine({ process: 'Heat', machineClass: 'forging_heat' }, reason));
    gaps.push(reason);
  }
  if (input.forgeClass) gapLine(input.forgeClass);
  else {
    const reason = 'Forge machine class (Press, Mechanical Press or Hammer) not chosen: route selection needs the force and energy formulas memory does not hold (v1.1 6.12).';
    processLines.push(forgingGapLine({ process: 'Forge', machineClass: 'forging' }, reason));
    gaps.push(reason);
  }
  gapLine('trim');

  // ── Tooling ────────────────────────────────────────────────────────────────
  const amortise = (kind: 'press' | 'mechanicalPress' | 'hammer' | 'trim', die: DieInput) => {
    const a = amortiseForgingDie({ reference: ref, kind, ...die, annualVolume: input.annualVolume, productionLifeYears: input.productionLifeYears });
    warnings.push(...a.warnings);
    if (a.amortised) trace.push(...a.trace.map((t) => ({ label: `${kind === 'trim' ? 'Trim die' : 'Forge die'}: ${t.label}`, value: t.value })));
    else gaps.push(`${kind === 'trim' ? 'Trim die' : 'Forge die'}: ${a.reason}`);
    return a;
  };
  let forgeDie: DieAmortisation | null = null;
  if (input.forgeClass) forgeDie = amortise(input.forgeClass, input.forgeDie);
  else gaps.push('Forge die not amortised: forge machine class not chosen (its tool life is per class).');
  const trimDie = amortise('trim', input.trimDie);

  return out({ material, barChecks: stock.checks, processLines, forgeDie, trimDie });
}
