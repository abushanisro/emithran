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
import { Edit2, Trash2, Plus, ChevronDown, ChevronUp, FileText, Box, GripVertical } from 'lucide-react';
// ✅ Fix 6133: Removed unused imports: ArrowRight, Move
import { toast } from 'sonner';
import { useBOMItems, deleteBOMItem, updateBOMItem, updateBOMItemsSortOrder, BOMItem } from '@/lib/api/hooks/useBOMItems';
import { useQueryClient } from '@tanstack/react-query';
import { BOMItemType } from '@/lib/types/bom.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BOMItemsFlatProps {
  bomId: string;
  onEditItem: (item: BOMItem) => void;
  onViewItem?: (item: BOMItem, viewType?: '2d' | '3d') => void;
  onAddChildItem?: (parentId: string, childType: BOMItemType) => void;
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
    sub_assembly: { label: 'Sub-Assembly', className: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
    child_part:   { label: 'Child Part',   className: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
  };

  const config = typeConfig[type] ?? { label: type, className: 'bg-muted text-muted-foreground border-muted' };

  return (
    <Badge variant="outline" className={`font-medium text-xs ${config.className}`}>
      {config.label}
    </Badge>
  );
}

function getBorderColor(type: string, depth: number = 0): string {
  const intensity = Math.max(500 - depth * 100, 300);
  switch (type) {
    case 'assembly':    return depth === 0 ? 'border-l-emerald-500' : `border-l-emerald-${intensity}`;
    case 'sub_assembly': return depth <= 1 ? 'border-l-blue-500'   : `border-l-blue-${intensity}`;
    case 'child_part':  return depth <= 2 ? 'border-l-amber-500'   : `border-l-amber-${intensity}`;
    default:            return 'border-l-gray-500';
  }
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

export function BOMItemsFlat({ bomId, onEditItem, onViewItem, onAddChildItem }: BOMItemsFlatProps) {
  const { data, isLoading, refetch } = useBOMItems(bomId);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete]         = useState<BOMItem | null>(null);
  const [expandedItems, setExpandedItems]       = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem]           = useState<BOMItem | null>(null);
  const [dragOverItem, setDragOverItem]         = useState<string | null>(null);
  const [isDragging, setIsDragging]             = useState(false);
  const [isUpdating, setIsUpdating]             = useState(false);

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

  const renderItem = (item: TreeNode, depth: number = 0): React.ReactElement => {
    const hasChildren    = item.children.length > 0;
    const isExpanded     = expandedItems.has(item.id);
    const isDraggedOver  = dragOverItem === item.id;
    const isBeingDragged = draggedItem?.id === item.id;
    const childType      = getChildType(item.itemType);

    return (
      <div key={item.id} className="mb-2">
        <div
          style={{ marginLeft: `${depth * 20}px` }}
          draggable
          onDragStart={e  => handleDragStart(e, item)}
          onDragEnd={handleDragEnd}
          onDragOver={e   => handleDragOver(e, item)}
          onDragLeave={handleDragLeave}
          onDrop={e       => handleDrop(e, item)}
          onClick={e      => { if (isDragging) { e.preventDefault(); e.stopPropagation(); } }}
          className={[
            'rounded-md border bg-card text-card-foreground shadow-sm border-l-4 transition-all duration-200 relative',
            getBorderColor(item.itemType, depth),
            isBeingDragged  ? 'opacity-50'                                                              : '',
            isDraggedOver   ? 'ring-2 ring-blue-500 ring-offset-2 bg-blue-50 dark:bg-blue-950/20'       : '',
            isDragging && !isBeingDragged ? 'hover:ring-2 hover:ring-green-400'                         : '',
            isUpdating      ? 'cursor-wait opacity-75'                                                   : 'cursor-move',
          ].join(' ')}
        >
          {/* Depth indicator */}
          {depth > 0 && (
            <div
              className="absolute left-0 top-0 bottom-0 w-0.5 bg-border"
              style={{ left: `-${depth * 20 - 10}px` }}
            />
          )}

          <div className="p-4">
            <div className="flex flex-col md:flex-row items-start justify-between gap-3">

              {/* Thumbnail */}
              {(item.file3dPath || item.file2dPath) && (
                <BOMItemThumbnail
                  item={item}
                  onClick={() => onViewItem?.(item, item.file3dPath ? '3d' : '2d')}
                />
              )}

              {/* Left: metadata */}
              <div className="flex-1 min-w-0 w-full">
                {/* Header row */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <div className="flex items-center gap-1">
                    <GripVertical className={`h-4 w-4 transition-colors cursor-grab active:cursor-grabbing ${
                      isBeingDragged ? 'text-blue-500' : isDraggedOver ? 'text-green-500' : 'text-muted-foreground hover:text-foreground'
                    }`} />
                    {hasChildren && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 p-0 rounded-full border"
                        onClick={() => toggleExpand(item.id)}
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>

                  <h3 className="text-base font-semibold text-foreground truncate max-w-[200px] md:max-w-none">
                    {item.name}
                  </h3>

                  {getItemTypeBadge(item.itemType)}

                  {isDragging && !isBeingDragged && draggedItem && (
                    <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-950/20 border-purple-300">
                      Drop to Swap Positions ↔
                    </Badge>
                  )}

                  {/* Circular reference warning */}
                  {item.parentItemId && items.some(o => o.id === item.parentItemId && o.parentItemId === item.id) && (
                    <Badge variant="destructive" className="text-xs">Circular Ref</Badge>
                  )}
                </div>

                {/* Detail grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-1 text-xs">
                  <div><span className="text-muted-foreground">Part No: </span><span className="font-medium">{item.partNumber || '—'}</span></div>
                  <div><span className="text-muted-foreground">Qty: </span><span className="font-medium">{item.quantity}</span></div>
                  <div><span className="text-muted-foreground">UOM: </span><span className="font-medium">{item.unit}</span></div>
                  <div>
                    <span className="text-muted-foreground">Level: </span>
                    <Badge variant="outline" className="h-4 text-[10px] font-medium px-1">
                      {item.bomLevel || getDefaultBomLevel(item.itemType)}
                    </Badge>
                  </div>
                  <div><span className="text-muted-foreground">Volume: </span><span className="font-medium">{item.annualVolume.toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground">Type: </span><span className="font-medium">{item.makeBuy === 'buy' ? 'Buy' : 'Make'}</span></div>

                  <div className="col-span-2 sm:col-span-3 lg:col-span-2">
                    <span className="text-muted-foreground">Description: </span>
                    <span className="font-medium" title={item.description || ''}>{item.description || '—'}</span>
                  </div>
                  <div><span className="text-muted-foreground">Material: </span><span className="font-medium">{item.materialGrade || '—'}</span></div>
                  <div>
                    <span className="text-muted-foreground">Weight: </span>
                    <span className="font-medium">{item.weight && item.weight > 0 ? `${item.weight.toFixed(3)} kg` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Dimensions: </span>
                    <span className="font-medium">
                      {(item.maxLength ?? 0) > 0 || (item.maxWidth ?? 0) > 0 || (item.maxHeight ?? 0) > 0
                        ? `${item.maxLength || 0}×${item.maxWidth || 0}×${item.maxHeight || 0} mm`
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Surface: </span>
                    <span className="font-medium">
                      {item.surfaceArea && item.surfaceArea > 0 ? `${(item.surfaceArea / 1000).toFixed(1)}k mm²` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: action buttons */}
              <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto justify-end mt-4 md:mt-0">
                {item.file2dPath && (
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onViewItem?.(item, '2d')} title="View 2D Drawing">
                    <FileText className="h-4 w-4" />
                  </Button>
                )}
                {item.file3dPath && (
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onViewItem?.(item, '3d')} title="View 3D Model">
                    <Box className="h-4 w-4" />
                  </Button>
                )}
                {childType && (
                  <Button variant="default" size="icon" className="h-8 w-8 rounded-full" onClick={() => handleAddChild(item)} title="Add Component">
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onEditItem(item)} title="Edit">
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDeleteClick(item)}
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Nested children */}
          {isExpanded && hasChildren && (
            <div className="mt-2 space-y-1">
              {item.children.map(child => renderItem(child, depth + 1))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Loading / empty states
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mb-4" />
        <p className="text-muted-foreground">Loading BOM items...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg">
        <h3 className="text-lg font-semibold mb-2">No items yet</h3>
        <p className="text-muted-foreground max-w-md mb-4">
          Start adding items to your BOM by clicking the "Add BOM" button above.
        </p>
      </div>
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
      <div className="space-y-2">
        {treeData.map(item => renderItem(item, 0))}

        {orphanedItems.length > 0 && (
          <div className="mt-4 p-4 border border-orange-300 rounded-lg bg-orange-50 dark:bg-orange-950/20">
            <h4 className="text-sm font-medium text-orange-800 dark:text-orange-200 mb-2">
              Orphaned Items (Missing Parent Reference)
            </h4>
            <div className="space-y-2">
              {orphanedItems.map(item => renderItem({ ...item, children: [], depth: 0 }, 0))}
            </div>
          </div>
        )}
      </div>

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