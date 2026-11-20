'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';

const BOMItemThumbnail = dynamic(
  () => import('./BOMItemThumbnail').then((m) => m.BOMItemThumbnail),
  { ssr: false, loading: () => null }
);
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Edit2, Trash2, Plus, ChevronDown, ChevronRight, FileText, Box, GripVertical, Cpu, Info } from 'lucide-react';
// ✅ Fix 6133: Removed unused imports: ArrowRight, Move
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBOMItems, deleteBOMItem, updateBOMItem, updateBOMItemsSortOrder, type BOMItem } from '@/lib/api/hooks/useBOMItems';
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

function getDefaultBomLevel(itemType: string): string {
  switch (itemType) {
    case 'assembly':    return 'L0';
    case 'sub_assembly': return 'L1';
    case 'child_part':  return 'L2';
    default:            return 'L0';
  }
}

function getItemTypeBadge(type: string): React.ReactElement {
  const typeConfig: Record<string, { label: string; className: string }> = {
    assembly:     { label: 'Assembly',     className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
    sub_assembly: { label: 'Sub-Assembly', className: 'bg-primary/10 text-primary border-primary/20' },
    child_part:   { label: 'Child Part',   className: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
  };

  const config = typeConfig[type] ?? { label: type, className: 'bg-muted text-muted-foreground border-muted' };

  return (
    <Badge variant="outline" className={`font-medium text-xs ${config.className}`}>
      {config.label}
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

export function BOMItemsFlat({ bomId, onEditItem, onViewItem, onAddChildItem, totalCost }: BOMItemsFlatProps) {
  const { data, isLoading, refetch } = useBOMItems(bomId);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete]         = useState<BOMItem | null>(null);
  const [expandedItems, setExpandedItems]       = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem]           = useState<BOMItem | null>(null);
  const [dragOverItem, setDragOverItem]         = useState<string | null>(null);
  const [isDragging, setIsDragging]             = useState(false);
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

  const resetDrag = () => { setDraggedItem(null); setDragOverItem(null); setIsDragging(false); };

  const handleDragStart = (e: React.DragEvent, item: BOMItem) => {
    e.stopPropagation();
    setDraggedItem(item);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);

    const el    = e.currentTarget as HTMLElement;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.cssText = `opacity:0.8;transform:rotate(2deg);width:${el.offsetWidth}px`;
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, el.offsetWidth / 2, 20);
    setTimeout(() => document.body.contains(clone) && document.body.removeChild(clone), 0);
  };

  const handleDragEnd   = () => resetDrag();

  const handleDragOver  = (e: React.DragEvent, targetItem: BOMItem) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedItem && draggedItem.id !== targetItem.id) setDragOverItem(targetItem.id);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverItem(null);
  };

  const handleDrop = async (e: React.DragEvent, targetItem: BOMItem) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem || draggedItem.id === targetItem.id || isUpdating) { resetDrag(); return; }
    if (draggedItem.id !== e.dataTransfer.getData('text/plain'))        { resetDrag(); return; }

    // Circular reference guard
    const wouldCreateCircle = (currentId: string, searchId: string, visited = new Set<string>()): boolean => {
      if (visited.has(currentId) || currentId === searchId) return currentId === searchId;
      visited.add(currentId);
      return items
        .filter(i => i.parentItemId === currentId)
        .some(child => child.id === searchId || wouldCreateCircle(child.id, searchId, new Set(visited)));
    };

    if (targetItem.itemType !== 'child_part' && wouldCreateCircle(draggedItem.id, targetItem.id)) {
      toast.error('Invalid move', { description: 'Cannot move an item into its own sub-components', duration: 4000 });
      resetDrag();
      return;
    }

    const isSameParentReorder =
      draggedItem.parentItemId === targetItem.parentItemId &&
      draggedItem.itemType     === targetItem.itemType;

    try {
      setIsUpdating(true);

      if (isSameParentReorder) {
        // ── Same-parent reorder ──────────────────────────────────────────────
        const siblings = items
          .filter(i => i.parentItemId === draggedItem.parentItemId && i.itemType === draggedItem.itemType)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const withoutDragged = siblings.filter(i => i.id !== draggedItem.id);
        const targetIndex    = withoutDragged.findIndex(i => i.id === targetItem.id);
        withoutDragged.splice(targetIndex, 0, draggedItem);

        const updatePayloads = withoutDragged.map((item, index) => ({ id: item.id, sortOrder: index }));

        if (typeof updateBOMItemsSortOrder === 'function') {
          await updateBOMItemsSortOrder(updatePayloads);
        } else {
          for (const payload of updatePayloads) {
            if (payload.sortOrder !== items.find(i => i.id === payload.id)?.sortOrder) {
              await updateBOMItem(payload.id, { sortOrder: payload.sortOrder });
            }
          }
        }

        toast.success(`Reordered "${draggedItem.name}"`, { duration: 3000 });

      } else {
        // ── Cross-hierarchy move ─────────────────────────────────────────────
        const bothRootAssemblies =
          draggedItem.itemType === 'assembly' && !draggedItem.parentItemId?.trim() &&
          targetItem.itemType  === 'assembly' && !targetItem.parentItemId?.trim();

        if (bothRootAssemblies) {
          await updateBOMItem(draggedItem.id, { sortOrder: targetItem.sortOrder });
          await updateBOMItem(targetItem.id,  { sortOrder: draggedItem.sortOrder });
          toast.success('Assemblies reordered', { description: `${draggedItem.name} ↔ ${targetItem.name}`, duration: 3000 });

        } else {
          // Validate move legality
          const isValidMove = (): boolean => {
            const { itemType: d } = draggedItem;
            const { itemType: t } = targetItem;
            if (d === 'assembly' && (t === 'sub_assembly' || t === 'child_part')) return false;
            if (d === 'sub_assembly' && t === 'child_part') return false;
            if (d === 'child_part'   && (t === 'sub_assembly' || t === 'assembly')) return true;
            if (d === 'sub_assembly' && t === 'assembly') return true;
            return false;
          };

          if (!isValidMove()) {
            toast.error('Invalid move', {
              description: `Cannot move ${draggedItem.itemType.replace('_', ' ')} to ${targetItem.itemType.replace('_', ' ')}`,
              duration: 4000,
            });
            resetDrag();
            setIsUpdating(false);
            return;
          }

          // Compute new parent & bomLevel for the dragged item
          let newParentId: string | undefined;
          let newBomLevel: string;

          if (targetItem.itemType === 'assembly') {
            newParentId = targetItem.id;
            newBomLevel = draggedItem.itemType === 'sub_assembly' ? 'L1' : 'L2';
          } else if (targetItem.itemType === 'sub_assembly') {
            newParentId = targetItem.id;
            newBomLevel = 'L2';
          } else {
            // child_part → become sibling
            // ✅ Fix 2345: use `undefined` instead of `null` to match UpdateBOMItemDto
            newParentId = targetItem.parentItemId ?? undefined;
            newBomLevel = targetItem.bomLevel || 'L2';
          }

          const noChange =
            draggedItem.parentItemId === (newParentId ?? null) &&
            draggedItem.bomLevel     === newBomLevel           &&
            draggedItem.itemType     === draggedItem.itemType;   // always same

          if (!noChange) {
            await updateBOMItem(draggedItem.id, {
              parentItemId: newParentId,   // ✅ undefined, not null
              bomLevel:     newBomLevel,
              itemType:     draggedItem.itemType,
            });

            const desc =
              targetItem.itemType === 'assembly'    ? `moved under assembly "${targetItem.name}"` :
              targetItem.itemType === 'sub_assembly' ? `moved under sub-assembly "${targetItem.name}"` :
              `moved to same level as "${targetItem.name}"`;

            toast.success(`Moved "${draggedItem.name}"`, { description: desc, duration: 3000 });
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['bom-items'] });
      await refetch();

    } catch (error: unknown) {
      // ✅ Fix 2339: getErrorMessage handles unknown type safely
      const msg = getErrorMessage(error);
      toast.error('Failed to move item', { description: msg || 'Please try again.', duration: 5000 });
    } finally {
      setIsUpdating(false);
      resetDrag();
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const numCell = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';

  const renderRow = (item: TreeNode, depth: number): React.ReactElement => {
    const hasChildren    = item.children.length > 0;
    const isExpanded     = expandedItems.has(item.id);
    const isDraggedOver  = dragOverItem === item.id;
    const isBeingDragged = draggedItem?.id === item.id;
    const childType      = getChildType(item.itemType);

    return (
      <tr
        key={item.id}
        aria-level={depth + 1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        draggable
        onDragStart={e => handleDragStart(e, item)}
        onDragEnd={handleDragEnd}
        onDragOver={e => handleDragOver(e, item)}
        onDragLeave={handleDragLeave}
        onDrop={e => handleDrop(e, item)}
        onClick={e => {
          if (isDragging) { e.preventDefault(); e.stopPropagation(); return; }
          // Clicking a row opens Manufacturing Intelligence -- the same
          // destination as the Cpu button. Explicit controls keep their own meaning.
          if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return;
          e.stopPropagation();
          onViewItem?.(item, 'intelligence');
        }}
        className={[
          'group border-b transition-colors hover:bg-muted/50',
          isBeingDragged ? 'opacity-50' : '',
          isDraggedOver ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : '',
          isUpdating ? 'cursor-wait opacity-75' : 'cursor-pointer',
        ].join(' ')}
      >
        <td className="px-3 py-2">
          <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${depth * 20}px` }}>
            <GripVertical
              className={`h-4 w-4 shrink-0 cursor-grab active:cursor-grabbing ${
                isBeingDragged ? 'text-primary' : isDraggedOver ? 'text-success' : 'text-muted-foreground/60 group-hover:text-muted-foreground'
              }`}
              aria-hidden="true"
            />
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                aria-label={isExpanded ? `Collapse ${item.name}` : `Expand ${item.name}`}
                onClick={() => toggleExpand(item.id)}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            ) : (
              <span className="inline-block h-6 w-6 shrink-0" aria-hidden="true" />
            )}
            {(item.file3dPath || item.file2dPath) && (
              <BOMItemThumbnail
                item={item}
                onClick={() => onViewItem?.(item, item.file3dPath ? '3d' : '2d')}
              />
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                {getItemTypeBadge(item.itemType)}
                {isDragging && !isBeingDragged && draggedItem && (
                  <Badge variant="outline" className="text-xs">Drop to swap ↔</Badge>
                )}
                {item.parentItemId && items.some(o => o.id === item.parentItemId && o.parentItemId === item.id) && (
                  <Badge variant="destructive" className="text-xs">Circular Ref</Badge>
                )}
              </div>
              {item.description && (
                <p className="truncate text-xs text-muted-foreground" title={item.description}>{item.description}</p>
              )}
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">{item.partNumber || '—'}</td>
        <td className="px-3 py-2">
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
            {item.bomLevel || getDefaultBomLevel(item.itemType)}
          </Badge>
        </td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">{item.makeBuy === 'buy' ? 'Buy' : 'Make'}</td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">{item.materialGrade || '—'}</td>
        <td className={numCell}>{item.quantity}</td>
        <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">{item.unit}</td>
        <td className={numCell}>{item.annualVolume?.toLocaleString() ?? '—'}</td>
        <td className={numCell}>
          {typeof item.unitCost === 'number'
            ? item.unitCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—'}
        </td>
        <td className={numCell}>{item.weight && item.weight > 0 ? `${item.weight.toFixed(3)} kg` : '—'}</td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            {item.file2dPath && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onViewItem?.(item, '2d')} title="View 2D Drawing" aria-label="View 2D Drawing">
                <FileText className="h-4 w-4" />
              </Button>
            )}
            {item.file3dPath && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onViewItem?.(item, '3d')} title="View 3D Model" aria-label="View 3D Model">
                <Box className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setDetailItem(item); }} title="Part details" aria-label="Part details">
              <Info className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => { e.stopPropagation(); onViewItem?.(item, 'intelligence'); }}
              title="Manufacturing Intelligence"
              aria-label="Manufacturing Intelligence"
            >
              <Cpu className="h-4 w-4 text-primary" />
            </Button>
            {childType && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleAddChild(item)} title="Add Component" aria-label="Add Component">
                <Plus className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditItem(item)} title="Edit" aria-label="Edit">
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => handleDeleteClick(item)}
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  // Flatten the hierarchy into the rows that are currently visible.
  const visibleRows = (nodes: TreeNode[], depth = 0): React.ReactElement[] =>
    nodes.flatMap(node => [
      renderRow(node, depth),
      ...(expandedItems.has(node.id) && node.children.length > 0 ? visibleRows(node.children, depth + 1) : []),
    ]);

  // -------------------------------------------------------------------------
  // Loading / empty states
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <TableSkeleton rows={6} columns={5} label="Loading BOM items..." />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No items yet"
        description={'Start adding items to your BOM by clicking the "Add BOM" button above.'}
        className="rounded-lg border border-dashed"
      />
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

  const th = 'sticky top-0 z-10 bg-muted px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]';
  const thNum = `${th} text-right`;

  return (
    <>
      <div className="max-h-[70vh] overflow-auto rounded-md border">
        <table role="treegrid" aria-label="BOM items" className="w-full caption-bottom border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col" className={`${th} min-w-[280px] text-left`}>Item</th>
              <th scope="col" className={`${th} text-left`}>Part No</th>
              <th scope="col" className={`${th} text-left`}>Level</th>
              <th scope="col" className={`${th} text-left`}>Type</th>
              <th scope="col" className={`${th} text-left`}>Material</th>
              <th scope="col" className={thNum}>Qty</th>
              <th scope="col" className={`${th} text-left`}>UOM</th>
              <th scope="col" className={thNum}>Annual Vol.</th>
              <th scope="col" className={thNum}>Unit Cost</th>
              <th scope="col" className={thNum}>Weight</th>
              <th scope="col" className={`${th} text-right`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows(treeData)}
            {orphanedItems.length > 0 && (
              <>
                <tr>
                  <td colSpan={11} className="bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                    Orphaned Items (Missing Parent Reference)
                  </td>
                </tr>
                {orphanedItems.map(item => renderRow({ ...item, children: [], depth: 0 }, 0))}
              </>
            )}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td colSpan={5} className="sticky bottom-0 z-10 bg-muted px-3 py-2 text-sm shadow-[inset_0_1px_0_hsl(var(--border))]">
                Total <span className="font-normal text-muted-foreground">· {items.length} {items.length === 1 ? 'item' : 'items'}</span>
              </td>
              <td className="sticky bottom-0 z-10 bg-muted shadow-[inset_0_1px_0_hsl(var(--border))]" />
              <td className="sticky bottom-0 z-10 bg-muted shadow-[inset_0_1px_0_hsl(var(--border))]" />
              <td className="sticky bottom-0 z-10 bg-muted shadow-[inset_0_1px_0_hsl(var(--border))]" />
              <td className="sticky bottom-0 z-10 bg-muted px-3 py-2 text-right text-sm tabular-nums whitespace-nowrap shadow-[inset_0_1px_0_hsl(var(--border))]">
                {typeof totalCost === 'number'
                  ? totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '—'}
              </td>
              <td className="sticky bottom-0 z-10 bg-muted shadow-[inset_0_1px_0_hsl(var(--border))]" />
              <td className="sticky bottom-0 z-10 bg-muted shadow-[inset_0_1px_0_hsl(var(--border))]" />
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
