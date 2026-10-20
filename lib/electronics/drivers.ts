/**
 * Pure builders for the workspace tables: the geometry a graph measured, and the process steps and cost-driver inputs the
 * reference coverage reports. Only what the files stated or the platform records appears; a value that is not known is shown as
 * not known, never estimated.
 */

import type { EngineCoverage, FeatureGraph, ReferenceCoverage } from '@/lib/api/electronics';

export interface GeometryRow {
  label: string;
  value: string;
  /** 0 for a headline row, 1 for a row that breaks the headline down (a hole diameter, a footprint). */
  depth: 0 | 1;
}

const row = (label: string, value: string, depth: 0 | 1 = 0): GeometryRow => ({ label, value, depth });
const mm = (v: number) => `${Number(v.toFixed(3))} mm`;

export function geometryRows(graph: FeatureGraph): GeometryRow[] {
  if (graph.kind === 'harness') {
    return [
      row('Circuits', String(graph.circuits.length)),
      ...graph.circuits.map((c) => row(`Circuit ${c.id}`, `${c.awg} AWG · ${c.lengthMm} mm · ${c.terminalCount} terminal${c.terminalCount === 1 ? '' : 's'} · ${c.sealCount} seal${c.sealCount === 1 ? '' : 's'}`, 1)),
      row('Connectors', String(graph.connectors.length)),
      ...graph.connectors.map((c) => row(`Connector ${c.id}`, `${c.cavities} cavities`, 1)),
      ...(graph.sleeveLengthMm !== undefined ? [row('Sleeve length', mm(graph.sleeveLengthMm))] : []),
      ...(graph.spliceCount !== undefined ? [row('Splices', String(graph.spliceCount))] : []),
      ...(graph.branchCount !== undefined ? [row('Branches', String(graph.branchCount))] : []),
    ];
  }

  const rows: GeometryRow[] = [
    row('Layers', String(graph.layers)),
    row('Board size', `${mm(graph.outline.lengthMm)} × ${mm(graph.outline.widthMm)}`),
    row('Thickness', graph.outline.thicknessMm === undefined ? 'not stated by the files' : mm(graph.outline.thicknessMm)),
  ];
  if (graph.outline.areaMm2 !== undefined) rows.push(row('Board area', `${Number(graph.outline.areaMm2.toFixed(1))} mm²`));

  const holes = graph.holes ?? [];
  if (holes.length > 0) {
    rows.push(row('Holes', holes.reduce((n, h) => n + h.count, 0).toLocaleString()));
    for (const h of holes) rows.push(row(`Ø${Number(h.diameterMm.toFixed(3))} mm ${h.plated ? 'plated' : 'non-plated'}`, `× ${h.count.toLocaleString()}`, 1));
  }

  if (graph.placements.length > 0) {
    rows.push(row('Placements', graph.placements.reduce((n, p) => n + p.count, 0).toLocaleString()));
    for (const p of graph.placements) {
      rows.push(row(`${p.side} · ${p.footprint ?? p.packageClass}`, `× ${p.count.toLocaleString()}${p.packageClass === 'unknown' ? ' (class unknown)' : ''}`, 1));
    }
  }
  if (graph.pasteAreaMm2) {
    for (const side of ['top', 'bottom'] as const) {
      const area = graph.pasteAreaMm2[side];
      if (area !== undefined) rows.push(row(`Paste area ${side}`, `${Number(area.toFixed(1))} mm²`));
    }
  }
  if (graph.testPoints !== undefined) rows.push(row('Test points', String(graph.testPoints)));
  return rows;
}

export interface ProcessStep {
  id: string;
  label: string;
  readiness: EngineCoverage['readiness'];
  /** What is still needed before this step can be priced; empty when it is ready. */
  needs: string;
}

/** The engines that apply to a design (board: assembly engines; harness: harness engines), in the platform order. */
export function enginesFor(coverage: ReferenceCoverage, kind: FeatureGraph['kind']): EngineCoverage[] {
  const family: EngineCoverage['family'] = kind === 'board' ? 'pcba' : 'harness';
  return coverage.engines.filter((e) => e.family === family);
}

export function processSteps(coverage: ReferenceCoverage, kind: FeatureGraph['kind']): ProcessStep[] {
  return enginesFor(coverage, kind).map((e) => {
    const gaps = e.inputs.filter((i) => i.status === 'gap').map((i) => i.requiredSource);
    const needs = e.readiness === 'ready' ? '' : gaps.length > 0 ? [...new Set(gaps)].join('; ') : 'data found; needs confirmation';
    return { id: e.id, label: e.label, readiness: e.readiness, needs };
  });
}

export interface DriverInput {
  engine: string;
  key: string;
  unit: string;
  status: EngineCoverage['inputs'][number]['status'];
  requiredSource: string;
}

/** Every input each applicable engine needs, with whether it is sourced: what the cost depends on and what is missing. */
export function driverInputs(coverage: ReferenceCoverage, kind: FeatureGraph['kind']): DriverInput[] {
  return enginesFor(coverage, kind).flatMap((e) => e.inputs.map((i) => ({ engine: e.label, key: i.key, unit: i.unit, status: i.status, requiredSource: i.requiredSource })));
}
