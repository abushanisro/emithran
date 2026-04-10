'use client';

// Updated: Removed all icons, compact design - Version 2.0
import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface BOMItem {
  id: string;
  partNumber: string;
  description: string;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  status: 'pending' | 'in_progress' | 'completed';
}

interface BOM {
  id: string;
  name: string;
  version: string;
  items: BOMItem[];
}

interface BOMSelectionCardProps {
  boms: BOM[];
  selectedBomId: string;
  selectedPartNumber: string;
  searchTerm: string;
  statusFilter: string;
  typeFilter: string;
  onBomChange: (bomId: string) => void;
  onPartChange: (partNumber: string) => void;
  onSearchChange: (search: string) => void;
  onStatusFilterChange: (status: string) => void;
  onTypeFilterChange: (type: string) => void;
}

export function BOMSelectionCard({
  boms,
  selectedBomId,
  selectedPartNumber,
  searchTerm,
  statusFilter,
  typeFilter,
  onBomChange,
  onPartChange,
  onSearchChange,
  onStatusFilterChange,
  onTypeFilterChange
}: BOMSelectionCardProps) {
  const selectedBom = boms.find(b => b.id === selectedBomId);

  // Filter items based on search and filters
  const filteredItems = useMemo(() => {
    if (!selectedBom) return [];

    return selectedBom.items.filter(item => {
      const matchesSearch = searchTerm === '' ||
        item.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesType = typeFilter === 'all' || item.itemType === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [selectedBom, searchTerm, statusFilter, typeFilter]);

  const totalItems = selectedBom?.items.length || 0;
  const completedItems = selectedBom?.items.filter(i => i.status === 'completed').length || 0;
  return (
    <div className="card border rounded-lg overflow-hidden bg-card">
      {/* Compact Header */}
      <div className="bg-primary py-2 px-3">
        <div className="flex items-center justify-between">
          <h6 className="m-0 font-semibold text-primary-foreground text-sm">BOM & Part Selection</h6>
          {selectedBomId && (
            <Badge variant="secondary" className="text-xs">
              {filteredItems.length}/{totalItems} parts
            </Badge>
          )}
        </div>
      </div>

      <div className="bg-card p-3 space-y-3">
        {/* Main Selection Row - BOM + Quick Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          {/* BOM Selection */}
          <div className="lg:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Select BOM
            </label>
            <Select value={selectedBomId} onValueChange={onBomChange}>
              <SelectTrigger className="h-9 bg-background border-2">
                <SelectValue placeholder="Choose a BOM to begin..." />
              </SelectTrigger>
              <SelectContent>
                {boms.map((bom) => (
                  <SelectItem key={bom.id} value={bom.id}>
                    {bom.name} <span className="text-xs text-muted-foreground">(v{bom.version})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick Stats - Only show when BOM selected */}
          {selectedBomId && (
            <>
              <div className="bg-blue-50 dark:bg-blue-950/50 rounded-lg p-2 border border-blue-200 dark:border-blue-800">
                <p className="text-[10px] font-medium text-blue-700 dark:text-blue-300">Total Items</p>
                <p className="text-sm font-bold text-blue-900 dark:text-blue-100">{totalItems}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-950/50 rounded-lg p-2 border border-green-200 dark:border-green-800">
                <p className="text-[10px] font-medium text-green-700 dark:text-green-300">Completed</p>
                <p className="text-sm font-bold text-green-900 dark:text-green-100">{completedItems}</p>
              </div>
            </>
          )}
        </div>

        {/* Filters and Part Selection - Only show when BOM is selected */}
        {selectedBomId && (
          <>
            {/* Filter Bar */}
            <div className="bg-muted/50 rounded-lg p-2 border">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                {/* Search */}
                <div className="md:col-span-3">
                  <Input
                    placeholder="Search parts by number or description..."
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="h-8 bg-background text-xs"
                  />
                </div>

                {/* Status Filter */}
                <div className="md:col-span-1.5">
                  <Select value={statusFilter} onValueChange={onStatusFilterChange}>
                    <SelectTrigger className="h-8 bg-background text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Type Filter */}
                <div className="md:col-span-1.5">
                  <Select value={typeFilter} onValueChange={onTypeFilterChange}>
                    <SelectTrigger className="h-8 bg-background text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="assembly">
                        <Badge variant="default" className="text-[9px]">Assembly</Badge>
                      </SelectItem>
                      <SelectItem value="sub_assembly">
                        <Badge variant="secondary" className="text-[9px]">Sub-Assembly</Badge>
                      </SelectItem>
                      <SelectItem value="child_part">
                        <Badge variant="outline" className="text-[9px]">Child Part</Badge>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Part Selection */}
            <div className="bg-accent/20 rounded-lg p-2 border border-primary/20">
              <label className="text-xs font-semibold text-foreground mb-2 flex items-center justify-between">
                <span>Select Part to Create Process Plan</span>
                <Badge variant="outline" className="text-[9px]">
                  {filteredItems.length} results
                </Badge>
              </label>
              <Select
                value={selectedPartNumber}
                onValueChange={onPartChange}
              >
                <SelectTrigger className="h-8 bg-background border-2 text-xs">
                  <SelectValue placeholder="Choose a part from filtered results..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredItems.length === 0 ? (
                    <div className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">No parts match your filters</p>
                    </div>
                  ) : (
                    filteredItems.map((item) => (
                      <SelectItem key={item.id} value={item.partNumber}>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              item.itemType === 'assembly' ? 'default' :
                                item.itemType === 'sub_assembly' ? 'secondary' :
                                  'outline'
                            }
                            className="text-[8px] px-1 py-0"
                          >
                            {item.itemType === 'assembly' ? 'ASM' : item.itemType === 'sub_assembly' ? 'SUB' : 'PRT'}
                          </Badge>
                          <span className="font-medium text-xs">{item.partNumber}</span>
                          <span className="text-muted-foreground text-xs">- {item.description}</span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Empty State - Only show if no BOMs available */}
        {boms.length === 0 && (
          <div className="text-center py-6 px-4">
            <p className="text-sm font-medium text-muted-foreground mb-1">No BOMs Available</p>
            <p className="text-xs text-muted-foreground">
              Create a BOM in your project to start process planning
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
