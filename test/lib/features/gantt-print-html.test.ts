import { describe, expect, it } from 'vitest';

import { buildGanttPrintHtml, type GanttPrintInput } from '@/components/features/production-planning/gantt-print-html';
import { html, SafeHtml } from '@/lib/utils/escape-html';

const PAYLOAD = '<img src=x onerror="alert(1)">';
const ATTR = `x" onmouseover='alert(2)`;

function input(overrides: Partial<GanttPrintInput> = {}): GanttPrintInput {
  return {
    lotId: `lot-${PAYLOAD}`,
    viewMode: 'weekly',
    hasProcesses: true,
    showBom: true,
    totalTasks: 3,
    completedTasks: 1,
    now: new Date('2026-11-02T10:00:00Z'),
    sections: [
      {
        name: 'Process',
        subTasks: [
          {
            name: `Process: ${PAYLOAD}`,
            operatorName: PAYLOAD,
            status: ATTR,
            estimatedDuration: 4,
            actualDuration: 2,
            bomRequirements: [
              { partNumber: PAYLOAD, partName: `<script>alert(3)</script>`, requiredQuantity: 4, consumedQuantity: 1, unit: ATTR, status: ATTR },
            ],
          },
        ],
      },
      { name: 'Packing', subTasks: [] },
    ],
    ...overrides,
  };
}

// Regression: the print window of the production Gantt (ScheduleView export) is written with innerHTML in the app's origin, and
// operator, task, part and lot names are user-editable.
describe('buildGanttPrintHtml', () => {
  const page = buildGanttPrintHtml(input());

  it('renders every user value as text, never as markup', () => {
    expect(page).not.toContain('<img');
    expect(page).not.toContain('<script>alert');
    expect(page).not.toMatch(/onerror="/);
    expect(page).not.toMatch(/onmouseover='/);
    expect(page).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(page).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
  });

  it('cannot break out of an attribute through a BOM status', () => {
    // An unknown status falls back to a fixed class; the raw status is never written into the class attribute.
    expect(page).toContain('class="bom-available"');
    expect(page).not.toContain(`class="x"`);
  });

  it('keeps the page structure: one header per column, sections, sub-tasks and BOM rows', () => {
    expect(page.match(/<th style="border: 1px solid #e5e7eb/g)).toHaveLength(10);
    expect(page).toContain('Packing (No tasks)');
    expect(page).toContain('Total Tasks: 3 | Completed: 1');
    expect(page).toContain('<style>');
  });

  it('says there is nothing to show when the lot has no processes', () => {
    expect(buildGanttPrintHtml(input({ hasProcesses: false, viewMode: 'daily' }))).toContain('colspan="8"');
  });
});

describe('html', () => {
  it('escapes every interpolated value and keeps nested fragments', () => {
    const cell = html`<td>${PAYLOAD}</td>`;
    expect(html`<tr>${[cell, cell]}${ATTR}</tr>`.value).toBe(
      '<tr><td>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</td><td>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</td>x&quot; onmouseover=&#39;alert(2)</tr>',
    );
  });

  it('only trusts SafeHtml, not strings that look like markup', () => {
    expect(html`${'<b>'}${new SafeHtml('<b>')}`.value).toBe('&lt;b&gt;<b>');
  });
});
