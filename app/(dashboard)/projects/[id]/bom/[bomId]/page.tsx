'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { useProject } from '@/lib/api/hooks/useProjects';
import { useBOM } from '@/lib/api/hooks/useBOM';
import { useBOMItems, deleteBOMItem, createBOMItem, type CreateBOMItemDto } from '@/lib/api/hooks/useBOMItems';
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
  Box,
  FileDown,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Trash2,
  Layers3,
} from 'lucide-react';
import { BOMItemsFlat, BOMItemDialog, BOMTreeView, BOMItemDetailPanel } from '@/components/features/bom';
import { AssemblyTreeGenerator } from '@/components/features/bom/AssemblyTreeGenerator';
import { HierarchicalBOMTree } from '@/components/features/bom/HierarchicalBOMTree';
import { ModelViewer } from '@/components/ui/model-viewer';
import { type BOMItem } from '@/lib/api/hooks/useBOMItems';
import { bomItemsApi as bomAPI } from '@/lib/api/bom-items';
import { BOMItemType } from '@/lib/types/bom.types';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMPORT_BATCH_SIZE = 5;
const IMPORT_RETRY_DELAY_MS = 1000;
const IMPORT_MAX_RETRIES = 3;
const IMPORT_RETRY_BATCH_DELAY_MS = 1000;
const USE_3D_PARTS = true;

const ALLOWED_UNITS = ['pcs', 'kg', 'lbs', 'm', 'ft', 'liters'] as const;
type AllowedUnit = (typeof ALLOWED_UNITS)[number];

const UNIT_ALIAS_MAP: Record<string, AllowedUnit> = {
  ea: 'pcs', each: 'pcs', piece: 'pcs', pieces: 'pcs', pc: 'pcs',
  kilogram: 'kg', kilograms: 'kg', kilo: 'kg',
  pound: 'lbs', pounds: 'lbs', lb: 'lbs',
  meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  foot: 'ft', feet: 'ft',
  liter: 'liters', litre: 'liters', litres: 'liters', l: 'liters',
};

const ITEM_TYPE_BY_LEVEL: Record<number, string> = {
  1: 'assembly',
  2: 'sub_assembly',
  3: 'child_part',
};

const LEVEL_BY_ITEM_TYPE: Record<string, number> = {
  assembly: 1,
  sub_assembly: 2,
  'sub-assembly': 2,
  subassembly: 2,
  child_part: 3,
  'child-part': 3,
  part: 3,
  component: 3,
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ---------------------------------------------------------------------------
// Pure utility functions (no component state)
// ---------------------------------------------------------------------------

function buildTree(items: any[]): any[] {
  const map = new Map<string, any>();
  const roots: any[] = [];

  items.forEach(item => map.set(item.id, { ...item, children: [] }));

  items.forEach(item => {
    const node = map.get(item.id);
    if (item.parentItemId) {
      const parent = map.get(item.parentItemId);
      if (parent) {
        parent.children.push(node);
        return;
      }
    }
    roots.push(node);
  });

  return roots;
}

function validateItemType(type: unknown): string {
  const t = String(type ?? '').toLowerCase();
  return ['assembly', 'sub_assembly', 'child_part'].includes(t) ? t : 'child_part';
}

function validatePositiveInteger(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function validatePositiveNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function validateMakeBuy(value: unknown): 'make' | 'buy' | undefined {
  const s = String(value ?? '').toLowerCase().trim();
  if (s.includes('make')) return 'make';
  if (s.includes('buy')) return 'buy';
  return undefined;
}

function validateUUID(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return UUID_REGEX.test(s) ? s : undefined;
}

function validateUnit(value: unknown): AllowedUnit {
  const s = String(value ?? '').trim().toLowerCase();
  if (ALLOWED_UNITS.includes(s as AllowedUnit)) return s as AllowedUnit;
  return UNIT_ALIAS_MAP[s] ?? 'pcs';
}

function getPartTypeFromGeometry(part: any): string {
  if (!part.boundingBox) return 'part';
  const { x, y, z } = part.boundingBox;
  const volume = x * y * z;
  if (volume < 1000) return 'fastener';
  if (x > y * 3 || y > x * 3) return 'bracket';
  if (z < Math.min(x, y) * 0.2) return 'plate';
  return 'component';
}

function parseRowData(headers: string[], values: string[], rowIndex: number): any {
  const item: any = {
    originalRowIndex: rowIndex,
    hierarchyLevel: undefined,
    parentReference: null,
  };

  headers.forEach((header, i) => {
    const value = values[i] ?? '';
    switch (header.toLowerCase().trim()) {
      case 'level':
      case 'hierarchy level':
      case 'indent level': {
        const parsed = parseInt(value);
        if (!Number.isNaN(parsed)) {
          item.hierarchyLevel = Math.max(1, Math.min(parsed, 3));
        }
        break;
      }
      case 'parent':
      case 'parent item':
      case 'parent part':
      case 'parent reference':
      case 'parentreference':
      case 'parent_reference':
        item.parentReference = value || null;
        break;
      case 'part number':
      case 'partnumber':
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
      case 'makebuy':
        item.makeBuy = validateMakeBuy(value);
        break;
      case 'unit cost':
      case 'cost':
        item.unitCost = value ? parseFloat(value) || undefined : undefined;
        break;
    }
  });

  // Infer hierarchy level from itemType if not provided by Level column
  if (item.hierarchyLevel === undefined && item.itemType) {
    item.hierarchyLevel = LEVEL_BY_ITEM_TYPE[item.itemType.toLowerCase()] ?? 3;
  }

  // Default to child_part level if still unresolved
  if (item.hierarchyLevel === undefined) {
    item.hierarchyLevel = 3;
  }

  // Enforce itemType/level consistency (DB constraint)
  const expectedType = ITEM_TYPE_BY_LEVEL[item.hierarchyLevel] ?? 'child_part';
  if (!item.itemType || item.itemType !== expectedType) {
    item.itemType = expectedType;
  }

  return item;
}


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Assembly3DState {
  modelUrl: string;
  fileName: string;
  volume: number;
  material: string;
  bomItemId: string;
}

interface ImportSummary {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ item: string; error: string; index: number }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BOMDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const bomId = params.bomId as string;

  const { data: project } = useProject(projectId);
  const { data: bomData, isLoading: bomLoading, isError: bomError } = useBOM(bomId);
  const { data: bomItemsData, refetch: refetchBOMItems } = useBOMItems(bomId);

  // -------------------------------------------------------------------------
  // Dialog / panel state
  // -------------------------------------------------------------------------
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [parentItemId, setParentItemId] = useState<string | null>(null);
  const [defaultItemType, setDefaultItemType] = useState<BOMItemType | undefined>(undefined);
  const [viewingItem, setViewingItem] = useState<BOMItem | null>(null);
  const [preferredView, setPreferredView] = useState<'2d' | '3d'>('3d');

  // -------------------------------------------------------------------------
  // 3D viewer state
  // -------------------------------------------------------------------------
  const [uploadedAssembly3D, setUploadedAssembly3D] = useState<Assembly3DState | null>(null);
  const [isExplodedView, setIsExplodedView] = useState(false);
  const [explodeDistance, setExplodeDistance] = useState(85);

  // -------------------------------------------------------------------------
  // BOM panel selection / hover
  // -------------------------------------------------------------------------
  const [selectedBOMItems, setSelectedBOMItems] = useState<any[]>([]);
  const [hoveredBOMItem, setHoveredBOMItem] = useState<any | null>(null);
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [detectedParts, setDetectedParts] = useState<any[]>([]);

  // -------------------------------------------------------------------------
  // Import state
  // -------------------------------------------------------------------------
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState('');
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [showImportSummary, setShowImportSummary] = useState(false);

  // -------------------------------------------------------------------------
  // Bulk delete state
  // -------------------------------------------------------------------------
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isBulkDeleting, setBulkDeleting] = useState(false);

  // -------------------------------------------------------------------------
  // DFM analysis state
  // -------------------------------------------------------------------------
  const [assemblyDFMData] = useState<any>(null);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  // Keep viewingItem in sync with latest data after mutations
  useEffect(() => {
    if (!viewingItem || !bomItemsData?.items) return;
    const updated = bomItemsData.items.find(item => item.id === viewingItem.id);
    if (updated) setViewingItem(updated);
  }, [bomItemsData?.items]); // eslint-disable-line react-hooks/exhaustive-deps


  // Load existing 3D assembly on mount (once, if not yet loaded)
  useEffect(() => {
    if (!bomItemsData?.items?.length || uploadedAssembly3D) return;

    const loadExisting3DModel = async () => {
      const assemblyWithFile = bomItemsData.items
        .filter(item => item.itemType === 'assembly' && item.file3dPath)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      if (!assemblyWithFile) return;

      try {
        const fileUrlData = await bomAPI.getFileUrl(assemblyWithFile.id, '3d');
        if (!fileUrlData?.url) return;

        let volume = (assemblyWithFile as any).volume ?? 0;
        if (volume === 0 && assemblyWithFile.description) {
          const match = assemblyWithFile.description.match(/Volume:\s*(\d+(?:\.\d+)?)mm³/);
          if (match?.[1]) volume = parseFloat(match[1]);
        }

        setUploadedAssembly3D({
          modelUrl: fileUrlData.url,
          fileName: assemblyWithFile.name ?? (assemblyWithFile as any).partNumber ?? 'Assembly Model',
          volume,
          material: assemblyWithFile.material ?? 'Unknown',
          bomItemId: assemblyWithFile.id,
        });
      } catch {
        // Silently skip — 3D model is optional; the BOM will still render
      }
    };

    loadExisting3DModel();
  }, [bomItemsData?.items]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const bom = bomData ?? {
    id: bomId,
    name: 'Loading...',
    description: '',
    version: '1.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const bomItems = buildTree(bomItemsData?.items ?? []);

  // -------------------------------------------------------------------------
  // Handlers — item CRUD
  // -------------------------------------------------------------------------

  const handleAddItem = () => {
    setSelectedItem(null);
    setParentItemId(null);
    setDefaultItemType(undefined);
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
      await refetchBOMItems();
      toast.success('Item deleted successfully');
    } catch {
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
    setPreferredView(viewType ?? '3d');
  };

  // Auto-assign parent based on item type hierarchy
  const getAutoParentForType = (type: BOMItemType): string | null => {
    const flat = bomItemsData?.items ?? [];

    if (type === BOMItemType.ASSEMBLY) return null;

    if (type === BOMItemType.SUB_ASSEMBLY) {
      const assemblies = flat.filter(i => i.itemType === 'assembly');
      return assemblies[assemblies.length - 1]?.id ?? null;
    }

    if (type === BOMItemType.CHILD_PART) {
      const subAssemblies = flat.filter(i => i.itemType === 'sub_assembly');
      if (subAssemblies.length > 0) return subAssemblies[subAssemblies.length - 1]?.id ?? null;
      const assemblies = flat.filter(i => i.itemType === 'assembly');
      return assemblies[assemblies.length - 1]?.id ?? null;
    }

    return null;
  };

  // -------------------------------------------------------------------------
  // Handlers — 3D viewer selection
  // -------------------------------------------------------------------------

  const handleBOMItemSelect = (item: any) => {
    const isSelected = selectedBOMItems.some(s => s.id === item.id);

    if (isSelected) {
      const next = selectedBOMItems.filter(s => s.id !== item.id);
      setSelectedBOMItems(next);
      if (next.length === 0) setShowOnlySelected(false);
    } else {
      setSelectedBOMItems(prev => [...prev, item]);
      setShowOnlySelected(true);
    }
  };

  const handleBOMItemHover = (item: any | null) => setHoveredBOMItem(item);

  const handlePartsDetected = (parts: any[]) => {
    const existingBOMItems = bomItemsData?.items ?? [];

    const enhanced = parts.map((part, index) => {
      const match = existingBOMItems[index];

      if (match) {
        return {
          ...match,
          partIndex: index,
          is3DDetected: true,
          geometry: part.geometry,
          volume: part.volume,
          boundingBox: part.boundingBox,
          id: part.id,
        };
      }

      const overflowIndex = index + 1 - existingBOMItems.length;
      return {
        id: part.id,
        name: `Additional Part ${overflowIndex}`,
        partNumber: `EXTRA-${String(overflowIndex).padStart(2, '0')}`,
        itemType: getPartTypeFromGeometry(part),
        material: 'To Be Determined',
        quantity: 1,
        description: 'Additional component detected in 3D model',
        partIndex: index,
        is3DDetected: true,
        isAdditional: true,
        geometry: part.geometry,
        volume: part.volume,
        boundingBox: part.boundingBox,
      };
    });

    setDetectedParts(enhanced);
  };

  // -------------------------------------------------------------------------
  // Handlers — DFM analysis
  // -------------------------------------------------------------------------


  // -------------------------------------------------------------------------
  // Handlers — bulk delete
  // -------------------------------------------------------------------------

  const handleBulkDeleteAll = async () => {
    const allItems = bomItemsData?.items ?? [];
    if (!allItems.length) {
      toast.error('No items to delete');
      return;
    }

    setBulkDeleting(true);
    try {
      // Delete deepest hierarchy levels first to respect FK constraints
      const sortedItems = [...allItems].sort((a, b) => {
        const levelOf = (type: string) =>
          type === 'assembly' ? 1 : type === 'sub_assembly' ? 2 : 3;
        return levelOf(b.itemType) - levelOf(a.itemType);
      });

      let deletedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < sortedItems.length; i += IMPORT_BATCH_SIZE) {
        const batch = sortedItems.slice(i, i + IMPORT_BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(item => deleteBOMItem(item.id))
        );

        results.forEach(r => {
          if (r.status === 'fulfilled') deletedCount++;
          else failedCount++;
        });

        // Rate-limit protection between batches
        if (i + IMPORT_BATCH_SIZE < sortedItems.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      await refetchBOMItems();

      if (failedCount === 0) {
        toast.success(`Successfully deleted all ${deletedCount} BOM items`);
      } else {
        toast.warning(`Deleted ${deletedCount} items; ${failedCount} failed`);
      }
    } catch (err: any) {
      toast.error(`Bulk delete failed: ${err.message}`);
    } finally {
      setBulkDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  };

  // -------------------------------------------------------------------------
  // Handlers — export
  // -------------------------------------------------------------------------

  const handleDownloadTemplate = () => {
    try {
      const headers = [
        'Level', 'Part Number', 'Name', 'Description', 'Type',
        'Quantity', 'Unit', 'Material', 'Material Grade',
        'Annual Volume', 'Make/Buy', 'Unit Cost', 'Parent Reference',
      ];

      const rows = [
        [1, 'ASM-001', 'Main Assembly', 'Top level assembly', 'assembly', 1, 'pcs', 'Aluminum', '6061-T6', 10000, 'make', 150.00, ''],
        [2, 'SUB-001', 'Motor Sub-Assembly', 'Electric motor unit', 'sub_assembly', 1, 'pcs', 'Steel', 'AISI 304', 10000, 'make', 85.00, 'ASM-001'],
        [3, 'PRT-001', 'Motor Housing', 'Cast aluminum housing', 'child_part', 1, 'pcs', 'Aluminum', 'A356', 10000, 'make', 25.00, 'SUB-001'],
        [3, 'PRT-002', 'Rotor', 'Steel rotor assembly', 'child_part', 1, 'pcs', 'Steel', '1045', 10000, 'make', 30.00, 'SUB-001'],
        [2, 'SUB-002', 'Control Unit', 'Electronic control system', 'sub_assembly', 1, 'pcs', 'Plastic', 'ABS', 10000, 'buy', 45.00, 'ASM-001'],
        [3, 'PRT-003', 'Control Board', 'Main PCB assembly', 'child_part', 1, 'pcs', 'Fiberglass', 'FR4', 10000, 'buy', 35.00, 'SUB-002'],
        [3, 'PRT-004', 'Enclosure', 'Plastic housing', 'child_part', 1, 'pcs', 'Plastic', 'ABS', 10000, 'buy', 8.00, 'SUB-002'],
        [1, 'ASM-002', 'Mounting Assembly', 'Mounting bracket system', 'assembly', 1, 'pcs', 'Steel', 'AISI 304', 10000, 'make', 25.00, ''],
        [2, 'PRT-005', 'L-Bracket', 'L-shaped mounting bracket', 'child_part', 4, 'pcs', 'Steel', 'AISI 304', 40000, 'make', 5.00, 'ASM-002'],
        [2, 'PRT-006', 'Bolt M8x20', 'Hex head bolt', 'child_part', 8, 'pcs', 'Steel', 'Grade 8.8', 80000, 'buy', 0.50, 'ASM-002'],
      ];

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map((_, i) => ({ wch: i === 3 ? 25 : i === 2 ? 20 : 12 }));
      XLSX.utils.book_append_sheet(wb, ws, 'BOM Template');
      XLSX.writeFile(wb, 'BOM_Import_Template_with_Hierarchy.xlsx');
      toast.success('Excel template downloaded');
    } catch {
      toast.error('Failed to download template');
    }
  };

  const handleExport = () => {
    try {
      const items = bomItemsData?.items ?? [];
      const headers = [
        'Part Number', 'Name', 'Description', 'Type', 'Quantity',
        'Unit', 'Material', 'Material Grade', 'Annual Volume', 'Parent Item',
      ];

      const rows = items.map(item => [
        item.partNumber ?? '',
        item.name ?? '',
        item.description ?? '',
        item.itemType ?? '',
        item.quantity?.toString() ?? '',
        item.unit ?? '',
        item.material ?? '',
        item.materialGrade ?? '',
        item.annualVolume?.toString() ?? '',
        items.find(i => i.id === item.parentItemId)?.partNumber ?? '',
      ]);

      const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `BOM_${bom.name}_${new Date().toISOString().split('T')[0]}.csv`;
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('BOM exported successfully');
    } catch {
      toast.error('Failed to export BOM');
    }
  };

  // -------------------------------------------------------------------------
  // Handlers — import
  // -------------------------------------------------------------------------

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
        const ext = file.name.toLowerCase().split('.').pop();
        let items: any[] = [];

        if (ext === 'csv') items = await parseCSVFile(file);
        else if (ext === 'xlsx' || ext === 'xls') items = await parseExcelFile(file);
        else throw new Error('Unsupported format. Use .xlsx or .csv.');

        if (!items.length) throw new Error('No valid items found in the file');

        setImportStatus('Building hierarchy...');
        setImportProgress(30);
        await importWithHierarchy(items);
        setImportProgress(100);
        setImportStatus('Import completed');
        await refetchBOMItems();
      } catch (err: any) {
        toast.error(err.message ?? 'Failed to import file');
      } finally {
        setIsImporting(false);
        setTimeout(() => { setImportProgress(0); setImportStatus(''); }, 2000);
      }
    };

    input.click();
  };

  const parseCSVFile = async (file: File): Promise<any[]> => {
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV has no data rows');

    const headers = lines[0]!.split(',').map(h => h.trim().replace(/"/g, ''));
    const items: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = (lines[i]!.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) ?? [])
        .map(v => v.trim().replace(/^"|"$/g, ''));
      const item = parseRowData(headers, values, i);
      if (item.name) items.push(item);
    }

    return items;
  };

  const parseExcelFile = async (file: File): Promise<any[]> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'binary' });
          const sheetName = wb.SheetNames[0];
          if (!sheetName) throw new Error('No worksheets found');

          const ws = wb.Sheets[sheetName];
          if (!ws) throw new Error(`Worksheet "${sheetName}" missing`);

          const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
          if (rows.length < 2) throw new Error('No data rows found');

          const headers = (rows[0] as any[]).map(h => String(h ?? '').trim());
          const items: any[] = [];

          for (let i = 1; i < rows.length; i++) {
            const row = rows[i] as any[];
            if (!row?.length) continue;
            const item = parseRowData(headers, row.map(v => String(v ?? '').trim()), i);
            if (item.name) items.push(item);
          }

          resolve(items);
        } catch (err) {
          reject(new Error('Failed to parse Excel: ' + (err as Error).message));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsBinaryString(file);
    });

  const importWithHierarchy = async (items: any[]) => {
    const createdItems = new Map<string, string>();
    const parentStack: { level: number; id: string; partNumber: string }[] = [];
    const failedItems: { item: any; error: string; index: number }[] = [];

    // Process level 1 first, then 2, then 3 — preserving original order within each level
    const sorted = [...items].sort((a, b) =>
      a.hierarchyLevel !== b.hierarchyLevel
        ? a.hierarchyLevel - b.hierarchyLevel
        : a.originalRowIndex - b.originalRowIndex
    );

    const batches: any[][] = [];
    for (let i = 0; i < sorted.length; i += IMPORT_BATCH_SIZE) {
      batches.push(sorted.slice(i, i + IMPORT_BATCH_SIZE));
    }

    let processedCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]!;
      setImportProgress(40 + (batchIndex / batches.length) * 50);
      setImportStatus(
        `Processing batch ${batchIndex + 1} of ${batches.length} (${processedCount}/${sorted.length} items)`
      );

      let retries = 0;
      while (retries < IMPORT_MAX_RETRIES) {
        try {
          for (const item of batch) {
            await processItemWithValidation(item, createdItems, parentStack, failedItems, processedCount);
            processedCount++;
          }
          break;
        } catch {
          retries++;
          if (retries >= IMPORT_MAX_RETRIES) {
            batch.forEach((item, idx) => {
              failedItems.push({
                item,
                error: `Batch failed after ${IMPORT_MAX_RETRIES} retries`,
                index: processedCount + idx,
              });
            });
            processedCount += batch.length;
          } else {
            const delay = IMPORT_RETRY_DELAY_MS * Math.pow(2, retries - 1);
            setImportStatus(`Batch ${batchIndex + 1} failed, retrying in ${delay / 1000}s…`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      if (batchIndex < batches.length - 1) {
        await new Promise(r => setTimeout(r, IMPORT_RETRY_BATCH_DELAY_MS));
      }
    }

    const successCount = sorted.length - failedItems.length;

    setImportSummary({
      total: sorted.length,
      successful: successCount,
      failed: failedItems.length,
      errors: failedItems.map(({ item, error, index }) => ({
        item: item.name ?? `Item ${index + 1}`,
        error,
        index: index + 1,
      })),
    });

    if (failedItems.length > 0) {
      toast.error(`${failedItems.length} items failed. Click "View Summary" for details.`);
      setShowImportSummary(true);
    } else {
      toast.success(`Imported all ${successCount} items with hierarchy preserved`);
    }
  };

  const processItemWithValidation = async (
    item: any,
    createdItems: Map<string, string>,
    parentStack: { level: number; id: string; partNumber: string }[],
    failedItems: { item: any; error: string; index: number }[],
    currentIndex: number
  ) => {
    try {
      if (!item.name?.trim()) throw new Error('Item name is required');
      if (item.hierarchyLevel < 1 || item.hierarchyLevel > 3) {
        throw new Error('Hierarchy level must be between 1 and 3');
      }

      let parentItemId: string | null = null;

      // Priority 1: Explicit parent reference column
      if (item.parentReference?.trim()) {
        const ref = item.parentReference.trim();
        const existingParent = bomItemsData?.items?.find(i => i.partNumber === ref);
        if (existingParent) {
          parentItemId = existingParent.id;
        } else {
          const createdId = createdItems.get(`part-${ref}`);
          if (createdId) parentItemId = createdId;
        }
      }

      // Priority 2: Parent stack (level-based)
      if (!parentItemId && item.hierarchyLevel > 1) {
        while (parentStack.length && parentStack[parentStack.length - 1]!.level >= item.hierarchyLevel) {
          parentStack.pop();
        }
        if (parentStack.length) {
          parentItemId = parentStack[parentStack.length - 1]!.id;
        }
      }

      // Priority 3: Last created item at parent level
      if (!parentItemId && item.hierarchyLevel > 1) {
        const targetLevel = item.hierarchyLevel - 1;
        const candidateId = createdItems.get(`level-${targetLevel}`);
        if (candidateId) parentItemId = candidateId;
      }

      const makeBuyValue = validateMakeBuy(item.makeBuy);
      const unitCostValue = validatePositiveNumber(item.unitCost);
      const validParentId = validateUUID(parentItemId);

      // Build a CreateBOMItemDto-shaped object. Optional fields are omitted
      // (not set to undefined) so the API never receives spurious keys.
      const payload: CreateBOMItemDto = {
        bomId: String(bomId).trim(),
        name: String(item.name).trim(),
        // partNumber is required by CreateBOMItemDto; fall back to a
        // generated value when the import row omits it.
        partNumber: item.partNumber?.trim()
          ? String(item.partNumber).trim()
          : `AUTO-${String(currentIndex + 1).padStart(4, '0')}`,
        itemType: validateItemType(item.itemType) as CreateBOMItemDto['itemType'],
        quantity: validatePositiveInteger(item.quantity, 1),
        unit: validateUnit(item.unit) as CreateBOMItemDto['unit'],
        ...(item.description?.trim()   && { description:   String(item.description).trim() }),
        ...(item.material?.trim()      && { material:      String(item.material).trim() }),
        ...(item.materialGrade?.trim() && { materialGrade: String(item.materialGrade).trim() }),
        ...(makeBuyValue               && { makeBuy:       makeBuyValue }),
        ...(unitCostValue !== undefined && makeBuyValue === 'buy' && { unitCost: unitCostValue }),
        ...(validParentId              && { parentItemId:  validParentId }),
        annualVolume: validatePositiveInteger(item.annualVolume, 0),
        sortOrder: currentIndex,
      };

      const newItem = await createBOMItemWithRetry(payload);
      const newId = newItem.id ?? newItem.data?.id;
      if (!newId) throw new Error('API returned no valid item ID');

      createdItems.set(`row-${item.originalRowIndex}`, newId);
      if (payload.partNumber) createdItems.set(`part-${payload.partNumber}`, newId);
      createdItems.set(`level-${item.hierarchyLevel}`, newId);

      // Maintain parent stack for subsequent children
      while (parentStack.length && parentStack[parentStack.length - 1]!.level >= item.hierarchyLevel) {
        parentStack.pop();
      }
      parentStack.push({
        level: item.hierarchyLevel,
        id: newId,
        partNumber: String(payload.partNumber ?? payload.name),
      });
    } catch (err: any) {
      failedItems.push({ item, error: err.message ?? 'Unknown error', index: currentIndex });
      throw err;
    }
  };

  const createBOMItemWithRetry = async (
    payload: CreateBOMItemDto,
    maxRetries = 2,
  ): Promise<any> => {
    // Required field guard — belt-and-suspenders after compile-time typing
    if (!payload.bomId || !payload.name || !payload.itemType) {
      throw new Error('Missing required fields: bomId, name, itemType');
    }

    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
        return await createBOMItem(payload);
      } catch (err: any) {
        lastError = err;
        // 400 / validation errors are deterministic — retrying won't help
        if (err.status === 400 || err.message?.includes('validation')) {
          throw new Error(`Validation error: ${err.message}`);
        }
      }
    }
    throw new Error(`Failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
  };


  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (bomLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (bomError || (!bomLoading && !bomData)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-xl font-semibold">BOM Not Found</h2>
          <p className="text-muted-foreground">
            This BOM may have been deleted or you may not have permission to view it.
          </p>
          <Button onClick={() => router.push(projectId ? `/bom?projectId=${projectId}` : '/projects')}>
            Back to BOM Management
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={bom.name} description={bom.description ?? ''}>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/bom?projectId=${projectId}`)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to BOM Management
          </Button>

          <Button variant="outline" className="gap-2" onClick={handleDownloadTemplate}>
            <FileDown className="h-4 w-4" />
            Excel Template
          </Button>

          <Button variant="outline" className="gap-2" onClick={handleImport} disabled={isImporting}>
            {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isImporting ? 'Importing…' : 'Import'}
          </Button>

          <Button variant="outline" className="gap-2" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export
          </Button>

          {!!bomItemsData?.items?.length && (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => setShowBulkDeleteConfirm(true)}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isBulkDeleting ? 'Deleting…' : 'Delete All'}
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Import progress / summary banner */}
      {(isImporting || importSummary) && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {isImporting ? 'Import Progress' : 'Import Summary'}
              </span>
              {isImporting && <span className="text-muted-foreground">{importProgress}%</span>}
            </div>
            {isImporting && <Progress value={importProgress} className="h-2" />}
            {importStatus && <p className="text-sm text-muted-foreground">{importStatus}</p>}
            {importSummary && !isImporting && (
              <div className="space-y-2">
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    Successful: {importSummary.successful}
                  </span>
                  {importSummary.failed > 0 && (
                    <span className="flex items-center gap-2 text-red-600">
                      <XCircle className="h-4 w-4" />
                      Failed: {importSummary.failed}
                    </span>
                  )}
                  <span className="text-muted-foreground">Total: {importSummary.total}</span>
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
          </CardContent>
        </Card>
      )}

      {/* BOM metadata card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>BOM Information</CardTitle>
              <CardDescription>Version: {bom.version}</CardDescription>
            </div>
            <Button variant="outline" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Project</p>
              <p className="font-medium">{project?.name ?? 'Loading…'}</p>
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

      {/* STEP / assembly upload */}
      <AssemblyTreeGenerator
        bomId={bomId}
        projectId={projectId}
        onAssemblyGenerated={(tree, assemblyData) => {
          if (assemblyData) setUploadedAssembly3D(assemblyData);
          if (tree?.length) refetchBOMItems();
        }}
      />

      {/* 3D Assembly viewer */}
      {uploadedAssembly3D && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="h-5 w-5" />
              Assembly 3D Model
            </CardTitle>
            <CardDescription>
              3D visualization — {uploadedAssembly3D.fileName}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-12 gap-6 min-h-[800px]">

              {/* Left panel — BOM tree */}
              <div className="col-span-3 border-r pr-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Assembly Parts</h3>
                </div>

                <div className="max-h-[700px] overflow-y-auto space-y-2">
                  {USE_3D_PARTS ? (
                    detectedParts.length > 0 ? (
                      <HierarchicalBOMTree
                        items={detectedParts}
                        selectedItems={selectedBOMItems}
                        onItemSelect={handleBOMItemSelect}
                        onItemHover={handleBOMItemHover}
                        onEditItem={handleEditItem}
                      />
                    ) : (
                      <div className="text-center text-muted-foreground py-8">
                        <Box className="h-12 w-12 mx-auto opacity-50 mb-2" />
                        <p>No 3D parts detected</p>
                        <p className="text-sm mt-2">Upload assembly to analyse parts</p>
                      </div>
                    )
                  ) : (
                    bomItemsData?.items?.length ? (
                      <HierarchicalBOMTree
                        items={bomItemsData.items}
                        selectedItems={selectedBOMItems}
                        onItemSelect={handleBOMItemSelect}
                        onItemHover={handleBOMItemHover}
                        onEditItem={handleEditItem}
                      />
                    ) : (
                      <div className="text-center text-muted-foreground py-8">
                        <p>No BOM items found</p>
                      </div>
                    )
                  )}
                </div>

                {/* Selection controls */}
                <div className="flex flex-col gap-2 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showOnlySelected}
                        onChange={e => {
                          setShowOnlySelected(e.target.checked);
                          if (!e.target.checked) setSelectedBOMItems([]);
                        }}
                        className="rounded"
                      />
                      <span>Show Only Selected</span>
                    </label>

                    {selectedBOMItems.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setSelectedBOMItems([]); setShowOnlySelected(false); }}
                        className="h-7 px-2 text-xs"
                      >
                        Clear ({selectedBOMItems.length})
                      </Button>
                    )}
                  </div>

                  {selectedBOMItems.length > 1 && (
                    <p className="text-xs text-gray-600 bg-blue-50 p-2 rounded">
                      {selectedBOMItems.length} parts selected. Click a part to toggle it.
                    </p>
                  )}
                </div>
              </div>

              {/* Right panel — 3D viewer */}
              <div className="col-span-9 space-y-4">
                <div className="h-[750px] rounded-lg overflow-hidden border">
                  <ModelViewer
                    fileUrl={uploadedAssembly3D.modelUrl}
                    fileName={uploadedAssembly3D.fileName}
                    fileType="stl"
                    bomItemId={uploadedAssembly3D.bomItemId}
                    isExploded={isExplodedView}
                    explodeDistance={explodeDistance}
                    selectedBOMItems={selectedBOMItems}
                    showOnlySelected={showOnlySelected}
                    hoveredBOMItem={hoveredBOMItem}
                    onPartsDetected={handlePartsDetected}
                    dfmAnalysisData={assemblyDFMData}
                    showFeatures
                  />
                </div>

                {/* View controls */}
                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    variant={isExplodedView ? 'default' : 'outline'}
                    onClick={() => setIsExplodedView(v => !v)}
                    className="gap-2"
                  >
                    <Layers3 className="h-4 w-4" />
                    {isExplodedView ? 'Normal View' : 'Exploded View'}
                  </Button>

                  {isExplodedView && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Explode Distance:</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={explodeDistance}
                        onChange={e => setExplodeDistance(parseInt(e.target.value))}
                        className="w-32 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-sm text-muted-foreground w-8">{explodeDistance}</span>
                    </div>
                  )}

                  <Button variant="outline" className="gap-2">
                    <Download className="h-4 w-4" />
                    Download STL
                  </Button>
                </div>

                {/* Assembly metadata */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg text-center">
                  <div>
                    <p className="text-sm text-muted-foreground">File Name</p>
                    <p className="font-semibold">{uploadedAssembly3D.fileName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Volume</p>
                    <p className="font-semibold">
                      {uploadedAssembly3D.volume > 0
                        ? `${uploadedAssembly3D.volume.toLocaleString()} mm³`
                        : 'Processing…'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Material</p>
                    <p className="font-semibold">{uploadedAssembly3D.material}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      Ready
                    </Badge>
                  </div>
                </div>
              </div>

            </div>
          </CardContent>
        </Card>
      )}

      {/* BOM items tabs */}
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
              <CardTitle>BOM Items</CardTitle>
              <CardDescription>Manage parts, materials, and components</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <BOMItemsFlat
                bomId={bomId}
                onEditItem={handleEditItem}
                onViewItem={handleViewItem}
                onAddChildItem={handleAddTreeItem}
              />
              <div className="flex justify-center">
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
                projectName={project?.name ?? ''}
                projectId={projectId}
                onAddItem={handleAddTreeItem}
                onEditItem={handleEditItem}
                onDeleteItem={handleDeleteItem}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs & panels */}
      <BOMItemDialog
        bomId={bomId}
        item={selectedItem}
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        parentItemId={parentItemId}
        {...(defaultItemType !== undefined && { defaultItemType })}
        onSuccess={refetchBOMItems}
        getAutoParent={getAutoParentForType}
      />

      <BOMItemDetailPanel
        item={viewingItem}
        onClose={() => setViewingItem(null)}
        onUpdate={refetchBOMItems}
        preferredView={preferredView}
      />

      {/* Import summary dialog */}
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
              <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg text-center">
                <div>
                  <div className="text-2xl font-bold text-green-600">{importSummary.successful}</div>
                  <div className="text-sm text-muted-foreground">Successful</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">{importSummary.failed}</div>
                  <div className="text-sm text-muted-foreground">Failed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">{importSummary.total}</div>
                  <div className="text-sm text-muted-foreground">Total</div>
                </div>
              </div>

              {importSummary.failed > 0 && (
                <div className="space-y-2">
                  <h3 className="font-medium text-red-600 flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Failed Items ({importSummary.failed})
                  </h3>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {importSummary.errors.map((err, i) => (
                      <div key={i} className="p-3 border rounded-lg bg-red-50 border-red-200">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm text-red-800">
                              Row {err.index}: {err.item}
                            </p>
                            <p className="text-sm text-red-600 mt-1">{err.error}</p>
                          </div>
                          <Badge variant="destructive" className="text-xs">Row {err.index}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {importSummary.failed === 0 && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-800">
                  <CheckCircle className="h-5 w-5" />
                  <div>
                    <p className="font-medium">All items imported successfully</p>
                    <p className="text-sm text-green-700 mt-0.5">
                      {importSummary.total} items created with hierarchy preserved.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              className="w-full"
              onClick={() => { setShowImportSummary(false); setImportSummary(null); }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation dialog */}
      <Dialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete All BOM Items
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-destructive">Permanent Deletion</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This will permanently delete{' '}
                  <strong>all {bomItemsData?.items?.length ?? 0} BOM items</strong>. This action
                  cannot be undone.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-sm">Items to be deleted:</p>
              <div className="bg-muted/50 rounded-lg p-3 max-h-32 overflow-y-auto space-y-1 text-xs">
                {bomItemsData?.items?.slice(0, 10).map(item => (
                  <div key={item.id} className="flex items-center justify-between">
                    <span className="truncate">{item.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      {item.itemType.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
                {(bomItemsData?.items?.length ?? 0) > 10 && (
                  <p className="text-muted-foreground text-center py-1">
                    … and {(bomItemsData?.items?.length ?? 0) - 10} more items
                  </p>
                )}
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2 text-sm text-blue-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Deletion proceeds deepest-first (child parts → sub-assemblies → assemblies) to
                preserve referential integrity.
              </p>
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
              {isBulkDeleting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>
                : <><Trash2 className="h-4 w-4" /> Delete All {bomItemsData?.items?.length ?? 0} Items</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WorkflowNavigation currentModuleId="bom" projectId={projectId} />
    </div>
  );
}