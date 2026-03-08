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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { 
  Edit2, 
  Trash2, 
  Package, 
  Plus, 
  AlertTriangle, 
  XCircle, 
  RefreshCw, 
  Loader2,
  AlertCircle,
  Info,
  CheckCircle,
  Clock,
  Network
} from 'lucide-react';
import { toast } from 'sonner';
import { useBOMItems, deleteBOMItem, BOMItem } from '@/lib/api/hooks/useBOMItems';
import { BOMItemType } from '@/lib/types/bom.types';

// Enhanced error handling for BOM operations
type BOMOperationError = {
  category: 'deletion' | 'permission' | 'network' | 'dependency' | 'data';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userMessage: string;
  suggestion: string;
  actionable: boolean;
  recoverable: boolean;
  errorCode?: string;
};

/**
 * Categorize BOM operation errors with manufacturing context
 */
function categorizeBOMOperationError(error: any): BOMOperationError {
  const errorMessage = error?.message?.toLowerCase() || '';
  const statusCode = error?.status || error?.response?.status;
  
  // Dependency errors (High severity - affects BOM integrity)
  if (errorMessage.includes('dependency') || errorMessage.includes('child') || statusCode === 409) {
    return {
      category: 'dependency',
      severity: 'high',
      userMessage: 'Cannot Delete - Has Dependencies',
      suggestion: 'Remove all child components first, then delete this item',
      actionable: true,
      recoverable: true,
      errorCode: 'BOM-DEP-001'
    };
  }
  
  // Permission errors (Medium severity)
  if (errorMessage.includes('permission') || errorMessage.includes('forbidden') || statusCode === 403) {
    return {
      category: 'permission',
      severity: 'medium',
      userMessage: 'Access Denied',
      suggestion: 'You need BOM edit permissions. Contact your project manager.',
      actionable: false,
      recoverable: false
    };
  }
  
  // Network errors (Critical)
  if (errorMessage.includes('network') || errorMessage.includes('timeout') || statusCode >= 500) {
    return {
      category: 'network',
      severity: 'critical',
      userMessage: 'Connection Issue',
      suggestion: 'Check your connection and try again',
      actionable: true,
      recoverable: true
    };
  }
  
  // Item not found (Low severity - already handled)
  if (errorMessage.includes('not found') || statusCode === 404) {
    return {
      category: 'data',
      severity: 'low',
      userMessage: 'Item Already Deleted',
      suggestion: 'The item has been removed by another user',
      actionable: false,
      recoverable: false
    };
  }
  
  // Default deletion error
  return {
    category: 'deletion',
    severity: 'medium',
    userMessage: 'Deletion Failed',
    suggestion: 'An error occurred while deleting. Please try again.',
    actionable: true,
    recoverable: true
  };
}

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
  const { data, isLoading, refetch, error } = useBOMItems(bomId);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<BOMItem | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [operationInProgress, setOperationInProgress] = useState<string | null>(null);

  const bomItems = data?.items || [];
  
  // Error state handling
  if (error) {
    const errorInfo = categorizeBOMOperationError(error);
    
    return (
      <div className="space-y-6">
        <Alert variant="destructive" className="border-l-4 border-l-red-500">
          <div className="flex items-start gap-4">
            <XCircle className="h-6 w-6 text-red-600 mt-1" />
            <div className="flex-1 space-y-2">
              <AlertTitle className="text-lg font-semibold">
                {errorInfo.userMessage}
              </AlertTitle>
              <AlertDescription className="text-base leading-relaxed">
                {errorInfo.suggestion}
              </AlertDescription>
              
              {errorInfo.category === 'network' && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded p-3 mt-3">
                  <div className="flex items-start gap-2">
                    <Network className="h-4 w-4 text-blue-600 mt-0.5" />
                    <div className="text-sm text-blue-800 dark:text-blue-200">
                      <p className="font-medium">Connection Tips:</p>
                      <ul className="list-disc list-inside text-xs mt-1 space-y-1">
                        <li>Check your internet connection</li>
                        <li>Try refreshing the page</li>
                        <li>Contact IT if the issue persists</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex gap-3 pt-2">
                <Button
                  onClick={() => refetch()}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
                
                {errorInfo.category === 'permission' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open('/help/permissions', '_blank')}
                  >
                    Get Help
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Alert>
      </div>
    );
  }

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

  const [deleteLoading, setDeleteLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  
  const handleDeleteClick = (item: any) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
    setRetryCount(0); // Reset retry count for new deletion
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    
    setDeleteLoading(true);

    try {
      await deleteBOMItem(itemToDelete.id);
      await refetch(); // Refresh the data
      
      // Success feedback with context
      toast.success(`✅ "${itemToDelete.name}" deleted successfully`, {
        description: 'The BOM has been updated and dependencies are maintained.',
        duration: 4000
      });
      
      // Reset states
      setRetryCount(0);
    } catch (error: any) {
      const errorInfo = categorizeBOMOperationError(error);
      setRetryCount(prev => prev + 1);
      
      // Enhanced error handling with retry logic
      const isRecoverable = errorInfo.recoverable && retryCount < 2;
      
      const toastOptions: any = {
        description: errorInfo.suggestion,
        duration: errorInfo.severity === 'critical' ? 10000 : 7000
      };
      
      if (isRecoverable) {
        toastOptions.action = {
          label: `Retry (${retryCount + 1}/3)`,
          onClick: () => handleDeleteConfirm()
        };
      }
      
      // Show categorized error
      switch (errorInfo.category) {
        case 'dependency':
          toast.error(`🔗 ${errorInfo.userMessage}`, {
            ...toastOptions,
            action: {
              label: 'Show Dependencies',
              onClick: () => {
                // Could implement dependency viewer
                toast.info('Check the BOM tree view to see which items depend on this component.');
              }
            }
          });
          break;
          
        case 'permission':
          toast.error(`🔒 ${errorInfo.userMessage}`, toastOptions);
          break;
          
        case 'network':
          toast.error(`🌐 ${errorInfo.userMessage}`, toastOptions);
          break;
          
        case 'data':
          toast.warning(`ℹ️ ${errorInfo.userMessage}`, {
            ...toastOptions,
            action: {
              label: 'Refresh BOM',
              onClick: () => refetch()
            }
          });
          break;
          
        default:
          toast.error(`❌ ${errorInfo.userMessage}`, toastOptions);
      }
      
      // Log for debugging
      console.error('BOM Item Deletion Error:', {
        itemId: itemToDelete.id,
        itemName: itemToDelete.name,
        category: errorInfo.category,
        severity: errorInfo.severity,
        attempt: retryCount + 1,
        error
      });
    } finally {
      setDeleteLoading(false);
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
      <div className="space-y-4">
        {/* Enhanced loading state with skeleton cards */}
        <div className="text-center py-6">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="text-lg font-medium">Loading BOM Structure</p>
              <p className="text-sm text-muted-foreground">Fetching items and dependencies...</p>
            </div>
          </div>
          <Progress value={75} className="w-64 mx-auto" />
        </div>
        
        {/* Skeleton cards */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-3 flex-1">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-14" />
                  </div>
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50/30 dark:bg-gray-900/20">
        <div className="relative mb-6">
          <Package className="h-20 w-20 text-muted-foreground/40" />
          <div className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full p-1">
            <Plus className="h-4 w-4" />
          </div>
        </div>
        <h3 className="text-xl font-semibold mb-3">BOM is Empty</h3>
        <p className="text-muted-foreground max-w-md mb-6 leading-relaxed">
          Start building your Bill of Materials by adding assemblies, sub-assemblies, and parts.
          A well-structured BOM helps with cost analysis, sourcing, and manufacturing planning.
        </p>
        
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 max-w-sm">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">Quick Start Tips:</p>
              <ul className="text-xs space-y-1 text-blue-700 dark:text-blue-300">
                <li>• Add main assemblies first</li>
                <li>• Break down into sub-assemblies</li>
                <li>• Add individual parts last</li>
                <li>• Include part numbers and materials</li>
              </ul>
            </div>
          </div>
        </div>
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
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`rounded-lg border bg-card text-card-foreground shadow-sm border-l-4 transition-all duration-200 hover:shadow-md ${getBorderColor(item.itemType)}`}
            style={{ animationDelay: `${index * 50}ms` }}
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
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 border-red-200 hover:border-red-300 flex-1 md:flex-none transition-all"
                    onClick={() => handleDeleteClick(item)}
                    disabled={operationInProgress === item.id}
                  >
                    {operationInProgress === item.id ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-1" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Enhanced Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-950/20 flex items-center justify-center">
                <Trash2 className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <AlertDialogTitle className="text-lg">Delete BOM Item</AlertDialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  This action cannot be undone
                </p>
              </div>
            </div>
          </AlertDialogHeader>
          
          <div className="space-y-4">
            <AlertDialogDescription className="text-base">
              Are you sure you want to permanently delete <span className="font-semibold text-foreground">"{itemToDelete?.name}"</span> from the BOM?
            </AlertDialogDescription>
            
            {/* Warning about dependencies */}
            <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">Before deleting:</p>
                  <ul className="text-yellow-700 dark:text-yellow-300 text-xs mt-1 space-y-1">
                    <li>• Check if this item has child components</li>
                    <li>• Verify no other assemblies depend on it</li>
                    <li>• Consider the impact on cost calculations</li>
                  </ul>
                </div>
              </div>
            </div>
            
            {/* Item details for confirmation */}
            {itemToDelete && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border">
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <Badge variant="outline" className="text-xs">
                      {itemToDelete.itemType === 'assembly' ? 'Assembly' :
                       itemToDelete.itemType === 'sub_assembly' ? 'Sub-Assembly' : 'Child Part'}
                    </Badge>
                  </div>
                  {itemToDelete.partNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Part #:</span>
                      <span className="font-mono text-xs">{itemToDelete.partNumber}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quantity:</span>
                    <span>{itemToDelete.quantity} {itemToDelete.unit}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <AlertDialogFooter className="flex gap-3">
            <AlertDialogCancel disabled={deleteLoading} className="flex-1">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteLoading}
              className="bg-red-600 text-white hover:bg-red-700 flex-1 flex items-center justify-center gap-2"
            >
              {deleteLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete Item
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
