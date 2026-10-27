import { describe, expect, it } from 'vitest';

import type { BoardGraph } from '@/lib/api/electronics';
import { describeGraph } from '@/lib/electronics/graph-view';

const measured = (file: string) => ({ basis: 'measured' as const, confidence: 'high' as const, source: { file } });

// The shape the engine returns for a reverse-engineered LED board (contract 1.3); values as measured on the OPT FL285182 set.
const graph: BoardGraph = {
  kind: 'board',
  contractVersion: '1.3',
  inputTier: 'B',
  reviewStatus: 'needs_review',
  outline: { lengthMm: 273.7, widthMm: 170.7, areaMm2: 23161.8 },
  layers: 2,
  placements: [{ side: 'top', packageClass: 'unknown', count: 534, footprint: 'OPT_3528' }],
  thtParts: [],
  fabrication: { minTraceWidthMm: 0.3, minSpacingMm: 0.357, minHoleMm: 0.6, minAnnularRingMm: 0.15, minCopperToEdgeMm: 0.935, soldermask: { top: true, bottom: true } },
  copper: { areaMm2: { top: 8269.8, bottom: 21934.1 }, conductors: 543, viaCount: 224 },
  connectivity: {
    netsWithPins: 536,
    pins: 1246,
    largestNetPins: 89,
    seriesChains: [{ count: 89, partsPerChain: 7, composition: [{ footprint: 'OPT-0805', count: 1 }, { footprint: 'OPT_3528', count: 6 }] }],
    chainEndNets: 2,
  },
  provenance: {
    outline: measured('a.GKO'),
    layers: measured('a.GTL'),
    placements: measured('pp.csv'),
    fabrication: measured('a.TXT'),
    'fabrication.minSpacingMm': measured('a.GTL'),
    copper: measured('a.GTL'),
    'copper.viaCount': measured('a.TXT'),
    connectivity: { basis: 'measured', confidence: 'medium', source: { file: 'a.GTL' } },
  },
  unresolved: [],
};

const section = (title: string) => describeGraph(graph).find((s) => s.title === title);

describe('describeGraph: reverse-engineered board', () => {
  it('lists the fabrication facts the copper and drill files state, each with its source', () => {
    const rows = Object.fromEntries((section('Fabrication')?.rows ?? []).map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({
      'Narrowest trace': '0.3 mm',
      'Narrowest spacing between conductors': '0.357 mm',
      'Smallest annular ring': '0.15 mm',
      'Copper nearest the board edge': '0.935 mm',
      'Solder mask': 'top and bottom',
    });
    expect(section('Fabrication')?.rows.find((r) => r.label.startsWith('Narrowest spacing'))?.provenance).toBe('Measured: a.GTL (high)');
  });

  it('shows copper per side as area and share of the board, conductors and vias', () => {
    const rows = Object.fromEntries((section('Copper')?.rows ?? []).map((r) => [r.label, r.value]));
    expect(rows['Copper area, top']).toBe('8,270 mm² (36% of the board)');
    expect(rows['Copper area, bottom']).toBe('21,934 mm² (95% of the board)');
    expect(rows['Vias (plated holes of no part)']).toBe('224');
  });

  it('describes each group of series chains by its composition', () => {
    const rows = section('Circuit (traced from the copper)')?.rows ?? [];
    expect(rows.find((r) => r.label === '89 × series chain of 7 parts')?.value).toBe('1 × OPT-0805 + 6 × OPT_3528');
    expect(rows.find((r) => r.label === 'Largest net')?.value).toBe('89 pins');
  });

  it('adds no sections for a graph without the 1.3 fields', () => {
    const { fabrication: _f, copper: _c, connectivity: _n, ...older } = graph;
    const titles = describeGraph({ ...older, contractVersion: '1.2' }).map((s) => s.title);
    expect(titles).not.toContain('Copper');
    expect(titles).not.toContain('Circuit (traced from the copper)');
    expect(titles).not.toContain('Fabrication');
  });
});
