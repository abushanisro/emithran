'use client';

import React, { useState, useEffect } from 'react';
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
import { Edit2, Trash2, Plus, ChevronDown, ChevronUp, FileText, Box } from 'lucide-react';
import { toast } from 'sonner';
import { useBOMItems, deleteBOMItem, BOMItem } from '@/lib/api/hooks/useBOMItems';
import { BOMItemType } from '@/lib/types/bom.types';

interface BOMItemsFlatProps {
  bomId: string;
  onEditItem: (item: any) => void;
  onViewItem?: (item: BOMItem, viewType?: '2d' | '3d') => void;
  onAddChildItem?: (parentId: string, childType: BOMItemType) => void;
}

interface TreeNode extends BOMItem {
  children: TreeNode[];
  depth: number;
}

export function BOMItemsFlat({ bomId, onEditItem, onViewItem, onAddChildItem }: BOMItemsFlatProps) {
  const { data, isLoading, refetch } = useBOMItems(bomId);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<BOMItem | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const items = data?.items || [];

  // Build tree structure
  const buildTree = (flatItems: BOMItem[]): TreeNode[] => {
    const itemMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    // Create nodes
    flatItems.forEach(item => {
      itemMap.set(item.id, { ...item, children: [], depth: 0 });
    });

    // Build hierarchy
    flatItems.forEach(item => {
      const node = itemMap.get(item.id)!;
      if (item.parentItemId) {
        const parent = itemMap.get(item.parentItemId);
        if (parent) {
          parent.children.push(node);
          node.depth = parent.depth + 1;
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    });

    return roots;
  };

  const treeData = buildTree(items);

  // Auto-expand all items by default
  useEffect(() => {
    const allIds = new Set(items.map(item => item.id));
    setExpandedItems(allIds);
  }, [items.length]);

  const toggleExpand = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Render item with nested children
  const renderItem = (item: TreeNode): React.ReactElement => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);

    return (
      <div key={item.id} className="mb-2">
        <div
          className={`rounded-md border bg-card text-card-foreground shadow-sm border-l-4 ${getBorderColor(item.itemType)}`}
        >
          <div className="p-4">
            <div className="flex flex-col md:flex-row items-start justify-between gap-3">
              <div className="flex-1 min-w-0 w-full">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {hasChildren && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 p-0 rounded-full border"
                      onClick={() => toggleExpand(item.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                  <h3 className="text-base font-semibold text-foreground truncate max-w-[200px] md:max-w-none">
                    {item.name}
                  </h3>
                  {getItemTypeBadge(item.itemType)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1.5 text-xs">
                  <div>
                    <span className="text-muted-foreground">Part No: </span>
                    <span className="font-medium">{item.partNumber || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Quantity: </span>
                    <span className="font-medium">{item.quantity}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Description: </span>
                    <span className="font-medium truncate block" title={item.description || ''}>{item.description || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">UOM: </span>
                    <span className="font-medium">{item.unit}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Material Grade: </span>
                    <span className="font-medium">{item.materialGrade || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Annual Volume: </span>
                    <span className="font-medium">{item.annualVolume.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Make/Buy: </span>
                    <span className="font-medium">
                      {item.makeBuy === 'buy' ? 'Purchasing (Buy)' : 'Manufacturing (Make)'}
                    </span>
                  </div>
                  {item.makeBuy === 'buy' && item.unitCost && (
                    <div>
                      <span className="text-muted-foreground">Unit Cost: </span>
                      <span className="font-medium">₹{item.unitCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Files: </span>
                    <div className="flex items-center gap-1">
                      {item.file2dPath && (
                        <button
                          onClick={() => onViewItem?.(item, '2d')}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
                          title={`2D: ${item.file2dPath.split('/').pop()?.replace(/^\d+_/, '') || 'drawing'}`}
                        >
                          <FileText className="h-3 w-3" />
                          <span className="text-[10px] font-medium">2D</span>
                        </button>
                      )}
                      {item.file3dPath && (
                        <button
                          onClick={() => onViewItem?.(item, '3d')}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 transition-colors"
                          title={`3D: ${item.file3dPath.split('/').pop()?.replace(/^\d+_/, '') || 'model'}`}
                        >
                          <Box className="h-3 w-3" />
                          <span className="text-[10px] font-medium">3D</span>
                        </button>
                      )}
                      {!item.file2dPath && !item.file3dPath && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto justify-end mt-4 md:mt-0">
                {item.file2dPath && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onViewItem?.(item, '2d')}
                    title="View 2D Drawing"
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                )}
                {item.file3dPath && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onViewItem?.(item, '3d')}
                    title="View 3D Model"
                  >
                    <Box className="h-4 w-4" />
                  </Button>
                )}
                {getChildType(item.itemType) && (
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => handleAddChild(item)}
                    title="Add Component"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onEditItem(item)}
                  title="Edit"
                >
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
            <div className="px-4 pb-4 space-y-2">
              {item.children.map(child => renderItem(child))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleDeleteClick = (item: BOMItem) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (itemToDelete) {
      try {
        await deleteBOMItem(itemToDelete.id);
        toast.success(`"${itemToDelete.name}" has been deleted successfully from the BOM.`);
        refetch();
      } catch (error: any) {
        let errorMessage = 'Failed to delete item. Please try again.';
        if (error?.message) {
          if (error.message.includes('permission')) {
            errorMessage = 'You do not have permission to delete this item. Please contact your administrator.';
          } else if (error.message.includes('network')) {
            errorMessage = 'Failed to delete item due to network error. Please check your connection and try again.';
          } else if (error.message.includes('dependency')) {
            errorMessage = 'Cannot delete this item because other items depend on it. Please remove child items first.';
          } else if (error.message.includes('not found')) {
            errorMessage = 'Item not found. It may have already been deleted.';
          } else {
            errorMessage = `Failed to delete item: ${error.message}`;
          }
        }
        toast.error(errorMessage, { duration: 6000 });
      } finally {
        setDeleteDialogOpen(false);
        setItemToDelete(null);
      }
    }
  };

  const getItemTypeBadge = (type: string) => {
    const typeConfig: Record<string, { label: string; className: string }> = {
      assembly: {
        label: 'Assembly',
        className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
      },
      sub_assembly: {
        label: 'Sub-Assembly',
        className: 'bg-blue-500/10 text-blue-700 border-blue-500/20'
      },
      child_part: {
        label: 'Child Part',
        className: 'bg-amber-500/10 text-amber-700 border-amber-500/20'
      },
    };

    const config = typeConfig[type] || {
      label: type,
      className: 'bg-muted text-muted-foreground border-muted'
    };

    return (
      <Badge
        variant="outline"
        className={`font-medium text-xs ${config.className}`}
      >
        {config.label}
      </Badge>
    );
  };

  const getChildType = (parentType: string): BOMItemType | null => {
    switch (parentType) {
      case 'assembly':
        return BOMItemType.SUB_ASSEMBLY;
      case 'sub_assembly':
        return BOMItemType.CHILD_PART;
      case 'child_part':
        return null;
      default:
        return null;
    }
  };

  const handleAddChild = (item: BOMItem) => {
    const childType = getChildType(item.itemType);
    if (childType && onAddChildItem) {
      onAddChildItem(item.id, childType);
    }
  };

  const getBorderColor = (type: string) => {
    switch (type) {
      case 'assembly':
        return 'border-l-emerald-500';
      case 'sub_assembly':
        return 'border-l-blue-500';
      case 'child_part':
        return 'border-l-amber-500';
      default:
        return 'border-l-gray-500';
    }
  };

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

  return (
    <>
      <div className="space-y-2">
        {treeData.map(item => renderItem(item))}
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
