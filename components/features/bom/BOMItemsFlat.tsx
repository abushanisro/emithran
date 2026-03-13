'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { Edit2, Trash2, Plus, ChevronDown, ChevronUp, FileText, Box, GripVertical, ArrowRight, Move } from 'lucide-react';
import { toast } from 'sonner';
import { useBOMItems, deleteBOMItem, updateBOMItem, updateBOMItemsSortOrder, BOMItem } from '@/lib/api/hooks/useBOMItems';
import { useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<BOMItem | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [draggedItem, setDraggedItem] = useState<BOMItem | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const items = data?.items || [];

  // Build tree structure with circular reference detection
  const buildTree = useCallback((flatItems: BOMItem[]): TreeNode[] => {
    if (flatItems.length === 0) return [];

    const itemMap = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    // Create all nodes first
    flatItems.forEach(item => {
      itemMap.set(item.id, { ...item, children: [], depth: 0 });
    });

    // Build parent-child relationships
    flatItems.forEach(item => {
      const node = itemMap.get(item.id)!;
      
      // Check if item has a parent
      if (item.parentItemId && item.parentItemId.trim() !== '') {
        const parent = itemMap.get(item.parentItemId);
        if (parent) {
          // Add this node as child of parent
          parent.children.push(node);
          node.depth = parent.depth + 1;
        } else {
          // Parent not found in current items, treat as root
          console.warn(`Parent ${item.parentItemId} not found for item ${item.name}, treating as root`);
          roots.push(node);
        }
      } else {
        // No parent, this is a root item
        roots.push(node);
      }
    });

    // Sort children within each node by item type, then by sort order, then by name
    const sortChildren = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (node.children.length > 0) {
          node.children.sort((a, b) => {
            const typeOrder = { 'assembly': 0, 'sub_assembly': 1, 'child_part': 2 };
            const aOrder = typeOrder[a.itemType] || 3;
            const bOrder = typeOrder[b.itemType] || 3;
            if (aOrder !== bOrder) return aOrder - bOrder;
            
            // If same type, sort by sortOrder first, but treat 0 as "newly created"
            const aSortOrder = a.sortOrder || 0;
            const bSortOrder = b.sortOrder || 0;
            
            // If both have meaningful sort orders (> 0), use them
            if (aSortOrder > 0 && bSortOrder > 0 && aSortOrder !== bSortOrder) {
              return aSortOrder - bSortOrder;
            }
            
            // If one has a meaningful sort order and other is 0/default, prioritize the meaningful one
            if (aSortOrder > 0 && bSortOrder === 0) return -1; // a comes first
            if (bSortOrder > 0 && aSortOrder === 0) return 1;  // b comes first
            
            // If both have same sortOrder (including 0), sort by creation time (older first, newer last)
            const aCreated = new Date(a.createdAt).getTime();
            const bCreated = new Date(b.createdAt).getTime();
            if (aCreated !== bCreated) return aCreated - bCreated;
            
            return a.name.localeCompare(b.name);
          });
          sortChildren(node.children);
        }
      });
    };

    // Sort roots by item type, then by sort order, then by name
    roots.sort((a, b) => {
      const typeOrder = { 'assembly': 0, 'sub_assembly': 1, 'child_part': 2 };
      const aOrder = typeOrder[a.itemType] || 3;
      const bOrder = typeOrder[b.itemType] || 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      
      // If same type, sort by sortOrder first, but treat 0 as "newly created"
      const aSortOrder = a.sortOrder || 0;
      const bSortOrder = b.sortOrder || 0;
      
      // If both have meaningful sort orders (> 0), use them
      if (aSortOrder > 0 && bSortOrder > 0 && aSortOrder !== bSortOrder) {
        return aSortOrder - bSortOrder;
      }
      
      // If one has a meaningful sort order and other is 0/default, prioritize the meaningful one
      if (aSortOrder > 0 && bSortOrder === 0) return -1; // a comes first
      if (bSortOrder > 0 && aSortOrder === 0) return 1;  // b comes first
      
      // If both have same sortOrder (including 0), sort by creation time (older first, newer last)
      const aCreated = new Date(a.createdAt).getTime();
      const bCreated = new Date(b.createdAt).getTime();
      if (aCreated !== bCreated) return aCreated - bCreated;
      
      return a.name.localeCompare(b.name);
    });

    sortChildren(roots);

    // Only log in development and avoid excessive logging
    if (process.env.NODE_ENV === 'development' && flatItems.length > 0) {
      console.log('Tree structure built:', {
        totalItems: flatItems.length,
        rootItems: roots.length,
        itemSummary: flatItems.map(item => ({
          name: item.name,
          type: item.itemType,
          parentId: item.parentItemId || 'root',
          bomLevel: item.bomLevel
        })),
        builtTree: roots.map(root => ({
          id: root.id,
          name: root.name,
          type: root.itemType,
          depth: root.depth,
          childrenCount: root.children.length,
          children: root.children.map(child => ({
            name: child.name,
            type: child.itemType,
            parentId: child.parentItemId,
            depth: child.depth
          }))
        }))
      });
    }

    return roots;
  }, []);

  const treeData = useMemo(() => {
    console.log('Rebuilding tree with items:', {
      count: items.length,
      timestamp: Date.now(),
      items: items.map(item => ({
        name: item.name,
        type: item.itemType,
        parentId: item.parentItemId,
        bomLevel: item.bomLevel,
        id: item.id,
        updatedAt: item.updatedAt,
        createdAt: item.createdAt,
        sortOrder: item.sortOrder
      }))
    });
    const tree = buildTree(items);
    console.log('Tree built result:', tree.length, 'root items', tree);
    return tree;
  }, [items.length, items.map(item => `${item.id}-${item.parentItemId}-${item.itemType}-${item.bomLevel}-${item.updatedAt}-${item.createdAt}-${item.sortOrder}`).join(','), buildTree]);

  // Only expand root level assemblies by default
  useEffect(() => {
    if (items.length === 0) return;
    
    const rootAssemblies = new Set(
      items
        .filter(item => item.itemType === 'assembly' && (!item.parentItemId || item.parentItemId.trim() === ''))
        .map(item => item.id)
    );
    
    // Only update if there are changes
    setExpandedItems(prev => {
      if (prev.size === rootAssemblies.size && [...prev].every(id => rootAssemblies.has(id))) {
        return prev; // No changes needed
      }
      return rootAssemblies;
    });
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

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, item: BOMItem) => {
    e.stopPropagation(); // Prevent event bubbling
    setDraggedItem(item);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    
    // Create a custom drag image that shows only this item
    const dragElement = e.currentTarget as HTMLElement;
    const clone = dragElement.cloneNode(true) as HTMLElement;
    clone.style.opacity = '0.8';
    clone.style.transform = 'rotate(2deg)';
    clone.style.width = dragElement.offsetWidth + 'px';
    
    // Temporarily add to body for drag image
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, dragElement.offsetWidth / 2, 20);
    
    // Clean up after drag starts
    setTimeout(() => {
      if (document.body.contains(clone)) {
        document.body.removeChild(clone);
      }
    }, 0);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent, targetItem: BOMItem) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (draggedItem && draggedItem.id !== targetItem.id) {
      setDragOverItem(targetItem.id);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear drag over if we're actually leaving the element
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverItem(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetItem: BOMItem) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedItem || draggedItem.id === targetItem.id || isUpdating) {
      handleDragEnd();
      return;
    }
    
    // Prevent multiple simultaneous operations
    if (draggedItem.id !== e.dataTransfer.getData('text/plain')) {
      handleDragEnd();
      return;
    }

    // Check if trying to drop an item inside its own hierarchy (prevent circular reference)
    const isCircularMove = (draggedId: string, targetId: string): boolean => {
      // Only check if we're dropping INSIDE the target (making target a parent)
      // Don't prevent moving to siblings or completely different hierarchies
      
      if (targetItem.itemType === 'child_part') {
        // Dropping on child part makes it a sibling, not circular
        return false;
      }
      
      // Check if target would become a descendant of dragged item
      const wouldCreateCircle = (currentId: string, searchId: string, visited = new Set<string>()): boolean => {
        if (visited.has(currentId) || currentId === searchId) {
          return currentId === searchId;
        }
        visited.add(currentId);
        
        // Find all direct children of current item
        const children = items.filter(item => item.parentItemId === currentId);
        
        // Check if searchId is among children or descendants
        return children.some(child => 
          child.id === searchId || wouldCreateCircle(child.id, searchId, new Set(visited))
        );
      };

      return wouldCreateCircle(draggedId, targetId);
    };

    if (isCircularMove(draggedItem.id, targetItem.id)) {
      toast.error('Invalid move', {
        description: 'Cannot move an item into its own sub-components',
        duration: 4000
      });
      handleDragEnd();
      return;
    }

    // Check if this is a reordering within the same parent (sort order change)
    const isSameParentReorder = draggedItem.parentItemId === targetItem.parentItemId && 
                                draggedItem.itemType === targetItem.itemType;
    
    if (isSameParentReorder) {
      // Same parent reordering - update sort orders
      console.log('Same parent reordering:', {
        draggedItem: { name: draggedItem.name, sortOrder: draggedItem.sortOrder },
        targetItem: { name: targetItem.name, sortOrder: targetItem.sortOrder }
      });
      
      // Get all siblings (items with same parent)
      const siblings = items.filter(item => 
        item.parentItemId === draggedItem.parentItemId && 
        item.itemType === draggedItem.itemType
      ).sort((a, b) => a.sortOrder - b.sortOrder);
      
      // Remove dragged item from siblings list
      const siblingsWithoutDragged = siblings.filter(item => item.id !== draggedItem.id);
      
      // Find target position
      const targetIndex = siblingsWithoutDragged.findIndex(item => item.id === targetItem.id);
      
      // Insert dragged item at target position
      siblingsWithoutDragged.splice(targetIndex, 0, draggedItem);
      
      // Update sort orders for all affected items
      const updatePayloads = siblingsWithoutDragged.map((item, index) => ({
        id: item.id,
        sortOrder: index
      }));
      
      try {
        // Use the batch reorder API if available
        if (typeof updateBOMItemsSortOrder === 'function') {
          await updateBOMItemsSortOrder(updatePayloads);
        } else {
          // Fallback: update each item individually
          for (const payload of updatePayloads) {
            if (payload.sortOrder !== items.find(i => i.id === payload.id)?.sortOrder) {
              await updateBOMItem(payload.id, { sortOrder: payload.sortOrder });
            }
          }
        }
        
        toast.success(`Reordered "${draggedItem.name}" within ${draggedItem.itemType.replace('_', ' ')}`, {
          duration: 3000
        });
      } catch (error) {
        console.error('Error reordering items:', error);
        toast.error('Failed to reorder items', {
          description: 'Please try again or check your permissions',
          duration: 5000
        });
        handleDragEnd();
        return;
      }
    } else {
      // Different parent - position swapping logic
      
      // Store original positions
      const draggedOriginalParent = draggedItem.parentItemId || null;
      const draggedOriginalLevel = draggedItem.bomLevel;
      const draggedOriginalType = draggedItem.itemType;
      
      const targetOriginalParent = targetItem.parentItemId || null;
      const targetOriginalLevel = targetItem.bomLevel;
      const targetOriginalType = targetItem.itemType;
      
      // Validate if this is a valid move
      const isValidMove = (dragged: BOMItem, target: BOMItem): boolean => {
        // Same item type and same parent = reordering (handled above)
        if (dragged.itemType === target.itemType && dragged.parentItemId === target.parentItemId) {
          return false; // This should have been handled by same-parent reordering
        }
        
        // Assembly to Assembly at root level = valid reordering
        if (dragged.itemType === 'assembly' && target.itemType === 'assembly' &&
            (!dragged.parentItemId || dragged.parentItemId.trim() === '') &&
            (!target.parentItemId || target.parentItemId.trim() === '')) {
          return true;
        }
        
        // Child part to Sub-assembly/Assembly = making it a sibling/child (valid)
        if (dragged.itemType === 'child_part' && 
            (target.itemType === 'sub_assembly' || target.itemType === 'assembly')) {
          return true;
        }
        
        // Sub-assembly to Assembly = making it a child (valid)
        if (dragged.itemType === 'sub_assembly' && target.itemType === 'assembly') {
          return true;
        }
        
        // Assembly to Sub-assembly/Child = invalid (assembly can't be child of smaller components)
        if (dragged.itemType === 'assembly' && 
            (target.itemType === 'sub_assembly' || target.itemType === 'child_part')) {
          return false;
        }
        
        // Sub-assembly to Child part = invalid (sub-assembly can't be child of part)
        if (dragged.itemType === 'sub_assembly' && target.itemType === 'child_part') {
          return false;
        }
        
        return false; // Default to invalid
      };
      
      if (!isValidMove(draggedItem, targetItem)) {
        toast.error('Invalid move', {
          description: `Cannot move ${draggedItem.itemType.replace('_', ' ')} to ${targetItem.itemType.replace('_', ' ')}`,
          duration: 4000
        });
        handleDragEnd();
        return;
      }
      
      // Check if both items are root-level assemblies
      const bothAreRootAssemblies = (
        (draggedItem.itemType === 'assembly' && (!draggedItem.parentItemId || draggedItem.parentItemId.trim() === '')) &&
        (targetItem.itemType === 'assembly' && (!targetItem.parentItemId || targetItem.parentItemId.trim() === ''))
      );
      
      if (bothAreRootAssemblies) {
        // Root assembly reordering - just swap sort orders, keep them as root items
        const draggedSortOrder = draggedItem.sortOrder;
        const targetSortOrder = targetItem.sortOrder;
        
        try {
          await updateBOMItem(draggedItem.id, { sortOrder: targetSortOrder });
          await updateBOMItem(targetItem.id, { sortOrder: draggedSortOrder });
          
          toast.success(`Reordered assemblies`, {
            description: `${draggedItem.name} ↔ ${targetItem.name} order swapped`,
            duration: 3000
          });
        } catch (error) {
          console.error('Error reordering assemblies:', error);
          toast.error('Failed to reorder assemblies', {
            description: 'Please try again or check your permissions',
            duration: 5000
          });
          handleDragEnd();
          return;
        }
      } else {
        // Different parent hierarchy move - proper parent-child assignment
        
        // Calculate new positions for dragged item based on target
        let draggedNewBomLevel: string;
        let draggedNewParentId: string | null;
        let draggedNewItemType = draggedItem.itemType; // Keep original type
        
        // Determine where the dragged item should go based on target
        if (targetItem.itemType === 'assembly') {
          // Moving to assembly - become a child of the assembly
          draggedNewParentId = targetItem.id;
          draggedNewBomLevel = draggedItem.itemType === 'sub_assembly' ? 'L1' : 'L2';
        } else if (targetItem.itemType === 'sub_assembly') {
          // Moving to sub-assembly - become a child of the sub-assembly  
          draggedNewParentId = targetItem.id;
          draggedNewBomLevel = 'L2';
        } else {
          // Moving to child part - become sibling (same parent as target)
          draggedNewParentId = targetItem.parentItemId || null;
          draggedNewBomLevel = targetItem.bomLevel || 'L2';
        }
        
        // No changes to target item - it stays in place
        
        // Check if there are actually changes to make for the dragged item
        const draggedHasChanges = (
          draggedOriginalParent !== draggedNewParentId || 
          draggedOriginalLevel !== draggedNewBomLevel || 
          draggedOriginalType !== draggedNewItemType
        );
        
        if (!draggedHasChanges) {
          // No changes needed
          handleDragEnd();
          return;
        }

        console.log('Hierarchy Move Operation:', {
          dragged: {
            id: draggedItem.id,
            name: draggedItem.name,
            from: { parentId: draggedOriginalParent, level: draggedOriginalLevel, type: draggedOriginalType },
            to: { parentId: draggedNewParentId, level: draggedNewBomLevel, type: draggedNewItemType }
          },
          target: {
            id: targetItem.id,
            name: targetItem.name,
            note: 'Target remains unchanged'
          }
        });

        // Update only the dragged item
        const draggedUpdatePayload = {
          parentItemId: draggedNewParentId,
          bomLevel: draggedNewBomLevel,
          itemType: draggedNewItemType
        };
        await updateBOMItem(draggedItem.id, draggedUpdatePayload);

        // Determine the relationship description
        let relationshipDesc = '';
        if (targetItem.itemType === 'assembly') {
          relationshipDesc = `moved under assembly "${targetItem.name}"`;
        } else if (targetItem.itemType === 'sub_assembly') {
          relationshipDesc = `moved under sub-assembly "${targetItem.name}"`;
        } else {
          relationshipDesc = `moved to same level as "${targetItem.name}"`;
        }

        toast.success(`Moved "${draggedItem.name}"`, {
          description: relationshipDesc,
          duration: 3000
        });
      }
    }

    try {
      setIsUpdating(true);

      // Invalidate the cache to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['bom-items'] });

      // Refresh the data and wait for it to complete
      const refreshResult = await refetch();
      console.log('Data refreshed after drag:', {
        success: refreshResult.isSuccess,
        newData: refreshResult.data?.items?.map(item => ({
          name: item.name,
          type: item.itemType,
          parentId: item.parentItemId,
          bomLevel: item.bomLevel
        }))
      });

    } catch (error) {
      console.error('Error updating item level:', error);
      toast.error('Failed to move item', {
        description: error?.message || 'Please try again or check your permissions',
        duration: 5000
      });
    } finally {
      setIsUpdating(false);
      handleDragEnd();
    }
  };

  // Render item with nested children
  const renderItem = (item: TreeNode, depth: number = 0): React.ReactElement => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    
    const isDraggedOver = dragOverItem === item.id;
    const isBeingDragged = draggedItem?.id === item.id;
    
    // Calculate indentation based on depth
    const indentationPadding = depth * 20;

    return (
      <div key={item.id} className="mb-2">
        {/* Main item card with indentation */}
        <div
          style={{ marginLeft: `${indentationPadding}px` }}
          draggable
          onDragStart={(e) => handleDragStart(e, item)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, item)}
          onDragLeave={(e) => handleDragLeave(e)}
          onDrop={(e) => handleDrop(e, item)}
          onClick={(e) => {
            // Prevent clicks during drag operations
            if (isDragging) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          className={`rounded-md border bg-card text-card-foreground shadow-sm border-l-4 transition-all duration-200 relative
            ${getBorderColor(item.itemType, depth)}
            ${isBeingDragged ? 'opacity-50' : ''}
            ${isDraggedOver ? 'ring-2 ring-blue-500 ring-offset-2 bg-blue-50 dark:bg-blue-950/20' : ''}
            ${isDragging && !isBeingDragged ? 'hover:ring-2 hover:ring-green-400' : ''}
            ${isUpdating ? 'cursor-wait opacity-75' : 'cursor-move'}
          `}
        >
          {/* Depth indicator line for nested items */}
          {depth > 0 && (
            <div 
              className="absolute left-0 top-0 bottom-0 w-0.5 bg-border"
              style={{ left: `-${indentationPadding - 10}px` }}
            />
          )}
          
          <div className="p-4">
            <div className="flex flex-col md:flex-row items-start justify-between gap-3">
              <div className="flex-1 min-w-0 w-full">
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
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
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
                  {/* Show circular reference warning */}
                  {(() => {
                    const hasCircular = item.parentItemId && 
                      items.some(other => other.id === item.parentItemId && other.parentItemId === item.id);
                    
                    return hasCircular ? (
                      <Badge variant="destructive" className="text-xs">
                        ⚠️ Circular Ref
                      </Badge>
                    ) : null;
                  })()}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-1 text-xs">
                  <div>
                    <span className="text-muted-foreground">Part No: </span>
                    <span className="font-medium">{item.partNumber || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Qty: </span>
                    <span className="font-medium">{item.quantity}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">UOM: </span>
                    <span className="font-medium">{item.unit}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Level: </span>
                    <Badge variant="outline" className="h-4 text-[10px] font-medium px-1">
                      {item.bomLevel || (() => {
                        switch (item.itemType) {
                          case 'assembly': return 'L0';
                          case 'sub_assembly': return 'L1';
                          case 'child_part': return 'L2';
                          default: return 'L0';
                        }
                      })()}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Volume: </span>
                    <span className="font-medium">{item.annualVolume.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Type: </span>
                    <span className="font-medium">
                      {item.makeBuy === 'buy' ? 'Buy' : 'Make'}
                    </span>
                  </div>
                  
                  <div className="col-span-2 sm:col-span-3 lg:col-span-2">
                    <span className="text-muted-foreground">Description: </span>
                    <span className="font-medium" title={item.description || ''}>{item.description || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Material: </span>
                    <span className="font-medium">{item.materialGrade || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Weight: </span>
                    <span className="font-medium">{item.weight && item.weight > 0 ? `${item.weight.toFixed(3)} kg` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Dimensions: </span>
                    <span className="font-medium">
                      {(item.maxLength && item.maxLength > 0) || (item.maxWidth && item.maxWidth > 0) || (item.maxHeight && item.maxHeight > 0) 
                        ? `${item.maxLength || 0}×${item.maxWidth || 0}×${item.maxHeight || 0} mm`
                        : '—'
                      }
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

          {/* Nested children with proper depth */}
          {isExpanded && hasChildren && (
            <div className="mt-2 space-y-1">
              {item.children.map(child => renderItem(child, depth + 1))}
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

  const getBorderColor = (type: string, depth: number = 0) => {
    const intensity = Math.max(500 - (depth * 100), 300); // Darker for deeper nesting
    switch (type) {
      case 'assembly':
        return depth === 0 ? 'border-l-emerald-500' : `border-l-emerald-${intensity}`;
      case 'sub_assembly':
        return depth <= 1 ? 'border-l-blue-500' : `border-l-blue-${intensity}`;
      case 'child_part':
        return depth <= 2 ? 'border-l-amber-500' : `border-l-amber-${intensity}`;
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
        {/* Render tree structure */}
        {treeData.map(item => renderItem(item, 0))}
        
        {/* Debug: Show orphaned items that weren't included in tree */}
        {(() => {
          const renderedIds = new Set<string>();
          const collectRenderedIds = (nodes: TreeNode[]) => {
            nodes.forEach(node => {
              renderedIds.add(node.id);
              if (node.children) {
                collectRenderedIds(node.children);
              }
            });
          };
          collectRenderedIds(treeData);
          
          const orphanedItems = items.filter(item => !renderedIds.has(item.id));
          
          if (orphanedItems.length > 0) {
            console.warn('Orphaned items found:', orphanedItems.map(item => ({ name: item.name, id: item.id, parentId: item.parentItemId })));
            
            return (
              <div className="mt-4 p-4 border border-orange-300 rounded-lg bg-orange-50 dark:bg-orange-950/20">
                <h4 className="text-sm font-medium text-orange-800 dark:text-orange-200 mb-2">
                  Orphaned Items (Missing Parent Reference)
                </h4>
                <div className="space-y-2">
                  {orphanedItems.map(item => renderItem({ ...item, children: [], depth: 0 }, 0))}
                </div>
              </div>
            );
          }
          return null;
        })()}
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
