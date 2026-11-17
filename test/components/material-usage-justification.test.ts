import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MaterialUsageJustification } from '@/components/features/process-planning/MaterialUsageJustification';
import type { MaterialUsageExplanation } from '@/lib/api/hooks/useMaterialUsage';
import { formatKg, usageDrift } from '@/lib/costing/material-usage-view';

const input = (displayLabel: string, value: number | string, unit: string | null, source: string) => ({ fieldName: displayLabel, displayLabel, kind: 'input' as const, value, unit, source });
const result = (displayLabel: string, value: number, unit: string, formula: string) => ({ fieldName: displayLabel, displayLabel, kind: 'calculated' as const, value, unit, formula });

// A sand casting: the net weight from the metal calculator, the gross usage from the material-cost calculator's Bought Weight.
const sand: MaterialUsageExplanation = {
  netUsage: 0.0391, grossUsage: 0.040754, scrapPct: 4.06, source: 'casting_charge',
  net: { title: 'Sand Casting - Metal per casting', calculatorId: 'c1', calculatorVersion: 3, estimate: false, trace: [input('Volume (mm³)', 14488.11, 'mm³', 'part volume (mm³)'), input('Density (kg/m³)', 2700, 'kg/m³', 'Aluminum, ANSI 6061: density_kg_m3'), result('Net Weight (kg)', 0.0391, 'kg', '{Volume} / 1e9 * {Density}')] },
  gross: { title: 'Sand Casting - Material cost', calculatorId: 'c2', calculatorVersion: 1, estimate: false, trace: [input('Furnace Yield Loss Factor', 0.98, null, 'machine Induction Furnace'), result('Bought Weight (kg)', 0.0408, 'kg', '{Net Weight} + {Melt Loss}')] },
  scrap: { title: 'Share of the gross usage that is not in the part', calculatorId: null, calculatorVersion: null, estimate: false, trace: [result('Scrap', 4.06, '%', '({Gross Usage} − {Net Usage}) ÷ {Gross Usage} × 100')] },
};
const html = (usage: MaterialUsageExplanation | undefined, fields = { net: 0.0391 as number | '', gross: 0.0408 as number | '' }, loading = false) =>
  renderToStaticMarkup(createElement(MaterialUsageJustification, { usage, loading, fields, onUse: () => undefined }));

describe('material usage justification', () => {
  it('names the calculator behind each figure and lists every input with its value and where it came from', () => {
    const out = html(sand);
    expect(out).toContain('Sand Casting - Metal per casting');
    expect(out).toContain('Calculator v3');
    expect(out).toContain('14488.11 mm³');
    expect(out).toContain('Aluminum, ANSI 6061: density_kg_m3');
    expect(out).toContain('Sand Casting - Material cost');
    expect(out).toContain('0.0408 kg');
    expect(out).toContain('= {Net Weight} + {Melt Loss}');
    expect(out).toContain('Casting metal');
  });

  it('offers to fill the fields, and stays quiet when they already hold the calculated values', () => {
    const out = html(sand);
    expect(out).toContain('Use calculated values');
    expect(out).not.toContain('the costing now calculates');
  });

  it('says so when the record holds other values than the costing now calculates', () => {
    const out = html(sand, { net: 0.0391, gross: 0.0177 });
    expect(out).toContain('Gross usage here is 0.0177 kg; the costing now calculates 0.0408 kg.');
    expect(out).not.toContain('Net usage here');
  });

  it('marks an allowance as an estimate', () => {
    const estimate: MaterialUsageExplanation = { ...sand, source: 'scrap_allowance_fallback', gross: { ...sand.gross, title: 'Net usage plus a scrap allowance', calculatorId: null, estimate: true } };
    const out = html(estimate);
    expect(out).toContain('Estimate');
    expect(out).toContain('Estimate: no stock, nest or charge yet');
  });

  it('asks for the usage by hand when nothing can be derived, with no button and no working', () => {
    const none: MaterialUsageExplanation = { netUsage: 0, grossUsage: 0, scrapPct: 0, source: 'none', net: { title: 'Not derived: the part has no volume, weight or costed material', calculatorId: null, calculatorVersion: null, estimate: false, trace: [] }, gross: sand.scrap, scrap: sand.scrap };
    const out = html(none, { net: '', gross: '' });
    expect(out).toContain('Not derived: the part has no volume, weight or costed material. Enter the usage by hand.');
    expect(out).not.toContain('Use calculated values');
  });

  it('shows that it is calculating while the costing runs, and nothing before there is an answer', () => {
    expect(html(undefined, { net: '', gross: '' }, true)).toContain('Calculating the usage');
    expect(html(undefined, { net: '', gross: '' })).toBe('');
  });
});

describe('usageDrift', () => {
  it('ignores a difference within 1 % and an empty field', () => {
    expect(usageDrift(sand, { net: 0.0392, gross: '' })).toEqual([]);
    expect(usageDrift(sand, { net: 0, gross: 0 })).toEqual([]);
  });

  it('reports each field that is off by more than 1 %', () => {
    expect(usageDrift(sand, { net: 0.05, gross: 0.06 }).map((d) => d.field)).toEqual(['Net usage', 'Gross usage']);
  });
});

describe('formatKg', () => {
  it('keeps four decimals for a light part and drops trailing zeros', () => {
    expect(formatKg(0.040754)).toBe('0.0408');
    expect(formatKg(0.5)).toBe('0.5');
    expect(formatKg(12.34567)).toBe('12.346');
  });
});
