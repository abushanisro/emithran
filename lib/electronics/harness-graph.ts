/**
 * Builds a wire-harness feature graph (contract 1.1) from what a person entered. There is no wire list to parse:
 * every field is supplied, so every field carries the source the person names (a BOM line, a drawing). Nothing is
 * defaulted: a terminal or seal count that was not entered is an error, not a zero.
 */

import type { HarnessGraph } from '@/lib/api/electronics';

export interface CircuitInput { id: string; awg: string; lengthMm: string; colour: string; terminalCount: string; sealCount: string }
export interface ConnectorInput { id: string; cavities: string }

export interface HarnessInput {
  circuits: CircuitInput[];
  connectors: ConnectorInput[];
  sleeveLengthMm: string;
  grommetCount: string;
  spliceCount: string;
  branchCount: string;
  labelCount: string;
  /** Who stated these values: a BOM line, a drawing, a person. Required. */
  source: string;
}

export type HarnessBuild = { ok: true; graph: HarnessGraph } | { ok: false; errors: string[] };

const blank = (v: string) => v.trim() === '';

function number(label: string, raw: string, opts: { integer?: boolean; min: number; max: number; minExclusive?: boolean }, errors: string[]): number | undefined {
  if (blank(raw)) {
    errors.push(`${label} is required`);
    return undefined;
  }
  const value = Number(raw);
  const belowMin = opts.minExclusive ? value <= opts.min : value < opts.min;
  if (!Number.isFinite(value) || belowMin || value > opts.max || (opts.integer && !Number.isInteger(value))) {
    errors.push(`${label} must be ${opts.integer ? 'a whole number' : 'a number'} ${opts.minExclusive ? 'greater than' : 'from'} ${opts.min}${opts.minExclusive ? '' : ` to ${opts.max}`}`);
    return undefined;
  }
  return value;
}

function optionalCount(label: string, raw: string, errors: string[]): number | undefined {
  return blank(raw) ? undefined : number(label, raw, { integer: true, min: 0, max: 100_000 }, errors);
}

export function buildHarnessGraph(input: HarnessInput): HarnessBuild {
  const errors: string[] = [];
  const source = input.source.trim();
  if (source === '') errors.push('Say where these values come from (a BOM line, a drawing, a person)');
  if (input.circuits.length === 0) errors.push('Enter at least one circuit');

  const ids = input.circuits.map((c) => c.id.trim());
  const circuits = input.circuits.flatMap((c, i) => {
    const label = `Circuit ${i + 1}`;
    if (blank(c.id)) errors.push(`${label}: give it an id`);
    if (ids.indexOf(c.id.trim()) !== i && !blank(c.id)) errors.push(`${label}: id "${c.id.trim()}" is used twice`);
    const awg = number(`${label}: AWG`, c.awg, { min: 0, max: 60, minExclusive: true }, errors);
    const lengthMm = number(`${label}: length (mm)`, c.lengthMm, { min: 0, max: 100_000, minExclusive: true }, errors);
    const terminalCount = number(`${label}: terminals`, c.terminalCount, { integer: true, min: 0, max: 2 }, errors);
    const sealCount = number(`${label}: seals`, c.sealCount, { integer: true, min: 0, max: 2 }, errors);
    if (awg === undefined || lengthMm === undefined || terminalCount === undefined || sealCount === undefined) return [];
    return [{ id: c.id.trim(), awg, lengthMm, ...(blank(c.colour) ? {} : { colour: c.colour.trim() }), terminalCount, sealCount }];
  });

  const connectors = input.connectors.flatMap((c, i) => {
    const cavities = number(`Connector ${i + 1}: cavities`, c.cavities, { integer: true, min: 1, max: 1000 }, errors);
    if (blank(c.id)) errors.push(`Connector ${i + 1}: give it an id`);
    return cavities === undefined || blank(c.id) ? [] : [{ id: c.id.trim(), cavities }];
  });

  const sleeveLengthMm = blank(input.sleeveLengthMm) ? undefined : number('Sleeve length (mm)', input.sleeveLengthMm, { min: 0, max: 100_000 }, errors);
  const grommetCount = optionalCount('Grommets', input.grommetCount, errors);
  const spliceCount = optionalCount('Splices', input.spliceCount, errors);
  const branchCount = optionalCount('Branches', input.branchCount, errors);
  const labelCount = optionalCount('Labels', input.labelCount, errors);
  if (errors.length > 0) return { ok: false, errors };

  const supplied = { basis: 'supplied' as const, confidence: 'high' as const, source: { note: source } };
  const present: Record<string, unknown> = { circuits, connectors, sleeveLengthMm, grommetCount, spliceCount, branchCount, labelCount };
  const provenance: HarnessGraph['provenance'] = {};
  for (const [key, value] of Object.entries(present)) if (value !== undefined) provenance[key] = supplied;

  const graph: HarnessGraph = {
    contractVersion: '1.1',
    kind: 'harness',
    inputTier: 'C',
    reviewStatus: 'needs_review',
    circuits,
    connectors,
    ...(sleeveLengthMm !== undefined ? { sleeveLengthMm } : {}),
    ...(grommetCount !== undefined ? { grommetCount } : {}),
    ...(spliceCount !== undefined ? { spliceCount } : {}),
    ...(branchCount !== undefined ? { branchCount } : {}),
    ...(labelCount !== undefined ? { labelCount } : {}),
    provenance,
    unresolved: [],
  };
  return { ok: true, graph };
}
