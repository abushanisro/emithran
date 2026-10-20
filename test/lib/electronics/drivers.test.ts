import { describe, expect, it } from 'vitest';

import type { BoardGraph, HarnessGraph, ReferenceCoverage } from '@/lib/api/electronics';
import { driverInputs, enginesFor, geometryRows, processSteps } from '@/lib/electronics/drivers';

// Small graphs in the contract shape, only to exercise the row builders. Real graphs come from uploads.
const base = { contractVersion: '1.1', inputTier: 'B', reviewStatus: 'needs_review', provenance: {}, unresolved: [] } as const;

const board: BoardGraph = {
  ...base,
  kind: 'board',
  outline: { lengthMm: 100.5, widthMm: 50 },
  layers: 2,
  placements: [
    { side: 'top', packageClass: 'unknown', count: 3, footprint: 'F1' },
    { side: 'bottom', packageClass: 'chip_0805', count: 1 },
  ],
  holes: [
    { diameterMm: 0.6, plated: true, count: 4 },
    { diameterMm: 1.5, plated: false, count: 2 },
  ],
  thtParts: [],
  pasteAreaMm2: { top: 12.34 },
};

const harness: HarnessGraph = {
  ...base,
  kind: 'harness',
  circuits: [{ id: 'C1', awg: 24, lengthMm: 900, terminalCount: 1, sealCount: 0 }],
  connectors: [{ id: 'J1', cavities: 2 }],
};

const coverage: ReferenceCoverage = {
  engines: [
    { id: 'pick', label: 'Pick and place', family: 'pcba', readiness: 'gap', inputs: [{ key: 'cph', unit: 'cph', requiredSource: 'rated speed', status: 'gap', scopes: [] }] },
    { id: 'reflow', label: 'Reflow', family: 'pcba', readiness: 'ready', inputs: [{ key: 'speed', unit: 'mm/min', requiredSource: 'oven speed', status: 'sourced', scopes: [] }] },
    { id: 'crimp', label: 'Crimp', family: 'harness', readiness: 'pending_confirmation', inputs: [{ key: 'time', unit: 's', requiredSource: 'cycle time', status: 'pending_confirmation', scopes: [] }] },
  ],
  summary: { ready: 1, pendingConfirmation: 1, gap: 1 },
  orphanKeys: [],
};

describe('geometryRows', () => {
  it('lists what a board measured, with holes and placements broken down, and says what was not stated', () => {
    const rows = geometryRows(board);
    const get = (label: string) => rows.find((r) => r.label === label);
    expect(get('Layers')?.value).toBe('2');
    expect(get('Board size')?.value).toBe('100.5 mm × 50 mm');
    expect(get('Thickness')?.value).toBe('not stated by the files');
    expect(get('Holes')).toMatchObject({ value: '6', depth: 0 });
    expect(get('Ø0.6 mm plated')).toMatchObject({ value: '× 4', depth: 1 });
    expect(get('Ø1.5 mm non-plated')?.value).toBe('× 2');
    expect(get('Placements')?.value).toBe('4');
    expect(get('top · F1')?.value).toBe('× 3 (class unknown)');
    expect(get('bottom · chip_0805')?.value).toBe('× 1');
    expect(get('Paste area top')?.value).toBe('12.3 mm²');
    expect(get('Paste area bottom')).toBeUndefined();
  });

  it('lists a harness by circuit and connector', () => {
    const rows = geometryRows(harness);
    expect(rows.find((r) => r.label === 'Circuits')?.value).toBe('1');
    expect(rows.find((r) => r.label === 'Circuit C1')?.value).toBe('24 AWG · 900 mm · 1 terminal · 0 seals');
    expect(rows.find((r) => r.label === 'Connector J1')?.value).toBe('2 cavities');
  });
});

describe('process steps and cost drivers', () => {
  it('uses the assembly engines for a board and the harness engines for a harness', () => {
    expect(enginesFor(coverage, 'board').map((e) => e.id)).toEqual(['pick', 'reflow']);
    expect(enginesFor(coverage, 'harness').map((e) => e.id)).toEqual(['crimp']);
  });

  it('says what each step still needs, and nothing for a ready one', () => {
    expect(processSteps(coverage, 'board')).toEqual([
      { id: 'pick', label: 'Pick and place', readiness: 'gap', needs: 'rated speed' },
      { id: 'reflow', label: 'Reflow', readiness: 'ready', needs: '' },
    ]);
    expect(processSteps(coverage, 'harness')[0]?.needs).toBe('data found; needs confirmation');
  });

  it('flattens every input of the applicable engines with its status', () => {
    expect(driverInputs(coverage, 'board').map((d) => [d.engine, d.key, d.status])).toEqual([
      ['Pick and place', 'cph', 'gap'],
      ['Reflow', 'speed', 'sourced'],
    ]);
  });
});
