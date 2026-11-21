'use client';

import dynamic from 'next/dynamic';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';

const BOMItemThumbnail = dynamic(
  () => import('./BOMItemThumbnail').then((m) => m.BOMItemThumbnail),
  { ssr: false, loading: () => null }
);
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Edit2, Trash2, Plus, ChevronDown, ChevronRight, FileText, Box, GripVertical, Cpu, Info, Layers, Layers3, Package, Search, X } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';

// ✅ Fix 6133: Removed unused imports: ArrowRight, Move

import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBOMItems, deleteBOMItem, updateBOMItem, updateBOMItemsSortOrder, type BOMItem } from '@/lib/api/hooks/useBOMItems';
import { dropIntent, type DropIntent } from '@/lib/bom/drop-intent';
import { rowFacts } from '@/lib/bom/row-summary';
import { filterTree, highlightParts, matchesQuery, visibleTreeRows } from '@/lib/bom/tree-rows';

import { useQueryClient } from '@tanstack/react-query';

import { BOMItemType } from '@/lib/types/bom.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BOMItemsFlatProps {
  bomId: string;
  onEditItem: (item: BOMItem) => void;
  onViewItem?: (item: BOMItem, viewType?: '2d' | '3d' | 'intelligence') => void;
  onAddChildItem?: (parentId: string, childType: BOMItemType) => void;
  /** BOM totals exactly as the server reports them; shown in the fixed footer row. */
  totalCost?: number;
  /** The page's own buttons (add an item), shown at the right of the list's toolbar, as Gmail keeps its actions above the list. */
  toolbarActions?: React.ReactNode;
}

interface TreeNode extends BOMItem {
  children: TreeNode[];
  depth: number;
}

// ---------------------------------------------------------------------------
// Helpers (pure, defined outside component to avoid re-creation)
// ---------------------------------------------------------------------------

const TYPE_ORDER: Record<string, number> = {
  assembly: 0,
  sub_assembly: 1,
  child_part: 2,
};

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const aTypeOrder = TYPE_ORDER[a.itemType] ?? 3;
    const bTypeOrder = TYPE_ORDER[b.itemType] ?? 3;
    if (aTypeOrder !== bTypeOrder) return aTypeOrder - bTypeOrder;

    const aSortOrder = a.sortOrder || 0;
    const bSortOrder = b.sortOrder || 0;

    if (aSortOrder > 0 && bSortOrder > 0 && aSortOrder !== bSortOrder) return aSortOrder - bSortOrder;
    if (aSortOrder > 0 && bSortOrder === 0) return -1;
    if (bSortOrder > 0 && aSortOrder === 0) return 1;

    const aCreated = new Date(a.createdAt).getTime();
    const bCreated = new Date(b.createdAt).getTime();
    if (aCreated !== bCreated) return aCreated - bCreated;

    return a.name.localeCompare(b.name);
  });

  nodes.forEach(node => {
    if (node.children.length > 0) sortNodes(node.children);
  });
}

/** The BOM level a row shows: its own, or its type's default when it has none. */
function levelOf(item: { bomLevel?: string; itemType: string }): string {
  const own = item.bomLevel?.trim() ?? '';
  return own.length > 0 ? own : getDefaultBomLevel(item.itemType);
}

function getDefaultBomLevel(itemType: string): string {
  switch (itemType) {
    case 'assembly':    return 'L0';
    case 'sub_assembly': return 'L1';
    case 'child_part':  return 'L2';
    default:            return 'L0';
  }
}

/**
 * Each item type's colour: assembly green, sub-assembly blue, child part yellow. The row's left bar, its tree lines (an assembly's lines down
 * to its sub-assemblies are green, a sub-assembly's down to its parts blue), a faint tint on the parent rows, the type badge (its text a
 * shade darker in light mode, so it reads on white), the icon of a part with no file, and the legend's dot. Static class names: Tailwind
 * cannot build them at runtime.
 */
interface TypeStyle {
  label: string; Icon: React.ComponentType<{ className?: string }>;
  accent: string; line: string; tint: string; badge: string; icon: string; dot: string;
}
const TYPE_STYLE: Record<string, TypeStyle> = {
  assembly: {
    label: 'Assembly', Icon: Layers, accent: 'border-l-4 border-l-emerald-500', line: 'border-emerald-500', tint: 'bg-emerald-500/[0.04]',
    badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', icon: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500',
  },
  sub_assembly: {
    label: 'Sub-Assembly', Icon: Layers3, accent: 'border-l-4 border-l-blue-500', line: 'border-blue-500', tint: 'bg-blue-500/[0.04]',
    badge: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400', icon: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500',
  },
  child_part: {
    label: 'Child Part', Icon: Box, accent: 'border-l-4 border-l-yellow-400', line: 'border-yellow-400', tint: '',
    badge: 'border-yellow-500/50 bg-yellow-400/15 text-yellow-800 dark:text-yellow-300', icon: 'text-yellow-600 dark:text-yellow-400', dot: 'bg-yellow-400',
  },
};
const LEGEND_TYPES = ['assembly', 'sub_assembly', 'child_part'] as const;

function typeStyleOf(type: string): TypeStyle {
  return TYPE_STYLE[type] ?? {
    label: type, Icon: Package, accent: 'border-l-4 border-l-border', line: 'border-border', tint: '',
    badge: 'border-border bg-muted text-muted-foreground', icon: 'text-muted-foreground', dot: 'bg-muted-foreground',
  };
}

function getItemTypeBadge(type: string): React.ReactElement {
  const style = typeStyleOf(type);
  return (
    <Badge variant="outline" className={`h-4 shrink-0 px-1.5 text-[10px] font-medium leading-none ${style.badge}`}>
      {style.label}
    </Badge>
  );
}

function getChildType(parentType: string): BOMItemType | null {
  switch (parentType) {
    case 'assembly':    return BOMItemType.SUB_ASSEMBLY;
    case 'sub_assembly': return BOMItemType.CHILD_PART;
    default:            return null;
  }
}

// ✅ Fix 2339: proper unknown → typed error extraction
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'An unexpected error occurred';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BOMItemsFlat({ bomId, onEditItem, onViewItem, onAddChildItem, totalCost, toolbarActions }: BOMItemsFlatProps) {
  const { data, isLoading, refetch } = useBOMItems(bomId);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete]         = useState<BOMItem | null>(null);
  const [expandedItems, setExpandedItems]       = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem]           = useState<BOMItem | null>(null);
  const [dragOverItem, setDragOverItem]         = useState<string | null>(null);
  const [isUpdating, setIsUpdating]             = useState(false);
  const [detailItem, setDetailItem]             = useState<BOMItem | null>(null);

  const items = data?.items ?? [];

  // -------------------------------------------------------------------------
  // Tree builder
  // -------------------------------------------------------------------------

  const buildTree = useCallback((flatItems: BOMItem[]): TreeNode[] => {
    if (flatItems.length === 0) return [];

    const itemMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    flatItems.forEach(item => itemMap.set(item.id, { ...item, children: [], depth: 0 }));

    flatItems.forEach(item => {
      const node = itemMap.get(item.id)!;

      if (item.parentItemId?.trim()) {
        const parent = itemMap.get(item.parentItemId);
        if (parent) {
          parent.children.push(node);
          node.depth = parent.depth + 1;
        } else {
          console.warn(`Parent ${item.parentItemId} not found for item ${item.name}, treating as root`);
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    });

    sortNodes(roots);

    if (process.env.NODE_ENV === 'development' && flatItems.length > 0) {
      console.log('Tree structure built:', { totalItems: flatItems.length, rootItems: roots.length });
    }

    return roots;
  }, []);

  const treeData = useMemo(
    () => buildTree(items),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      items.length,
      items.map(i => `${i.id}-${i.parentItemId}-${i.itemType}-${i.bomLevel}-${i.updatedAt}-${i.createdAt}-${i.sortOrder}`).join(','),
      buildTree,
    ],
  );

  // Search by name or part number: the matches with their ancestors (their place in the BOM), the branches to them opened.
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const search = query.trim();
  const filtered = useMemo(
    () => (search ? filterTree(treeData, (n) => matchesQuery(search, n.name, n.partNumber)) : null),
    [treeData, search],
  );
  // "/" puts the cursor in the search box, unless one is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, []);
  // The matched words, marked in a name or a part number.
  const marked = (text: string): React.ReactNode =>
    search
      ? highlightParts(text, search).map(([part, hit], i) => (hit ? <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-500/40">{part}</mark> : part))
      : text;

  // Auto-expand root assemblies on first load
  useEffect(() => {
    if (items.length === 0) return;

    const rootAssemblies = new Set(
      items
        .filter(item => item.itemType === 'assembly' && !item.parentItemId?.trim())
        .map(item => item.id),
    );

    setExpandedItems(prev => {
      if (prev.size === rootAssemblies.size && [...prev].every(id => rootAssemblies.has(id))) return prev;
      return rootAssemblies;
    });
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // UI actions
  // -------------------------------------------------------------------------

  // Every item that has children, opened or closed at once.
  const expandAll = () => {
    const parents = new Set(items.map(i => i.parentItemId?.trim()).filter((id): id is string => !!id));
    setExpandedItems(new Set(items.filter(i => parents.has(i.id)).map(i => i.id)));
  };
  const collapseAll = () => { setExpandedItems(new Set()); };

  const toggleExpand = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  const handleDeleteClick   = (item: BOMItem) => { setItemToDelete(item); setDeleteDialogOpen(true); };
  const handleAddChild      = (item: BOMItem) => {
    const childType = getChildType(item.itemType);
    if (childType && onAddChildItem) onAddChildItem(item.id, childType);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    try {
      await deleteBOMItem(itemToDelete.id);
      toast.success(`"${itemToDelete.name}" has been deleted successfully from the BOM.`);
      refetch();
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      let friendly = 'Failed to delete item. Please try again.';
      if (msg.includes('permission'))  friendly = 'You do not have permission to delete this item.';
      else if (msg.includes('network')) friendly = 'Network error. Please check your connection and try again.';
      else if (msg.includes('dependency')) friendly = 'Cannot delete: remove child items first.';
      else if (msg.includes('not found'))  friendly = 'Item not found. It may have already been deleted.';
      else friendly = `Failed to delete item: ${msg}`;
      toast.error(friendly, { duration: 6000 });
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  // -------------------------------------------------------------------------
  // Drag & Drop
  // -------------------------------------------------------------------------

  // The browser's own drag and drop, done properly: the image under the cursor is a small card of the dragged item (drawn below, off
  // screen), not a snapshot of the whole table row; only the row under the cursor shows what dropping there does (lib/bom/drop-intent.ts),
  // and a row where the move is not allowed is no drop target, so the browser shows its not-allowed cursor.
  const dragCardRef = useRef<HTMLDivElement>(null);
  const expandTimer = useRef<number | null>(null);
  // A drop ends on a row; the click the browser may send after it must not open that row.
  const lastDropAt  = useRef(0);
  const isDragging  = draggedItem !== null;

  const clearExpandTimer = () => {
    if (expandTimer.current !== null) { window.clearTimeout(expandTimer.current); expandTimer.current = null; }
  };
  const resetDrag = () => { clearExpandTimer(); setDraggedItem(null); setDragOverItem(null); };

  const handleDragStart = (e: React.DragEvent, item: BOMItem) => {
    if (isUpdating) { e.preventDefault(); return; }
    e.stopPropagation();
    // Draw the drag card for this item now, so the browser takes it (not the row) as the drag image, held where the cursor grabbed it.
    flushSync(() => { setDraggedItem(item); setDragOverItem(null); });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    if (dragCardRef.current) e.dataTransfer.setDragImage(dragCardRef.current, 16, 16);
  };

  const handleDragEnd = () => { resetDrag(); };

  const handleDragOver = (e: React.DragEvent, target: BOMItem) => {
    if (!draggedItem) return;
    const intent = dropIntent(draggedItem, target, items);
    if (dragOverItem !== target.id) {
      setDragOverItem(target.id);
      clearExpandTimer();
      // Resting on a closed parent it can go into opens it, so a part deeper down can be reached.
      if (intent.kind === 'into' && !expandedItems.has(target.id) && items.some(c => c.parentItemId === target.id)) {
        expandTimer.current = window.setTimeout(() => { setExpandedItems(prev => new Set(prev).add(target.id)); }, 700);
      }
    }
    // Only a real move is a drop target; elsewhere the browser shows the not-allowed cursor and a drop does nothing.
    if (intent.kind === 'none' || intent.kind === 'invalid') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, target: BOMItem) => {
    e.preventDefault();
    e.stopPropagation();
    lastDropAt.current = Date.now();
    const dragged = draggedItem;
    resetDrag();
    if (!dragged || isUpdating || dragged.id !== e.dataTransfer.getData('text/plain')) return;

    const intent: DropIntent = dropIntent(dragged, target, items);
    if (intent.kind === 'none') return;
    if (intent.kind === 'invalid') { toast.error('Not moved', { description: intent.label, duration: 4000 }); return; }

    try {
      setIsUpdating(true);

      if (intent.kind === 'reorder') {
        // Same parent, same type: the dragged item takes the target's place.
        const siblings = items
          .filter(i => i.parentItemId === dragged.parentItemId && i.itemType === dragged.itemType)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const withoutDragged = siblings.filter(i => i.id !== dragged.id);
        withoutDragged.splice(withoutDragged.findIndex(i => i.id === target.id), 0, dragged);
        await updateBOMItemsSortOrder(withoutDragged.map((item, index) => ({ id: item.id, sortOrder: index })));
        toast.success(`Reordered “${dragged.name}”`, { description: `now before “${target.name}”`, duration: 3000 });
      } else if (intent.kind === 'swap') {
        await updateBOMItem(dragged.id, { sortOrder: target.sortOrder });
        await updateBOMItem(target.id,  { sortOrder: dragged.sortOrder });
        toast.success('Assemblies reordered', { description: `${dragged.name} ↔ ${target.name}`, duration: 3000 });
      } else {
        await updateBOMItem(dragged.id, { parentItemId: intent.parentId, bomLevel: intent.bomLevel, itemType: dragged.itemType });
        // Open the new parent, so the moved item is in view where it landed.
        setExpandedItems(prev => new Set(prev).add(intent.parentId));
        toast.success(`Moved “${dragged.name}”`, { description: `into “${target.name}”`, duration: 3000 });
      }

      void queryClient.invalidateQueries({ queryKey: ['bom-items'] });
      await refetch();
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      toast.error('Failed to move item', { description: msg || 'Please try again.', duration: 5000 });
    } finally {
      setIsUpdating(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  // Round icon buttons, as Gmail's; their hover a shade darker than the row's (the row is already the hover colour).
  const actionButton = 'h-7 w-7 rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground';
  const formatCost = (cost: number | undefined): string =>
    typeof cost === 'number' ? cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  // Gmail's hover: the row's actions take the place of its cost while the pointer is on the row (or a key has focus in it); a touch screen,
  // with no hover, shows them all the time. Not while dragging: then the rows show where a drop would go.
  const costHidden   = isDragging ? '' : 'group-hover:invisible group-focus-within:invisible pointer-coarse:invisible';
  const actionsShown = isDragging
    ? ''
    : 'group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100';

  /**
   * One row of the tree. `guides`: for each ancestor level below the root, whether its line continues past this row (that ancestor has
   * more children below); `isLast`: this row is the last of its parent's children, so its connector ends here (└) instead of going on (├).
   */
  const renderRow = (item: TreeNode, depth: number, guides: boolean[] = [], isLast = true, path: TreeNode[] = []): React.ReactElement => {
    const hasChildren    = item.children.length > 0;
    const isExpanded     = expandedItems.has(item.id);
    const isDraggedOver  = dragOverItem === item.id;
    const isBeingDragged = draggedItem?.id === item.id;
    const childType      = getChildType(item.itemType);
    const style          = typeStyleOf(item.itemType);
    const facts          = rowFacts(item, levelOf(item));
    // Every line takes the colour of the items it leads to: this row's connector its own type's (a child part's yellow, a sub-assembly's
    // blue), a line running past it the colour of the branch it joins (path[i + 1], the ancestor whose next sibling it reaches), and the
    // line down from an open parent its children's.
    const lineOf         = (node: TreeNode | undefined) => typeStyleOf(node?.itemType ?? '').line;
    // What dropping the dragged item here would do: shown on this row only, while it is under the cursor.
    const overIntent     = isDraggedOver && draggedItem ? dropIntent(draggedItem, item, items) : null;
    const dropClass      = !overIntent ? ''
      : overIntent.kind === 'into' ? 'bg-primary/10 [&>td]:shadow-[inset_0_2px_0_0_hsl(var(--primary)),inset_0_-2px_0_0_hsl(var(--primary))]'
      : overIntent.kind === 'reorder' || overIntent.kind === 'swap' ? '[&>td]:shadow-[inset_0_3px_0_0_hsl(var(--primary))]'
      : overIntent.kind === 'invalid' ? 'bg-destructive/5 [&>td]:shadow-[inset_0_2px_0_0_hsl(var(--destructive)),inset_0_-2px_0_0_hsl(var(--destructive))]'
      : '';

    return (
      <tr
        key={item.id}
        aria-level={depth + 1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        draggable={!isUpdating}
        onDragStart={e => { handleDragStart(e, item); }}
        onDragEnd={handleDragEnd}
        onDragOver={e => { handleDragOver(e, item); }}
        onDrop={e => { void handleDrop(e, item); }}
        onClick={e => {
          if (isDragging || Date.now() - lastDropAt.current < 300) { e.preventDefault(); e.stopPropagation(); return; }
          // Clicking a row opens Manufacturing Intelligence -- the same
          // destination as the Cpu button. Explicit controls keep their own meaning.
          if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return;
          e.stopPropagation();
          onViewItem?.(item, 'intelligence');
        }}
        className={[
          'group border-b transition-colors',
          // Opaque, so the actions shown over the end of the row's details on hover (same colour) cover them cleanly.
          isDragging ? '' : 'hover:bg-accent',
          // The row being dragged stays in place, faded, so you see where it came from.
          isBeingDragged ? 'bg-muted/40 opacity-40' : '',
          dropClass,
          isUpdating ? 'cursor-wait opacity-75' : 'cursor-pointer',
          dropClass ? '' : style.tint,
        ].join(' ')}
      >
        <td className={`p-0 ${style.accent}`}>
          <div className="flex h-14 min-w-0 items-stretch pr-2">
            {/* Drag handle: the whole row is draggable; the grip shows where to take it. */}
            <span className="flex w-6 shrink-0 items-center justify-center">
              <GripVertical
                className={`h-3.5 w-3.5 cursor-grab active:cursor-grabbing transition-opacity ${
                  isBeingDragged ? 'text-primary' : 'text-muted-foreground/60 opacity-0 group-hover:opacity-100'
                }`}
                aria-hidden="true"
              />
            </span>
            {/* Tree guides: a line under each ancestor with more children below, then this row's connector (├ or └). */}
            {guides.map((continues, i) => (
              <span key={i} className="relative w-5 shrink-0" aria-hidden="true">
                {continues && <span className={`absolute inset-y-0 left-1/2 border-l-2 ${lineOf(path[i + 1])}`} />}
              </span>
            ))}
            {depth > 0 && (
              <span className="relative w-5 shrink-0" aria-hidden="true">
                <span className={`absolute left-1/2 top-0 border-l-2 ${style.line} ${isLast ? 'h-[calc(50%+1px)]' : 'h-full'}`} />
                <span className={`absolute left-1/2 top-1/2 w-2.5 border-t-2 ${style.line}`} />
              </span>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* Expand / collapse, with the line down to the first child when open. */}
              <span className="relative flex w-5 shrink-0 items-center justify-center self-stretch">
                {hasChildren ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative z-[1] h-5 w-5 rounded-sm"
                      aria-label={isExpanded ? `Collapse ${item.name}` : `Expand ${item.name}`}
                      onClick={() => { toggleExpand(item.id); }}
                    >
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </Button>
                    {isExpanded && <span className={`absolute bottom-0 left-1/2 top-[calc(50%+10px)] border-l-2 ${lineOf(item.children[0])}`} aria-hidden="true" />}
                  </>
                ) : null}
              </span>
              {(item.file3dPath || item.file2dPath) ? (
                <BOMItemThumbnail
                  item={item}
                  size="sm"
                  onClick={() => onViewItem?.(item, item.file3dPath ? '3d' : '2d')}
                />
              ) : (
                <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded border border-border/60 bg-muted/40" aria-hidden="true">
                  <style.Icon className={`h-5 w-5 ${style.icon}`} />
                </span>
              )}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium leading-5 text-foreground" title={item.name}>{marked(item.name)}</span>
                  {getItemTypeBadge(item.itemType)}
                  {hasChildren && (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {item.children.length} {item.children.length === 1 ? 'item' : 'items'}
                    </span>
                  )}
                  {overIntent && overIntent.kind !== 'none' && (
                    <span
                      role="status"
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none shadow-sm ${
                        overIntent.kind === 'invalid' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      {overIntent.label}
                    </span>
                  )}
                  {item.parentItemId && items.some(o => o.id === item.parentItemId && o.parentItemId === item.id) && (
                    <Badge variant="destructive" className="h-4 shrink-0 px-1.5 text-[10px]">Circular Ref</Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </td>
        {/* Gmail's subject and snippet: the part number, then the row's details in one line, cut short at the edge (all of it on hover). */}
        <td className="max-w-0 px-2 py-0">
          <div className="truncate text-[13px] leading-5" title={[item.partNumber, ...facts].filter(Boolean).join(' · ')}>
            {item.partNumber && <span className="text-foreground">{marked(item.partNumber)}</span>}
            {item.partNumber && facts.length > 0 && <span className="text-muted-foreground"> — </span>}
            <span className="text-muted-foreground">{facts.join(' · ')}</span>
          </div>
        </td>
        {/* Gmail's date: the unit cost, which the row's actions replace on hover. */}
        <td className="relative whitespace-nowrap py-0 pl-2 pr-3 text-right">
          <span className={`text-[13px] font-medium tabular-nums ${costHidden}`}>{formatCost(item.unitCost)}</span>
          <div className={`pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end gap-0.5 bg-accent pl-2 pr-2 opacity-0 transition-opacity pointer-coarse:bg-card ${actionsShown}`}>
            {item.file2dPath && (
              <Button variant="ghost" size="icon" className={actionButton} onClick={() => onViewItem?.(item, '2d')} title="View 2D Drawing" aria-label="View 2D Drawing">
                <FileText className="h-3.5 w-3.5" />
              </Button>
            )}
            {item.file3dPath && (
              <Button variant="ghost" size="icon" className={actionButton} onClick={() => onViewItem?.(item, '3d')} title="View 3D Model" aria-label="View 3D Model">
                <Box className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className={actionButton} onClick={() => { setDetailItem(item); }} title="Part details" aria-label="Part details">
              <Info className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full hover:bg-foreground/10"
              onClick={(e) => { e.stopPropagation(); onViewItem?.(item, 'intelligence'); }}
              title="Manufacturing Intelligence"
              aria-label="Manufacturing Intelligence"
            >
              <Cpu className="h-3.5 w-3.5 text-primary" />
            </Button>
            {childType && (
              <Button variant="ghost" size="icon" className={actionButton} onClick={() => { handleAddChild(item); }} title="Add Component" aria-label="Add Component">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className={actionButton} onClick={() => { onEditItem(item); }} title="Edit" aria-label="Edit">
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => handleDeleteClick(item)}
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  // The rows currently visible, with the tree each draws (lib/bom/tree-rows.ts).
  const visibleRows = (nodes: TreeNode[], expanded: ReadonlySet<string>): React.ReactElement[] =>
    visibleTreeRows(nodes, expanded).map((r) => renderRow(r.node, r.depth, r.guides, r.isLast, r.path));
  const rowsTree     = filtered ? filtered.nodes : treeData;
  const rowsExpanded = filtered ? new Set([...expandedItems, ...filtered.expand]) : expandedItems;

  // -------------------------------------------------------------------------
  // Loading / empty states
  // -------------------------------------------------------------------------

  // Gmail's toolbar: one row on top of the list, the list's own tools at the left and the page's actions at the right.
  const toolbarClass = 'flex flex-wrap items-center gap-2 border-b px-3 py-2';
  const actionsOnly  = toolbarActions
    ? <div className={toolbarClass}><div className="ml-auto flex flex-wrap items-center gap-2">{toolbarActions}</div></div>
    : null;

  if (isLoading) {
    return (
      <>
        {actionsOnly}
        <div className="p-3">
          <TableSkeleton rows={6} columns={5} label="Loading BOM items..." />
        </div>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        {actionsOnly}
        <div className="p-4">
          <EmptyState
            title="No items yet"
            description={'Start adding items to your BOM by clicking the "Add BOM" button above.'}
            className="rounded-lg border border-dashed"
          />
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Detect orphaned items (items missing from the rendered tree)
  // -------------------------------------------------------------------------

  const renderedIds = new Set<string>();
  const collectIds  = (nodes: TreeNode[]) => nodes.forEach(n => { renderedIds.add(n.id); collectIds(n.children); });
  collectIds(treeData);
  const orphanedItems = items.filter(item => !renderedIds.has(item.id));

  if (orphanedItems.length > 0) {
    console.warn('Orphaned items found:', orphanedItems.map(i => ({ name: i.name, id: i.id, parentId: i.parentItemId })));
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <>
      {/* Search by name or part number; the whole tree opened or closed at once; the page's add buttons at the right. */}
      <div className={toolbarClass}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
              placeholder="Search by name or part no."
              aria-label="Search the BOM by name or part number"
              className="h-8 pl-8 pr-14 text-xs"
            />
            {query ? (
              <button
                type="button"
                onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">/</kbd>
            )}
          </div>
          {filtered && (
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {filtered.matches.size} of {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={expandAll}>
            <ChevronDown className="h-3.5 w-3.5" /> Expand all
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={collapseAll}>
            <ChevronRight className="h-3.5 w-3.5" /> Collapse all
          </Button>
        </div>
        {toolbarActions && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbarActions}</div>}
      </div>
      {/* The drag image: a card of the item being dragged, drawn off screen for the browser to take under the cursor (handleDragStart). */}
      <div
        ref={dragCardRef}
        aria-hidden="true"
        className={`pointer-events-none fixed left-0 top-[-1000px] flex w-72 items-center gap-2.5 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-lg ${
          draggedItem ? typeStyleOf(draggedItem.itemType).accent : ''
        }`}
      >
        {draggedItem && (() => {
          const s = typeStyleOf(draggedItem.itemType);
          return (
            <>
              <s.Icon className={`h-4 w-4 shrink-0 ${s.icon}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{draggedItem.name}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{draggedItem.partNumber ? draggedItem.partNumber : s.label}</span>
              </span>
              {getItemTypeBadge(draggedItem.itemType)}
            </>
          );
        })()}
      </div>
      {/*
        No height of its own: the list grows with the page (one scroll, the page's). Three columns of fixed share, as Gmail's sender, subject
        and date, so the list always fits the card's width (no sideways scroll); only a phone-narrow screen scrolls it sideways.
      */}
      <div
        className="overflow-x-auto"
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverItem(null); }}
      >
        <table role="treegrid" aria-label="BOM items" className="w-full min-w-[720px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[44%]" />
            <col />
            <col className="w-32" />
          </colgroup>
          <thead className="sr-only">
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Part number and details</th>
              <th scope="col">Unit cost and actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows(rowsTree, rowsExpanded)}
            {filtered?.matches.size === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No item matches &ldquo;{search}&rdquo; by name or part number.{' '}
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setQuery(''); }}>Clear search</button>
                </td>
              </tr>
            )}
            {orphanedItems.length > 0 && (
              <>
                <tr>
                  <td colSpan={3} className="bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                    Orphaned Items (Missing Parent Reference)
                  </td>
                </tr>
                {orphanedItems.map(item => renderRow({ ...item, children: [], depth: 0 }, 0))}
              </>
            )}
          </tbody>
          {/* The total under the costs; the item types, as the rows colour them, with how many of each. */}
          <tfoot>
            <tr>
              <td colSpan={2} className="border-t bg-muted/60 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-medium">
                    Total <span className="font-normal text-muted-foreground">· {items.length} {items.length === 1 ? 'item' : 'items'}</span>
                  </span>
                  {LEGEND_TYPES.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <span className={`h-2 w-2 rounded-full ${typeStyleOf(t).dot}`} aria-hidden="true" />
                      {typeStyleOf(t).label}
                      <span className="tabular-nums text-muted-foreground/70">{items.filter((i) => i.itemType === t).length}</span>
                    </span>
                  ))}
                </div>
              </td>
              <td className="whitespace-nowrap border-t bg-muted/60 py-2 pl-2 pr-3 text-right text-xs font-medium tabular-nums">
                {formatCost(totalCost)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <PartDetailSheet item={detailItem} onClose={() => { setDetailItem(null); }} />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete BOM Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{itemToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
// ---------------------------------------------------------------------------
// Part detail sheet: read-only view of fields already on the BOM item
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value || '—'}</dd>
    </div>
  );
}

function PartDetailSheet({ item, onClose }: { item: BOMItem | null; onClose: () => void }) {
  const dims =
    (item?.maxLength ?? 0) > 0 || (item?.maxWidth ?? 0) > 0 || (item?.maxHeight ?? 0) > 0
      ? `${item?.maxLength || 0}×${item?.maxWidth || 0}×${item?.maxHeight || 0} mm`
      : '';
  return (
    <Sheet open={item !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle>{item.name}</SheetTitle>
              <SheetDescription>{item.partNumber || 'No part number'}</SheetDescription>
            </SheetHeader>
            <dl className="px-4 pb-4">
              <DetailRow label="Type" value={getItemTypeBadge(item.itemType)} />
              <DetailRow label="BOM level" value={(item.bomLevel ?? '') === '' ? getDefaultBomLevel(item.itemType) : item.bomLevel} />
              <DetailRow label="Make / Buy" value={item.makeBuy === 'buy' ? 'Buy' : 'Make'} />
              <DetailRow label="Description" value={item.description} />
              <DetailRow label="Material" value={item.material} />
              <DetailRow label="Material grade" value={item.materialGrade} />
              <DetailRow label="Quantity" value={`${item.quantity}${item.unit ? ` ${item.unit}` : ''}`} />
              <DetailRow label="Annual volume" value={item.annualVolume?.toLocaleString()} />
              <DetailRow
                label="Unit cost"
                value={
                  typeof item.unitCost === 'number'
                    ? item.unitCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : ''
                }
              />
              <DetailRow label="Weight" value={item.weight && item.weight > 0 ? `${item.weight.toFixed(3)} kg` : ''} />
              <DetailRow label="Dimensions" value={dims} />
              <DetailRow
                label="Surface area"
                value={item.surfaceArea && item.surfaceArea > 0 ? `${(item.surfaceArea / 1000).toFixed(1)}k mm²` : ''}
              />
              <DetailRow label="Revision" value={item.revision} />
              <DetailRow label="Lead time" value={item.leadTime} />
              <DetailRow label="Surface finish" value={item.surfaceFinish} />
              <DetailRow label="Tolerance grade" value={item.toleranceGrade} />
            </dl>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
