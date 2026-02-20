'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { Edit2, Trash2, Package, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useBOMItems, deleteBOMItem, BOMItem } from '@/lib/api/hooks/useBOMItems';
import { BOMItemType } from '@/lib/types/bom.types';

interface BOMItemsTableProps {
  bomId: string;
  onEditItem: (item: any) => void;
  onAddChildItem?: (parentId: string, childType: BOMItemType) => void;
}

interface TreeNode extends BOMItem {
  children: TreeNode[];
  depth: number;
}

export function BOMItemsTable({ bomId, onEditItem, onAddChildItem }: BOMItemsTableProps) {
  const { data, isLoading, refetch } = useBOMItems(bomId);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<BOMItem | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const bomItems = data?.items || [];

  // Build tree structure from flat items
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

  // Flatten tree for rendering
  const flattenTree = (nodes: TreeNode[], parentExpanded: boolean = true): TreeNode[] => {
    const result: TreeNode[] = [];

    nodes.forEach(node => {
      result.push(node);

      if (parentExpanded && node.children.length > 0 && expandedItems.has(node.id)) {
        result.push(...flattenTree(node.children, true));
      }
    });

    return result;
  };

  const treeData = buildTree(bomItems);

  // Flatten tree for display with depth information
  const items = flattenTree(treeData);

  // Memoize item structure for stable dependency
  const itemStructure = useMemo(
    () => items.map(i => ({ id: i.id, parentItemId: i.parentItemId })),
    [items]
  );

  // Auto-expand all items with children on first load
  useEffect(() => {
    const itemsWithChildren = new Set<string>();
    const findParents = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (node.children && node.children.length > 0) {
          itemsWithChildren.add(node.id);
          findParents(node.children);
        }
      });
    };
    findParents(treeData);
    setExpandedItems(itemsWithChildren);
  }, [itemStructure, treeData]);

  const handleDeleteClick = (item: any) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;

    try {
      await deleteBOMItem(itemToDelete.id);
      await refetch(); // Refresh the data
      toast.success(`"${itemToDelete.name}" has been deleted successfully from the BOM.`);
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
  };

  const getItemTypeBadge = (type: string) => {
    const typeConfig: Record<string, { label: string; className: string }> = {
      assembly: {
        label: 'Assembly',
        className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400'
      },
      sub_assembly: {
        label: 'Sub-Assembly',
        className: 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400'
      },
      child_part: {
        label: 'Child Part',
        className: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400'
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

  // Determine what child type can be added based on parent type
  const getChildType = (parentType: string): BOMItemType | null => {
    switch (parentType) {
      case 'assembly':
        return BOMItemType.SUB_ASSEMBLY;
      case 'sub_assembly':
        return BOMItemType.CHILD_PART;
      case 'child_part':
        return null; // Child part is now the leaf node
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
        <Package className="h-16 w-16 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold mb-2">No items yet</h3>
        <p className="text-muted-foreground max-w-md mb-4">
          Start adding items to your BOM by clicking the "Add BOM" button above.
        </p>
      </div>
    );
  }

  // Get border color based on item type
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

  return (
    <>
      {/* Render All Items as Flat Cards */}
      <div className="space-y-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={`rounded-lg border bg-card text-card-foreground shadow-sm border-l-4 ${getBorderColor(item.itemType)}`}
          >
            <div className="flex flex-col space-y-1.5 p-6 pb-3">
              <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 w-full">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Package className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                      <h3 className="tracking-tight text-lg font-semibold text-foreground truncate max-w-[200px] md:max-w-none">
                        {item.name}
                      </h3>
                      {getItemTypeBadge(item.itemType)}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <div className="text-sm">
                        <p className="text-muted-foreground text-xs mb-0.5">Part Number</p>
                        <p className="font-medium text-foreground truncate">{item.partNumber || '—'}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-muted-foreground text-xs mb-0.5">Quantity</p>
                        <p className="font-medium text-foreground truncate">{item.quantity} {item.unit}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-muted-foreground text-xs mb-0.5">Annual Volume</p>
                        <p className="font-medium text-foreground truncate">{item.annualVolume.toLocaleString()}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-muted-foreground text-xs mb-0.5">Material</p>
                        <p className="font-medium text-foreground truncate" title={item.materialGrade || '—'}>
                          {item.materialGrade || '—'}
                        </p>
                      </div>
                    </div>
                    {item.description && (
                      <div className="text-sm mt-3">
                        <p className="text-muted-foreground text-xs mb-0.5">Description</p>
                        <p className="font-medium text-foreground line-clamp-2 md:line-clamp-none">{item.description}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto justify-end md:ml-4 pt-2 md:pt-0 border-t md:border-t-0 mt-2 md:mt-0">
                  {getChildType(item.itemType) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddChild(item)}
                      className="flex-1 md:flex-none"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      <span className="md:hidden lg:inline">Add Part</span>
                      <span className="hidden md:inline lg:hidden">Add</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEditItem(item)}
                    className="flex-1 md:flex-none"
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-1 md:flex-none"
                    onClick={() => handleDeleteClick(item)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
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
