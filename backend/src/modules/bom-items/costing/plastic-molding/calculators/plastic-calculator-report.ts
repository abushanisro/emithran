/**
 * The plastic-molding cycle-time calculators, written out for reading: per molding process, the feature lookup table of the reference catalog, the calculation
 * (every input with where it comes from, every formula) and what is not modelled. Built from the calculator spec, the reference catalog rows and the formula
 * registry, so it cannot disagree with any of them; docs/plastic-modeling/cycle-time-calculators.md is its output and a test fails when that file is stale.
 */
import { PLASTIC_FORMULAS, formulaById } from '../formula-registry';
import type { DomainCalculatorSpec, DomainFieldSource, DomainSpecCalculator } from '../../shared/calculators/domain-calculator-spec';
import { REGISTRY_FORMULA_OF_FIELD } from './plastic-calculator-formulas';

export interface ReportInput {
  spec: DomainCalculatorSpec;
  /** digital_factory_operations.csv by process: the compound strings, e.g. "Injection Molding:HoleSideCore//SimpleHole". */
  catalog: Record<string, string[]>;
  /** injectionTimeAdjustmentFactors rows: attribute, number, adjustment factor. */
  fillFactorRows: Array<{ attribute: string; number: number; factor: number }>;
}

const PROCESS_OF_OPERATION: Record<string, string> = {
  'Injection Molding': 'Injection Molding', 'Structural foam molding': 'Structural Foam Molding',
  'Compression Molding': 'Compression Molding', 'Reaction Injection Molding': 'Reaction Injection Molding',
};

const sourceText = (s: DomainFieldSource): string => {
  const [kind, value] = Object.entries(s)[0]!;
  const label: Record<string, string> = { cad: 'CAD', material: 'Material reference', machine: 'Machine record', variable: 'Reference variable', lookup: 'Lookup table', scenario: 'Scenario', engine: 'Cost engine' };
  return `${label[kind] ?? kind}: ${value}`;
};

const cell = (v: string) => v.replace(/\|/g, '\\|');

function featureTable(process: string, rows: readonly string[]): string[] {
  const byFeature = new Map<string, string[]>();
  for (const raw of rows) {
    const pair = raw.split(':').find((p) => p.includes('//'));
    if (!pair) continue;
    const [operation, feature] = pair.split('//').map((x) => x.trim()) as [string, string];
    (byFeature.get(feature) ?? byFeature.set(feature, []).get(feature)!).push(operation);
  }
  const out = [`| Feature type | Operations the reference lists for ${process} | Enters the cycle time |`, '|---|---|---|'];
  for (const [feature, ops] of [...byFeature].sort(([a], [b]) => a.localeCompare(b))) {
    const effect = feature === 'SlideBundle' || feature === 'LifterBundle' ? 'No: the slide and lifter cycle is not modelled (G-03)' : 'No';
    out.push(`| ${feature} | ${ops.sort().map(cell).join(', ')} | ${effect} |`);
  }
  return out;
}

function calculationTable(c: DomainSpecCalculator): string[] {
  const out = ['| # | Field | Unit | Input, or formula | Registry |', '|---|---|---|---|---|'];
  c.fields.forEach((f, i) => {
    const id = REGISTRY_FORMULA_OF_FIELD[c.key]?.[f.name];
    const entry = id ? formulaById(id) : undefined;
    const registry = entry ? `${entry.id} v${entry.version}, ${entry.state}` : '';
    const how = f.formula ? `\`${cell(f.formula)}\`` : sourceText(f.source!);
    out.push(`| ${i + 1} | ${f.name} | ${f.unit ?? ''} | ${cell(how)} | ${registry} |`);
  });
  return out;
}

export function buildPlasticCalculatorReport(input: ReportInput): string {
  const out: string[] = [];
  out.push('# Plastic molding: cycle-time calculators, feature lookup tables and how each cycle time is calculated');
  out.push('');
  out.push('Generated from `plastic-molding-calculators.json` (migration 975), `memory/Plastic Modeling/process/digital_factory_operations.csv`, `memory/Plastic Modeling/lookup/injectionTimeAdjustmentFactors` and the formula registry. Do not edit by hand: `npx ts-node --transpile-only scripts/generate-plastic-calculator-report.ts`; a test fails when this file is stale.');
  out.push('');
  out.push('Each of the four molding processes has one cycle-time calculator, stored in the database and mapped to its catalog operation in `process_calculator_mappings`, the way heat treatment, machining and die casting have theirs. A calculator is a list of fields: inputs, each with where its value comes from, and formulas over earlier fields, ending in **Cycle Time** (seconds). The cost engine supplies the inputs and the calculator holds the formulas.');
  out.push('');
  out.push('**Reading the feature tables.** The reference catalog lists, per process, the operations each feature type can need (`As Molded`, a core, a lifter, a slide, flash trimming). No feature enters any cycle-time formula today: the cycle depends on the material, the press, the wall and the shot size. The time slides and lifters add is not modelled because the reference stages their sizes and rates but no formula (G-03).');
  out.push('');

  const mapped = input.spec.calculators.filter((c) => !c.helper);
  const helper = input.spec.calculators.filter((c) => c.helper);
  for (const c of mapped) {
    const process = PROCESS_OF_OPERATION[c.operations[0]!]!;
    out.push(`## ${process}`);
    out.push('');
    out.push(`Calculator **${c.name}**, mapped to the catalog operation \`${c.operations[0]}\` (${c.fields.length} fields).`);
    out.push('');
    out.push(c.description);
    out.push('');
    out.push('### Feature lookup table');
    out.push('');
    out.push(...featureTable(process, input.catalog[process] ?? []));
    out.push('');
    out.push('### How the cycle time is calculated');
    out.push('');
    out.push(...calculationTable(c));
    out.push('');
    if (c.fields.some((f) => f.name === 'Fill Factor for Cavities')) {
      out.push('Lookup table behind the two fill factors, `injectionTimeAdjustmentFactors` (the first row whose Number is at least the value is used; the last row covers the rest):');
      out.push('');
      out.push('| Attribute | Number (up to) | Adjustment factor |');
      out.push('|---|---|---|');
      for (const r of input.fillFactorRows) out.push(`| ${r.attribute} | ${r.number} | ${r.factor} |`);
      out.push('');
    }
    if (c.name === 'Injection Molding - Cycle Time') {
      const lsr = helper[0]!;
      out.push(`For a liquid silicone rubber the engine uses **${lsr.name}** instead (cure replaces cooling, no pack phase); no catalog operation maps to it:`);
      out.push('');
      out.push(...calculationTable(lsr));
      out.push('');
    }
  }

  out.push('## Not modelled (registry entries marked UNSUPPORTED)');
  out.push('');
  out.push('| Id | Item | Staged in memory/ | State |');
  out.push('|---|---|---|---|');
  for (const f of PLASTIC_FORMULAS.filter((x) => x.state === 'UNSUPPORTED')) out.push(`| ${f.id} | ${cell(f.name)} | ${cell(f.stagedData ?? '')} | ${f.state} |`);
  out.push('');
  return out.join('\n');
}
