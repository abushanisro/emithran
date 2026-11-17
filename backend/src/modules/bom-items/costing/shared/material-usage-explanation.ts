import type { CalculationTraceStep, CalculatorRunDto } from '../../dto/cost-breakdown.dto';

import { deriveMaterialUsage, FALLBACK_SCRAP_PCT, type DeriveMaterialUsageInput, type MaterialUsage } from './material-usage';

/** How one usage figure of a Raw Material record was reached: the calculator or rule, and every value it read with where it came from. */
export interface UsageJustification {
  /** The reference calculator that ran ("Die Casting - Net Material Usage"), or the rule in words when no calculator exists for it. */
  title: string;
  calculatorId: string | null;
  calculatorVersion: number | null;
  /** Inputs first, the result last: the same steps the calculator dialog shows for a process line. */
  trace: CalculationTraceStep[];
  /** True when the figure is a stated allowance, not a result of the engine: the dialog says so. */
  estimate: boolean;
}

export interface MaterialUsageExplanation extends MaterialUsage {
  net: UsageJustification;
  gross: UsageJustification;
  scrap: UsageJustification;
}

export interface ExplainMaterialUsageInput extends DeriveMaterialUsageInput {
  /** The cost summary's calculator runs: a casting's usage is the result of two of them. */
  calculatorRuns?: Record<string, CalculatorRunDto> | null;
  /** Plastic molding: the runner system the part was costed with (the allowance on the part weight depends on it). */
  runnerSystem?: 'hot' | 'cold' | null;
}

const input = (label: string, value: number | string | null | undefined, unit: string | null, source: string): CalculationTraceStep =>
  ({ fieldName: label, displayLabel: label, kind: 'input', value: value ?? null, unit, source });
const result = (label: string, value: number, unit: string | null, formula: string): CalculationTraceStep =>
  ({ fieldName: label, displayLabel: label, kind: 'calculated', value, unit, formula });
const rule = (title: string, trace: CalculationTraceStep[], estimate = false): UsageJustification =>
  ({ title, calculatorId: null, calculatorVersion: null, trace, estimate });

/** Two weights are the same figure when they agree within rounding of the last digit the engine reports. */
const sameKg = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.0005, Math.abs(b) * 0.005);

/**
 * A calculator run as the working behind a usage figure: its steps up to the one that yields the figure (the run's own output, or the named step of a
 * run that goes on to compute something else). Null when the run did not yield this figure: a working that ends in another number explains nothing.
 */
function fromRun(run: CalculatorRunDto | undefined, usageKg: number, step?: string): UsageJustification | null {
  if (!run) return null;
  const at = run.trace.findIndex((t) => t.kind === 'calculated' && t.fieldName === (step ?? run.output));
  const value = at >= 0 ? Number(run.trace[at]!.value) : NaN;
  if (!Number.isFinite(value) || !sameKg(value, usageKg)) return null;
  return { title: run.name, calculatorId: run.calculatorId, calculatorVersion: run.calculatorVersion, trace: workingOf(run.trace, at), estimate: false };
}

/**
 * The steps of a calculator that the step at `at` is computed from, in the calculator's order: the fields its formula names, and the fields theirs
 * name. A run that goes on to price the metal also reads a price and a yield; they are not part of how the weight was reached.
 */
function workingOf(trace: CalculationTraceStep[], at: number): CalculationTraceStep[] {
  const fields = (formula: string | undefined) => [...(formula ?? '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  const needed = new Set(fields(trace[at]!.formula));
  // A result with no formula on record cannot be traced back: every earlier step is kept.
  if (needed.size === 0) return trace.slice(0, at + 1);
  const keep = new Set<number>([at]);
  for (let i = at - 1; i >= 0; i--) {
    const step = trace[i]!;
    if (step.kind !== 'calculated' || !needed.has(step.fieldName)) continue;
    keep.add(i);
    for (const f of fields(step.formula)) needed.add(f);
  }
  return trace.filter((step, i) => keep.has(i) || (i < at && step.kind === 'input' && needed.has(step.fieldName)));
}

const NET = 'Net Usage';
const GROSS = 'Gross Usage';

/** Part volume x density, the weight of the finished part: the net figure wherever no calculator computed one. */
function partWeight(input_: ExplainMaterialUsageInput, netKg: number, engine: string): UsageJustification {
  const { itemVolumeMm3, densityKgM3 } = input_;
  const density = input_.blankSpec?.densityKgM3 ?? densityKgM3;
  if (itemVolumeMm3 && density) {
    return rule('Weight of the finished part', [
      input('Part Volume', itemVolumeMm3, 'mm³', 'CAD analysis of the part'),
      input('Material Density', density, 'kg/m³', "the material's row in the material library"),
      result(NET, netKg, 'kg', '{Part Volume} × {Material Density} ÷ 1,000,000,000'),
    ]);
  }
  return rule('Weight of the finished part', [result(NET, netKg, 'kg', engine)]);
}

/**
 * The usage `deriveMaterialUsage` returns, with the working behind each figure. The numbers are that function's own: this adds no second derivation, only
 * the values each branch read, so the record, the cost summary and the explanation cannot disagree.
 */
export function explainMaterialUsage(input_: ExplainMaterialUsageInput): MaterialUsageExplanation {
  const usage = deriveMaterialUsage(input_);
  const { blankSpec, calculatorRuns } = input_;
  const scrap = rule(usage.source === 'scrap_allowance_fallback' ? 'Scrap allowance' : 'Share of the gross usage that is not in the part', usage.source === 'scrap_allowance_fallback'
    ? [input('Scrap Allowance', FALLBACK_SCRAP_PCT, '%', 'standing allowance used when the engine has no stock, nest or charge for the part')]
    : [
      input(GROSS, usage.grossUsage, 'kg', 'the gross usage above'),
      input(NET, usage.netUsage, 'kg', 'the net usage above'),
      result('Scrap', usage.scrapPct, '%', '({Gross Usage} − {Net Usage}) ÷ {Gross Usage} × 100'),
    ], usage.source === 'scrap_allowance_fallback');

  switch (usage.source) {
    case 'sheet_nesting': {
      const sheet = blankSpec?.sheetWidthMm && blankSpec.sheetLengthMm ? `${blankSpec.sheetWidthMm} × ${blankSpec.sheetLengthMm} mm` : blankSpec?.sizeLabel ?? null;
      const nested = blankSpec?.sheetWeightKg != null && blankSpec.partsPerSheet != null;
      return {
        ...usage, scrap,
        net: rule('Weight of the flat blank', [result(NET, usage.netUsage, 'kg', 'flat pattern area × sheet thickness × material density (sheet-metal engine)')]),
        gross: rule(blankSpec?.nestingMethod === 'true_shape' ? 'Sheet nesting (true shape)' : 'Sheet nesting', nested ? [
          input('Sheet', sheet, null, blankSpec?.sheetSource ?? 'standard sheet chosen by the nesting engine'),
          input('Sheet Weight', blankSpec!.sheetWeightKg!, 'kg', 'sheet area × thickness × material density'),
          input('Parts per Sheet', blankSpec!.partsPerSheet!, null, blankSpec?.nestingDimensionConfidence === 'verified' ? "nested on the part's CAD flat pattern" : "nested on the part's folded bounding box (flat pattern not available)"),
          result(GROSS, usage.grossUsage, 'kg', '{Sheet Weight} ÷ {Parts per Sheet}'),
        ] : [result(GROSS, usage.grossUsage, 'kg', 'sheet weight ÷ parts per sheet (sheet-metal engine)')]),
      };
    }
    case 'casting_charge': {
      // Die casting has a calculator for each figure. Sand casting buys the part metal, the melt loss and the gating and risers that are not remelted:
      // the Bought Weight of its material-cost calculator (which goes on to price it).
      const net = fromRun(calculatorRuns?.['Net Material Usage'], usage.netUsage)
        ?? fromRun(calculatorRuns?.['Sand metal per casting'], usage.netUsage, 'Net Weight');
      const gross = fromRun(calculatorRuns?.['Gross Material Usage'], usage.grossUsage)
        ?? fromRun(calculatorRuns?.['Sand material cost'], usage.grossUsage, 'Bought Weight');
      const melted = usage.grossUsage > usage.netUsage;
      return {
        ...usage, scrap,
        net: net ?? partWeight(input_, usage.netUsage, 'part metal (casting engine)'),
        gross: gross ?? rule('Metal charged per casting', [
          input(NET, usage.netUsage, 'kg', 'the net usage above'),
          result(GROSS, usage.grossUsage, 'kg', melted ? 'part metal plus the melt loss the casting engine charges' : 'the part metal: this casting process has no melt loss factor on file'),
        ]),
      };
    }
    case 'stock_blank':
      return {
        ...usage, scrap,
        net: partWeight(input_, usage.netUsage, 'part volume × material density (machining engine)'),
        gross: rule('Weight of the stock the part is cut from', blankSpec?.stockVolumeMm3 != null && blankSpec.densityKgM3 != null ? [
          input('Stock', blankSpec.sizeLabel, null, `the smallest ${blankSpec.form.replace(/_/g, ' ')} that contains the part with its machining allowance`),
          input('Stock Volume', blankSpec.stockVolumeMm3, 'mm³', 'volume of that stock'),
          input('Material Density', blankSpec.densityKgM3, 'kg/m³', "the material's row in the material library"),
          result(GROSS, usage.grossUsage, 'kg', '{Stock Volume} × {Material Density} ÷ 1,000,000,000'),
        ] : [
          input('Stock', blankSpec?.sizeLabel ?? null, null, 'the stock the machining engine chose'),
          result(GROSS, usage.grossUsage, 'kg', 'stock volume × material density (machining engine)'),
        ]),
      };
    case 'molding_allowance': {
      const allowancePct = Math.round((usage.grossUsage / usage.netUsage - 1) * 1000) / 10;
      return {
        ...usage, scrap,
        net: partWeight(input_, usage.netUsage, 'part volume × material density (molding engine)'),
        gross: rule('Material charged per molded part', [
          input(NET, usage.netUsage, 'kg', 'the net usage above'),
          input('Runner Allowance', allowancePct, '%', `${input_.runnerSystem === 'hot' ? 'hot' : 'cold'} runner: the molding engine's allowance on the part weight for the sprue and runner (the reference data has no runner length rule to size it from)`),
          result(GROSS, usage.grossUsage, 'kg', '{Net Usage} × (1 + {Runner Allowance} ÷ 100)'),
        ]),
      };
    }
    case 'scrap_allowance_fallback': {
      const netFirst = !!(input_.itemVolumeMm3 && input_.densityKgM3) || (input_.cadWeightKg != null && input_.cadWeightKg > 0);
      const net = input_.itemVolumeMm3 && input_.densityKgM3
        ? partWeight(input_, usage.netUsage, '')
        : netFirst
          ? rule('Weight of the finished part', [input(NET, usage.netUsage, 'kg', 'weight recorded on the part')])
          : rule('Gross usage less the scrap allowance', [
            input(GROSS, usage.grossUsage, 'kg', 'gross weight per part from the cost engine'),
            input('Scrap Allowance', FALLBACK_SCRAP_PCT, '%', 'standing allowance'),
            result(NET, usage.netUsage, 'kg', '{Gross Usage} × (1 − {Scrap Allowance} ÷ 100)'),
          ], true);
      const gross = netFirst
        ? rule('Net usage plus a scrap allowance', [
          input(NET, usage.netUsage, 'kg', 'the net usage above'),
          input('Scrap Allowance', FALLBACK_SCRAP_PCT, '%', 'standing allowance: the engine has no stock, nest or charge for this part'),
          result(GROSS, usage.grossUsage, 'kg', '{Net Usage} ÷ (1 − {Scrap Allowance} ÷ 100)'),
        ], true)
        : rule('Gross weight per part', [input(GROSS, usage.grossUsage, 'kg', 'gross weight per part from the cost engine')]);
      return { ...usage, scrap, net, gross };
    }
    case 'none':
    default: {
      const nothing = rule('Not derived: the part has no volume, weight or costed material', []);
      return { ...usage, scrap: nothing, net: nothing, gross: nothing };
    }
  }
}
