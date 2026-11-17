import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ForgingSection } from '@/components/costing/ForgingSection';
import { formatForming, shortReason, splitRouteLabel, type ForgingSummary } from '@/lib/costing/forging-view';

// The Carriage Mount's forging: a die hammer quoted, two other closed-die presses priced, open-die and ring rolling not routes for the part.
const forging: ForgingSummary = {
  route: 'closed_die_hammer', routeLabel: 'Closed-die forging · die hammer', complexity: 7, barDiameterMm: 19.05, multLengthMm: 64.64,
  heating: 'induction', hits: 3, forming: { quantity: 'energy_j', value: 412 }, trimForceKn: 12, flash: { thicknessMm: 1.33, widthMm: 5.58, volumeMm3: 900 },
  complete: true,
  options: [
    { route: 'closed_die_screw_press', label: 'Closed-die forging · screw press', complete: true, totalCost: 2.46, reason: null },
    { route: 'closed_die_hammer', label: 'Closed-die forging · die hammer', complete: true, totalCost: 2.41, reason: null },
    { route: 'open_die', label: 'Open-die forging', complete: false, totalCost: null,
      reason: 'complexity 7 carries flash (partComplexityBasedData): open-die forging makes only the flashless shapes (complexity 1 to 3)' },
  ],
};
const html = (route: string | null = null) =>
  renderToStaticMarkup(createElement(ForgingSection, { forging, complexity: null, route, currency: 'USD', onChange: () => undefined }));

describe('forging section of the Cost Guide', () => {
  it('lists every route in the panel, each with its price, and the automatic choice selected when none is set', () => {
    const out = html();
    expect(out).toContain('Cheapest complete route');
    expect(out).toMatch(/aria-checked="true"[^>]*>[\s\S]*?Cheapest complete route/);
    expect(out).toContain('screw press');
    expect(out).toContain('2.46 USD');
    expect(out).toContain('2.41 USD');
  });

  it('shows a route that is not possible for the part disabled, with a one-line reason and the full one as its tooltip', () => {
    const out = html();
    expect(out).toMatch(/disabled=""[^>]*title="Open-die forging: complexity 7 carries flash/);
    expect(out).toContain('complexity 7 carries flash<');
    expect(out).toContain('not possible');
  });

  it('marks the route the user chose', () => {
    expect(html('closed_die_hammer')).toMatch(/aria-checked="true"[^>]*title="Closed-die forging · die hammer/);
  });

  it('describes the quoted route as labelled values, with a small blow in joules, not 0 kJ', () => {
    const out = html();
    expect(out).toContain('Ø19.05 mm, 64.64 mm mults');
    expect(out).toContain('3 blows, 412 J');
    expect(out).not.toContain('0 kJ');
  });
});

describe('forging view helpers', () => {
  it('a force in kN, an energy in J under a kilojoule and in kJ above', () => {
    expect(formatForming({ quantity: 'force_kn', value: 8906.4 })).toBe('8,906 kN');
    expect(formatForming({ quantity: 'energy_j', value: 412 })).toBe('412 J');
    expect(formatForming({ quantity: 'energy_j', value: 1286 })).toBe('1.3 kJ');
  });
  it('splits a route label into its kind and machine', () => {
    expect(splitRouteLabel('Closed-die forging · screw press')).toEqual({ kind: 'Closed-die forging', machine: 'screw press' });
    expect(splitRouteLabel('Ring rolling')).toEqual({ kind: 'Ring rolling', machine: null });
  });
  it('shortens a reason to its first clause, without the data keys', () => {
    expect(shortReason('the part is not a ring: round in plan with a through bore')).toBe('the part is not a ring');
    expect(shortReason(null)).toBeNull();
  });
});
