import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UsageCalculatorForm } from '@/components/features/process-planning/UsageCalculatorForm';
import type { MaterialUsageExplanation } from '@/lib/api/hooks/useMaterialUsage';

const input = (displayLabel: string, value: number | string, unit: string | null, source: string) => ({ fieldName: displayLabel, displayLabel, kind: 'input' as const, value, unit, source });
const result = (displayLabel: string, value: number, unit: string, formula: string) => ({ fieldName: displayLabel, displayLabel, kind: 'calculated' as const, value, unit, formula });

// An investment casting: each figure is the result of a stored calculator.
const investment: MaterialUsageExplanation = {
  netUsage: 0.0399, grossUsage: 0.044074, scrapPct: 9.47, source: 'casting_charge',
  net: { title: 'Investment Casting - Metal per casting', calculatorId: 'c1', calculatorVersion: 2, estimate: false, trace: [input('Part Volume', 5178.74, 'mm³', 'part volume (mm³)'), input('Density', 7700, 'kg/m³', 'ASTM A217 Grade CA15: density_kg_m3'), result('Net Weight', 0.0399, 'kg', '{Part Volume} * 1e-9 * {Density}')] },
  gross: { title: 'Investment Casting - Material cost', calculatorId: 'c2', calculatorVersion: 1, estimate: false, trace: [input('Net Weight', 0.0399, 'kg', 'metal per casting'), input('Furnace Yield', 0.95, null, 'machine Induction Furnace: yield'), result('Melt Loss', 0.0035, 'kg', '{Poured Weight} / {Furnace Yield} - {Poured Weight}'), result('Bought Weight', 0.044074, 'kg', '{Net Weight} + {Melt Loss}')] },
  scrap: { title: 'Share of the gross usage that is not in the part', calculatorId: null, calculatorVersion: null, estimate: false, trace: [result('Scrap', 9.47, '%', '({Gross Usage} − {Net Usage}) ÷ {Gross Usage} × 100')] },
};
// A machined part: no stored calculator, the engine's own rule.
const machined: MaterialUsageExplanation = {
  ...investment, source: 'stock_blank',
  gross: { title: 'Weight of the stock the part is cut from', calculatorId: null, calculatorVersion: null, estimate: false, trace: [input('Stock Volume', 20000, 'mm³', 'volume of that stock'), result('Gross Usage', 0.154, 'kg', '{Stock Volume} × {Material Density} ÷ 1,000,000,000')] },
};
const html = (usage: MaterialUsageExplanation, target: 'netUsage' | 'grossUsage') => renderToStaticMarkup(createElement(UsageCalculatorForm, { usage, target, onUse: () => undefined }));

describe('usage calculator form', () => {
  it('opens the calculator behind the gross usage as a form: its name and version, each input as a field with its value and source', () => {
    const out = html(investment, 'grossUsage');
    expect(out).toContain('Investment Casting - Material cost');
    expect(out).toContain('v1');
    expect(out).toContain('Input Values');
    expect(out).toMatch(/<input[^>]*value="0.95"/);
    expect(out).toContain('machine Induction Furnace: yield');
    expect(out).not.toContain('Investment Casting - Metal per casting');
  });

  it('lists every result with its formula and offers the figure for the fields', () => {
    const out = html(investment, 'grossUsage');
    expect(out).toContain('Results');
    expect(out).toContain('Bought Weight');
    expect(out).toContain('0.044074');
    expect(out).toContain('= {Net Weight} + {Melt Loss}');
    expect(out).toContain('>Use<');
    expect(out).toContain('Use calculated values');
    expect(out).toContain('9.47 %');
  });

  it('the net usage button opens the net calculator', () => {
    const out = html(investment, 'netUsage');
    expect(out).toContain('Investment Casting - Metal per casting');
    expect(out).toMatch(/<input[^>]*value="7700"/);
    expect(out).not.toContain('9.47 %');
  });

  it('a process with no stored calculator shows the same form for the rule the engine applied, and says it is a rule', () => {
    const out = html(machined, 'grossUsage');
    expect(out).toContain('Weight of the stock the part is cut from');
    expect(out).toContain('Engine rule');
    expect(out).toMatch(/<input[^>]*value="20000"/);
  });
});
