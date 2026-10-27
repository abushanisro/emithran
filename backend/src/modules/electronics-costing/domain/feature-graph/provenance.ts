import type { BoardFeatureGraph, ElectronicsFeatureGraph, HarnessFeatureGraph } from './contract';

// The top-level fields of each graph that hold extracted or supplied data. Each one present in a
// graph must say where it came from. Envelope fields (version, kind, tier, review status, source
// file list, extraction, provenance, unresolved) describe the graph itself and carry no entry.
export const BOARD_DATA_FIELDS: readonly (keyof BoardFeatureGraph)[] = [
  'outline', 'layers', 'sidesPopulated', 'panel', 'placements', 'holes', 'thtParts', 'uniquePartNumbers',
  'flags', 'pasteAreaMm2', 'testPoints', 'coating', 'fabrication', 'copper', 'connectivity',
];

export const HARNESS_DATA_FIELDS: readonly (keyof HarnessFeatureGraph)[] = [
  'circuits', 'connectors', 'sleeveLengthMm', 'grommetCount', 'spliceCount', 'branchCount', 'labelCount',
];

export interface ProvenanceIssue {
  path: string;
  message: string;
}

// Rules the JSON Schema cannot express. Every extracted feature has traceable source data or is
// explicitly marked as derived; a measured value names the file and the parser that read it.
export function provenanceIssues(graph: ElectronicsFeatureGraph): ProvenanceIssue[] {
  const issues: ProvenanceIssue[] = [];
  const present = new Set<string>(
    (graph.kind === 'board' ? BOARD_DATA_FIELDS : HARNESS_DATA_FIELDS).filter((f) => (graph as unknown as Record<string, unknown>)[f] !== undefined),
  );
  const add = (path: string, message: string) => issues.push({ path, message });

  for (const field of present) {
    if (!(field in graph.provenance)) add(`/provenance/${field}`, `provenance missing for ${field}`);
  }
  // A key is a top-level data field, or a dotted path inside one ("outline.thicknessMm") when that part of the
  // field has a different origin from the rest.
  const isPresentPath = (key: string): boolean => {
    const [top, ...rest] = key.split('.');
    if (!present.has(top)) return false;
    let node: unknown = (graph as unknown as Record<string, unknown>)[top];
    for (const step of rest) {
      if (typeof node !== 'object' || node === null || !(step in node)) return false;
      node = (node as Record<string, unknown>)[step];
    }
    return true;
  };
  for (const [field, entry] of Object.entries(graph.provenance)) {
    const path = `/provenance/${field}`;
    if (!isPresentPath(field)) {
      add(path, `provenance for ${field}, which is not a data field present in the graph`);
      continue;
    }
    const { basis, source, derivedFrom } = entry;
    if (basis === 'derived') {
      if (!derivedFrom || derivedFrom.length === 0) add(path, 'a derived field must say what it was derived from');
      for (const from of derivedFrom ?? []) {
        if (from === field) add(path, 'a field cannot be derived from itself');
        else if (!isPresentPath(from)) add(path, `derived from ${from}, which is not a data field present in the graph`);
      }
    } else if (derivedFrom) {
      add(path, `derivedFrom is only for derived fields, not ${basis}`);
    }
    if (basis === 'measured') {
      if (!source?.file) add(path, 'a measured field must name the source file it was read from');
      else if (!graph.sourceFiles?.includes(source.file)) add(path, `source file ${source.file} is not listed in sourceFiles`);
      if (!graph.extraction) add(path, 'a measured field needs the extraction parser (extraction.parserId and parserVersion)');
    }
    if (basis === 'supplied' && !source?.file && !source?.note) add(path, 'a supplied field must name a source file or give a note saying who stated it');
    if (basis === 'supplied' && source?.file && !graph.sourceFiles?.includes(source.file)) {
      add(path, `source file ${source.file} is not listed in sourceFiles`);
    }
  }
  return issues;
}
