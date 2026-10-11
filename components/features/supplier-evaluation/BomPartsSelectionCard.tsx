'use client';
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, FileText, Box } from 'lucide-react';

interface BOMItem {
  id: string;
  partNumber: string;
  description: string;
  category: string;
  processType: string;
  quantity: number;
  selected?: boolean;
  file2dPath?: string;
  file3dPath?: string;
}

interface BomPartsSelectionCardProps {
  bomItems: BOMItem[];
  selectedItems: string[];
  groupName: string;
  onItemToggle: (itemId: string, selected: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onGroupNameChange: (name: string) => void;
  onCreateGroup?: () => void;
  isCreatingGroup?: boolean;
  onViewFile?: (item: BOMItem, fileType: '2d' | '3d') => void;
}

export function BomPartsSelectionCard({
  bomItems,
  selectedItems,
  groupName,
  onItemToggle,
  onSelectAll,
  onClearSelection,
  onGroupNameChange,
  onCreateGroup,
  isCreatingGroup = false,
  onViewFile
}: BomPartsSelectionCardProps) {
  const [searchTerm, setSearchTerm] = useState('');

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!searchTerm) return bomItems;

    const search = searchTerm.toLowerCase();
    return bomItems.filter(item =>
      item.partNumber.toLowerCase().includes(search) ||
      item.description.toLowerCase().includes(search) ||
      item.category.toLowerCase().includes(search)
    );
  }, [bomItems, searchTerm]);

  const selectedCount = selectedItems.length;
  const totalCount = bomItems.length;

  return (
    <Card className="rounded-lg border bg-card text-card-foreground shadow-xs">
      <CardHeader className="flex flex-col space-y-1.5 p-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-bold">
            1
          </div>
          <div className="flex-1">
            <CardTitle className="tracking-tight text-lg font-semibold text-gray-700">
              SELECT BOM PARTS
            </CardTitle>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-sm text-muted-foreground">
                {selectedCount} selected
              </span>
            </div>
          </div>
        </div>

        {/* Group Name Input */}
        <div className="mt-4">
          <label className="text-sm font-medium text-gray-700 mb-2 block">
            Group Name
          </label>
          <Input
            placeholder="Enter supplier evaluation group name..."
            value={groupName}
            onChange={(e) => onGroupNameChange(e.target.value)}
            className="max-w-md"
          />
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-0">
        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search parts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={selectedCount === totalCount ? "default" : "outline"}
              className="bg-teal-600 hover:bg-teal-700 text-white"
              onClick={selectedCount === totalCount ? onClearSelection : onSelectAll}
            >
              {selectedCount === totalCount ? `Clear (${totalCount})` : `All (${totalCount})`}
            </Button>
            
            {onCreateGroup && selectedCount > 0 && groupName.trim() && (
              <Button
                onClick={onCreateGroup}
                disabled={isCreatingGroup}
                className="bg-green-600 hover:bg-green-700 text-white gap-2"
              >
                {isCreatingGroup ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create New Evaluation
              </Button>
            )}
          </div>
        </div>

        {/* Parts Table */}
        <div className="border rounded-lg overflow-hidden">
          {/* Table Header */}
          <div className="bg-gray-50 p-4 border-b">
            <div className="grid grid-cols-12 gap-4 text-sm font-medium text-gray-700">
              <div className="col-span-1"></div>
              <div className="col-span-2">PART NO.</div>
              <div className="col-span-3">DESCRIPTION</div>
              <div className="col-span-2">CATEGORY</div>
              <div className="col-span-2">PROCESS</div>
              <div className="col-span-1">QTY</div>
              <div className="col-span-1">FILES</div>
            </div>
          </div>

          {/* Table Body */}
          <div className="max-h-96 overflow-y-auto">
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {searchTerm ? 'No parts match your search criteria' : 'No parts available'}
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  className={`grid grid-cols-12 gap-4 p-4 border-b hover:bg-gray-50 transition-colors ${selectedItems.includes(item.id) ? 'bg-teal-50 border-teal-200' : ''
                    }`}
                >
                  <div className="col-span-1 flex items-center">
                    <Checkbox
                      checked={selectedItems.includes(item.id)}
                      onCheckedChange={(checked) => onItemToggle(item.id, checked as boolean)}
                    />
                  </div>
                  <div 
                    className="col-span-2 text-sm font-medium cursor-pointer"
                    onClick={() => onItemToggle(item.id, !selectedItems.includes(item.id))}
                  >
                    {item.partNumber}
                  </div>
                  <div 
                    className="col-span-3 text-sm text-gray-600 cursor-pointer"
                    onClick={() => onItemToggle(item.id, !selectedItems.includes(item.id))}
                  >
                    {item.description}
                  </div>
                  <div 
                    className="col-span-2 cursor-pointer"
                    onClick={() => onItemToggle(item.id, !selectedItems.includes(item.id))}
                  >
                    <Badge variant="outline" className="text-xs">
                      {item.category}
                    </Badge>
                  </div>
                  <div 
                    className="col-span-2 text-sm text-gray-600 cursor-pointer"
                    onClick={() => onItemToggle(item.id, !selectedItems.includes(item.id))}
                  >
                    {item.processType}
                  </div>
                  <div 
                    className="col-span-1 text-sm font-medium cursor-pointer"
                    onClick={() => onItemToggle(item.id, !selectedItems.includes(item.id))}
                  >
                    {item.quantity}
                  </div>
                  <div className="col-span-1 flex items-center gap-1">
                    {item.file2dPath && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewFile?.(item, '2d');
                        }}
                        className="p-1 hover:bg-blue-100 rounded text-blue-600 transition-colors"
                        title="View 2D Drawing"
                      >
                        <FileText className="h-3 w-3" />
                      </button>
                    )}
                    {item.file3dPath && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewFile?.(item, '3d');
                        }}
                        className="p-1 hover:bg-purple-100 rounded text-purple-600 transition-colors"
                        title="View 3D Model"
                      >
                        <Box className="h-3 w-3" />
                      </button>
                    )}
                    {!item.file2dPath && !item.file3dPath && (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Table Footer */}
          <div className="bg-gray-50 p-2 text-sm text-muted-foreground text-center">
            Showing {filteredItems.length} of {totalCount} parts
          </div>
        </div>
      </CardContent>
    </Card>
  );
}