'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { useProject } from '@/lib/api/hooks/useProjects';
import { useBOM } from '@/lib/api/hooks/useBOM';
import { useBOMItems, deleteBOMItem, createBOMItem } from '@/lib/api/hooks/useBOMItems';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  ArrowLeft,
  Plus,
  Download,
  Upload,
  FileSpreadsheet,
  Settings,
  FileText,
  Box,
  FileDown,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { BOMItemsFlat, BOMItemDialog, BOMTreeView, BOMItemDetailPanel } from '@/components/features/bom';
import { BOMItem } from '@/lib/api/hooks/useBOMItems';
import { BOMItemType } from '@/lib/types/bom.types';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

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
  
  // Import states
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState('');
  const [importSummary, setImportSummary] = useState<{
    total: number;
    successful: number;
    failed: number;
    errors: Array<{ item: string; error: string; index: number }>;
  } | null>(null);
  const [showImportSummary, setShowImportSummary] = useState(false);
  
  // Bulk Delete States
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setBulkDeleting] = useState(false);

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

  // PRODUCTION-GRADE BULK DELETE ALL BOM ITEMS
  const handleBulkDeleteAll = async () => {
    setBulkDeleting(true);
    try {
      const allItems = bomItemsData?.items || [];
      
      if (allItems.length === 0) {
        toast.error('No items to delete');
        return;
      }

      console.log(`🗑️ Starting bulk delete of ${allItems.length} items...`);
      
      // Sort items by hierarchy level in reverse order (delete children first)
      const sortedItems = allItems.sort((a, b) => {
        // Get hierarchy level from itemType
        const getLevel = (type: string) => {
          switch (type) {
            case 'assembly': return 1;
            case 'sub_assembly': return 2;
            case 'child_part': return 3;
            default: return 3;
          }
        };
        
        const levelA = getLevel(a.itemType);
        const levelB = getLevel(b.itemType);
        
        // Delete in reverse hierarchy order (level 3 first, then 2, then 1)
        return levelB - levelA;
      });

      let deletedCount = 0;
      let failedCount = 0;
      const batchSize = 5; // Delete in small batches to avoid overwhelming the server
      
      for (let i = 0; i < sortedItems.length; i += batchSize) {
        const batch = sortedItems.slice(i, i + batchSize);
        
        console.log(`🔄 Deleting batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(sortedItems.length / batchSize)}`);
        
        // Delete items in parallel within batch
        const batchPromises = batch.map(async (item) => {
          try {
            await deleteBOMItem(item.id);
            deletedCount++;
            console.log(`✅ Deleted: ${item.name} (${item.partNumber || 'no part number'})`);
          } catch (error: any) {
            failedCount++;
            console.error(`❌ Failed to delete: ${item.name}`, error);
          }
        });

        await Promise.allSettled(batchPromises);
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < sortedItems.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Refresh the BOM items list
      await refetchBOMItems();

      // Show results
      if (failedCount === 0) {
        toast.success(`Successfully deleted all ${deletedCount} BOM items`);
      } else {
        toast.warning(`Deleted ${deletedCount} items, ${failedCount} failed to delete`);
      }

      console.log(`🏁 Bulk delete completed: ${deletedCount} deleted, ${failedCount} failed`);
      
    } catch (error: any) {
      console.error('Bulk delete error:', error);
      toast.error(`Failed to delete items: ${error.message}`);
    } finally {
      setBulkDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  };

  // Download Enhanced Excel Template
  const handleDownloadTemplate = () => {
    try {
      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      
      // Template headers
      const headers = [
        'Level',
        'Part Number',
        'Name',
        'Description',
        'Type',
        'Quantity',
        'Unit',
        'Material',
        'Material Grade',
        'Annual Volume',
        'Make/Buy',
        'Unit Cost',
        'Parent Reference'
      ];

      // Example data with hierarchy
      const exampleData = [
        [1, 'ASM-001', 'Main Assembly', 'Top level assembly', 'assembly', 1, 'pcs', 'Aluminum', '6061-T6', 10000, 'make', 150.00, ''],
        [2, 'SUB-001', 'Motor Sub-Assembly', 'Electric motor unit', 'sub_assembly', 1, 'pcs', 'Steel', 'AISI 304', 10000, 'make', 85.00, 'ASM-001'],
        [3, 'PRT-001', 'Motor Housing', 'Cast aluminum housing', 'child_part', 1, 'pcs', 'Aluminum', 'A356', 10000, 'make', 25.00, 'SUB-001'],
        [3, 'PRT-002', 'Rotor', 'Steel rotor assembly', 'child_part', 1, 'pcs', 'Steel', '1045', 10000, 'make', 30.00, 'SUB-001'],
        [2, 'SUB-002', 'Control Unit', 'Electronic control system', 'sub_assembly', 1, 'pcs', 'Plastic', 'ABS', 10000, 'buy', 45.00, 'ASM-001'],
        [3, 'PRT-003', 'Control Board', 'Main PCB assembly', 'child_part', 1, 'pcs', 'Fiberglass', 'FR4', 10000, 'buy', 35.00, 'SUB-002'],
        [3, 'PRT-004', 'Enclosure', 'Plastic housing', 'child_part', 1, 'pcs', 'Plastic', 'ABS', 10000, 'buy', 8.00, 'SUB-002'],
        [1, 'ASM-002', 'Mounting Assembly', 'Mounting bracket system', 'assembly', 1, 'pcs', 'Steel', 'AISI 304', 10000, 'make', 25.00, ''],
        [2, 'PRT-005', 'L-Bracket', 'L-shaped mounting bracket', 'child_part', 4, 'pcs', 'Steel', 'AISI 304', 40000, 'make', 5.00, 'ASM-002'],
        [2, 'PRT-006', 'Bolt M8x20', 'Hex head bolt', 'child_part', 8, 'pcs', 'Steel', 'Grade 8.8', 80000, 'buy', 0.50, 'ASM-002']
      ];

      // Create worksheet data
      const wsData = [headers, ...exampleData];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Set column widths
      const colWidths = [
        { wch: 8 },  // Level
        { wch: 12 }, // Part Number
        { wch: 20 }, // Name
        { wch: 25 }, // Description
        { wch: 12 }, // Type
        { wch: 8 },  // Quantity
        { wch: 6 },  // Unit
        { wch: 12 }, // Material
        { wch: 12 }, // Material Grade
        { wch: 12 }, // Annual Volume
        { wch: 8 },  // Make/Buy
        { wch: 10 }, // Unit Cost
        { wch: 15 }  // Parent Reference
      ];
      ws['!cols'] = colWidths;

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'BOM Template');

      // Write file
      XLSX.writeFile(wb, 'BOM_Import_Template_with_Hierarchy.xlsx');

      toast.success('Enhanced Excel template with hierarchy examples downloaded!');
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

  // Enhanced import with Excel and CSV support + automatic hierarchy
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';

    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      setImportProgress(0);
      setImportStatus('Reading file...');

      try {
        const fileExtension = file.name.toLowerCase().split('.').pop();
        let itemsToImport: any[] = [];

        if (fileExtension === 'csv') {
          itemsToImport = await parseCSVFile(file);
        } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
          itemsToImport = await parseExcelFile(file);
        } else {
          toast.error('Unsupported file format. Please use CSV or Excel files.');
          return;
        }

        if (itemsToImport.length === 0) {
          toast.error('No valid items found in the file');
          return;
        }

        setImportStatus('Building hierarchy...');
        setImportProgress(30);

        // Build hierarchy and create items
        await importWithHierarchy(itemsToImport);
        
        setImportProgress(100);
        setImportStatus('Import completed!');
        
        await refetchBOMItems();
        
      } catch (error: any) {
        console.error('Import error:', error);
        toast.error(error.message || 'Failed to import file');
      } finally {
        setIsImporting(false);
        setTimeout(() => {
          setImportProgress(0);
          setImportStatus('');
        }, 2000);
      }
    };

    input.click();
  };

  // Parse CSV file
  const parseCSVFile = async (file: File): Promise<any[]> => {
    const text = await file.text();
    const lines = text.split('\n');

    if (lines.length < 2) {
      throw new Error('Invalid CSV file - no data rows found');
    }

    const headers = lines[0]!.split(',').map((h: string) => h.trim().replace(/"/g, ''));
    const items = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;

      const values = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
      const cleanedValues = values.map((v: string) => v.trim().replace(/^"|"$/g, ''));

      const item = parseRowData(headers, cleanedValues, i);
      if (item.name) {
        items.push(item);
      }
    }

    return items;
  };

  // Parse Excel file
  const parseExcelFile = async (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          
          // Use first worksheet
          const worksheetName = workbook.SheetNames[0];
          if (!worksheetName) {
            throw new Error('Invalid Excel file - no worksheets found');
          }
          const worksheet = workbook.Sheets[worksheetName];
          if (!worksheet) {
            throw new Error(`Invalid Excel file - worksheet "${worksheetName}" not found`);
          }
          
          // Convert to JSON with headers
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          if (jsonData.length < 2) {
            throw new Error('Invalid Excel file - no data rows found');
          }

          const headers = (jsonData[0] as any[]).map(h => String(h).trim());
          const items = [];

          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i] as any[];
            if (!row || row.length === 0) continue;

            const item = parseRowData(headers, row.map(v => String(v || '').trim()), i);
            if (item.name) {
              items.push(item);
            }
          }

          resolve(items);
        } catch (error) {
          reject(new Error('Failed to parse Excel file: ' + (error as Error).message));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsBinaryString(file);
    });
  };

  // Parse row data with hierarchy detection
  const parseRowData = (headers: string[], values: string[], rowIndex: number) => {
    const item: any = { 
      originalRowIndex: rowIndex,
      hierarchyLevel: undefined, // Don't initialize to 0 - use undefined to detect if it was set
      parentReference: null
    };

    headers.forEach((header: string, index: number) => {
      const value = values[index] || '';
      const headerLower = header.toLowerCase();

      switch (headerLower) {
        case 'level':
        case 'hierarchy level':
        case 'indent level':
          const level = parseInt(value) || 0;
          item.hierarchyLevel = Math.max(0, Math.min(level, 3)); // Clamp to 0-3
          console.log(`📊 Level parsed: ${value} → ${item.hierarchyLevel} for item: ${item.name || 'unnamed'}`);
          break;
        case 'parent':
        case 'parent item':
        case 'parent part':
        case 'parent reference':
        case 'parentreference':
        case 'parent_reference':
          item.parentReference = value;
          console.log(`👨‍👩‍👧‍👦 Parent reference parsed: ${item.name || 'unnamed'} → ${value}`);
          break;
        case 'part number':
        case 'partNumber':
          item.partNumber = value;
          break;
        case 'name':
        case 'item name':
          item.name = value;
          break;
        case 'description':
          item.description = value;
          break;
        case 'type':
        case 'item type':
          item.itemType = value.toLowerCase();
          break;
        case 'quantity':
        case 'qty':
          item.quantity = value ? parseInt(value) || 1 : 1;
          break;
        case 'unit':
          item.unit = value;
          break;
        case 'material':
          item.material = value;
          break;
        case 'material grade':
        case 'grade':
          item.materialGrade = value;
          break;
        case 'annual volume':
        case 'volume':
          item.annualVolume = value ? parseInt(value) || 0 : 0;
          break;
        case 'make/buy':
        case 'make buy':
        case 'makeBuy':
          if (value.toLowerCase().includes('make')) item.makeBuy = 'make';
          else if (value.toLowerCase().includes('buy')) item.makeBuy = 'buy';
          break;
        case 'unit cost':
        case 'cost':
          item.unitCost = value ? parseFloat(value) || 0 : undefined;
          break;
      }
    });

    // PRODUCTION-GRADE HIERARCHY AND TYPE VALIDATION
    
    // CRITICAL FIX: Check if hierarchyLevel was actually set from Excel Level column
    const wasLevelParsedFromExcel = item.hierarchyLevel !== undefined;
    
    // Auto-detect hierarchy level from itemType ONLY if level not provided from Excel
    if (!wasLevelParsedFromExcel && item.itemType) {
      switch (item.itemType.toLowerCase()) {
        case 'assembly':
          item.hierarchyLevel = 1;
          console.log(`🔍 Inferred hierarchy level 1 from itemType '${item.itemType}' for: ${item.name}`);
          break;
        case 'sub_assembly':
        case 'sub-assembly':
        case 'subassembly':
          item.hierarchyLevel = 2;
          console.log(`🔍 Inferred hierarchy level 2 from itemType '${item.itemType}' for: ${item.name}`);
          break;
        case 'child_part':
        case 'child-part':
        case 'part':
        case 'component':
          item.hierarchyLevel = 3;
          console.log(`🔍 Inferred hierarchy level 3 from itemType '${item.itemType}' for: ${item.name}`);
          break;
      }
    }

    // CRITICAL: Ensure itemType matches hierarchy level (enforce DB constraints)
    const expectedItemType = item.hierarchyLevel === 1 ? 'assembly' :
                            item.hierarchyLevel === 2 ? 'sub_assembly' : 'child_part';
    
    if (!item.itemType || item.itemType !== expectedItemType) {
      const oldType = item.itemType;
      item.itemType = expectedItemType;
      console.log(`✅ Fixed itemType: '${oldType}' → '${expectedItemType}' for level ${item.hierarchyLevel}: ${item.name}`);
    }

    // Default hierarchy level ONLY if still not set at all
    if (item.hierarchyLevel === undefined) {
      item.hierarchyLevel = 3; // Default to child_part
      item.itemType = 'child_part';
      console.log(`⚠️ Defaulted to level 3 (child_part): ${item.name}`);
    }
    
    console.log(`🏁 Final item: ${item.name} | Level: ${item.hierarchyLevel} | Type: ${item.itemType} | Parent: ${item.parentReference || 'none'}`);

    return item;
  };

  // Import with automatic hierarchy creation - Enterprise Grade Implementation
  const importWithHierarchy = async (items: any[]) => {
    const createdItems = new Map<string, string>();
    const parentStack: { level: number; id: string; partNumber: string }[] = [];
    const failedItems: { item: any; error: string; index: number }[] = [];
    
    setImportProgress(40);
    setImportStatus('Preparing batch import...');

    // Sort items by hierarchy level and original order
    const sortedItems = items.sort((a, b) => {
      if (a.hierarchyLevel !== b.hierarchyLevel) {
        return a.hierarchyLevel - b.hierarchyLevel;
      }
      return a.originalRowIndex - b.originalRowIndex;
    });

    // Batch configuration
    const BATCH_SIZE = 5; // Process in small batches to avoid overwhelming the API
    const RETRY_DELAY = 1000; // 1 second between batches
    const MAX_RETRIES = 3;

    const batches = [];
    for (let i = 0; i < sortedItems.length; i += BATCH_SIZE) {
      batches.push(sortedItems.slice(i, i + BATCH_SIZE));
    }

    let processedCount = 0;
    const totalItems = sortedItems.length;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      if (!batch) continue;
      
      setImportProgress(40 + ((batchIndex / batches.length) * 50));
      setImportStatus(`Processing batch ${batchIndex + 1} of ${batches.length} (${processedCount}/${totalItems} items completed)`);

      // Process batch with retry logic
      let retryCount = 0;
      while (retryCount < MAX_RETRIES) {
        try {
          // Sequential processing within batch to maintain parent-child relationships
          for (const item of batch) {
            await processItemWithValidation(item, createdItems, parentStack, failedItems, processedCount);
            processedCount++;
          }
          break; // Success - exit retry loop
        } catch (error: any) {
          retryCount++;
          if (retryCount >= MAX_RETRIES) {
            // Mark all items in batch as failed
            batch.forEach((item, idx) => {
              failedItems.push({
                item,
                error: `Batch failed after ${MAX_RETRIES} retries: ${error.message}`,
                index: processedCount + idx
              });
            });
            processedCount += batch.length;
          } else {
            // Wait before retry with exponential backoff
            const delay = RETRY_DELAY * Math.pow(2, retryCount - 1);
            setImportStatus(`Batch ${batchIndex + 1} failed, retrying in ${delay/1000}s... (attempt ${retryCount}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // Add delay between batches to respect rate limits
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }

    // Report results
    const successCount = totalItems - failedItems.length;
    setImportStatus(`Import completed: ${successCount}/${totalItems} items created successfully`);
    
    // Set detailed summary for user review
    const summary = {
      total: totalItems,
      successful: successCount,
      failed: failedItems.length,
      errors: failedItems.map(({ item, error, index }) => ({
        item: item.name || `Item ${index + 1}`,
        error,
        index: index + 1
      }))
    };
    setImportSummary(summary);
    
    if (failedItems.length > 0) {
      console.warn('Failed items:', failedItems);
      toast.error(`${failedItems.length} items failed to import. Click 'View Summary' for details.`);
      setShowImportSummary(true);
      
      // Log detailed failure information
      failedItems.forEach(({ item, error, index }) => {
        console.error(`Item ${index + 1} (${item.name || 'Unnamed'}):`, error);
      });
    } else {
      toast.success(`Successfully imported all ${successCount} items with automatic hierarchy formation!`);
    }
  };

  // Process individual item with comprehensive validation and error handling
  const processItemWithValidation = async (
    item: any, 
    createdItems: Map<string, string>, 
    parentStack: { level: number; id: string; partNumber: string }[], 
    failedItems: { item: any; error: string; index: number }[],
    currentIndex: number
  ) => {
    try {
      // Input validation
      if (!item.name || typeof item.name !== 'string' || item.name.trim().length === 0) {
        throw new Error('Item name is required and must be a non-empty string');
      }

      if (item.hierarchyLevel < 0 || item.hierarchyLevel > 3) {
        throw new Error('Hierarchy level must be between 0 and 3');
      }

      // PRODUCTION-GRADE PARENT-CHILD RELATIONSHIP RESOLUTION
      let parentItemId: string | null = null;

      // Method 1: Explicit Parent Reference (Excel column "Parent Reference")
      if (item.parentReference && typeof item.parentReference === 'string' && item.parentReference.trim()) {
        const parentRef = item.parentReference.trim();
        
        // Search in existing BOM items
        const existingItems = bomItemsData?.items || [];
        const existingParent = existingItems.find(existing => 
          existing.partNumber === parentRef
        );
        
        if (existingParent) {
          parentItemId = existingParent.id;
          console.log(`✅ Found existing parent: ${parentRef} → ${existingParent.id}`);
        } else {
          // Search in newly created items using partNumber mapping
          for (const [key, createdId] of createdItems.entries()) {
            if (key.startsWith('part-')) {
              const partNumber = key.replace('part-', '');
              if (partNumber === parentRef) {
                parentItemId = createdId;
                console.log(`✅ Found created parent: ${parentRef} → ${createdId}`);
                break;
              }
            }
          }
          
          if (!parentItemId) {
            console.warn(`⚠️ Parent reference '${parentRef}' not found for item '${item.name}'`);
          }
        }
      }

      // Method 2: Hierarchy Level-Based Parent Assignment (Fallback)
      if (!parentItemId && item.hierarchyLevel > 1) {
        // Clean parent stack - remove items at same or deeper level
        while (parentStack.length > 0 && parentStack[parentStack.length - 1]!.level >= item.hierarchyLevel) {
          const removed = parentStack.pop();
          console.log(`🔄 Removed from stack (level ${removed?.level}): ${removed?.partNumber}`);
        }
        
        // Assign parent from stack
        if (parentStack.length > 0) {
          const stackParent = parentStack[parentStack.length - 1];
          if (stackParent) {
            parentItemId = stackParent.id;
            console.log(`📚 Stack-based parent assignment: ${item.name} (level ${item.hierarchyLevel}) → ${stackParent.partNumber} (level ${stackParent.level})`);
          }
        } else {
          console.warn(`⚠️ No valid parent found in stack for ${item.name} (level ${item.hierarchyLevel})`);
        }
      }

      // Method 3: Smart Assembly Detection (for items without explicit parent)
      if (!parentItemId && item.hierarchyLevel > 1) {
        // For sub_assemblies (level 2), find the main assembly (level 1)
        // For child_parts (level 3), find the immediate sub_assembly (level 2)
        const targetLevel = item.hierarchyLevel - 1;
        
        // Search recent items in creation order (most likely parent)
        const recentParents = Array.from(createdItems.entries())
          .filter(([key, _]) => key.startsWith('level-'))
          .map(([key, id]) => ({ level: parseInt(key.replace('level-', '')), id }))
          .filter(p => p.level === targetLevel)
          .slice(-3); // Last 3 potential parents
        
        if (recentParents.length > 0) {
          const recentParent = recentParents[recentParents.length - 1];
          if (recentParent) {
            parentItemId = recentParent.id;
            console.log(`🎯 Smart parent detection: ${item.name} (level ${item.hierarchyLevel}) → level ${targetLevel} parent`);
          }
        }
      }

      // Sanitize and validate all fields with strict JSON-safe construction
      const bomItemData: any = {};
      
      // Required fields
      bomItemData.bomId = String(bomId).trim();
      bomItemData.name = String(item.name || '').trim();
      bomItemData.itemType = validateItemType(item.itemType);
      bomItemData.quantity = validatePositiveInteger(item.quantity, 1);
      bomItemData.annualVolume = validatePositiveInteger(item.annualVolume, 0);
      
      // Optional fields - only add if they have valid values
      if (item.partNumber && String(item.partNumber).trim()) {
        bomItemData.partNumber = String(item.partNumber).trim();
      }
      
      if (item.description && String(item.description).trim()) {
        bomItemData.description = String(item.description).trim();
      }
      
      bomItemData.unit = validateUnit(item.unit);
      
      if (item.material && String(item.material).trim()) {
        bomItemData.material = String(item.material).trim();
      }
      
      if (item.materialGrade && String(item.materialGrade).trim()) {
        bomItemData.materialGrade = String(item.materialGrade).trim();
      }
      
      const makeBuyValue = validateMakeBuy(item.makeBuy);
      if (makeBuyValue) {
        bomItemData.makeBuy = makeBuyValue;
      }
      
      // Business Rule: unit_cost can only be set when make_buy is "buy"
      const unitCostValue = validatePositiveNumber(item.unitCost);
      if (unitCostValue !== undefined && makeBuyValue === 'buy') {
        bomItemData.unitCost = unitCostValue;
      }
      
      const parentId = validateUUID(parentItemId);
      if (parentId) {
        bomItemData.parentItemId = parentId;
      }
      
      bomItemData.sortOrder = currentIndex;

      // Debug logging - remove in production
      console.log('Creating BOM item with data:', {
        ...bomItemData,
        // Log structure to see if there are any issues
        dataTypes: {
          bomId: typeof bomItemData.bomId,
          name: typeof bomItemData.name,
          itemType: typeof bomItemData.itemType,
          quantity: typeof bomItemData.quantity,
          annualVolume: typeof bomItemData.annualVolume,
          parentItemId: typeof bomItemData.parentItemId,
          unitCost: typeof bomItemData.unitCost,
        }
      });

      // Create the BOM item with proper error handling
      const newItem = await createBOMItemWithRetry(bomItemData);
      const newItemId = newItem.id || newItem.data?.id;
      
      if (!newItemId) {
        throw new Error('Failed to get valid item ID from create response');
      }
      
      // ENHANCED CREATED ITEMS TRACKING FOR PARENT RESOLUTION
      createdItems.set(`row-${item.originalRowIndex}`, newItemId);
      
      // Track by part number for parent reference resolution
      if (bomItemData.partNumber) {
        createdItems.set(`part-${bomItemData.partNumber}`, newItemId);
      }
      
      // Track by hierarchy level for smart parent detection  
      createdItems.set(`level-${item.hierarchyLevel}`, newItemId);
      
      // ENHANCED PARENT STACK MANAGEMENT
      if (item.hierarchyLevel >= 1) {
        // Clean the stack - remove items at same or deeper level
        while (parentStack.length > 0 && parentStack[parentStack.length - 1]!.level >= item.hierarchyLevel) {
          const removed = parentStack.pop();
          console.log(`🗑️ Removed from parent stack: ${removed?.partNumber} (level ${removed?.level})`);
        }
        
        // Add current item to stack for future children
        const stackItem = {
          level: item.hierarchyLevel,
          id: newItemId,
          partNumber: bomItemData.partNumber || item.name,
          name: item.name
        };
        parentStack.push(stackItem);
        
        console.log(`✅ Added to parent stack: ${stackItem.partNumber} (level ${stackItem.level}) - Stack depth: ${parentStack.length}`);
        console.log(`📋 Current stack:`, parentStack.map(p => `${p.partNumber}(L${p.level})`).join(' → '));
      }

    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error occurred';
      failedItems.push({
        item,
        error: errorMessage,
        index: currentIndex
      });
      throw error; // Re-throw to trigger batch retry logic
    }
  };

  // Validation helper functions
  const validateItemType = (type: any): string => {
    const validTypes = ['assembly', 'sub_assembly', 'child_part'];
    const typeStr = String(type || '').toLowerCase();
    return validTypes.includes(typeStr) ? typeStr : 'child_part';
  };

  const validatePositiveInteger = (value: any, defaultValue: number): number => {
    const num = parseInt(String(value || '').replace(/[^\d]/g, ''));
    return isNaN(num) || num < 0 ? defaultValue : num;
  };

  const validatePositiveNumber = (value: any): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
    return isNaN(num) || num < 0 ? undefined : num;
  };

  const validateMakeBuy = (value: any): 'make' | 'buy' | undefined => {
    if (!value) return undefined;
    const str = String(value).toLowerCase().trim();
    if (str.includes('make')) return 'make';
    if (str.includes('buy')) return 'buy';
    return undefined;
  };

  // Additional validation for parentItemId to ensure it's a valid UUID
  const validateUUID = (value: any): string | undefined => {
    if (!value) return undefined;
    const str = String(value).trim();
    // Basic UUID format check
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str) ? str : undefined;
  };

  const validateUnit = (value: any): string => {
    // Database constraint allows: 'pcs', 'kg', 'lbs', 'm', 'ft', 'liters'
    const allowedUnits = ['pcs', 'kg', 'lbs', 'm', 'ft', 'liters'];
    const unitStr = String(value || '').trim().toLowerCase();
    
    // Map common variations to allowed values
    const unitMappings: { [key: string]: string } = {
      'ea': 'pcs',
      'each': 'pcs',
      'piece': 'pcs',
      'pieces': 'pcs',
      'pc': 'pcs',
      'kilogram': 'kg',
      'kilograms': 'kg',
      'kilo': 'kg',
      'pound': 'lbs',
      'pounds': 'lbs',
      'lb': 'lbs',
      'meter': 'm',
      'meters': 'm',
      'metre': 'm',
      'metres': 'm',
      'foot': 'ft',
      'feet': 'ft',
      'liter': 'liters',
      'litre': 'liters',
      'litres': 'liters',
      'l': 'liters'
    };

    // Check if it's already a valid unit
    if (allowedUnits.includes(unitStr)) {
      return unitStr;
    }

    // Check if it can be mapped to a valid unit
    if (unitMappings[unitStr]) {
      return unitMappings[unitStr];
    }

    // Default to 'pcs' for any invalid/unknown units
    return 'pcs';
  };

  // Enhanced createBOMItem with retry logic and better error handling
  const createBOMItemWithRetry = async (itemData: any, maxRetries: number = 2): Promise<any> => {
    let lastError: any;
    
    // Validate the data before sending
    if (!itemData.bomId || !itemData.name || !itemData.itemType) {
      throw new Error(`Invalid item data: bomId, name, and itemType are required. Got: ${JSON.stringify(itemData)}`);
    }
    
    // Clean the data to ensure no undefined values are sent
    const cleanedData = Object.entries(itemData).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as any);
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Add small delay for subsequent attempts
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
        
        console.log(`Attempt ${attempt + 1}: Sending cleaned data:`, JSON.stringify(cleanedData, null, 2));
        
        const result = await createBOMItem(cleanedData);
        console.log('BOM item created successfully:', result);
        return result;
      } catch (error: any) {
        console.error(`Attempt ${attempt + 1} failed:`, error);
        lastError = error;
        
        // Log the actual error details
        if (error.response) {
          console.error('Response error:', error.response);
        }
        if (error.status) {
          console.error('Status:', error.status);
        }
        
        // Don't retry for certain error types
        if (error.status === 400 || error.message?.includes('validation') || error.message?.includes('JSON')) {
          throw new Error(`Validation error: ${error.message}. Data sent: ${JSON.stringify(cleanedData)}`);
        }
        
        if (attempt === maxRetries) {
          throw new Error(`Failed after ${maxRetries + 1} attempts: ${error.message}`);
        }
      }
    }
    
    throw lastError;
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
            title="Download Excel template with hierarchy examples"
          >
            <FileDown className="h-4 w-4" />
            Excel Template
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleImport}
            disabled={isImporting}
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {isImporting ? 'Importing...' : 'Import'}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          
          {/* Bulk Delete All Button - Production Feature */}
          {bomItemsData?.items && bomItemsData.items.length > 0 && (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => setShowBulkDeleteConfirm(true)}
              disabled={isBulkDeleting}
              title="Delete all BOM items (useful for clearing bulk imports)"
            >
              {isBulkDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {isBulkDeleting ? 'Deleting...' : 'Delete All'}
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Import Progress Indicator */}
      {(isImporting || importSummary) && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {isImporting ? 'Import Progress' : 'Import Summary'}
                </span>
                {isImporting && (
                  <span className="text-muted-foreground">{importProgress}%</span>
                )}
              </div>
              {isImporting && (
                <Progress value={importProgress} className="h-2" />
              )}
              {importStatus && (
                <p className="text-sm text-muted-foreground">{importStatus}</p>
              )}
              {importSummary && !isImporting && (
                <div className="space-y-2">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      <span>Successful: {importSummary.successful}</span>
                    </div>
                    {importSummary.failed > 0 && (
                      <div className="flex items-center gap-2 text-red-600">
                        <XCircle className="h-4 w-4" />
                        <span>Failed: {importSummary.failed}</span>
                      </div>
                    )}
                    <span className="text-muted-foreground">
                      Total: {importSummary.total}
                    </span>
                  </div>
                  {importSummary.failed > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setShowImportSummary(true)}
                      className="gap-2"
                    >
                      <AlertCircle className="h-4 w-4" />
                      View Failed Items
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* STEP File Upload and Assembly Tree */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            STEP File Upload & Assembly Analysis
          </CardTitle>
          <CardDescription>Upload STEP files to automatically generate hierarchical BOM structure with CAD analysis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* STEP File Upload Section */}
          <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Upload STEP File</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Drop your STEP file here or click to browse
                </p>
              </div>
              <Button variant="outline" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Choose STEP File
              </Button>
              <p className="text-xs text-muted-foreground">Supports .step, .stp files up to 100MB</p>
            </div>
          </div>

          {/* CAD Processing Pipeline */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Settings className="h-4 w-4" />
              CAD Processing Pipeline
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span>STEP file → OpenCascade → volume, surface area, holes, walls</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span>Material DB lookup → density, price/kg</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                <span>Process classifier → CNC / casting / sheet metal</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                <span>Cost formulas → material + machining + setup</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                <span>XGBoost adjustment → correction factor from history</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span><strong>ACCURATE COST ✅</strong></span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                <span>LLM (optional, async) → explanation + DFM advice</span>
              </div>
            </div>
          </div>

          {/* Hierarchical Assembly Tree */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold flex items-center gap-2">
                <Box className="h-5 w-5" />
                Assembly Tree Structure
              </h4>
              <Badge variant="outline" className="text-xs">
                Auto-Generated from STEP
              </Badge>
            </div>
            
            <div className="space-y-0.5 bg-muted/20 rounded-lg p-4">
              {/* Root Assembly */}
              <div className="group hover:bg-muted/50 rounded-md transition-colors">
                <div className="flex items-center gap-2 py-2 px-2">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium truncate">Main Assembly</p>
                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                      Assembly
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                      <Box className="h-3 w-3" />
                      <span>main_assembly.step</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Sub-Assembly */}
              <div className="group hover:bg-muted/50 rounded-md transition-colors">
                <div className="flex items-center gap-2 py-1.5 px-2" style={{paddingLeft: '28px'}}>
                  <div className="flex items-center">
                    <div className="w-3 h-px bg-border"></div>
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium truncate">Mounting Assembly</p>
                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/10 text-blue-700 border-blue-500/20">
                      Sub-Assembly
                    </Badge>
                    <span className="text-xs text-muted-foreground">#ASM-002</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                      <Box className="h-3 w-3" />
                      <span>mounting_assembly.step</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Child Parts */}
              <div className="group hover:bg-muted/50 rounded-md transition-colors">
                <div className="flex items-center gap-2 py-1.5 px-2" style={{paddingLeft: '48px'}}>
                  <div className="flex items-center">
                    <div className="w-3 h-px bg-border"></div>
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium truncate">Base Plate</p>
                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-700 border-amber-500/20">
                      Part
                    </Badge>
                    <span className="text-xs text-muted-foreground">#PRT-001</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                      <FileText className="h-3 w-3" />
                      <span>base_plate.pdf</span>
                    </button>
                    <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                      <Box className="h-3 w-3" />
                      <span>base_plate.step</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="group hover:bg-muted/50 rounded-md transition-colors">
                <div className="flex items-center gap-2 py-1.5 px-2" style={{paddingLeft: '48px'}}>
                  <div className="flex items-center">
                    <div className="w-3 h-px bg-border"></div>
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium truncate">Mounting Bracket</p>
                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-700 border-amber-500/20">
                      Part
                    </Badge>
                    <span className="text-xs text-muted-foreground">#PRT-002</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                      <FileText className="h-3 w-3" />
                      <span>mounting_bracket.pdf</span>
                    </button>
                    <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                      <Box className="h-3 w-3" />
                      <span>mounting_bracket.step</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Hardware Components */}
              <div className="group hover:bg-muted/50 rounded-md transition-colors">
                <div className="flex items-center gap-2 py-1.5 px-2" style={{paddingLeft: '28px'}}>
                  <div className="flex items-center">
                    <div className="w-3 h-px bg-border"></div>
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium truncate">Hardware Kit</p>
                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-purple-500/10 text-purple-700 border-purple-500/20">
                      Hardware
                    </Badge>
                    <span className="text-xs text-muted-foreground">#HW-001</span>
                  </div>
                </div>
              </div>

              <div className="group hover:bg-muted/50 rounded-md transition-colors">
                <div className="flex items-center gap-2 py-1.5 px-2" style={{paddingLeft: '48px'}}>
                  <div className="flex items-center">
                    <div className="w-3 h-px bg-border"></div>
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium truncate">Bolt M8x20 (Qty: 4)</p>
                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-gray-500/10 text-gray-700 border-gray-500/20">
                      Fastener
                    </Badge>
                    <span className="text-xs text-muted-foreground">#M8x20</span>
                  </div>
                </div>
              </div>

              <div className="group hover:bg-muted/50 rounded-md transition-colors">
                <div className="flex items-center gap-2 py-1.5 px-2" style={{paddingLeft: '48px'}}>
                  <div className="flex items-center">
                    <div className="w-3 h-px bg-border"></div>
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium truncate">Washer M8 (Qty: 4)</p>
                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-gray-500/10 text-gray-700 border-gray-500/20">
                      Fastener
                    </Badge>
                    <span className="text-xs text-muted-foreground">#W8</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* BOM Generation Status */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle className="h-3 w-3 text-white" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-blue-900 mb-1">Automated BOM Generation Process</h4>
                <div className="text-xs text-blue-700 space-y-1">
                  <p>✅ File Validation Layer → STEP file integrity check</p>
                  <p>✅ CAD Engine → Parse STEP structure using OpenCascade</p>
                  <p>✅ Assembly Tree Walker → Identify hierarchical relationships</p>
                  <p>✅ Node Classifier → Assembly / Sub-Assembly / Child Part</p>
                  <p>✅ BOM Builder → Generate hierarchy + quantities</p>
                  <p>✅ AI Enrichment Layer → Material, make/buy, description inference</p>
                  <p>✅ BOM JSON → Supabase integration</p>
                  <p>✅ Frontend → Render tree in existing BOM UI</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
              </div>
            </CardHeader>
            <CardContent>
              <BOMItemsFlat
                bomId={bomId}
                onEditItem={handleEditItem}
                onViewItem={handleViewItem}
                onAddChildItem={handleAddTreeItem}
              />
              
              {/* Add BOM Button - Moved to bottom */}
              <div className="flex justify-center mt-6">
                <Button onClick={handleAddItem} className="gap-2" size="lg">
                  <Plus className="h-4 w-4" />
                  Add BOM Item
                </Button>
              </div>
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

      {/* Import Summary Dialog */}
      <Dialog open={showImportSummary} onOpenChange={setShowImportSummary}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              Import Summary
            </DialogTitle>
          </DialogHeader>
          
          {importSummary && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{importSummary.successful}</div>
                  <div className="text-sm text-muted-foreground">Successful</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{importSummary.failed}</div>
                  <div className="text-sm text-muted-foreground">Failed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{importSummary.total}</div>
                  <div className="text-sm text-muted-foreground">Total</div>
                </div>
              </div>

              {/* Failed Items Details */}
              {importSummary.failed > 0 && (
                <div className="space-y-2">
                  <h3 className="font-medium text-red-600 flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Failed Items ({importSummary.failed})
                  </h3>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {importSummary.errors.map((error, index) => (
                      <div key={index} className="p-3 border rounded-lg bg-red-50 border-red-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-red-800">
                              Row {error.index}: {error.item}
                            </div>
                            <div className="text-sm text-red-600 mt-1">
                              {error.error}
                            </div>
                          </div>
                          <Badge variant="destructive" className="text-xs">
                            Row {error.index}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Success Message */}
              {importSummary.failed === 0 && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-800">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">All items imported successfully!</span>
                  </div>
                  <p className="text-sm text-green-700 mt-1">
                    {importSummary.total} items have been created with their hierarchy preserved.
                  </p>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter>
            <Button 
              onClick={() => {
                setShowImportSummary(false);
                setImportSummary(null);
              }}
              className="w-full"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete All BOM Items
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                <div>
                  <h4 className="font-medium text-destructive">Permanent Deletion</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    This will permanently delete <strong>all {bomItemsData?.items?.length || 0} BOM items</strong> from this BOM. 
                    This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm">Items to be deleted:</h4>
              <div className="bg-muted/50 rounded-lg p-3 max-h-32 overflow-y-auto">
                <div className="space-y-1 text-xs">
                  {bomItemsData?.items?.slice(0, 10).map((item) => (
                    <div key={item.id} className="flex items-center justify-between">
                      <span className="truncate">{item.name}</span>
                      <Badge 
                        variant="outline" 
                        className="text-[10px] px-1.5 py-0 h-4"
                      >
                        {item.itemType.replace('_', ' ')}
                      </Badge>
                    </div>
                  ))}
                  {bomItemsData?.items && bomItemsData.items.length > 10 && (
                    <div className="text-muted-foreground text-center py-1">
                      ... and {bomItemsData.items.length - 10} more items
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">Deletion Strategy:</p>
                  <p>Items will be deleted in hierarchy order (child parts → sub-assemblies → assemblies) to maintain referential integrity.</p>
                </div>
              </div>
            </div>
          </div>
          
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowBulkDeleteConfirm(false)}
              disabled={isBulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDeleteAll}
              disabled={isBulkDeleting}
              className="gap-2"
            >
              {isBulkDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete All {bomItemsData?.items?.length || 0} Items
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Workflow Navigation - Bottom */}
      <WorkflowNavigation 
        currentModuleId="bom" 
        projectId={projectId}
      />
    </div>
  );
}
