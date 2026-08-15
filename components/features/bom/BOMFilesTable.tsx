'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  Box, 
  Eye, 
  Filter,
  Search,
  Upload
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';

interface BOMFilesTableProps {
  items: BOMItem[];
  onViewItem: (item: BOMItem, viewType?: '2d' | '3d') => void;
}

interface FileInfo {
  item: BOMItem;
  fileName: string;
  fileType: '2d' | '3d';
  filePath: string;
  fileExtension: string;
}

export function BOMFilesTable({ items, onViewItem }: BOMFilesTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState<'all' | '2d' | '3d'>('all');
  const [itemTypeFilter, setItemTypeFilter] = useState<string>('all');

  // Extract all files from BOM items
  const allFiles: FileInfo[] = [];
  
  items.forEach(item => {
    if (item.file2dPath) {
      const fileName = item.file2dPath.split('/').pop() || '';
      const originalName = fileName.includes('_') 
        ? fileName.substring(fileName.indexOf('_') + 1) 
        : fileName;
      const extension = originalName.split('.').pop()?.toLowerCase() || '';
      
      allFiles.push({
        item,
        fileName: originalName,
        fileType: '2d',
        filePath: item.file2dPath,
        fileExtension: extension
      });
    }
    
    if (item.file3dPath) {
      const fileName = item.file3dPath.split('/').pop() || '';
      const originalName = fileName.includes('_') 
        ? fileName.substring(fileName.indexOf('_') + 1) 
        : fileName;
      const extension = originalName.split('.').pop()?.toLowerCase() || '';
      
      allFiles.push({
        item,
        fileName: originalName,
        fileType: '3d',
        filePath: item.file3dPath,
        fileExtension: extension
      });
    }
  });

  // Filter files
  const filteredFiles = allFiles.filter(file => {
    const matchesSearch = 
      file.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      file.item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (file.item.partNumber || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFileType = fileTypeFilter === 'all' || file.fileType === fileTypeFilter;
    const matchesItemType = itemTypeFilter === 'all' || file.item.itemType === itemTypeFilter;
    
    return matchesSearch && matchesFileType && matchesItemType;
  });

  const getFileIcon = (fileType: '2d' | '3d') => {
    return fileType === '2d' ? 
      <FileText className="h-4 w-4 text-blue-600" /> : 
      <Box className="h-4 w-4 text-purple-600" />;
  };

  const getFileTypeBadge = (fileType: '2d' | '3d', extension: string) => {
    const isImage2d = fileType === '2d' && ['png', 'jpg', 'jpeg'].includes(extension);
    const isPdf2d = fileType === '2d' && extension === 'pdf';
    
    if (fileType === '2d') {
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          {isImage2d ? 'Image' : isPdf2d ? 'PDF' : 'Drawing'}
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
          3D Model
        </Badge>
      );
    }
  };

  const getItemTypeBadge = (type: string) => {
    const config = {
      assembly: { label: 'Assembly', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      sub_assembly: { label: 'Sub-Assembly', className: 'bg-blue-50 text-blue-700 border-blue-200' },
      child_part: { label: 'Part', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    }[type] || { label: type, className: 'bg-gray-50 text-gray-700 border-gray-200' };

    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  if (allFiles.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Project Files</CardTitle>
          <CardDescription>No files have been attached to any BOM items yet</CardDescription>
        </CardHeader>
        <CardContent className="py-8">
          <div className="text-center">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              Add 2D drawings and 3D models to your BOM items to see them here
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Project Files ({allFiles.length} files)</CardTitle>
            <CardDescription>All attached 2D drawings and 3D models</CardDescription>
          </div>
        </div>
        
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={fileTypeFilter} onValueChange={(value: 'all' | '2d' | '3d') => setFileTypeFilter(value)}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="2d">2D Drawings</SelectItem>
              <SelectItem value="3d">3D Models</SelectItem>
            </SelectContent>
          </Select>
          <Select value={itemTypeFilter} onValueChange={setItemTypeFilter}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              <SelectItem value="assembly">Assembly</SelectItem>
              <SelectItem value="sub_assembly">Sub-Assembly</SelectItem>
              <SelectItem value="child_part">Parts</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">File</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Type</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">BOM Item</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Category</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Part Number</th>
                <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file) => (
                <tr key={`${file.item.id}-${file.fileType}`} className="border-b hover:bg-muted/30">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      {getFileIcon(file.fileType)}
                      <div>
                        <p className="font-medium text-sm">{file.fileName}</p>
                        <p className="text-xs text-muted-foreground uppercase">{file.fileExtension}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    {getFileTypeBadge(file.fileType, file.fileExtension)}
                  </td>
                  <td className="p-4">
                    <p className="font-medium text-sm">{file.item.name}</p>
                    {file.item.description && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {file.item.description}
                      </p>
                    )}
                  </td>
                  <td className="p-4">
                    {getItemTypeBadge(file.item.itemType)}
                  </td>
                  <td className="p-4">
                    <span className="text-sm text-muted-foreground">
                      {file.item.partNumber || '—'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewItem(file.item, file.fileType)}
                        className="h-8"
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredFiles.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Filter className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No files match your current filters</p>
          </div>
        )}
        
        <div className="p-4 border-t bg-muted/30 text-sm text-muted-foreground">
          Showing {filteredFiles.length} of {allFiles.length} files
        </div>
      </CardContent>
    </Card>
  );
}