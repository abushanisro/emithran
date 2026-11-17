import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ForgingSection } from '@/components/costing/ForgingSection';
import { forgingOverrideCount, parseBlows } from '@/lib/costing/forging-view';
import type { ForgingSummary } from '@/lib/costing/forging-view';

// The Cost Guide's Forging section on the Cannula Holder bottom: quoted on the screw press, 19.05 mm bar, induction, 3 blows at 1,626 kN.
const FORGING: ForgingSummary = {
  route: 'closed_die_press', routeLabel: 'Closed-die forging · screw press', complexity: 7, barDiameterMm: 19.05, multLengthMm: 48.34,
  heating: 'induction', hits: 3, forming: { quantity: 'force_kn', value: 1625.89 }, trimForceKn: 3.4,
  flash: { thicknessMm: 1.31, widthMm: 5.48, volumeMm3: 2367 }, complete: true, options: [],
};
const html = (overrides: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(ForgingSection, { forging: FORGING, overrides, onChange: () => {} }));

describe('the Forging section of the Cost Guide', () => {
  it("shows the quoted route, and every setting as a field with the engine's value as its placeholder", () => {
    const out = html();
    expect(out).toContain('Closed-die forging · screw press');
    for (const p of ['placeholder="19.05"', 'placeholder="3"', 'placeholder="1.31"', 'placeholder="5.48"']) expect(out).toContain(p);
    expect(out).toContain('Auto (induction)');
    expect(out).toContain('48.34 mm');
    expect(out).toContain('1,626 kN');
    expect(out).toContain('Forging settings: automatic');
  });

  it('a setting the engineer made is the value of its field, and counted', () => {
    const out = html({ forgingBarDiameterMm: 25, forgingHeating: 'furnace' });
    expect(out).toContain('value="25"');
    expect(out).toContain('Forging settings: 2 overridden');
  });

  it('does not list the routes: they are compared and picked in the Workflow Builder', () => {
    expect(html()).not.toContain('Cheapest complete route');
    expect(html()).not.toContain('radiogroup');
  });

  it('blows are a whole number; empty gives them back to the data', () => {
    expect(parseBlows('4')).toBe(4);
    expect(parseBlows('')).toBeNull();
    expect(parseBlows('2.5')).toBe('invalid');
    expect(forgingOverrideCount({ forgingComplexity: 5, forgingHits: 2, other: 1 })).toBe(2);
  });
});
