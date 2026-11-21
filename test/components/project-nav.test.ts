import { describe, expect, it } from 'vitest';

import { getProjectNavTabs, isProjectNavTabActive } from '@/components/features/projects/ProjectNav';

const id = 'p1';
const tabs = getProjectNavTabs(id);
const activeLabels = (pathname: string) =>
  tabs.filter((tab) => isProjectNavTabActive(tab, pathname)).map((tab) => tab.label);

describe('ProjectNav', () => {
  it('keeps the hrefs the overview page already used', () => {
    expect(tabs.map((t) => t.href)).toEqual([
      '/projects/p1',
      '/bom?projectId=p1',
      '/projects/p1/process-planning',
      '/projects/p1/rfq',
      '/projects/p1/supplier-evaluation',
      '/projects/p1/supplier-nomination',
      '/projects/p1/production-planning',
      '/projects/p1/quality-control',
      '/projects/p1/reports',
    ]);
  });

  it('marks exactly one tab active per project page', () => {
    expect(activeLabels('/projects/p1')).toEqual(['Overview']);
    expect(activeLabels('/projects/p1/rfq/quotes')).toEqual(['RFQ']);
    expect(activeLabels('/projects/p1/quality-control/abc')).toEqual(['Quality']);
    expect(activeLabels('/projects/p1/bom/b1')).toEqual(['BOM']);
    expect(activeLabels('/bom')).toEqual(['BOM']);
  });

  it('does not match look-alike prefixes', () => {
    expect(activeLabels('/projects/p1/rfqx')).toEqual([]);
    expect(activeLabels('/projects/p10')).toEqual([]);
  });
});
