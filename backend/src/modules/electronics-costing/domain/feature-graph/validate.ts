import Ajv, { type ValidateFunction } from 'ajv8';

import { provenanceIssues } from './provenance';
import { BOARD_FEATURE_GRAPH_SCHEMA, HARNESS_FEATURE_GRAPH_SCHEMA } from './schemas.generated';

import type { BoardFeatureGraph, ElectronicsFeatureGraph, HarnessFeatureGraph } from './contract';

export interface FeatureGraphIssue {
  path: string;
  message: string;
}

export type FeatureGraphValidation =
  | { valid: true; graph: ElectronicsFeatureGraph }
  | { valid: false; issues: FeatureGraphIssue[] };

const ajv = new Ajv({ allErrors: true, strict: true });
const validateBoardSchema: ValidateFunction = ajv.compile(BOARD_FEATURE_GRAPH_SCHEMA);
const validateHarnessSchema: ValidateFunction = ajv.compile(HARNESS_FEATURE_GRAPH_SCHEMA);

const PARTIAL_FIELDS = new Set(['placements', 'thtParts']);

// A dotted path ("outline.thicknessMm") is present when every step exists in the graph.
function isPresent(graph: object, path: string): boolean {
  let node: unknown = graph;
  for (const step of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(step in node)) return false;
    node = (node as Record<string, unknown>)[step];
  }
  return true;
}

function schemaIssues(validate: ValidateFunction): FeatureGraphIssue[] {
  return (validate.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message ?? 'invalid',
  }));
}

// Rules the schema cannot express. A confirmed graph is what engines price, so it
// must not carry anything still unresolved.
function boardSemanticIssues(g: BoardFeatureGraph): FeatureGraphIssue[] {
  const issues: FeatureGraphIssue[] = [];
  g.placements.forEach((p, i) => {
    // Without a stated list of populated sides there is nothing to contradict.
    if (g.sidesPopulated && !g.sidesPopulated.includes(p.side)) {
      issues.push({ path: `/placements/${i}/side`, message: `placement on ${p.side} but that side is not populated` });
    }
    if (g.reviewStatus === 'confirmed' && p.packageClass === 'unknown') {
      issues.push({ path: `/placements/${i}/packageClass`, message: 'a confirmed graph cannot contain an unknown package class' });
    }
  });
  // A field listed as unresolved must be absent. The two lists that can be partially known (placements,
  // thtParts) may be present and listed: the entry then says what is missing from them.
  for (const { field } of g.unresolved) {
    if (PARTIAL_FIELDS.has(field)) continue;
    if (isPresent(g, field)) {
      issues.push({ path: `/${field}`, message: 'a field listed as unresolved must be absent, not filled with a guess' });
    }
  }
  return issues;
}

function harnessSemanticIssues(g: HarnessFeatureGraph): FeatureGraphIssue[] {
  const ids = g.circuits.map((c) => c.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  return [...new Set(duplicates)].map((id) => ({ path: '/circuits', message: `duplicate circuit id ${id}` }));
}

export function validateFeatureGraph(input: unknown): FeatureGraphValidation {
  const kind = typeof input === 'object' && input !== null ? (input as { kind?: unknown }).kind : undefined;
  if (kind !== 'board' && kind !== 'harness') {
    return { valid: false, issues: [{ path: '/kind', message: 'kind must be "board" or "harness"' }] };
  }
  const validate = kind === 'board' ? validateBoardSchema : validateHarnessSchema;
  if (!validate(input)) return { valid: false, issues: schemaIssues(validate) };

  const graph = input as ElectronicsFeatureGraph;
  const issues = [...(graph.kind === 'board' ? boardSemanticIssues(graph) : harnessSemanticIssues(graph)), ...provenanceIssues(graph)];
  return issues.length > 0 ? { valid: false, issues } : { valid: true, graph };
}
