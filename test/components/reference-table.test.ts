import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReferenceTable } from '@/components/features/process-planning/ReferenceTable';
import { variablePanel } from '@/lib/calculators/input-source';

// The sand-casting variables panel as the Process dialog opens it for Ambient Temperature: long notes on some rows.
const panel = variablePanel({ kind: 'variable', domain: 'sand_casting', name: 'ambientTemp' } as never, [
  { key: 'Melting', category: 'Process', value: '1', unitType: null, notes: 'A process flag with a long explanation that runs on and on. '.repeat(6) },
  { key: 'ambientTemp', category: 'Temperature', value: '21', unitType: 'Temperature', notes: null },
]);
const html = renderToStaticMarkup(createElement(ReferenceTable, {
  columns: panel.column_definitions,
  rows: panel.rows,
  fieldLabel: 'Ambient Temperature (°C)',
  isCurrent: (row: Record<string, unknown>) => row.key === 'ambientTemp',
  onPick: () => undefined,
}));
const headers = [...html.matchAll(/<th class="([^"]*)">(.*?)<\/th>/g)];

describe('ReferenceTable', () => {
  it('pins the value column to the right edge, so it is in view however wide the notes are', () => {
    const value = headers.find(([, , text]) => text?.startsWith('Value'));
    expect(value?.[1]).toContain('sticky');
    expect(value?.[1]).toContain('right-0');
    expect(html).toMatch(/<td class="[^"]*sticky right-0[^"]*">21<\/td>/);
  });

  it('wraps long text cells instead of widening the table', () => {
    expect(html).toMatch(/<td class="[^"]*max-w-\[22rem\] whitespace-normal[^"]*">A process flag/);
    expect(html).not.toMatch(/<td class="[^"]*whitespace-nowrap[^"]*">A process flag/);
  });

  it('says in one sentence which column is picked and for which input, and marks the row in use', () => {
    expect(html).toContain('Click a row to use its <strong class="text-primary">Value</strong> for <strong class="text-foreground">Ambient Temperature (°C)</strong>.');
    expect(html).toContain('>★</td>');
  });

  it('an empty cell is a dash', () => {
    expect(html).toContain('>—</td>');
  });
});
