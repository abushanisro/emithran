/**
 * Writes docs/plastic-modeling/cycle-time-calculators.md: the plastic-molding cycle-time calculators with each process's feature lookup table and the
 * calculation behind every cycle time. Reads the calculator spec, memory/Plastic Modeling (the operation catalog and the fill-factor table) and the formula
 * registry. Re-run after changing any of them:
 *   npx ts-node --transpile-only scripts/generate-plastic-calculator-report.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildPlasticCalculatorReport } from '../src/modules/bom-items/costing/plastic-molding/calculators/plastic-calculator-report';
import { loadPlasticMoldingCalculatorSpec } from '../src/modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';

const MEMORY = join(__dirname, '../../memory/plastic modeling');

function csv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h.trim(), r[i] ?? ''])));
}
const read = (rel: string) => csv(readFileSync(join(MEMORY, rel), 'utf8').replace(/^﻿/, ''));

const catalog: Record<string, string[]> = {};
for (const r of read('process/digital_factory_operations.csv')) (catalog[r['process']!] ??= []).push(r['processName']!);
const fillFactorRows = read('lookup/injectionTimeAdjustmentFactors__records.csv').map((r) => ({ attribute: r['attribute']!, number: Number(r['number']), factor: Number(r['adjustment_factor']) }));

const OUT = join(__dirname, '../../docs/plastic-modeling/cycle-time-calculators.md');
writeFileSync(OUT, buildPlasticCalculatorReport({ spec: loadPlasticMoldingCalculatorSpec(), catalog, fillFactorRows }));
console.log(`wrote ${OUT}`);
