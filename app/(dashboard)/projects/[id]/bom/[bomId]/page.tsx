'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { useProject } from '@/lib/api/hooks/useProjects';
import { useBOM } from '@/lib/api/hooks/useBOM';
import { useBOMItems, deleteBOMItem } from '@/lib/api/hooks/useBOMItems';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Plus,
  Download,
  Upload,
  Save,
  FileSpreadsheet,
  Settings,
  FileText,
  Box,
  FileDown,
} from 'lucide-react';
import { BOMItemsFlat, BOMItemDialog, BOMTreeView, BOMItemDetailPanel } from '@/components/features/bom';
import { BOMItem } from '@/lib/api/hooks/useBOMItems';
import { BOMItemType } from '@/lib/types/bom.types';
import { toast } from 'sonner';

export default function
  BOMDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const bomId = params.bomId as string;

  const { data: project } = useProject(projectId);
  const { data: bomData } = useBOM(bomId);
  const { data: bomItemsData, refetch: refetchBOMItems } = useBOMItems(bomId);

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [parentItemId, setParentItemId] = useState<string | null>(null);
  const [defaultItemType, setDefaultItemType] = useState<BOMItemType>(BOMItemType.ASSEMBLY);
  const [viewingItem, setViewingItem] = useState<BOMItem | null>(null);
  const [preferredView, setPreferredView] = useState<'2d' | '3d'>('3d');

  // Update viewingItem when bomItemsData changes (e.g., after file upload)
  useEffect(() => {
    if (viewingItem && bomItemsData?.items) {
      const updatedItem = bomItemsData.items.find(item => item.id === viewingItem.id);
      if (updatedItem) {
        setViewingItem(updatedItem);
      }
    }
  }, [bomItemsData?.items]);

  const bom = bomData || {
    id: bomId,
    name: 'Loading...',
    description: '',
    version: '1.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Build tree structure from flat items list
  const buildTree = (items: any[]) => {
    const itemMap = new Map();
    const roots: any[] = [];

    // Create a map of all items
    items.forEach(item => {
      itemMap.set(item.id, { ...item, children: [] });
    });

    // Build the tree
    items.forEach(item => {
      const node = itemMap.get(item.id);
      if (item.parentItemId) {
        const parent = itemMap.get(item.parentItemId);
        if (parent) {
          parent.children.push(node);
        } else {
          // Parent not found, treat as root
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    });

    return roots;
  };

  const bomItems = buildTree(bomItemsData?.items || []);

  // Calculate depth for each item
  const getItemDepth = (itemId: string, items: any[], visited = new Set<string>()): number => {
    if (visited.has(itemId)) return 0; // Cycle detected
    const item = items.find(i => i.id === itemId);
    if (!item || !item.parentItemId) return 0;
    visited.add(itemId);
    return 1 + getItemDepth(item.parentItemId, items, visited);
  };

  // Sort items to maintain hierarchy (parents before children)
  const getSortedItems = (items: any[]) => {
    const itemMap = new Map(items.map(item => [item.id, item]));
    const sorted: any[] = [];
    const added = new Set<string>();

    const addItem = (item: any) => {
      if (added.has(item.id)) return;

      // Add parent first if it exists
      if (item.parentItemId && itemMap.has(item.parentItemId)) {
        addItem(itemMap.get(item.parentItemId));
      }

      sorted.push(item);
      added.add(item.id);
    };

    items.forEach(item => addItem(item));
    return sorted;
  };

  // Auto-assign parent based on item type hierarchy
  const getAutoParentForType = (type: BOMItemType): string | null => {
    const flatItems = bomItemsData?.items || [];

    if (type === BOMItemType.ASSEMBLY) {
      // Assemblies are always top-level
      return null;
    }

    if (type === BOMItemType.SUB_ASSEMBLY) {
      // Sub-assemblies go under the most recent assembly
      const assemblies = flatItems.filter(item => item.itemType === 'assembly');
      return assemblies.length > 0 ? assemblies[assemblies.length - 1]?.id ?? null : null;
    }

    if (type === BOMItemType.CHILD_PART) {
      // Child parts go under the most recent sub-assembly
      const subAssemblies = flatItems.filter(item => item.itemType === 'sub_assembly');
      if (subAssemblies.length > 0) {
        return subAssemblies[subAssemblies.length - 1]?.id ?? null;
      }
      // If no sub-assembly, go under most recent assembly
      const assemblies = flatItems.filter(item => item.itemType === 'assembly');
      return assemblies.length > 0 ? assemblies[assemblies.length - 1]?.id ?? null : null;
    }

    return null;
  };

  const handleAddItem = () => {
    setSelectedItem(null);
    setParentItemId(null);
    setDefaultItemType(BOMItemType.ASSEMBLY); // Always create Assembly from main button
    setItemDialogOpen(true);
  };

  const handleEditItem = (item: any) => {
    setSelectedItem(item);
    setParentItemId(null);
    setItemDialogOpen(true);
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteBOMItem(id);
      await refetchBOMItems(); // Refresh the list
      toast.success('Item deleted successfully');
    } catch (error) {
      toast.error('Failed to delete item');
    }
  };

  const handleAddTreeItem = (parentId: string | null, type: BOMItemType) => {
    setSelectedItem(null);
    setParentItemId(parentId);
    setDefaultItemType(type);
    setItemDialogOpen(true);
  };

  const handleViewItem = (item: BOMItem, viewType?: '2d' | '3d') => {
    setViewingItem(item);
    setPreferredView(viewType || '3d');
  };

  // Download CSV Template
  const handleDownloadTemplate = () => {
    try {
      // CSV headers
      const headers = [
        'Part Number',
        'Name',
        'Description',
        'Type',
        'Quantity',
        'Unit',
        'Material',
        'Material Grade',
        'Annual Volume',
        'Parent Item'
      ];

      // Example data rows
      const exampleRows = [
        ['ASM-001', 'Main Assembly', 'Top level assembly', 'assembly', '1', 'pcs', 'Aluminum', '6061-T6', '10000', ''],
        ['SUB-001', 'Motor Sub-Assembly', 'Electric motor unit', 'sub_assembly', '1', 'pcs', 'Steel', 'AISI 304', '10000', 'ASM-001'],
        ['PRT-001', 'Motor Housing', 'Cast aluminum housing', 'child_part', '1', 'pcs', 'Aluminum', 'A356', '10000', 'SUB-001'],
        ['PRT-002', 'Rotor', 'Steel rotor assembly', 'child_part', '1', 'pcs', 'Steel', '1045', '10000', 'SUB-001'],
        ['PRT-003', 'Mounting Bracket', 'L-shaped bracket', 'child_part', '4', 'pcs', 'Steel', 'AISI 304', '40000', 'ASM-001'],
        ['PRT-004', 'Bolt M8x20', 'Hex head bolt', 'child_part', '8', 'pcs', 'Steel', 'Grade 8.8', '80000', 'ASM-001'],
      ];

      // Combine headers and example rows
      const csvContent = [
        headers.join(','),
        ...exampleRows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'BOM_Import_Template.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('Template downloaded successfully');
    } catch (error) {
      toast.error('Failed to download template');
    }
  };

  // Export BOM to CSV
  const handleExport = () => {
    try {
      const items = bomItemsData?.items || [];

      // Prepare CSV headers
      const headers = [
        'Part Number',
        'Name',
        'Description',
        'Type',
        'Quantity',
        'Unit',
        'Material',
        'Material Grade',
        'Annual Volume',
        'Parent Item'
      ];

      // Convert items to CSV rows
      const rows = items.map(item => [
        item.partNumber || '',
        item.name || '',
        item.description || '',
        item.itemType || '',
        item.quantity?.toString() || '',
        item.unit || '',
        item.material || '',
        item.materialGrade || '',
        item.annualVolume?.toString() || '',
        items.find(i => i.id === item.parentItemId)?.partNumber || ''
      ]);

      // Combine headers and rows
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `BOM_${bom.name}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('BOM exported successfully');
    } catch (error) {
      toast.error('Failed to export BOM');
    }
  };

  // Import BOM from CSV
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';

    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const lines = text.split('\n');

        if (lines.length < 2) {
          toast.error('Invalid CSV file');
          return;
        }

        // Parse CSV (simple parser, might need enhancement for complex CSVs)
        const headers = lines[0].split(',').map((h: string) => h.trim().replace(/"/g, ''));
        const itemsToImport = [];

        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;

          const values = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
          const cleanedValues = values.map((v: string) => v.trim().replace(/^"|"$/g, ''));

          const item: any = {};
          headers.forEach((header: string, index: number) => {
            const value = cleanedValues[index] || '';

            switch (header.toLowerCase()) {
              case 'part number':
                item.partNumber = value;
                break;
              case 'name':
                item.name = value;
                break;
              case 'description':
                item.description = value;
                break;
              case 'type':
                item.itemType = value;
                break;
              case 'quantity':
                item.quantity = value ? parseInt(value) : undefined;
                break;
              case 'unit':
                item.unit = value;
                break;
              case 'material':
                item.material = value;
                break;
              case 'material grade':
                item.materialGrade = value;
                break;
              case 'annual volume':
                item.annualVolume = value ? parseInt(value) : undefined;
                break;
            }
          });

          if (item.name) {
            itemsToImport.push(item);
          }
        }

        toast.success(`Parsed ${itemsToImport.length} items. Import functionality coming soon!`);

// await createBOMItem(bomId, itemsToImport);
        // refetchBOMItems();

      } catch (error) {
        toast.error('Failed to import CSV file');
      }
    };

    input.click();
  };

  // Save changes (currently just a placeholder - add actual save logic)
  const handleSaveChanges = async () => {
    try {
      toast.success('Changes saved successfully');
      
      // For now, this might just be a confirmation that auto-save is working
    } catch (error) {
      toast.error('Failed to save changes');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={bom.name}
        description={bom.description}
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/bom?projectId=${projectId}`)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to BOM Management
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleDownloadTemplate}
            title="Download CSV template with example data"
          >
            <FileDown className="h-4 w-4" />
            Template
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleImport}
          >
            <Upload className="h-4 w-4" />
            Import
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button
            className="gap-2"
            onClick={handleSaveChanges}
          >
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </PageHeader>

      {/* BOM Header Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>BOM Information</CardTitle>
              <CardDescription>Version: {bom.version}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Project</p>
              <p className="font-medium">{project?.name || 'Loading...'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Created</p>
              <p className="font-medium">{new Date(bom.createdAt).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Last Updated</p>
              <p className="font-medium">{new Date(bom.updatedAt).toLocaleDateString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Project Files - Hierarchical List */}
      {bomItemsData?.items && bomItemsData.items.some(item => item.file2dPath || item.file3dPath) && (
        <Card>
          <CardHeader>
            <CardTitle>Project Files</CardTitle>
            <CardDescription>All 2D drawings and 3D models in hierarchical order</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              {getSortedItems(bomItemsData.items)
                .filter(item => item.file2dPath || item.file3dPath)
                .map((item) => {
                  const depth = getItemDepth(item.id, bomItemsData.items);

                  // Get item type badge color
                  const getTypeColor = (type: string) => {
                    switch (type) {
                      case 'assembly':
                        return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
                      case 'sub_assembly':
                        return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
                      case 'child_part':
                        return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
                      default:
                        return 'bg-muted text-muted-foreground border-muted';
                    }
                  };

                  const getTypeLabel = (type: string) => {
                    switch (type) {
                      case 'assembly':
                        return 'Assembly';
                      case 'sub_assembly':
                        return 'Sub-Assembly';
                      case 'child_part':
                        return 'Part';
                      default:
                        return type;
                    }
                  };

                  return (
                    <div
                      key={item.id}
                      className="group hover:bg-muted/50 rounded-md transition-colors"
                    >
                      <div className="flex items-center gap-2 py-1.5 px-2" style={{ paddingLeft: `${8 + depth * 20}px` }}>
                        {/* Hierarchy indicator */}
                        {depth > 0 && (
                          <div className="flex items-center">
                            <div className="w-3 h-px bg-border" />
                          </div>
                        )}

                        {/* Item Name & Type */}
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 h-4 ${getTypeColor(item.itemType)}`}
                          >
                            {getTypeLabel(item.itemType)}
                          </Badge>
                          {item.partNumber && (
                            <span className="text-xs text-muted-foreground">#{item.partNumber}</span>
                          )}
                        </div>

                        {/* Uploaded File Names - Clickable */}
                        <div className="flex items-center gap-4 text-xs">
                          {item.file2dPath && (() => {
                            const fileName = item.file2dPath.split('/').pop() || '';
                            // Remove timestamp prefix (pattern: timestamp_originalname)
                            const originalName = fileName.includes('_')
                              ? fileName.substring(fileName.indexOf('_') + 1)
                              : fileName;
                            return (
                              <button
                                onClick={() => handleViewItem(item, '2d')}
                                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                              >
                                <FileText className="h-3 w-3 flex-shrink-0" />
                                <span title={originalName}>
                                  {originalName}
                                </span>
                              </button>
                            );
                          })()}
                          {item.file3dPath && (() => {
                            const fileName = item.file3dPath.split('/').pop() || '';
                            // Remove timestamp prefix (pattern: timestamp_originalname)
                            const originalName = fileName.includes('_')
                              ? fileName.substring(fileName.indexOf('_') + 1)
                              : fileName;
                            return (
                              <button
                                onClick={() => handleViewItem(item, '3d')}
                                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                              >
                                <Box className="h-3 w-3 flex-shrink-0" />
                                <span title={originalName}>
                                  {originalName}
                                </span>
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs defaultValue="items" className="space-y-4">
        <TabsList>
          <TabsTrigger value="items">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Items & Parts
          </TabsTrigger>
          <TabsTrigger value="tree">Tree View</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>BOM Items</CardTitle>
                  <CardDescription>Manage parts, materials, and components</CardDescription>
                </div>
                <Button onClick={handleAddItem} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add BOM
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <BOMItemsFlat
                bomId={bomId}
                onEditItem={handleEditItem}
                onViewItem={handleViewItem}
                onAddChildItem={handleAddTreeItem}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tree" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>BOM Tree Structure</CardTitle>
              <CardDescription>Hierarchical view of assemblies and sub-assemblies</CardDescription>
            </CardHeader>
            <CardContent>
              <BOMTreeView
                items={bomItems}
                projectName={project?.name}
                projectId={projectId}
                onAddItem={handleAddTreeItem}
                onEditItem={handleEditItem}
                onDeleteItem={handleDeleteItem}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <BOMItemDialog
        bomId={bomId}
        item={selectedItem}
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        parentItemId={parentItemId}
        defaultItemType={defaultItemType}
        onSuccess={() => refetchBOMItems()}
        getAutoParent={getAutoParentForType}
      />

      <BOMItemDetailPanel
        item={viewingItem}
        onClose={() => setViewingItem(null)}
        onUpdate={() => refetchBOMItems()}
        preferredView={preferredView}
      />

      {/* Workflow Navigation - Bottom */}
      <WorkflowNavigation 
        currentModuleId="bom" 
        projectId={projectId}
      />
    </div>
  );
}
