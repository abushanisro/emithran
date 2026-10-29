import { BOMItemType } from '../bom-items/dto/bom-items.dto';

import type { AssemblyNode, AssemblyPart, AssemblyReport } from './assembly-report';

export interface PlannedItem {
  /** Position in the tree ("0", "0.1", ...); a child's parent is the key before its last dot. */
  key: string;
  parentKey: string | null;
  name: string;
  itemType: BOMItemType;
  quantity: number;
  partNumber: string;
  /** The uploaded file that is exactly this part (a single-part STEP), to attach as its 3D file; null for parts inside an assembly file. */
  ownFile: string | null;
  /** The part's definition id (what /assembly/parts exports); null for assemblies. */
  definition: string | null;
  /** What the engine measured for a part (mm, mm², mm³; bounding box sorted longest first); absent when it could not. */
  measured: { volume: number; surfaceArea: number; maxLength: number; maxWidth: number; maxHeight: number } | null;
}

/** The BOM lines an engine report becomes: one per tree node, parents before children. Pure. */
export function planItems(report: AssemblyReport, uploadTag: string): PlannedItem[] {
  const partById = new Map(report.parts.map((p) => [p.id, p]));
  const ownFiles = new Map(report.assembly.filter((n) => n.kind === 'part').map((n) => [n.definition, n.file]));
  const items: PlannedItem[] = [];
  const walk = (node: AssemblyNode, key: string, parentKey: string | null) => {
    items.push({
      key,
      parentKey,
      name: node.name,
      itemType: node.kind === 'part' ? BOMItemType.CHILD_PART : parentKey === null ? BOMItemType.ASSEMBLY : BOMItemType.SUB_ASSEMBLY,
      quantity: node.quantity,
      partNumber: `${slug(node.name)}-${uploadTag}-${items.length + 1}`,
      ownFile: node.kind === 'part' ? (ownFiles.get(node.definition) ?? null) : null,
      definition: node.kind === 'part' ? node.definition : null,
      measured: node.kind === 'part' ? measured(partById.get(node.definition)) : null,
    });
    node.children.forEach((child, i) => walk(child, `${key}.${i}`, key));
  };
  report.assembly.forEach((root, i) => walk(root, String(i), null));
  return items;
}

function measured(part: AssemblyPart | undefined): PlannedItem['measured'] {
  if (!part || part.volume_mm3 === null || part.surface_area_mm2 === null || part.bounding_box === null) return null;
  const { length, width, height } = part.bounding_box;
  return { volume: part.volume_mm3, surfaceArea: part.surface_area_mm2, maxLength: length, maxWidth: width, maxHeight: height };
}

function slug(name: string): string {
  const s = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
  return s || 'PART';
}
