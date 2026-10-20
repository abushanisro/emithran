import type { DesignView, ItemType, RevisionView } from '@/lib/api/electronics';

type Status = NonNullable<RevisionView['status']>;

const STATUS_LABEL: Record<Status, string> = {
  uploaded: 'Queued',
  parsing: 'Reading files',
  needs_review: 'Needs review',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

/** Words for an upload status; a revision whose upload does not exist yet has none. */
export function statusLabel(status: RevisionView['status']): string {
  return status ? STATUS_LABEL[status] : 'No upload';
}

/** True while the engine is still working, so a list should keep refreshing. */
export function isInFlight(status: RevisionView['status']): boolean {
  return status === 'uploaded' || status === 'parsing';
}

/** The newest revision (the API returns them newest first). */
export function latestRevision(design: DesignView): RevisionView | null {
  return design.revisions[0] ?? null;
}

/** PCB, PCBA or wire harness. Whether a board is assembled follows from its extracted placements; until it is read it is just a board. */
export function typeLabel(design: Pick<DesignView, 'kind' | 'summary' | 'itemType'>): string {
  if (design.kind === 'assembly') return itemTypeLabel(design.itemType);
  if (design.kind === 'harness') return 'Wire harness';
  if (design.summary?.kind === 'board') return design.summary.assembled ? 'PCBA' : 'PCB';
  return 'Board';
}

/** The revision to show: the one asked for when it exists, otherwise the newest. */
export function selectRevision(design: DesignView, revisionId: string | null): RevisionView | null {
  return design.revisions.find((r) => r.id === revisionId) ?? latestRevision(design);
}

export interface DetailItem {
  label: string;
  value: string;
}

/**
 * The label/value pairs one design card shows, in the order of the BOM item card. Only what the files measured appears;
 * a value the files did not state is shown as a dash, never estimated.
 */
export function detailItems(design: DesignView): DetailItem[] {
  const latest = latestRevision(design);
  const common: DetailItem[] = [
    { label: 'Revision', value: latest?.revision ?? '—' },
    { label: 'Revisions', value: String(design.revisions.length) },
  ];
  const s = design.summary;
  if (!s) return [...common, { label: 'Features', value: latest && isInFlight(latest.status) ? 'being read…' : '—' }];
  if (s.kind === 'board') {
    return [
      ...common,
      { label: 'Layers', value: String(s.layers) },
      { label: 'Size', value: `${s.lengthMm}×${s.widthMm} mm` },
      { label: 'Thickness', value: s.thicknessMm === null ? '—' : `${s.thicknessMm} mm` },
      { label: 'Holes', value: s.holeCount.toLocaleString() },
      { label: 'Placements', value: s.placementCount.toLocaleString() },
      { label: 'Unresolved', value: String(s.unresolvedCount) },
    ];
  }
  return [
    ...common,
    { label: 'Circuits', value: String(s.circuitCount) },
    { label: 'Connectors', value: String(s.connectorCount) },
    { label: 'Unresolved', value: String(s.unresolvedCount) },
  ];
}

/** The Electronics module of a project: designs only exist inside a project. */
export function listHref(projectId: string): string {
  return `/projects/${projectId}/electronics`;
}

/** The workspace of one design of a project (optionally on one revision). */
export function designHref(projectId: string, designId: string, revisionId?: string): string {
  return `${listHref(projectId)}/${designId}${revisionId ? `?revision=${revisionId}` : ''}`;
}

/** The BOM-style name of a level in the structure. */
export function itemTypeLabel(type: ItemType): string {
  return type === 'assembly' ? 'Assembly' : type === 'sub_assembly' ? 'Sub-Assembly' : 'Child Part';
}

export interface DesignNode {
  design: DesignView;
  /** 0 for a top-level item; shown as L0, L1, L2 like the BOM level. */
  depth: number;
  children: DesignNode[];
}

/**
 * The designs of a project as the tree they form (Assembly > Sub-Assembly > Child Part). Top-level items come first in the
 * order given; a design whose container is not in the list is shown at the top level rather than dropped.
 */
export function buildDesignTree(designs: DesignView[]): DesignNode[] {
  const ids = new Set(designs.map((d) => d.id));
  const byParent = new Map<string | null, DesignView[]>();
  for (const d of designs) {
    const key = d.parentId && ids.has(d.parentId) ? d.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), d]);
  }
  const build = (parent: string | null, depth: number): DesignNode[] =>
    (byParent.get(parent) ?? []).map((design) => ({ design, depth, children: build(design.id, depth + 1) }));
  return build(null, 0);
}

export const levelLabel = (depth: number) => `L${depth}`;

/** Every child part below a node (the boards and harnesses), in tree order. */
export function partsUnder(node: DesignNode): DesignView[] {
  return node.children.flatMap((c) => (c.design.itemType === 'child_part' ? [c.design] : partsUnder(c)));
}

/** What a container card shows in place of measured values: how many parts it holds and how many need attention. */
export function containerDetails(node: DesignNode): DetailItem[] {
  const parts = partsUnder(node);
  const boards = parts.filter((p) => p.kind === 'board').length;
  const harnesses = parts.filter((p) => p.kind === 'harness').length;
  const attention = parts.filter((p) => p.revisions[0]?.status === 'failed').length;
  const reading = parts.filter((p) => isInFlight(p.revisions[0]?.status ?? null)).length;
  return [
    { label: 'Child parts', value: String(parts.length) },
    { label: 'Boards', value: String(boards) },
    { label: 'Harnesses', value: String(harnesses) },
    { label: 'Sub-assemblies', value: String(countContainers(node)) },
    { label: 'Failed', value: String(attention) },
    { label: 'Being read', value: String(reading) },
  ];
}

function countContainers(node: DesignNode): number {
  return node.children.reduce((n, c) => n + (c.design.itemType === 'sub_assembly' ? 1 : 0) + countContainers(c), 0);
}

/** A design and everything below it, in tree order, for the page of one assembly. */
export function subtreeOf(designs: DesignView[], rootId: string): DesignView[] {
  const flat = (node: DesignNode): DesignView[] => [node.design, ...node.children.flatMap(flat)];
  const find = (nodes: DesignNode[]): DesignNode | null => {
    for (const n of nodes) {
      if (n.design.id === rootId) return n;
      const inner = find(n.children);
      if (inner) return inner;
    }
    return null;
  };
  const root = find(buildDesignTree(designs));
  return root ? flat(root) : [];
}

export interface DeleteImpact {
  containers: number;
  parts: number;
  revisions: number;
}

/** What deleting a node removes: itself and everything below it. Shown in the confirmation so nothing is deleted unseen. */
export function deleteImpact(node: DesignNode): DeleteImpact {
  const own: DeleteImpact = node.design.itemType === 'child_part' ? { containers: 0, parts: 1, revisions: node.design.revisions.length } : { containers: 1, parts: 0, revisions: 0 };
  return node.children.reduce((sum, child) => {
    const c = deleteImpact(child);
    return { containers: sum.containers + c.containers, parts: sum.parts + c.parts, revisions: sum.revisions + c.revisions };
  }, own);
}

/** The sentence a delete confirmation states. */
export function deleteSentence(impact: DeleteImpact): string {
  const bits: string[] = [];
  if (impact.containers > 0) bits.push(`${impact.containers} assembl${impact.containers === 1 ? 'y' : 'ies'} and sub-assembl${impact.containers === 1 ? 'y' : 'ies'}`);
  if (impact.parts > 0) bits.push(`${impact.parts} child part${impact.parts === 1 ? '' : 's'}`);
  if (impact.revisions > 0) bits.push(`${impact.revisions} revision${impact.revisions === 1 ? '' : 's'} with their uploaded files, extracted features and cost results`);
  return bits.join(', ');
}

/** True when a revision's files were read, so it has features to show. */
export function isRead(revision: RevisionView | null): boolean {
  return !!revision?.uploadId && (revision.status === 'needs_review' || revision.status === 'confirmed');
}

/** The full-screen intelligence workspace of a board (the same route shape as the part manufacturing-intelligence page). */
export function intelligenceHref(projectId: string, designId: string, revisionId?: string): string {
  return `${listHref(projectId)}/${designId}/manufacturing-intelligence${revisionId ? `?revision=${revisionId}` : ''}`;
}

/** Where opening a design goes: a board whose revision was read opens the intelligence workspace; anything else opens its page. */
export function openHref(projectId: string, design: DesignView, revisionId?: string): string {
  const revision = selectRevision(design, revisionId ?? null);
  return design.kind === 'board' && isRead(revision) ? intelligenceHref(projectId, design.id, revisionId) : designHref(projectId, design.id, revisionId);
}
