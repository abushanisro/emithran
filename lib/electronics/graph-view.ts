/**
 * Pure view model for the electronics screen: how a file is classified before upload, and how a feature graph is
 * described to the person reviewing it. No React and no data of its own: file roles come from the backend file-role
 * table (GET /electronics/file-formats), everything else from the graph the engine returned.
 */

import type { BoardGraph, FeatureGraph, FieldProvenance, FileFormats, HarnessGraph } from '@/lib/api/electronics';

export type FileClass =
  | { name: string; kind: 'board'; role: string; family: string }
  | { name: string; kind: 'tabular' | 'document' | 'image' | 'archive' }
  | { name: string; kind: 'unrecognised' };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Classifies a picked file by its extension using the platform tables. Unknown extensions are named, never guessed. */
export function classifyFile(name: string, formats: FileFormats): FileClass {
  const ext = extensionOf(name);
  const board = formats.boardFiles.find((r) => r.extension === ext);
  // A .txt is drill data only when it is Excellon; the server decides by content. Offered here as its table role.
  if (board) return { name, kind: 'board', role: board.role, family: board.family };
  if (formats.tabular.includes(ext)) return { name, kind: 'tabular' };
  if (formats.documents.includes(ext)) return { name, kind: 'document' };
  if (formats.images.includes(ext)) return { name, kind: 'image' };
  if (formats.archives.includes(ext)) return { name, kind: 'archive' };
  return { name, kind: 'unrecognised' };
}

export function roleLabel(role: string): string {
  return role.replace(/_/g, ' ');
}

export function provenanceLabel(p: FieldProvenance | undefined): string {
  if (!p) return 'no source recorded';
  const where = p.source?.file ?? p.source?.note ?? (p.derivedFrom ? `from ${p.derivedFrom.join(', ')}` : '');
  const how = p.basis === 'measured' ? 'Measured' : p.basis === 'supplied' ? 'Supplied' : 'Derived';
  return `${how}${where ? `: ${where}` : ''} (${p.confidence})`;
}

export interface Row { label: string; value: string; provenance?: string }
export interface Section { title: string; rows: Row[] }

const mm = (v: number, digits = 1) => `${Number(v.toFixed(digits))} mm`;

function board(graph: BoardGraph): Section[] {
  const prov = (key: string) => provenanceLabel(graph.provenance[key]);
  const sections: Section[] = [];

  const geometry: Row[] = [
    { label: 'Size', value: `${mm(graph.outline.lengthMm)} × ${mm(graph.outline.widthMm)}`, provenance: prov('outline') },
  ];
  if (graph.outline.areaMm2 !== undefined) {
    geometry.push({ label: 'Board area', value: `${Number(graph.outline.areaMm2.toFixed(0)).toLocaleString('en-US')} mm²`, provenance: prov('outline') });
  }
  geometry.push(
    graph.outline.thicknessMm !== undefined
      ? { label: 'Thickness', value: mm(graph.outline.thicknessMm, 2), provenance: prov('outline.thicknessMm') }
      : { label: 'Thickness', value: 'not stated' },
  );
  geometry.push({ label: 'Copper layers', value: String(graph.layers), provenance: prov('layers') });
  if (graph.panel) geometry.push({ label: 'Boards per panel', value: String(graph.panel.boardsPerPanel), provenance: prov('panel') });
  if (graph.sidesPopulated) geometry.push({ label: 'Populated sides', value: graph.sidesPopulated.join(' and '), provenance: prov('sidesPopulated') });
  sections.push({ title: 'Board', rows: geometry });

  if (graph.holes) {
    sections.push({
      title: 'Drilled holes',
      rows: graph.holes.map((h) => ({
        label: `Ø${Number(h.diameterMm.toFixed(2))} mm ${h.plated ? 'plated' : 'non-plated'}`,
        value: `${h.count} holes`,
        provenance: prov('holes'),
      })),
    });
  }

  if (graph.pasteAreaMm2) {
    sections.push({
      title: 'Solder paste openings',
      rows: (['top', 'bottom'] as const).flatMap((side) => {
        const area = graph.pasteAreaMm2?.[side];
        return area === undefined ? [] : [{ label: `${side} side`, value: `${Number(area.toFixed(0)).toLocaleString('en-US')} mm²`, provenance: prov(`pasteAreaMm2.${side}`) }];
      }),
    });
  }

  sections.push({
    title: 'Placements',
    rows: graph.placements.map((p) => ({
      label: `${p.side} · ${p.footprint ?? 'unnamed footprint'}`,
      value: `${p.count} × ${p.packageClass === 'unknown' ? 'class unknown' : p.packageClass}`,
      provenance: prov('placements'),
    })),
  });

  if (graph.thtParts.length > 0) {
    sections.push({
      title: 'Through-hole parts',
      rows: graph.thtParts.map((t) => ({ label: t.label, value: `${t.count} parts × ${t.jointsPerPart} joints`, provenance: prov('thtParts') })),
    });
  }
  return sections;
}

function harness(graph: HarnessGraph): Section[] {
  const prov = (key: string) => provenanceLabel(graph.provenance[key]);
  const sections: Section[] = [
    {
      title: 'Circuits',
      rows: graph.circuits.map((c) => ({
        label: c.id,
        value: `${c.awg} AWG · ${mm(c.lengthMm, 0)}${c.colour ? ` · ${c.colour}` : ''} · ${c.terminalCount} terminal(s) · ${c.sealCount} seal(s)`,
        provenance: prov('circuits'),
      })),
    },
  ];
  if (graph.connectors.length > 0) {
    sections.push({ title: 'Connectors', rows: graph.connectors.map((c) => ({ label: c.id, value: `${c.cavities} cavities`, provenance: prov('connectors') })) });
  }
  const extras: Row[] = [];
  if (graph.sleeveLengthMm !== undefined) extras.push({ label: 'Sleeve', value: mm(graph.sleeveLengthMm, 0), provenance: prov('sleeveLengthMm') });
  const counts: [string, keyof HarnessGraph][] = [['Grommets', 'grommetCount'], ['Splices', 'spliceCount'], ['Branches', 'branchCount'], ['Labels', 'labelCount']];
  for (const [label, key] of counts) {
    const value = graph[key];
    if (typeof value === 'number') extras.push({ label, value: String(value), provenance: prov(key) });
  }
  if (extras.length > 0) sections.push({ title: 'Other', rows: extras });
  return sections;
}

export function describeGraph(graph: FeatureGraph): Section[] {
  return graph.kind === 'board' ? board(graph) : harness(graph);
}

/** What the graph says it does not know, for the "unresolved" list. */
export function unresolvedRows(graph: FeatureGraph): Row[] {
  return graph.unresolved.map((u) => ({ label: u.field, value: u.reason }));
}
