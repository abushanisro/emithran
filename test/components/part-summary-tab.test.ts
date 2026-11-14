import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PartSummaryView, uncostedBanner } from '@/components/features/manufacturing-intelligence/PartSummaryTab';
import type { PartSummary } from '@/lib/api/hooks/useBOMItems';

// The Part Summary tab, rendered from the summary the backend returned for the real Back cover (nylon, injection molding, mold tooling).

const BACK_COVER: PartSummary = {
  currency: 'USD', basis: 'applied',
  component: { roughMassKg: 0.0296, finishMassKg: 0.0266, lengthMm: 170.5171, widthMm: 95.0861, heightMm: 51.8351, surfaceAreaMm2: 25695.5501, volumeMm3: 18844.74 },
  production: { digitalFactory: { primary: 'USA', secondary: null, toolshop: null }, annualVolume: 1000, batchSize: 250, productionLifeYears: 5, lifetimeVolume: 5000 },
  material: { catalog: 'BENCHMARK Q1-2025', name: 'Generic Nylon, Type 11 40% Glass', stock: null, composition: 'Generic Nylon, Type 11 40% Glass', utilizationPct: 90, unitCostUsdPerKg: 5.864 },
  costByCategory: [
    { key: 'material', label: 'Material', usd: 0.182, pct: 7.3 }, { key: 'labor', label: 'Labor', usd: 0.03, pct: 1.2 }, { key: 'overhead', label: 'Overhead', usd: 0.03, pct: 1.2 },
    { key: 'setup', label: 'Setup', usd: 0.3, pct: 12 }, { key: 'investment', label: 'Investment', usd: 1.9617, pct: 78.4 }, { key: 'other', label: 'Other', usd: 0, pct: 0 },
  ],
  costByProcess: [{ process: 'Injection Molding', usd: 0.36, pct: 100 }],
  costs: { piecePartCostUsd: 2.503755, fullyBurdenedCostUsd: null, totalCapitalInvestmentsUsd: 9808.59, targetCostUsd: null, varianceToTargetCostPct: null, targetMassKg: null, varianceToTargetMassPct: null },
  notModelled: { secondaryFactory: 'one factory', toolshop: 'no toolshop', stock: 'no stock form', fullyBurdenedCost: 'period costs are not modelled', targetCost: 'no target cost', targetMass: 'no target mass' },
  uncosted: [],
};

const html = (s: PartSummary, warnings: string[] = []) => renderToStaticMarkup(createElement(PartSummaryView, { summary: s, uncostedWarnings: warnings }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

describe('PartSummaryView: the six panels of the Part Summary', () => {
  const out = text(html(BACK_COVER));

  it('has the six panels, in the order of the image', () => {
    const titles = ['Component Information', 'Production Information', 'Material Information', 'Cost by Category (%)', 'Cost by Process (%)', 'Component Costs And Targets'];
    const at = titles.map((t) => out.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('component information: masses, dimensions, surface area and volume', () => {
    for (const s of ['Rough Mass (kg)|0.03', 'Finish Mass (kg)|0.03', 'Length (mm)|170.52', 'Width (mm)|95.09', 'Height (mm)|51.84', 'Surface Area (mm^2)|25,695.55', 'Volume (mm^3)|18,844.74']) expect(out).toContain(s);
  });

  it('production information: the factory, the volumes and the production life', () => {
    for (const s of ['Digital Factories', '-Primary:|USA', 'Annual Volume|1,000', 'Batch Size|250', 'Production Life|5.00', 'Lifetime Volume|5,000']) expect(out).toContain(s);
  });

  it('material information: catalog, material, utilization and unit cost; a material with no stock form shows N/A', () => {
    for (const s of ['Material Catalog:|BENCHMARK Q1-2025', 'Material:|Generic Nylon, Type 11 40% Glass', 'Utilization (%)|90.00', 'Unit Cost (USD / kg)|5.864', 'N/A']) expect(out).toContain(s);
  });

  it('cost by category: the six categories with their share, in the image\'s order', () => {
    const order = ['Material:', 'Labor:', 'Overhead:', 'Setup:', 'Investment:', 'Other:'].map((l) => out.indexOf(l, out.indexOf('Cost by Category')));
    expect(order.every((i) => i >= 0) && [...order].sort((a, b) => a - b).join() === order.join()).toBe(true);
    expect(out).toContain('Investment:|');
    expect(html(BACK_COVER)).toContain('width:78.4%');
  });

  it('the bars are coloured by category, the same colour in the stacked bar and its row, and the stock is a line of the panel', () => {
    const markup = html({ ...BACK_COVER, material: { ...BACK_COVER.material, stock: '59×50×49 billet' } });
    expect(markup.split('background-color:#ec4899').length - 1).toBe(3); // stacked segment, swatch, row bar
    expect(markup).toContain('flex-basis:78.4%');
    expect(text(markup)).toContain('Stock:|59×50×49 billet');
  });

  it('the panels are laid out by the width of the pane, not the viewport', () => {
    expect(html(BACK_COVER)).toContain('repeat(auto-fit,minmax(min(100%,15rem),1fr))');
  });

  it('cost by process: a Process and % table', () => {
    expect(out).toContain('Process|%');
    expect(out).toContain('Injection Molding|100.0');
  });

  it('component costs and targets: the piece part cost and capital investment, and a dash with its reason for what is not modelled', () => {
    for (const s of ['Piece Part Cost (USD):|2.50', 'Total Capital Investments (USD):|9,808.59', 'Fully Burdened Cost (USD):|—', 'Target Cost (USD):|—', '% Variance To Target Cost:|—', 'Target Mass (kg):|—', '% Variance To Target Mass:|—']) expect(out).toContain(s);
    const markup = html(BACK_COVER);
    expect(markup).toContain('title="period costs are not modelled"');
    expect(markup).toContain('title="no target cost"');
  });
});

describe('the banner about what failed to cost', () => {
  it('is shown, in red and bold, when an operation carries no cost or a warning says it was not costed', () => {
    const markup = html({ ...BACK_COVER, uncosted: ['Gate trimming'] }, ['⚠ Material Drying required — not costed']);
    expect(markup).toContain('font-bold text-red-600');
    expect(text(markup)).toContain('Part has 2 operations that failed to cost. Gate trimming: no cost was applied.');
  });

  it('says "an operation" for one and names nothing for warnings alone', () => {
    expect(uncostedBanner(BACK_COVER, ['⚠ Gate Trimming required — not costed'])).toBe('Part has an operation that failed to cost. The Cost tab lists the warning for each.');
  });

  it('is not shown when everything costed', () => {
    expect(uncostedBanner(BACK_COVER, [])).toBeNull();
    expect(html(BACK_COVER)).not.toContain('text-red-600');
  });
});

describe('a part with nothing applied', () => {
  const none: PartSummary = { ...BACK_COVER, basis: 'none', costByCategory: [], costByProcess: [], costs: { ...BACK_COVER.costs, piecePartCostUsd: null, totalCapitalInvestmentsUsd: null } };

  it('says so, shows the facts of the part, and no cost', () => {
    const out = text(html(none));
    expect(out).toContain('Nothing has been applied to this part yet');
    expect(out).toContain('Length (mm)|170.52');
    expect(out).toContain('No cost applied.');
    expect(out).toContain('No process applied.');
    expect(out).toContain('Piece Part Cost (USD):|—');
  });
});
