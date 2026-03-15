'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Edit2, Box, Settings, FileText } from 'lucide-react';

interface BOMTreeItem {
  id: string;
  name: string;
  partNumber?: string;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  quantity?: number;
  material?: string;
  parentItemId?: string;
  children?: BOMTreeItem[];
  level?: number;
  expanded?: boolean;
}

interface HierarchicalBOMTreeProps {
  items: BOMTreeItem[];
  selectedItems: BOMTreeItem[];
  onItemSelect: (item: BOMTreeItem) => void;
  onItemHover: (item: BOMTreeItem | null) => void;
  onEditItem: (item: BOMTreeItem) => void;
}

export function HierarchicalBOMTree({ 
  items, 
  selectedItems, 
  onItemSelect, 
  onItemHover, 
  onEditItem 
}: HierarchicalBOMTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Build hierarchy from flat list
  const buildHierarchy = (flatItems: BOMTreeItem[]): BOMTreeItem[] => {
    const itemMap = new Map<string, BOMTreeItem>();
    const rootItems: BOMTreeItem[] = [];

    // First pass: create map and add children arrays
    flatItems.forEach(item => {
      itemMap.set(item.id, { ...item, children: [], level: 0, expanded: expandedNodes.has(item.id) });
    });

    // Second pass: build hierarchy
    flatItems.forEach(item => {
      const treeItem = itemMap.get(item.id)!;
      
      if (item.parentItemId && itemMap.has(item.parentItemId)) {
        // This is a child item
        const parent = itemMap.get(item.parentItemId)!;
        parent.children!.push(treeItem);
        treeItem.level = (parent.level || 0) + 1;
      } else {
        // This is a root item
        rootItems.push(treeItem);
      }
    });

    return rootItems;
  };

  const toggleExpanded = (nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'assembly':
        return <Box className="h-4 w-4" />;
      case 'sub_assembly':
        return <Settings className="h-4 w-4" />;
      case 'child_part':
        return <FileText className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'assembly':
        return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
      case 'sub_assembly':
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
      case 'child_part':
        return 'bg-orange-500/10 text-orange-700 border-orange-500/20';
      default:
        return 'bg-gray-500/10 text-gray-700 border-gray-500/20';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'assembly':
        return 'Assembly';
      case 'sub_assembly':
        return 'Sub-Assembly';
      case 'child_part':
        return 'Child Part';
      default:
        return type;
    }
  };

  const renderTreeNode = (item: BOMTreeItem): React.ReactNode => {
    const hasChildren = item.children && item.children.length > 0;
    const isSelected = selectedItems.some(selected => selected.id === item.id);
    const isExpanded = expandedNodes.has(item.id);
    const level = item.level || 0;
    const indentStyle = { paddingLeft: `${level * 20 + 8}px` };

    return (
      <div key={item.id}>
        <div 
          className={`group border rounded-lg cursor-pointer transition-all ${
            isSelected 
              ? 'bg-primary/10 border-primary/30 shadow-sm ring-1 ring-primary/20' 
              : 'hover:bg-card/80 hover:border-border/60 border-border/20'
          }`}
          onClick={() => onItemSelect(item)}
          onMouseEnter={() => onItemHover(item)}
          onMouseLeave={() => onItemHover(null)}
        >
          <div className="flex items-center gap-2 p-2" style={indentStyle}>
            {/* Tree connection lines */}
            {level > 0 && (
              <div className="flex items-center">
                <div className="w-4 h-px bg-border"></div>
              </div>
            )}
            
            {/* Expand/collapse button */}
            {hasChildren ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 hover:bg-muted/50"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded(item.id);
                }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </Button>
            ) : (
              <div className="w-6" />
            )}


            {/* Item content */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">
                  {item.name}
                  {item.quantity && ` (Qty: ${item.quantity})`}
                </div>
                {item.partNumber && (
                  <div className="text-xs text-muted-foreground">
                    #{item.partNumber}
                  </div>
                )}
                {item.material && (
                  <div className="text-xs text-muted-foreground">
                    Material: {item.material}
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <Badge 
                  variant="outline" 
                  className={`text-[10px] px-1.5 py-0 h-5 ${getTypeColor(item.itemType)}`}
                >
                  {getTypeLabel(item.itemType)}
                </Badge>
                
                <div className="flex items-center gap-1">
                  <Button 
                    size="sm" 
                    variant="ghost"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditItem(item);
                    }}
                    title="Edit Item"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  
                  <Button 
                    size="sm" 
                    variant="ghost"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      // TODO: Implement DFM analysis for specific part
                      console.log('DFM Analysis for:', item);
                    }}
                    title="Run DFM Analysis"
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Render children */}
        {hasChildren && isExpanded && (
          <div className="mt-1 space-y-1">
            {item.children!.map(child => renderTreeNode(child))}
          </div>
        )}
      </div>
    );
  };

  const hierarchicalItems = buildHierarchy(items);

  return (
    <div className="space-y-1">
      {hierarchicalItems.length > 0 ? (
        hierarchicalItems.map(item => renderTreeNode(item))
      ) : (
        <div className="text-center text-muted-foreground py-8">
          <Box className="h-12 w-12 mx-auto opacity-50 mb-2" />
          <p>No BOM items found</p>
          <p className="text-xs">Upload a STEP file to generate parts automatically</p>
        </div>
      )}
    </div>
  );
}