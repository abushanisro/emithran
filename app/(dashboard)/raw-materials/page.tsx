'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Upload, Search, ArrowUpDown, Download, Trash2, AlertTriangle, Pencil, FileSpreadsheet } from 'lucide-react';
import {
  useRawMaterials,
  useRawMaterialFilterOptions,
  useUploadRawMaterialsExcel,
  useCreateRawMaterial,
  useUpdateRawMaterial,
  useDeleteRawMaterial,
  useDeleteAllRawMaterials,
  type RawMaterial,
} from '@/lib/api/hooks/useRawMaterials';
import { FerrousNonFerrousForm } from '@/components/features/raw-materials/FerrousNonFerrousForm';
import { useMaterialFilters } from '@/lib/hooks/useMaterialFilters';
import {
  CURRENCY_SYMBOLS,
  COUNTRY_LABELS,
  MATERIAL_SHAPE_LABELS,
  type Currency,
  type Country,
  type MaterialShape,
  getCurrencyForCountry
} from '@/lib/constants/materials';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// One material can genuinely be either family, so this is checked per-material
// (badge color, edit form choice) rather than driven by a page-level filter —
// the page shows every material together, one unified list, no group tab.
function isFerrousMaterial(materialGroup?: string | null): boolean {
  const g = materialGroup?.toLowerCase() || '';
  return (
    g.includes('ferrous') ||
    g.includes('steel') ||
    g.includes('iron') ||
    g.includes('aluminum') ||
    g.includes('copper') ||
    g.includes('titanium') ||
    g.includes('zinc') ||
    g.includes('magnesium') ||
    g.includes('nickel') ||
    (g.includes('metal') && !g.includes('plastic'))
  );
}

export default function RawMaterialsPage() {
  // Enhanced filter system
  const {
    filters,
    queryFilters,
    setSearch,
    setMaterialGroup,
    setSorting,
    clearFilters,
  } = useMaterialFilters({
    initialFilters: {
      sortBy: 'material',
      sortOrder: 'asc',
      page: 1,
      limit: 500
    },
    autoSyncCurrency: true
  });
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);
  const [visibleSections, setVisibleSections] = useState({
    basic: true,
    properties: true,
    standards: true,
    forming: true,
  });
  const [costRegion, setCostRegion] = useState<'india' | 'usa' | 'china' | 'mexico' | 'france' | 'germany' | 'w_europe' | 'e_europe'>('usa');
  const [newMaterial, setNewMaterial] = useState({
    materialGroup: '',
    material: '',
    materialGrade: '',
    materialType: '',
    materialDescription: '',
    densityKgM3: '',
    unitCost: '',
    country: '',
    currency: 'USD' as Currency,
    shape: '' as MaterialShape | '',
    
    // Material properties
    density: '',
    ultimate_tensile_strength: '',
    yield_tensile_strength: '',
    shearing_strength: '',
    
    // Standards
    astm_standard: '',
    din_standard: '',
    en_standard: '',
    jis_standard: '',
    
    // Plastic-specific properties
    regrinding: '',
    regrindingPercentage: '',
    clampingPressureMpa: '',
    ejectDeflectionTempC: '',
    meltingTempC: '',
    moldTempC: '',
    specificHeatMelt: '',
    thermalConductivityMelt: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const CONFIRM_DELETE_TEXT = 'delete';

  const COST_REGION_LABELS: Record<string, string> = {
    india:    'India',
    usa:      'USA',
    china:    'China',
    mexico:   'Mexico',
    france:   'France',
    germany:  'Germany',
    w_europe: 'W. Europe',
    e_europe: 'E. Europe',
  };

  // Helper functions for display
  const renderCostDisplay = (material: RawMaterial) => {
    const costMap: Record<string, number | undefined> = {
      india:    material.costIndia,
      usa:      material.costUsa,
      china:    material.costChina,
      mexico:   material.costMexico,
      france:   material.costFrance,
      germany:  material.costGermany,
      w_europe: material.costWEurope,
      e_europe: material.costEEurope,
    };
    const cost = costMap[costRegion] ?? material.unitCost ?? material.cost;
    if (!cost || cost === 0) return '-';
    return `$${cost.toFixed(2)}`;
  };


  const renderShapeDisplay = (material: RawMaterial) => {
    if (material.shape) return MATERIAL_SHAPE_LABELS[material.shape];
    return '-';
  };

  // One unified query, no group-based restriction — every material comes back
  // together (this used to force an exact materialGroup match per container,
  // e.g. 'Plastic & Rubber', which silently returned 0 rows whenever the
  // real data didn't match that exact string).
  const getEnhancedQuery = () => {
    const enhancedQuery = { ...queryFilters };

    // Remove fields that might not be supported by the backend yet
    const { materialCategory, country, currency, shape, minCost, maxCost, minDensity, maxDensity, minMeltingTemp, maxMeltingTemp, ...supportedQuery } = enhancedQuery;

    // Debug logging
    if (process.env.NODE_ENV === 'development') {
      console.log('Sending query to API:', supportedQuery);
    }

    return supportedQuery;
  };

  const { data: rawMaterialsData, isLoading } = useRawMaterials(getEnhancedQuery());
  const { data: filterOptions } = useRawMaterialFilterOptions();
  const uploadMutation = useUploadRawMaterialsExcel();
  const createMutation = useCreateRawMaterial();
  const updateMutation = useUpdateRawMaterial();
  const deleteMutation = useDeleteRawMaterial();
  const deleteAllMutation = useDeleteAllRawMaterials();

  const rawMaterials = rawMaterialsData?.items || [];
  const totalCount = rawMaterialsData?.total || 0;

  // No group-based filtering — one page, every material shown together.
  const filteredMaterials = rawMaterials;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (!selectedFile) {
      toast.error('Please select a file first');
      return;
    }

    uploadMutation.mutate(selectedFile, {
      onSuccess: () => {
        setUploadDialogOpen(false);
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
    });
  };

  const downloadTemplate = () => {
    // One combined template covering both material families — plastic-only
    // and ferrous-only columns are simply blank on the sample row that
    // doesn't apply, same as how the unified table now shows both sets of
    // columns for every material.
    const headers = [
      'MaterialGroup',
      'Material',
      'MaterialType',
      'MaterialDescription',
      'Shape',
      'Country',
      'Currency',
      'Density',
      'UltimateTensileStrength',
      'YeildTensileStrength',
      'ShearingStrength',
      'ASTM Standard',
      'DIN Standard',
      'EN Standard',
      'JIS Standard',
      'Regrinding',
      'Regrinding%',
      'Clamping Pressure (MPa)',
      'Eject Deflection Temp (°C)',
      'Melting Temp (°C)',
      'Mold Temp (°C)',
      'Density (kg/m³)',
      'Specific Heat of Melt (J / g * °C)',
      'Thermal Conductivity of Melt (Watts / m * °C)',
      'Unit Cost ($)',
      'Year',
    ];
    const sampleRows = [
      [
        'Ferrous & Non-Ferrous', 'Carbon Steel', 'Carbon Steel', 'Low carbon steel for structural applications',
        'BARS', 'USA', 'USD', '7.85', '520', '350', '315', 'ASTM A36', 'DIN St37', 'EN S235JR', 'JIS SS400',
        '', '', '', '', '', '', '', '', '', '45.50', '2024',
      ],
      [
        'Plastic & Rubber', 'Acrylonitrile Butadiene Styrene', 'Thermoplastic', 'High-impact ABS plastic for automotive applications',
        'GRANULES', 'USA', 'USD', '', '', '', '', '', '', '', '',
        'Yes', '10', '49.4', '85', '240', '70', '1040', '1.8', '0.127', '135.50', '2024',
      ],
    ];
    const fileName = 'raw-materials-template.csv';

    const csv = [headers.join(','), ...sampleRows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);

    toast.success('Template downloaded! Use this format for your Excel file.');
  };

  const handleCreateMaterial = () => {
    if (!newMaterial.materialGroup || !newMaterial.material) {
      toast.error('Material Group and Material name are required');
      return;
    }

    const materialData: any = {
      materialGroup: newMaterial.materialGroup,
      material: newMaterial.material,
      materialGrade: newMaterial.materialGrade || undefined,
      materialType: newMaterial.materialType || undefined,
      materialDescription: newMaterial.materialDescription || undefined,
      regrinding: newMaterial.regrinding || undefined,
      regrindingPercentage: newMaterial.regrindingPercentage ? parseFloat(newMaterial.regrindingPercentage) : undefined,
      clampingPressureMpa: newMaterial.clampingPressureMpa ? parseFloat(newMaterial.clampingPressureMpa) : undefined,
      ejectDeflectionTempC: newMaterial.ejectDeflectionTempC ? parseFloat(newMaterial.ejectDeflectionTempC) : undefined,
      meltingTempC: newMaterial.meltingTempC ? parseFloat(newMaterial.meltingTempC) : undefined,
      moldTempC: newMaterial.moldTempC ? parseFloat(newMaterial.moldTempC) : undefined,
      densityKgM3: newMaterial.densityKgM3 ? parseFloat(newMaterial.densityKgM3) : undefined,
      specificHeatMelt: newMaterial.specificHeatMelt ? parseFloat(newMaterial.specificHeatMelt) : undefined,
      thermalConductivityMelt: newMaterial.thermalConductivityMelt ? parseFloat(newMaterial.thermalConductivityMelt) : undefined,
      country: newMaterial.country || undefined,
      currency: newMaterial.currency || 'USD',
      unitCost: newMaterial.unitCost ? parseFloat(newMaterial.unitCost) : undefined,

      // Material properties
      density: newMaterial.density ? parseFloat(newMaterial.density) : undefined,
      ultimate_tensile_strength: newMaterial.ultimate_tensile_strength ? parseFloat(newMaterial.ultimate_tensile_strength) : undefined,
      yield_tensile_strength: newMaterial.yield_tensile_strength ? parseFloat(newMaterial.yield_tensile_strength) : undefined,
      shearing_strength: newMaterial.shearing_strength ? parseFloat(newMaterial.shearing_strength) : undefined,
      
      // Standards
      astm_standard: newMaterial.astm_standard || undefined,
      din_standard: newMaterial.din_standard || undefined,
      en_standard: newMaterial.en_standard || undefined,
      jis_standard: newMaterial.jis_standard || undefined,
      
    };

    createMutation.mutate(materialData, {
      onSuccess: () => {
        setCreateDialogOpen(false);
        resetNewMaterial();
      },
    });
  };

  const resetNewMaterial = () => {
    setNewMaterial({
      materialGroup: '',
      material: '',
      materialGrade: '',
      materialType: '',
      materialDescription: '',
      densityKgM3: '',
      unitCost: '',
      country: '',
      currency: 'USD' as Currency,
      shape: '' as MaterialShape | '',
      
      // Material properties
      density: '',
      ultimate_tensile_strength: '',
      yield_tensile_strength: '',
      shearing_strength: '',
      
      // Standards
      astm_standard: '',
      din_standard: '',
      en_standard: '',
      jis_standard: '',
      
      // Plastic-specific properties
      regrinding: '',
      regrindingPercentage: '',
      clampingPressureMpa: '',
      ejectDeflectionTempC: '',
      meltingTempC: '',
      moldTempC: '',
      specificHeatMelt: '',
      thermalConductivityMelt: '',
    });
  };

  const handleDownloadJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      totalInDatabase: totalCount,
      exportedCount: rawMaterials.length,
      materials: rawMaterials,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raw-materials-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteMaterial = (id: string, materialName: string) => {
    if (confirm(`Are you sure you want to delete "${materialName}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  const handleDeleteAll = () => {
    if (deleteConfirmText.toLowerCase() !== CONFIRM_DELETE_TEXT) {
      toast.error(`Please type "${CONFIRM_DELETE_TEXT}" to confirm`);
      return;
    }

    deleteAllMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteAllDialogOpen(false);
        setDeleteConfirmText('');
      },
    });
  };

  const handleEditMaterial = (material: RawMaterial) => {
    // Create a clean material object with all values as strings or proper types for controlled components
    const cleanMaterial = {
      ...material,
      // Convert any null values to empty strings for React form handling
      materialGrade: material.materialGrade || '',
      regrinding: material.regrinding || '',
      astmStandard: material.astmStandard || '',
      dinStandard: material.dinStandard || '',
      enStandard: material.enStandard || '',
      jisStandard: material.jisStandard || '',
      currency: material.currency || 'USD',
    };
    
    setEditingMaterial(cleanMaterial);
    setNewMaterial({
      materialGroup: material.materialGroup || '',
      material: material.material || '',
      materialGrade: material.materialGrade || '',
      materialType: material.materialType || '',
      materialDescription: material.materialDescription || '',
      densityKgM3: material.densityKgM3?.toString() || '',
      unitCost: (material.unitCost || material.cost)?.toString() || '',
      country: material.country || '',
      currency: material.currency || 'USD',
      shape: material.shape || '',

      // Material properties
      density: material.density?.toString() || '',
      ultimate_tensile_strength: material.ultimateTensileStrength?.toString() || '',
      yield_tensile_strength: material.yieldTensileStrength?.toString() || '',
      shearing_strength: material.shearingStrength?.toString() || '',

      // Standards
      astm_standard: material.astmStandard || '',
      din_standard: material.dinStandard || '',
      en_standard: material.enStandard || '',
      jis_standard: material.jisStandard || '',

      // Plastic-specific properties
      regrinding: material.regrinding || '',
      regrindingPercentage: material.regrindingPercentage?.toString() || '',
      clampingPressureMpa: material.clampingPressureMpa?.toString() || '',
      ejectDeflectionTempC: material.ejectDeflectionTempC?.toString() || '',
      meltingTempC: material.meltingTempC?.toString() || '',
      moldTempC: material.moldTempC?.toString() || '',
      specificHeatMelt: material.specificHeatMelt?.toString() || '',
      thermalConductivityMelt: material.thermalConductivityMelt?.toString() || '',
    });
    
    setEditDialogOpen(true);
  };

  const handleUpdateMaterial = () => {
    if (!editingMaterial) return;
    if (!editingMaterial.materialGroup || !editingMaterial.material) {
      toast.error('Material Group and Material name are required');
      return;
    }

    const materialData: any = {
      materialGroup: editingMaterial.materialGroup,
      material: editingMaterial.material,
      materialGrade: editingMaterial.materialGrade || undefined,
      materialType: editingMaterial.materialType || undefined,
      materialDescription: editingMaterial.materialDescription || undefined,
      unitCost: editingMaterial.unitCost ? parseFloat(editingMaterial.unitCost.toString()) : undefined,
      country: editingMaterial.country || undefined,
      shape: editingMaterial.shape || undefined,
      
      // Plastic-specific fields
      regrinding: editingMaterial.regrinding || undefined,
      regrindingPercentage: editingMaterial.regrindingPercentage ? parseFloat(editingMaterial.regrindingPercentage.toString()) : undefined,
      clampingPressureMpa: editingMaterial.clampingPressureMpa ? parseFloat(editingMaterial.clampingPressureMpa.toString()) : undefined,
      ejectDeflectionTempC: editingMaterial.ejectDeflectionTempC ? parseFloat(editingMaterial.ejectDeflectionTempC.toString()) : undefined,
      meltingTempC: editingMaterial.meltingTempC ? parseFloat(editingMaterial.meltingTempC.toString()) : undefined,
      moldTempC: editingMaterial.moldTempC ? parseFloat(editingMaterial.moldTempC.toString()) : undefined,
      densityKgM3: editingMaterial.densityKgM3 ? parseFloat(editingMaterial.densityKgM3.toString()) : undefined,
      specificHeatMelt: editingMaterial.specificHeatMelt ? parseFloat(editingMaterial.specificHeatMelt.toString()) : undefined,
      thermalConductivityMelt: editingMaterial.thermalConductivityMelt ? parseFloat(editingMaterial.thermalConductivityMelt.toString()) : undefined,
    };

    updateMutation.mutate(
      { id: editingMaterial.id, data: materialData },
      {
        onSuccess: () => {
          setEditDialogOpen(false);
          setEditingMaterial(null);
          resetNewMaterial();
        },
      }
    );
  };

  const toggleSort = (column: string) => {
    setSorting(column);
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (filters.sortBy !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return <ArrowUpDown className={`h-3 w-3 ml-1 ${filters.sortOrder === 'desc' ? 'rotate-180' : ''}`} />;
  };

  const displayMaterials = filteredMaterials;

  return (
    <div className="flex flex-col gap-4 p-2 sm:p-4 lg:p-6 animate-fade-in min-h-0">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Raw Materials Database</h1>
          <p className="text-sm text-muted-foreground">Material properties &amp; regional cost data</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setUploadDialogOpen(true)}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import Excel
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownloadJson} disabled={rawMaterials.length === 0} title="Download all loaded materials as JSON">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Download JSON
          </Button>
          <Button size="sm" onClick={() => { setCreateDialogOpen(true); resetNewMaterial(); }}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Material
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDeleteAllDialogOpen(true)} disabled={totalCount === 0}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete All
          </Button>
        </div>
      </div>

      {/* ── Stats strip ────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <Card className="p-3 flex-1 min-w-[100px]">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
          <p className="text-2xl font-bold">{totalCount}</p>
        </Card>
      </div>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Materials from Excel</DialogTitle>
            <DialogDescription>
              Select an Excel file (.xlsx, .xls) or CSV file containing raw material data to import
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 p-4 border border-blue-200 dark:border-blue-900">
              <p className="text-sm text-blue-900 dark:text-blue-100 mb-2">
                Need help with the format?
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadTemplate()}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template CSV
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Select Excel File (.xlsx, .xls, .csv)</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p>Required columns: <strong>MaterialGroup</strong>, <strong>Material</strong></p>
              <p>Supports multiple column formats (e.g., "Material Group" or "MaterialGroup")</p>
            </div>

            <Button
              onClick={handleUpload}
              disabled={!selectedFile || uploadMutation.isPending}
              className="w-full"
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete All Dialog */}
      <Dialog open={deleteAllDialogOpen} onOpenChange={(open) => {
        setDeleteAllDialogOpen(open);
        if (!open) setDeleteConfirmText('');
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Delete All Materials?
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete all {totalCount} raw material(s) from your database.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="rounded-lg bg-red-50 dark:bg-red-950/20 p-4 border border-red-200 dark:border-red-900">
              <p className="text-sm text-red-900 dark:text-red-100 font-semibold">
                ⚠️ Warning: This will delete all {totalCount} materials
              </p>
              <p className="text-xs text-red-800 dark:text-red-200 mt-1">
                All material data will be permanently removed from the database.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-confirm" className="text-sm font-medium">
                Type <span className="font-mono font-bold text-red-600">delete</span> to confirm:
              </Label>
              <Input
                id="delete-confirm"
                type="text"
                placeholder="Type 'delete' to confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="font-mono"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setDeleteAllDialogOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteAll}
                disabled={deleteAllMutation.isPending || deleteConfirmText.toLowerCase() !== CONFIRM_DELETE_TEXT}
                className="flex-1"
              >
                {deleteAllMutation.isPending ? 'Deleting...' : 'Delete All Materials'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Material Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Material</DialogTitle>
            <DialogDescription>
              Create a new raw material entry with complete specifications
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 pt-4">
            {/* Material Identification Section */}
            <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
              <h3 className="text-sm font-semibold text-foreground">Material Identification</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Material Group *</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., Plastic & Rubber, Ferrous & Non-Ferrous"
                    value={newMaterial.materialGroup}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialGroup: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Material *</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., ABS, PC, PE, 100Cr6, AISI 1045"
                    value={newMaterial.material}
                    onChange={(e) => setNewMaterial({ ...newMaterial, material: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Grade</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., General Purpose, 1.3505"
                    value={newMaterial.materialGrade}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialGrade: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., Carbon Steel, Stainless Steel"
                    value={newMaterial.materialType}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialType: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">Description</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., High Carbon Bearing steel"
                    value={newMaterial.materialDescription}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialDescription: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Material Properties Section */}
            <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
              <h3 className="text-sm font-semibold text-foreground">Material Properties</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Country</label>
                  <Select
                    value={newMaterial.country || ''}
                    onValueChange={(value) => {
                      const country = value as Country;
                      const defaultCurrency = getCurrencyForCountry(country);
                      setNewMaterial({ 
                        ...newMaterial, 
                        country,
                        currency: defaultCurrency
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(COUNTRY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Shape</label>
                  <Select
                    value={newMaterial.shape || ''}
                    onValueChange={(value) => setNewMaterial({ ...newMaterial, shape: value as MaterialShape })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select shape" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MATERIAL_SHAPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Plastic Processing Parameters Section */}
            <div className="space-y-4 p-4 bg-blue-50/30 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100">Processing Parameters</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Regrinding</label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={newMaterial.regrinding}
                      onChange={(e) => setNewMaterial({ ...newMaterial, regrinding: e.target.value })}
                    >
                      <option value="">Select...</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Regrinding Percentage (%)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      placeholder="e.g., 10.0"
                      value={newMaterial.regrindingPercentage}
                      onChange={(e) => setNewMaterial({ ...newMaterial, regrindingPercentage: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Clamping Pressure (MPa)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="0.1"
                      placeholder="e.g., 49.4"
                      value={newMaterial.clampingPressureMpa}
                      onChange={(e) => setNewMaterial({ ...newMaterial, clampingPressureMpa: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Eject Deflection Temp (°C)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="1"
                      placeholder="e.g., 85"
                      value={newMaterial.ejectDeflectionTempC}
                      onChange={(e) => setNewMaterial({ ...newMaterial, ejectDeflectionTempC: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Melting Temp (°C)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="1"
                      placeholder="e.g., 240"
                      value={newMaterial.meltingTempC}
                      onChange={(e) => setNewMaterial({ ...newMaterial, meltingTempC: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Mold Temp (°C)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="1"
                      placeholder="e.g., 70"
                      value={newMaterial.moldTempC}
                      onChange={(e) => setNewMaterial({ ...newMaterial, moldTempC: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Density (kg/m³)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      placeholder="e.g., 1050"
                      value={newMaterial.densityKgM3}
                      onChange={(e) => setNewMaterial({ ...newMaterial, densityKgM3: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Specific Heat (J/g·°C)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="0.001"
                      placeholder="e.g., 1.800"
                      value={newMaterial.specificHeatMelt}
                      onChange={(e) => setNewMaterial({ ...newMaterial, specificHeatMelt: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Thermal Conductivity (W/m·°C)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="0.001"
                      placeholder="e.g., 0.127"
                      value={newMaterial.thermalConductivityMelt}
                      onChange={(e) => setNewMaterial({ ...newMaterial, thermalConductivityMelt: e.target.value })}
                    />
                  </div>
                </div>
              </div>

            {/* Mechanical Properties Section */}
            <div className="space-y-4 p-4 bg-indigo-50/30 dark:bg-indigo-950/30 rounded-lg border border-indigo-200 dark:border-indigo-800">
                <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">Mechanical Properties</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Density (g/cm³)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 7.80"
                      value={newMaterial.density}
                      onChange={(e) => setNewMaterial({ ...newMaterial, density: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Ultimate Tensile Strength (MPa)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="1"
                      placeholder="e.g., 1470"
                      value={newMaterial.ultimate_tensile_strength}
                      onChange={(e) => setNewMaterial({ ...newMaterial, ultimate_tensile_strength: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Yield Tensile Strength (MPa)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="1"
                      placeholder="e.g., 1130"
                      value={newMaterial.yield_tensile_strength}
                      onChange={(e) => setNewMaterial({ ...newMaterial, yield_tensile_strength: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Shearing Strength (MPa)</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      type="number"
                      step="1"
                      placeholder="e.g., 850"
                      value={newMaterial.shearing_strength}
                      onChange={(e) => setNewMaterial({ ...newMaterial, shearing_strength: e.target.value })}
                    />
                  </div>
                </div>
              </div>

            {/* Material Standards Section */}
            <div className="space-y-4 p-4 bg-violet-50/30 dark:bg-violet-950/30 rounded-lg border border-violet-200 dark:border-violet-800">
                <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-100">Material Standards</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">ASTM Standard</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="e.g., ASTM A295"
                      value={newMaterial.astm_standard}
                      onChange={(e) => setNewMaterial({ ...newMaterial, astm_standard: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">DIN Standard</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="e.g., DIN 1.3505"
                      value={newMaterial.din_standard}
                      onChange={(e) => setNewMaterial({ ...newMaterial, din_standard: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">EN Standard</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="e.g., EN 10088-2"
                      value={newMaterial.en_standard}
                      onChange={(e) => setNewMaterial({ ...newMaterial, en_standard: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">JIS Standard</label>
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="e.g., SUJ2"
                      value={newMaterial.jis_standard}
                      onChange={(e) => setNewMaterial({ ...newMaterial, jis_standard: e.target.value })}
                    />
                  </div>
                </div>
              </div>

            {/* Cost Information Section */}
            <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
              <h3 className="text-sm font-semibold text-foreground">Cost Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Unit Cost ({CURRENCY_SYMBOLS[newMaterial.currency] || '$'})
                  </label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 135.00"
                    value={newMaterial.unitCost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, unitCost: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex gap-2 sticky bottom-0 bg-background pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateMaterial}
                disabled={createMutation.isPending}
                className="flex-1"
              >
                {createMutation.isPending ? 'Creating...' : 'Create Material'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>


      {/* ── Toolbar ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search materials…"
            value={filters.search || ''}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {/* Material group filter — options come from the real distinct
            material_group values on file (GET /raw-materials/filter-options),
            never a hardcoded list, so a newly-added group shows up here
            automatically without a frontend change. */}
        {(filterOptions?.materialGroups?.length ?? 0) > 0 && (
          <Select
            value={filters.materialGroup || 'all'}
            onValueChange={(v) => setMaterialGroup(v === 'all' ? undefined : v)}
          >
            <SelectTrigger className="h-9 w-[170px] text-xs">
              <SelectValue placeholder="All Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Groups</SelectItem>
              {filterOptions!.materialGroups.map((g) => (
                <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Column visibility */}
        <div className="flex gap-1">
          {(['basic', 'properties', 'standards', 'forming'] as const).map(s => (
            <Button key={s} variant={visibleSections[s] ? 'default' : 'outline'} size="sm"
              className="h-9 text-xs px-2"
              onClick={() => setVisibleSections(prev => ({ ...prev, [s]: !prev[s] }))}>
              {s === 'basic' ? 'Info' : s === 'properties' ? 'Props' : s === 'standards' ? 'Std' : 'Form'}
            </Button>
          ))}
        </div>

        {/* Cost region selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Cost region:</span>
          <Select value={costRegion} onValueChange={(v) => setCostRegion(v as any)}>
            <SelectTrigger className="h-9 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(COST_REGION_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <span>
          Showing <strong>{displayMaterials.length}</strong> of <strong>{totalCount}</strong> materials
        </span>
        {filters.search && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2"
            onClick={() => clearFilters()}>
            Clear filters
          </Button>
        )}
      </div>

      {/* ── Data Table ─────────────────────────────────────────── */}
      <Card>
        <Table wrapperClassName="overflow-x-auto overflow-y-auto max-h-[calc(100vh-380px)]" className="relative min-w-0 w-full">
                <TableHeader className="sticky top-0 z-30">
                  <TableRow className="bg-card hover:bg-card border-b-2 border-border">
                    {/* Always Visible - Sticky Basic Info */}
                    <TableHead className="cursor-pointer h-10 px-2 text-xs sticky left-0 bg-card z-20 min-w-[72px] w-[72px] border-r-2 border-border shadow-lg" onClick={() => toggleSort('material_type')}>
                      <div className="flex items-center font-semibold">
                        Material
                        <SortIcon column="material_type" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer h-10 px-2 text-xs sticky left-[72px] bg-card z-20 min-w-[90px] w-[90px] max-w-[90px] border-r-2 border-border shadow-lg" onClick={() => toggleSort('material')}>
                      <div className="flex items-center font-semibold">
                        Grade
                        <SortIcon column="material" />
                      </div>
                    </TableHead>

                    {/* Conditional Basic Info Columns */}
                    {visibleSections.basic && (
                      <>
                        <TableHead className="h-10 px-1 text-xs min-w-[52px] w-[52px] max-w-[52px]">State</TableHead>
                      </>
                    )}

                    {visibleSections.properties && (
                      <>
                        <TableHead className="h-10 px-1 text-xs text-center border-l-4 border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 min-w-[46px] w-[46px]">
                          <div className="leading-tight">
                            <div className="text-indigo-700 dark:text-indigo-300 font-bold text-[9px]">PROPS</div>
                            <div className="text-indigo-600 dark:text-indigo-400 font-semibold text-[10px]">Den.</div>
                          </div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-indigo-50 dark:bg-indigo-950/20 min-w-[42px] w-[42px]">
                          <div className="leading-tight">
                            <div className="text-indigo-600 dark:text-indigo-400 font-semibold text-[10px]">UTS</div>
                            <div className="text-[9px] text-muted-foreground">MPa</div>
                          </div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-indigo-50 dark:bg-indigo-950/20 min-w-[42px] w-[42px]">
                          <div className="leading-tight">
                            <div className="text-indigo-600 dark:text-indigo-400 font-semibold text-[10px]">YTS</div>
                            <div className="text-[9px] text-muted-foreground">MPa</div>
                          </div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-indigo-50 dark:bg-indigo-950/20 min-w-[42px] w-[42px]">
                          <div className="leading-tight">
                            <div className="text-indigo-600 dark:text-indigo-400 font-semibold text-[10px]">Shear</div>
                            <div className="text-[9px] text-muted-foreground">MPa</div>
                          </div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-indigo-50 dark:bg-indigo-950/20 min-w-[46px] w-[46px]">
                          <div className="leading-tight">
                            <div className="text-indigo-600 dark:text-indigo-400 font-semibold text-[10px]">Hard.</div>
                            <div className="text-[9px] text-muted-foreground">HB/HRC</div>
                          </div>
                        </TableHead>
                      </>
                    )}

                    {visibleSections.standards && (
                      <>
                        <TableHead className="h-10 px-1 text-xs text-center border-l-4 border-violet-400 bg-violet-50 dark:bg-violet-950/30 min-w-[52px] w-[52px]">
                          <div className="leading-tight">
                            <div className="text-violet-700 dark:text-violet-300 font-bold text-[9px]">STD</div>
                            <div className="text-violet-600 dark:text-violet-400 font-semibold text-[10px]">ASTM</div>
                          </div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-violet-50 dark:bg-violet-950/20 min-w-[46px] w-[46px]">
                          <div className="text-violet-600 dark:text-violet-400 font-semibold text-[10px]">DIN</div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-violet-50 dark:bg-violet-950/20 min-w-[42px] w-[42px]">
                          <div className="text-violet-600 dark:text-violet-400 font-semibold text-[10px]">EN</div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-violet-50 dark:bg-violet-950/20 min-w-[42px] w-[42px]">
                          <div className="text-violet-600 dark:text-violet-400 font-semibold text-[10px]">JIS</div>
                        </TableHead>
                      </>
                    )}

                    {visibleSections.forming && (
                      <>
                        <TableHead className="h-10 px-1 text-xs text-center border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950/30 min-w-[42px] w-[42px]" title="Strength coefficient K (MPa) in sigma = K * epsilon^n">
                          <div className="leading-tight">
                            <div className="text-amber-700 dark:text-amber-300 font-bold text-[9px]">FORM</div>
                            <div className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">K</div>
                          </div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-amber-50 dark:bg-amber-950/20 min-w-[36px] w-[36px]" title="Strain-hardening exponent n">
                          <div className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">n</div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-amber-50 dark:bg-amber-950/20 min-w-[36px] w-[36px]" title="Lankford (normal anisotropy) coefficient R">
                          <div className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">R</div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs text-center bg-amber-50 dark:bg-amber-950/20 min-w-[42px] w-[42px]" title="Scrap / yield-loss fraction">
                          <div className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">Scrap%</div>
                        </TableHead>
                      </>
                    )}

                    {(
                      <>
                        <TableHead className="h-10 px-1 text-xs min-w-[46px] w-[46px]">Shape</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[52px] w-[52px]">
                          <div className="leading-tight">
                            <div className="text-[10px]">Hard.</div>
                            <div className="text-[9px] text-muted-foreground">HB/HRC</div>
                          </div>
                        </TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[48px] w-[48px]">Regrind</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[42px] w-[42px]">Rgrd%</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[50px] w-[50px]">Clamp</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[50px] w-[50px]">Eject°C</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[48px] w-[48px]">Melt°C</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[46px] w-[46px]">Mold°C</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[48px] w-[48px]">Density</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[48px] w-[48px]">SpHeat</TableHead>
                        <TableHead className="h-10 px-1 text-xs min-w-[52px] w-[52px]">ThCond.</TableHead>
                      </>
                    )}

                    {/* Always Visible - Right Side */}
                    <TableHead className="h-10 px-1 text-xs min-w-[62px] w-[62px] max-w-[62px] text-right">Cost</TableHead>
                    <TableHead className="h-10 px-1 text-xs sticky right-0 bg-card z-20 min-w-[56px] w-[56px] border-l-2 border-border shadow-lg">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={23} className="text-center py-12 text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          <span className="text-sm">Loading materials…</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : displayMaterials.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={23} className="text-center py-12 text-muted-foreground">
                        <div className="flex flex-col items-center gap-2">
                          <FileSpreadsheet className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No materials found. Upload an Excel file to get started.</span>
                          <Button size="sm" variant="outline" onClick={() => setUploadDialogOpen(true)}>
                            <Upload className="h-3.5 w-3.5 mr-1.5" /> Import Excel
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayMaterials.map((material) => (
                      <TableRow key={material.id} className="hover:bg-secondary/30 border-b border-border/50">
                        {/* Always Visible - Sticky Basic Info */}
                        <TableCell className="font-medium px-1 py-2 text-xs sticky left-0 bg-background z-10 min-w-[72px] w-[72px] max-w-[72px] overflow-hidden border-r border-border">
                          <div className="truncate" title={material.materialType || material.materialGroup || ''}>
                            <Badge
                              variant="outline"
                              className={`text-[9px] px-1 py-0 max-w-full truncate ${
                                material.materialGroup?.toLowerCase().includes('plastic') ||
                                material.materialGroup?.toLowerCase().includes('rubber')
                                  ? 'border-blue-400 text-blue-700 bg-blue-50'
                                  : 'border-orange-400 text-orange-700 bg-orange-50'
                              }`}
                            >
                              {material.materialType || material.materialGroup}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold px-2 py-2 text-xs sticky left-[72px] bg-background z-10 min-w-[90px] w-[90px] max-w-[90px] overflow-hidden border-r border-border">
                          <div className="truncate text-[10px] font-semibold max-w-full" title={material.material}>
                            {material.material}
                          </div>
                        </TableCell>

                        {/* Conditional Basic Info Columns */}
                        {visibleSections.basic && (
                          <>
                            <TableCell className="px-1 py-2 min-w-[52px] w-[52px] max-w-[52px] overflow-hidden">
                              <div className="truncate text-[10px] max-w-full" title={material.matlState || ''}>{material.matlState || '-'}</div>
                            </TableCell>
                          </>
                        )}

                        {visibleSections.properties && (
                          <>
                            <TableCell className="px-1 py-2 text-center border-l-4 border-indigo-400/30 bg-indigo-50/20 min-w-[46px] w-[46px]">
                              {(() => {
                                const d = material.density ?? (material.densityKgM3 ? material.densityKgM3 / 1000 : null);
                                return <div className="text-[10px] font-mono">{d ? d.toFixed(2) : '-'}</div>;
                              })()}
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-indigo-50/10 min-w-[42px] w-[42px]">
                              <div className="text-[10px] font-mono">{material.ultimateTensileStrength ? material.ultimateTensileStrength.toFixed(0) : '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-indigo-50/10 min-w-[42px] w-[42px]">
                              <div className="text-[10px] font-mono">{material.yieldTensileStrength ? material.yieldTensileStrength.toFixed(0) : '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-indigo-50/10 min-w-[42px] w-[42px]">
                              <div className="text-[10px] font-mono">{material.shearingStrength ? material.shearingStrength.toFixed(0) : '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-indigo-50/10 min-w-[46px] w-[46px]">
                              {material.hardness ? (
                                <span className="text-[10px] font-mono" title={material.hardnessSystem || ''}>
                                  {material.hardness.toFixed(0)}
                                  {material.hardnessSystem ? <span className="text-[9px] text-muted-foreground ml-0.5">{material.hardnessSystem.slice(0, 3)}</span> : null}
                                </span>
                              ) : <span className="text-[10px]">-</span>}
                            </TableCell>
                          </>
                        )}

                        {visibleSections.standards && (
                          <>
                            <TableCell className="px-1 py-2 text-center border-l-4 border-violet-400/30 bg-violet-50/20 min-w-[52px] w-[52px]">
                              <div className="text-[10px] truncate" title={material.astmStandard || ''}>{material.astmStandard || '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-violet-50/10 min-w-[46px] w-[46px]">
                              <div className="text-[10px] truncate" title={material.dinStandard || ''}>{material.dinStandard || '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-violet-50/10 min-w-[42px] w-[42px]">
                              <div className="text-[10px] truncate" title={material.enStandard || ''}>{material.enStandard || '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-violet-50/10 min-w-[42px] w-[42px]">
                              <div className="text-[10px] truncate" title={material.jisStandard || ''}>{material.jisStandard || '-'}</div>
                            </TableCell>
                          </>
                        )}

                        {visibleSections.forming && (
                          <>
                            <TableCell className="px-1 py-2 text-center border-l-4 border-amber-400/30 bg-amber-50/20 min-w-[42px] w-[42px]">
                              <div className="text-[10px] font-mono">{material.strengthCoeffKMpa ? material.strengthCoeffKMpa.toFixed(1) : '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-amber-50/10 min-w-[36px] w-[36px]">
                              <div className="text-[10px] font-mono">{material.strainHardeningExponentN ? material.strainHardeningExponentN.toFixed(2) : '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-amber-50/10 min-w-[36px] w-[36px]">
                              <div className="text-[10px] font-mono">{material.lankfordCoefficientR ? material.lankfordCoefficientR.toFixed(2) : '-'}</div>
                            </TableCell>
                            <TableCell className="px-1 py-2 text-center bg-amber-50/10 min-w-[42px] w-[42px]">
                              <div className="text-[10px] font-mono">{material.scrapFactor ? `${(material.scrapFactor * 100).toFixed(1)}%` : '-'}</div>
                            </TableCell>
                          </>
                        )}

                        {(
                          <>
                            <TableCell className="px-1 py-2 min-w-[46px] w-[46px]">
                              {renderShapeDisplay(material)}
                            </TableCell>
                            <TableCell className="px-1 py-2 text-right min-w-[52px] w-[52px]">
                              {material.hardness ? (
                                <span className="text-[10px] font-mono" title={material.hardnessSystem || ''}>
                                  {material.hardness.toFixed(0)}
                                  {material.hardnessSystem ? <span className="text-[9px] text-muted-foreground ml-0.5">{material.hardnessSystem.slice(0, 3)}</span> : null}
                                </span>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="px-1 py-2 min-w-[48px] w-[48px]">
                              {material.regrinding === 'Yes' ? (
                                <Badge variant="default" className="bg-green-600 text-[9px] px-1 py-0 h-4">Yes</Badge>
                              ) : material.regrinding === 'No' ? (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">No</Badge>
                              ) : (
                                <span className="text-[10px]">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right px-1 py-2 text-[10px] min-w-[42px] w-[42px]">
                              {material.regrindingPercentage ? `${material.regrindingPercentage.toFixed(1)}%` : '-'}
                            </TableCell>
                            <TableCell className="text-right px-1 py-2 text-[10px] min-w-[50px] w-[50px]">
                              {material.clampingPressureMpa?.toFixed(1) || '-'}
                            </TableCell>
                            <TableCell className="text-right px-1 py-2 text-[10px] min-w-[50px] w-[50px]">
                              {material.ejectDeflectionTempC?.toFixed(0) || '-'}
                            </TableCell>
                            <TableCell className="text-right px-1 py-2 text-[10px] min-w-[48px] w-[48px]">
                              {material.meltingTempC?.toFixed(0) || '-'}
                            </TableCell>
                            <TableCell className="text-right px-1 py-2 text-[10px] min-w-[46px] w-[46px]">
                              {material.moldTempC?.toFixed(0) || '-'}
                            </TableCell>
                            <TableCell className="text-right px-1 py-2 text-[10px] min-w-[48px] w-[48px]">
                              {(() => {
                                const d = material.densityKgM3 ?? (material.density ? Math.round(material.density * 1000) : null);
                                return d ? String(d) : '-';
                              })()}
                            </TableCell>
                            <TableCell className="text-right px-1 py-2 text-[10px] min-w-[48px] w-[48px]">
                              {material.specificHeatMelt?.toFixed(2) || '-'}
                            </TableCell>
                            <TableCell className="text-right px-1 py-2 text-[10px] min-w-[52px] w-[52px]">
                              {material.thermalConductivityMelt?.toFixed(3) || '-'}
                            </TableCell>
                          </>
                        )}

                        {/* Always Visible - Right Side */}
                        <TableCell className="text-right px-1 py-2 min-w-[62px] w-[62px] max-w-[62px]">
                          <div className="text-[10px] font-mono font-semibold whitespace-nowrap">
                            {renderCostDisplay(material)}
                          </div>
                        </TableCell>
                        <TableCell className="px-1 py-2 text-xs sticky right-0 bg-background z-10 min-w-[56px] w-[56px] border-l border-border">
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditMaterial(material)}
                              className="h-6 w-6 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            >
                              <Pencil className="h-2.5 w-2.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteMaterial(material.id, material.material)}
                              disabled={deleteMutation.isPending}
                              className="h-6 w-6 text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
      </Card>

      {/* Edit Material Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Material</DialogTitle>
            <DialogDescription>
              Update the raw material specifications
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 pt-4">
            {editingMaterial && (
              isFerrousMaterial(editingMaterial.materialGroup) ? (
                <FerrousNonFerrousForm 
                  material={editingMaterial}
                  onMaterialChange={(updatedMaterial) => setEditingMaterial({ ...editingMaterial, ...updatedMaterial })}
                  isEditing={true}
                />
              ) : (
                <div className="space-y-6">
                  {/* Material Identification Section */}
                  <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
                    <h3 className="text-sm font-semibold text-foreground">Material Identification</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Material Group *</label>
                        <Input
                          placeholder="e.g., Plastic & Rubber"
                          value={editingMaterial.materialGroup || ''}
                          onChange={(e) => setEditingMaterial({ ...editingMaterial, materialGroup: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Material *</label>
                        <Input
                          placeholder="e.g., ABS, PC, PE"
                          value={editingMaterial.material || ''}
                          onChange={(e) => setEditingMaterial({ ...editingMaterial, material: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Processing Parameters Section */}
                  <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
                    <h3 className="text-sm font-semibold text-foreground">Processing Parameters</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Country</label>
                        <Select
                          value={editingMaterial.country || ''}
                          onValueChange={(value) => {
                            const country = value as Country;
                            const defaultCurrency = getCurrencyForCountry(country);
                            setEditingMaterial({ 
                              ...editingMaterial, 
                              country,
                              currency: defaultCurrency
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select country" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(COUNTRY_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Shape</label>
                        <Select
                          value={editingMaterial.shape || ''}
                          onValueChange={(value) => setEditingMaterial({ ...editingMaterial, shape: value as MaterialShape })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select shape" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(MATERIAL_SHAPE_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Regrinding</label>
                        <Select
                          value={editingMaterial.regrinding || ''}
                          onValueChange={(value) => setEditingMaterial({ ...editingMaterial, regrinding: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select Yes/No" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Yes">Yes</SelectItem>
                            <SelectItem value="No">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Regrind Percentage (%)</label>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="e.g., 10.0"
                          value={editingMaterial.regrindingPercentage?.toString() || ''}
                          onChange={(e) => {
                            const { regrindingPercentage: _regrindingPercentage, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, regrindingPercentage: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Clamping Pressure (MPa)</label>
                        <Input
                          type="number"
                          step="0.1"
                          placeholder="e.g., 49.4"
                          value={editingMaterial.clampingPressureMpa?.toString() || ''}
                          onChange={(e) => {
                            const { clampingPressureMpa: _clampingPressureMpa, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, clampingPressureMpa: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Eject Deflection Temp (°C)</label>
                        <Input
                          type="number"
                          step="1"
                          placeholder="e.g., 85"
                          value={editingMaterial.ejectDeflectionTempC?.toString() || ''}
                          onChange={(e) => {
                            const { ejectDeflectionTempC: _ejectDeflectionTempC, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, ejectDeflectionTempC: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Melting Temp (°C)</label>
                        <Input
                          type="number"
                          step="1"
                          placeholder="e.g., 240"
                          value={editingMaterial.meltingTempC?.toString() || ''}
                          onChange={(e) => {
                            const { meltingTempC: _meltingTempC, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, meltingTempC: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Mold Temp (°C)</label>
                        <Input
                          type="number"
                          step="1"
                          placeholder="e.g., 70"
                          value={editingMaterial.moldTempC?.toString() || ''}
                          onChange={(e) => {
                            const { moldTempC: _moldTempC, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, moldTempC: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Density (kg/m³)</label>
                        <Input
                          type="number"
                          step="1"
                          placeholder="e.g., 1040"
                          value={editingMaterial.densityKgM3?.toString() || ''}
                          onChange={(e) => {
                            const { densityKgM3: _densityKgM3, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, densityKgM3: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Specific Heat (J/g·°C)</label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="e.g., 1.8"
                          value={editingMaterial.specificHeatMelt?.toString() || ''}
                          onChange={(e) => {
                            const { specificHeatMelt: _specificHeatMelt, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, specificHeatMelt: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Thermal Conductivity (W/m·°C)</label>
                        <Input
                          type="number"
                          step="0.001"
                          placeholder="e.g., 0.127"
                          value={editingMaterial.thermalConductivityMelt?.toString() || ''}
                          onChange={(e) => {
                            const { thermalConductivityMelt: _thermalConductivityMelt, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, thermalConductivityMelt: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Cost Information Section */}
                  <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
                    <h3 className="text-sm font-semibold text-foreground">Cost Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Unit Cost</label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="e.g., 135.00"
                          value={editingMaterial.unitCost?.toString() || ''}
                          onChange={(e) => {
                            const { unitCost: _unitCost, ...rest } = editingMaterial;
                            setEditingMaterial(e.target.value ? { ...rest, unitCost: parseFloat(e.target.value) } : rest);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateMaterial}
                disabled={updateMutation.isPending}
                className="flex-1"
              >
                {updateMutation.isPending ? 'Updating...' : 'Update Material'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}