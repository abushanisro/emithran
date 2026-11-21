// What dropping one BOM item on another does, decided once: the row under the cursor shows it while dragging, and the drop carries it out.
// Pure. The rules are the BOM table's: siblings of one type reorder, root assemblies swap, a child part goes into a sub-assembly or an
// assembly, a sub-assembly into an assembly; nothing goes into its own sub-components.

export interface DropItem {
  id: string;
  name: string;
  itemType: string;
  parentItemId?: string | null;
  bomLevel?: string | null;
}

export type DropIntent =
  /** Dropped on itself, or where it already is: nothing to do. */
  | { kind: 'none'; label: string }
  /** Not a move the BOM allows; the label says why. */
  | { kind: 'invalid'; label: string }
  /** A sibling of the same type: it takes the target's place, the target and those after it move down one. */
  | { kind: 'reorder'; label: string }
  /** Two root assemblies trade places. */
  | { kind: 'swap'; label: string }
  /** It moves under the target, at the target's child level. */
  | { kind: 'into'; label: string; parentId: string; bomLevel: string };

const TYPE_NAME: Readonly<Record<string, string>> = { assembly: 'an assembly', sub_assembly: 'a sub-assembly', child_part: 'a child part' };
const typeName = (t: string) => TYPE_NAME[t] ?? t.replace(/_/g, ' ');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isRoot = (i: DropItem) => !i.parentItemId?.trim();

/** Whether `ancestorId` sits above `id` in the tree (moving it under `id` would close a loop). */
function isUnder(items: readonly DropItem[], id: string, ancestorId: string): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  for (let cur = byId.get(id)?.parentItemId ?? null; cur && !seen.has(cur); cur = byId.get(cur)?.parentItemId ?? null) {
    if (cur === ancestorId) return true;
    seen.add(cur);
  }
  return false;
}

export function dropIntent(dragged: DropItem, target: DropItem, items: readonly DropItem[]): DropIntent {
  if (dragged.id === target.id) return { kind: 'none', label: '' };
  if (isUnder(items, target.id, dragged.id)) return { kind: 'invalid', label: `“${dragged.name}” can't go into its own sub-components` };
  if ((dragged.parentItemId ?? null) === (target.parentItemId ?? null) && dragged.itemType === target.itemType) {
    return { kind: 'reorder', label: `Move before “${target.name}”` };
  }
  if (dragged.itemType === 'assembly' && target.itemType === 'assembly' && isRoot(dragged) && isRoot(target)) {
    return { kind: 'swap', label: `Swap with “${target.name}”` };
  }
  const intoAllowed =
    (dragged.itemType === 'child_part' && (target.itemType === 'sub_assembly' || target.itemType === 'assembly'))
    || (dragged.itemType === 'sub_assembly' && target.itemType === 'assembly');
  if (!intoAllowed) return { kind: 'invalid', label: `${cap(typeName(dragged.itemType))} can't go into ${typeName(target.itemType)}` };
  const bomLevel = target.itemType === 'assembly' && dragged.itemType === 'sub_assembly' ? 'L1' : 'L2';
  if (dragged.parentItemId === target.id && dragged.bomLevel === bomLevel) return { kind: 'none', label: `Already in “${target.name}”` };
  return { kind: 'into', label: `Move into “${target.name}”`, parentId: target.id, bomLevel };
}
