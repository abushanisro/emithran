import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PartAssemblySection } from '@/components/costing/PartAssemblySection';
import type { PartAssemblySummary } from '@/lib/costing/part-assembly-view';

// Two 3 mm steel brackets welded on the manual route as the engine quoted them (backend part-assembly-engine.spec.ts's weldment).
const weld = (over: Partial<PartAssemblySummary['welds'][number]>): PartAssemblySummary['welds'][number] => ({
  id: 'f1', process: 'MIG Welding', routeProcess: 'Manual MIG Welding', operation: 'Fillet Welding', feature: 'Edge', label: 'Fillet Welding 1', count: 2,
  lengthMm: 300, sizeMm: null, thicknessMm: null, areaMm2: null, depthMm: null, bevel: false, grind: true, finishGrind: false, wireBrush: false, enabled: true,
  cycleSec: 101.4, wireKg: 0.021, reason: null, ...over,
});
const PA: PartAssemblySummary = {
  route: 'manual', routeLabel: 'Manual welding', complete: true,
  components: [
    { id: 'a', name: 'Bracket a', quantity: 1, massKg: 1.5, massSource: 'weight', maxDimensionMm: 300 },
    { id: 'b', name: 'Bracket b', quantity: 1, massKg: null, massSource: null, maxDimensionMm: 300 },
  ],
  weldmentMassKg: null, thicknessMm: 3, thicknessSource: 'the components\' sheet thickness, 3 mm', material: 'Steel, Cold Worked, AISI 1020', cutCodeFamily: '1',
  welds: [
    weld({}),
    weld({ id: 'j', operation: 'J-Groove Welding', label: 'J-Groove Welding 2', count: 1, lengthMm: 100, grind: false, cycleSec: null, wireKg: null, reason: 'its cross-section (area): a j-groove joint has no default shape' }),
  ],
  wireCost: 0.15,
  options: [
    { route: 'manual', label: 'Manual welding', complete: true, totalCost: 4.12, reason: null },
    { route: 'robotic', label: 'Robotic welding', complete: false, totalCost: null, reason: 'Robotic MIG Welding not costed' },
  ],
};
const panel = (pa: PartAssemblySummary | null = PA) => renderToStaticMarkup(createElement(PartAssemblySection, { partAssembly: pa, overrides: {}, onChange: () => undefined, hrefOf: (id: string) => `/items/${id}` }));

describe('the Part Assembly section of the Cost Guide', () => {
  it('says the route quoted, and why another is not a route', () => {
    const out = panel();
    expect(out).toContain('Quoted: <span class="text-foreground">Manual welding</span>');
    expect(out).toContain('Robotic welding: Robotic MIG Welding not costed');
  });

  it('lists the components (one with no weight flagged), the plate and the material the welds are made in', () => {
    const out = panel();
    expect(out).toContain('href="/items/a"');
    expect(out).toContain('1.5 kg');
    expect(out).toContain('no weight');
    expect(out).toContain('3 mm</span> (the components&#x27; sheet thickness, 3 mm)');
    expect(out).toContain('Steel, Cold Worked, AISI 1020');
  });

  it('lists each weld with its welder, its measures, its time and wire, or why it is not costed', () => {
    const out = panel();
    expect(out).toContain('Manual MIG Welding · Fillet Welding on the edge · 2 x 300 mm, grind · 0.021 kg wire');
    expect(out).toContain('1.7 min');
    expect(out).toContain('its cross-section (area): a j-groove joint has no default shape');
    expect(out).toContain('MIG wire 0.15 per weldment');
  });

  it('waits for the cost while there is none', () => {
    expect(panel(null)).toContain('Costing the weldment…');
  });
});
