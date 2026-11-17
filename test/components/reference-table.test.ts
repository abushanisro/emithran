import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReferenceTable } from '@/components/features/process-planning/ReferenceTable';
import { variablePanel } from '@/lib/calculators/input-source';

// The sand-casting variables panel as the Process dialog opens it for Ambient Temperature: long notes on some rows.
const panel = variablePanel({ kind: 'variable', domain: 'sand_casting', name: 'ambientTemp' } as never, [
  { key: 'pouringTempMargin', category: 'variable', value: '1', unitType: null, notes: 'A process flag with a long explanation that runs on and on. '.repeat(6) },
  { key: 'ambientTemp', category: 'variable', value: '21', unitType: 'Temperature', notes: null },
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

  it('fits every column in the panel: the table is laid out to column shares and long text wraps in its own column', () => {
    expect(html).toContain('<table class="w-full table-fixed');
    expect(html.match(/<col /g)).toHaveLength(5); // the row number and the four columns
    expect(html).toMatch(/<td class="[^"]*break-words[^"]*">A process flag/);
    expect(html).not.toMatch(/whitespace-nowrap/);
  });

  it('the pinned value cell is opaque on the row in use too, so nothing scrolled under it shows through', () => {
    expect(html).toMatch(/<td class="[^"]*sticky right-0[^"]*bg-background[^"]*">21<\/td>/);
  });

  it('says in one sentence which column is picked and for which input, and marks the row in use', () => {
    expect(html).toContain('Click a row to use its <strong class="text-primary">Value</strong> for <strong class="text-foreground">Ambient Temperature (°C)</strong>.');
    expect(html).toContain('>★</td>');
  });

  it('an empty cell is a dash', () => {
    expect(html).toContain('>—</td>');
  });
});
