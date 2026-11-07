import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RouteCompareList } from '@/components/features/workflow/RouteCompareList';
import type { RouteNode } from '@/lib/routing/route-tree';

const REASON = 'The reference lists no SlideBundle for Compression Molding: this process has no tooling for it.';
const WARNING = 'SharpEdge is not assessed from the CAD yet, so Injection Molding is not excluded or confirmed for it.';

function node(over: Partial<RouteNode> & Pick<RouteNode, 'id' | 'label'>): RouteNode {
  return {
    kind: 'required', processFamily: 'cutting', selectable: true, selectionNote: null, toolingVolumeNote: null, feasible: true, infeasibleReason: null,
    processIncompatibilities: [], incompatible: false, compatibilityWarnings: [],
    cost: 1, cycleTimeMin: 1, machineName: null, hourlyRate: null, machineClass: null,
    badges: { lowestCost: false, fastest: false, bestQuality: false }, children: [],
    ...over,
  };
}

const incompatible = node({
  id: 'im-compression-molding', label: 'Compression Molding', cost: 0.5, selectable: false,
  incompatible: true,
  processIncompatibilities: [{ featureType: 'SlideBundle', variant: '', count: 2, featureIds: ['sb'], kind: 'not_in_process_vocabulary', reason: REASON }],
});
const compatible = node({ id: 'im-small', label: 'Small Press', cost: 0.7, compatibilityWarnings: [WARNING], badges: { lowestCost: true, fastest: true, bestQuality: false } });

const html = (nodes: RouteNode[], props: { noCompatibleMessage?: string | null; recommendedIds?: string[] } = {}) =>
  renderToStaticMarkup(createElement(RouteCompareList, {
    nodes, selectedId: null, onSelect: () => undefined, recommendedIds: props.recommendedIds ?? [], sortMode: 'cost', onSortModeChange: () => undefined, currencySymbol: '$',
    noCompatibleMessage: props.noCompatibleMessage ?? null,
  }));

describe('route list: compatibility', () => {
  it('marks an incompatible route and shows the exact feature, how many, and why', () => {
    const out = html([incompatible, compatible]);
    expect(out).toContain('Incompatible');
    expect(out).toContain('2 × SlideBundle');
    expect(out).toContain(REASON);
  });

  it('lists the incompatible route after the compatible one, although it is cheaper', () => {
    const out = html([incompatible, compatible]);
    expect(out.indexOf('Small Press')).toBeLessThan(out.indexOf('Compression Molding'));
  });

  it('shows an unassessed feature as a warning on a route that is still offered', () => {
    const out = html([compatible]);
    expect(out).toContain(WARNING);
    expect(out).not.toContain('Incompatible');
  });

  it('says "No compatible manufacturing process found." when every route is incompatible, and recommends nothing', () => {
    const out = html([incompatible], { noCompatibleMessage: 'No compatible manufacturing process found.' });
    expect(out).toContain('No compatible manufacturing process found.');
    expect(out).toContain('role="alert"');
    // no route carries a Recommended badge (the sort toolbar's own "Recommended" button is a <button>)
    expect(out).not.toContain('Recommended</span>');
  });

  it('shows no such message when there is a compatible route', () => {
    expect(html([incompatible, compatible])).not.toContain('No compatible manufacturing process');
  });
});
