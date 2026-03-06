'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Upload, Search, ArrowUpDown, Filter, Download, Trash2, AlertTriangle, Pencil, ArrowLeft, Container, BarChart3, FileSpreadsheet } from 'lucide-react';
import {
  useRawMaterials,
  useRawMaterialFilterOptions,
  useUploadRawMaterialsExcel,
  useCreateRawMaterial,
  useUpdateRawMaterial,
  useDeleteRawMaterial,
  useDeleteAllRawMaterials,
  RawMaterial,
} from '@/lib/api/hooks/useRawMaterials';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface User { id: string; email: string; [key: string]: any; }

type MaterialContainer = 'all' | 'plastic-rubber' | 'ferrous';

export default function RawMaterialsPage() {
  const router = useRouter();
  const [activeContainer, setActiveContainer] = useState<MaterialContainer>('all');
  const [search, setSearch] = useState('');
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [filterLocation, setFilterLocation] = useState<string>('all');
  const [filterYear, setFilterYear] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('material');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);
  const [newMaterial, setNewMaterial] = useState({
    materialGroup: '',
    material: '',
    materialAbbreviation: '',
    materialGrade: '',
    stockForm: '',
    matlState: '',
    application: '',
    regrinding: '',
    regrindingPercentage: '',
    clampingPressureMpa: '',
    ejectDeflectionTempC: '',
    meltingTempC: '',
    moldTempC: '',
    densityKgM3: '',
    specificHeatMelt: '',
    thermalConductivityMelt: '',
    location: '',
    year: '',
    q1Cost: '',
    q2Cost: '',
    q3Cost: '',
    q4Cost: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const CONFIRM_DELETE_TEXT = 'delete';

  // Apply container-based filtering
  const getFilteredQuery = () => {
    const baseQuery = {
      search: search || undefined,
      materialGroup: filterGroup !== 'all' ? filterGroup : undefined,
      location: filterLocation !== 'all' ? filterLocation : undefined,
      year: filterYear !== 'all' ? parseInt(filterYear) : undefined,
      sortBy,
      sortOrder,
    };

    // Add container-specific filtering
    if (activeContainer === 'plastic-rubber') {
      return {
        ...baseQuery,
        materialGroup: baseQuery.materialGroup || undefined,
        // Could add specific plastic-rubber filtering here if needed
      };
    } else if (activeContainer === 'ferrous') {
      return {
        ...baseQuery,
        materialGroup: baseQuery.materialGroup || undefined,
        // Could add specific ferrous filtering here if needed
      };
    }

    return baseQuery;
  };

  const { data: rawMaterialsData, isLoading } = useRawMaterials(getFilteredQuery());
  const { data: filterOptions } = useRawMaterialFilterOptions();
  const uploadMutation = useUploadRawMaterialsExcel();
  const createMutation = useCreateRawMaterial();
  const updateMutation = useUpdateRawMaterial();
  const deleteMutation = useDeleteRawMaterial();
  const deleteAllMutation = useDeleteAllRawMaterials();

  const rawMaterials = rawMaterialsData?.items || [];
  const totalCount = rawMaterialsData?.total || 0;

  // Filter materials based on active container
  const getFilteredMaterials = () => {
    if (activeContainer === 'plastic-rubber') {
      return rawMaterials.filter(material => 
        material.materialGroup?.toLowerCase().includes('plastic') ||
        material.materialGroup?.toLowerCase().includes('rubber') ||
        material.materialGroup?.toLowerCase().includes('polymer') ||
        material.materialGroup?.toLowerCase().includes('elastomer')
      );
    } else if (activeContainer === 'ferrous') {
      return rawMaterials.filter(material => 
        material.materialGroup?.toLowerCase().includes('ferrous') ||
        material.materialGroup?.toLowerCase().includes('steel') ||
        material.materialGroup?.toLowerCase().includes('iron') ||
        material.materialGroup?.toLowerCase().includes('metal')
      );
    }
    return rawMaterials;
  };

  const filteredMaterials = getFilteredMaterials();
  const filteredCount = filteredMaterials.length;

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

  const downloadTemplate = (containerType: MaterialContainer = 'all') => {
    const headers = [
      'MaterialGroup',
      'Material',
      'MaterialAbbreviation',
      'MaterialGrade',
      'StockForm',
      'MatlState',
      'Application',
      'Regrinding',
      'Regrinding%',
      'Clamping Pressure (MPa)',
      'Eject Deflection Temp (°C)',
      'Melting Temp (°C)',
      'Mold Temp (°C)',
      'Density (kg / m^3)',
      'Specific Heat of Melt',
      'Thermal Conductivity of Melt',
      'Location',
      'Year',
      'Q1',
      'Q2',
      'Q3',
      'Q4',
    ];

    let sampleRow: string[] = [];
    let fileName = 'raw-materials-template.csv';

    if (containerType === 'plastic-rubber') {
      sampleRow = [
        'Plastic & Rubber',
        'Acrylonitrile Butadiene Styrene',
        'ABS',
        'General Purpose',
        'Pellet',
        'Amorphous',
        'General purpose applications',
        'Yes',
        '10',
        '50.5',
        '80',
        '220',
        '60',
        '1050',
        '2.1',
        '0.18',
        'USA',
        '2024',
        '2.5',
        '2.6',
        '2.7',
        '2.8',
      ];
      fileName = 'plastic-rubber-materials-template.csv';
    } else if (containerType === 'ferrous') {
      sampleRow = [
        'Ferrous Materials',
        'Carbon Steel',
        'CS',
        'AISI 1020',
        'Bar',
        'Solid',
        'Structural applications',
        'No',
        '0',
        '0',
        '0',
        '1538',
        '0',
        '7850',
        '0.49',
        '50',
        'USA',
        '2024',
        '45.5',
        '46.2',
        '47.1',
        '48.0',
      ];
      fileName = 'ferrous-materials-template.csv';
    } else {
      sampleRow = [
        'Plastic & Rubber',
        'Acrylonitrile Butadiene Styrene',
        'ABS',
        'General Purpose',
        'Pellet',
        'Amorphous',
        'General purpose applications',
        'Yes',
        '10',
        '50.5',
        '80',
        '220',
        '60',
        '1050',
        '2.1',
        '0.18',
        'USA',
        '2024',
        '2.5',
        '2.6',
        '2.7',
        '2.8',
      ];
    }

    const csv = [headers.join(','), sampleRow.join(',')].join('\n');
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

    // Set default material group based on active container
    let materialGroup = newMaterial.materialGroup;
    if (activeContainer === 'plastic-rubber' && !materialGroup.toLowerCase().includes('plastic') && !materialGroup.toLowerCase().includes('rubber')) {
      materialGroup = 'Plastic & Rubber';
    } else if (activeContainer === 'ferrous' && !materialGroup.toLowerCase().includes('ferrous') && !materialGroup.toLowerCase().includes('steel') && !materialGroup.toLowerCase().includes('iron')) {
      materialGroup = 'Ferrous Materials';
    }

    const materialData: any = {
      materialGroup,
      material: newMaterial.material,
      materialAbbreviation: newMaterial.materialAbbreviation || undefined,
      materialGrade: newMaterial.materialGrade || undefined,
      stockForm: newMaterial.stockForm || undefined,
      matlState: newMaterial.matlState || undefined,
      application: newMaterial.application || undefined,
      regrinding: newMaterial.regrinding || undefined,
      regrindingPercentage: newMaterial.regrindingPercentage ? parseFloat(newMaterial.regrindingPercentage) : undefined,
      clampingPressureMpa: newMaterial.clampingPressureMpa ? parseFloat(newMaterial.clampingPressureMpa) : undefined,
      ejectDeflectionTempC: newMaterial.ejectDeflectionTempC ? parseFloat(newMaterial.ejectDeflectionTempC) : undefined,
      meltingTempC: newMaterial.meltingTempC ? parseFloat(newMaterial.meltingTempC) : undefined,
      moldTempC: newMaterial.moldTempC ? parseFloat(newMaterial.moldTempC) : undefined,
      densityKgM3: newMaterial.densityKgM3 ? parseFloat(newMaterial.densityKgM3) : undefined,
      specificHeatMelt: newMaterial.specificHeatMelt ? parseFloat(newMaterial.specificHeatMelt) : undefined,
      thermalConductivityMelt: newMaterial.thermalConductivityMelt ? parseFloat(newMaterial.thermalConductivityMelt) : undefined,
      location: newMaterial.location || undefined,
      year: newMaterial.year ? parseInt(newMaterial.year) : undefined,
      q1Cost: newMaterial.q1Cost ? parseFloat(newMaterial.q1Cost) : undefined,
      q2Cost: newMaterial.q2Cost ? parseFloat(newMaterial.q2Cost) : undefined,
      q3Cost: newMaterial.q3Cost ? parseFloat(newMaterial.q3Cost) : undefined,
      q4Cost: newMaterial.q4Cost ? parseFloat(newMaterial.q4Cost) : undefined,
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
      materialGroup: activeContainer === 'plastic-rubber' ? 'Plastic & Rubber' : activeContainer === 'ferrous' ? 'Ferrous Materials' : '',
      material: '',
      materialAbbreviation: '',
      materialGrade: '',
      stockForm: '',
      matlState: '',
      application: '',
      regrinding: '',
      regrindingPercentage: '',
      clampingPressureMpa: '',
      ejectDeflectionTempC: '',
      meltingTempC: '',
      moldTempC: '',
      densityKgM3: '',
      specificHeatMelt: '',
      thermalConductivityMelt: '',
      location: '',
      year: '',
      q1Cost: '',
      q2Cost: '',
      q3Cost: '',
      q4Cost: '',
    });
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
    setEditingMaterial(material);
    setNewMaterial({
      materialGroup: material.materialGroup || '',
      material: material.material || '',
      materialAbbreviation: material.materialAbbreviation || '',
      materialGrade: material.materialGrade || '',
      stockForm: material.stockForm || '',
      matlState: material.matlState || '',
      application: material.application || '',
      regrinding: material.regrinding || '',
      regrindingPercentage: material.regrindingPercentage?.toString() || '',
      clampingPressureMpa: material.clampingPressureMpa?.toString() || '',
      ejectDeflectionTempC: material.ejectDeflectionTempC?.toString() || '',
      meltingTempC: material.meltingTempC?.toString() || '',
      moldTempC: material.moldTempC?.toString() || '',
      densityKgM3: material.densityKgM3?.toString() || '',
      specificHeatMelt: material.specificHeatMelt?.toString() || '',
      thermalConductivityMelt: material.thermalConductivityMelt?.toString() || '',
      location: material.location || '',
      year: material.year?.toString() || '',
      q1Cost: material.q1Cost?.toString() || '',
      q2Cost: material.q2Cost?.toString() || '',
      q3Cost: material.q3Cost?.toString() || '',
      q4Cost: material.q4Cost?.toString() || '',
    });
    setEditDialogOpen(true);
  };

  const handleUpdateMaterial = () => {
    if (!editingMaterial) return;
    if (!newMaterial.materialGroup || !newMaterial.material) {
      toast.error('Material Group and Material name are required');
      return;
    }

    const materialData: any = {
      materialGroup: newMaterial.materialGroup,
      material: newMaterial.material,
      materialAbbreviation: newMaterial.materialAbbreviation || undefined,
      materialGrade: newMaterial.materialGrade || undefined,
      stockForm: newMaterial.stockForm || undefined,
      matlState: newMaterial.matlState || undefined,
      application: newMaterial.application || undefined,
      regrinding: newMaterial.regrinding || undefined,
      regrindingPercentage: newMaterial.regrindingPercentage ? parseFloat(newMaterial.regrindingPercentage) : undefined,
      clampingPressureMpa: newMaterial.clampingPressureMpa ? parseFloat(newMaterial.clampingPressureMpa) : undefined,
      ejectDeflectionTempC: newMaterial.ejectDeflectionTempC ? parseFloat(newMaterial.ejectDeflectionTempC) : undefined,
      meltingTempC: newMaterial.meltingTempC ? parseFloat(newMaterial.meltingTempC) : undefined,
      moldTempC: newMaterial.moldTempC ? parseFloat(newMaterial.moldTempC) : undefined,
      densityKgM3: newMaterial.densityKgM3 ? parseFloat(newMaterial.densityKgM3) : undefined,
      specificHeatMelt: newMaterial.specificHeatMelt ? parseFloat(newMaterial.specificHeatMelt) : undefined,
      thermalConductivityMelt: newMaterial.thermalConductivityMelt ? parseFloat(newMaterial.thermalConductivityMelt) : undefined,
      location: newMaterial.location || undefined,
      year: newMaterial.year ? parseInt(newMaterial.year) : undefined,
      q1Cost: newMaterial.q1Cost ? parseFloat(newMaterial.q1Cost) : undefined,
      q2Cost: newMaterial.q2Cost ? parseFloat(newMaterial.q2Cost) : undefined,
      q3Cost: newMaterial.q3Cost ? parseFloat(newMaterial.q3Cost) : undefined,
      q4Cost: newMaterial.q4Cost ? parseFloat(newMaterial.q4Cost) : undefined,
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
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return <ArrowUpDown className={`h-3 w-3 ml-1 ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />;
  };

  const getContainerStats = () => {
    const plasticRubberCount = rawMaterials.filter(material => 
      material.materialGroup?.toLowerCase().includes('plastic') ||
      material.materialGroup?.toLowerCase().includes('rubber') ||
      material.materialGroup?.toLowerCase().includes('polymer') ||
      material.materialGroup?.toLowerCase().includes('elastomer')
    ).length;

    const ferrousCount = rawMaterials.filter(material => 
      material.materialGroup?.toLowerCase().includes('ferrous') ||
      material.materialGroup?.toLowerCase().includes('steel') ||
      material.materialGroup?.toLowerCase().includes('iron') ||
      material.materialGroup?.toLowerCase().includes('metal')
    ).length;

    return { plasticRubberCount, ferrousCount };
  };

  const { plasticRubberCount, ferrousCount } = getContainerStats();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Raw Materials Database"
        description="Material properties and cost data for injection molding process"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setUploadDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Excel
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Material
          </Button>
        </div>
      </PageHeader>

      {/* Material Container Tabs */}
      <Tabs value={activeContainer} onValueChange={(value) => setActiveContainer(value as MaterialContainer)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            All Materials ({totalCount})
          </TabsTrigger>
          <TabsTrigger value="plastic-rubber" className="flex items-center gap-2">
            <Container className="h-4 w-4" />
            Plastic & Rubber ({plasticRubberCount})
          </TabsTrigger>
          <TabsTrigger value="ferrous" className="flex items-center gap-2">
            <Container className="h-4 w-4" />
            Ferrous Materials ({ferrousCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Container className="h-5 w-5 text-blue-600" />
                  Plastic & Rubber Container
                </CardTitle>
                <CardDescription>
                  Thermoplastics, thermosets, elastomers, and composites
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Materials</span>
                    <Badge variant="secondary">{plasticRubberCount}</Badge>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setActiveContainer('plastic-rubber')}
                    className="w-full"
                  >
                    View Container
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Container className="h-5 w-5 text-orange-600" />
                  Ferrous Materials Container
                </CardTitle>
                <CardDescription>
                  Steel, cast iron, and ferrous alloys
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Materials</span>
                    <Badge variant="secondary">{ferrousCount}</Badge>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setActiveContainer('ferrous')}
                    className="w-full"
                  >
                    View Container
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="plastic-rubber" className="space-y-6">
          <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-900">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Container className="h-5 w-5 text-blue-600" />
                Plastic & Rubber Materials Container
              </CardTitle>
              <CardDescription>
                Specialized container for thermoplastic and rubber-based materials including polymers, elastomers, and composites.
                Optimized for injection molding process parameters.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{plasticRubberCount}</div>
                  <div className="text-xs text-muted-foreground">Materials</div>
                </div>
                <div className="text-center">
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate('plastic-rubber')}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Template
                  </Button>
                </div>
                <div className="text-center">
                  <Button variant="outline" size="sm" onClick={() => { setCreateDialogOpen(true); resetNewMaterial(); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Material
                  </Button>
                </div>
                <div className="text-center">
                  <Button variant="outline" size="sm" onClick={() => setUploadDialogOpen(true)}>
                    <Upload className="h-4 w-4 mr-2" />
                    Import Excel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ferrous" className="space-y-6">
          <Card className="border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 dark:border-orange-900">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Container className="h-5 w-5 text-orange-600" />
                Ferrous Materials Container
              </CardTitle>
              <CardDescription>
                Specialized container for iron-based materials including carbon steel, alloy steel, stainless steel, and cast iron.
                Supports import from existing Excel databases.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{ferrousCount}</div>
                  <div className="text-xs text-muted-foreground">Materials</div>
                </div>
                <div className="text-center">
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate('ferrous')}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Template
                  </Button>
                </div>
                <div className="text-center">
                  <Button variant="outline" size="sm" onClick={() => { setCreateDialogOpen(true); resetNewMaterial(); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Material
                  </Button>
                </div>
                <div className="text-center">
                  <Button variant="outline" size="sm" onClick={() => setUploadDialogOpen(true)}>
                    <Upload className="h-4 w-4 mr-2" />
                    Import Excel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Materials from Excel</DialogTitle>
            <DialogDescription>
              Select an Excel file (.xlsx, .xls) or CSV file containing raw material data to import
              {activeContainer !== 'all' && (
                <span className="block mt-1 text-sm font-medium">
                  Uploading to: {activeContainer === 'plastic-rubber' ? 'Plastic & Rubber Container' : 'Ferrous Materials Container'}
                </span>
              )}
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
                onClick={() => downloadTemplate(activeContainer)}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template CSV
                {activeContainer !== 'all' && (
                  <span className="ml-1">({activeContainer === 'plastic-rubber' ? 'Plastic/Rubber' : 'Ferrous'})</span>
                )}
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
              {activeContainer !== 'all' && (
                <span className="block mt-1 text-sm font-medium">
                  Adding to: {activeContainer === 'plastic-rubber' ? 'Plastic & Rubber Container' : 'Ferrous Materials Container'}
                </span>
              )}
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
                    placeholder="e.g., Plastic & Rubber"
                    value={newMaterial.materialGroup}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialGroup: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Material *</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., Acrylonitrile Butadiene Styrene"
                    value={newMaterial.material}
                    onChange={(e) => setNewMaterial({ ...newMaterial, material: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Abbreviation</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., ABS"
                    value={newMaterial.materialAbbreviation}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialAbbreviation: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Grade</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., General Purpose"
                    value={newMaterial.materialGrade}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialGrade: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Material Properties Section */}
            <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
              <h3 className="text-sm font-semibold text-foreground">Material Properties</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Stock Form</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., Pellet, Granules"
                    value={newMaterial.stockForm}
                    onChange={(e) => setNewMaterial({ ...newMaterial, stockForm: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Material State</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., Amorphous, Semi-Crystalline"
                    value={newMaterial.matlState}
                    onChange={(e) => setNewMaterial({ ...newMaterial, matlState: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">Application</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., General purpose applications"
                    value={newMaterial.application}
                    onChange={(e) => setNewMaterial({ ...newMaterial, application: e.target.value })}
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
                  <label className="text-sm font-medium">Location</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., USA, India, China"
                    value={newMaterial.location}
                    onChange={(e) => setNewMaterial({ ...newMaterial, location: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Cost Data Section */}
            <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
              <h3 className="text-sm font-semibold text-foreground">Cost Data</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Year</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    placeholder="e.g., 2024"
                    value={newMaterial.year}
                    onChange={(e) => setNewMaterial({ ...newMaterial, year: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Q1 Cost (₹)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.5"
                    value={newMaterial.q1Cost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, q1Cost: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Q2 Cost (₹)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.6"
                    value={newMaterial.q2Cost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, q2Cost: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Q3 Cost (₹)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.7"
                    value={newMaterial.q3Cost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, q3Cost: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Q4 Cost (₹)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.8"
                    value={newMaterial.q4Cost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, q4Cost: e.target.value })}
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

      {/* Edit Material Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Material</DialogTitle>
            <DialogDescription>
              Update the raw material specifications
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
                    placeholder="e.g., Plastic & Rubber"
                    value={newMaterial.materialGroup}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialGroup: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Material *</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., Acrylonitrile Butadiene Styrene"
                    value={newMaterial.material}
                    onChange={(e) => setNewMaterial({ ...newMaterial, material: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Abbreviation</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., ABS"
                    value={newMaterial.materialAbbreviation}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialAbbreviation: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Grade</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., General Purpose"
                    value={newMaterial.materialGrade}
                    onChange={(e) => setNewMaterial({ ...newMaterial, materialGrade: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Material Properties Section */}
            <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
              <h3 className="text-sm font-semibold text-foreground">Material Properties</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Stock Form</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., Pellet, Granules"
                    value={newMaterial.stockForm}
                    onChange={(e) => setNewMaterial({ ...newMaterial, stockForm: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Material State</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., Amorphous, Semi-Crystalline"
                    value={newMaterial.matlState}
                    onChange={(e) => setNewMaterial({ ...newMaterial, matlState: e.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">Application</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., General purpose applications"
                    value={newMaterial.application}
                    onChange={(e) => setNewMaterial({ ...newMaterial, application: e.target.value })}
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
                  <label className="text-sm font-medium">Location</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="e.g., USA, India, China"
                    value={newMaterial.location}
                    onChange={(e) => setNewMaterial({ ...newMaterial, location: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Cost Data Section */}
            <div className="space-y-4 p-4 bg-secondary/30 rounded-lg">
              <h3 className="text-sm font-semibold text-foreground">Cost Data</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Year</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    placeholder="e.g., 2024"
                    value={newMaterial.year}
                    onChange={(e) => setNewMaterial({ ...newMaterial, year: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Q1 Cost (₹)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.5"
                    value={newMaterial.q1Cost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, q1Cost: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Q2 Cost (₹)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.6"
                    value={newMaterial.q2Cost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, q2Cost: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Q3 Cost (₹)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.7"
                    value={newMaterial.q3Cost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, q3Cost: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Q4 Cost (₹)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 2.8"
                    value={newMaterial.q4Cost}
                    onChange={(e) => setNewMaterial({ ...newMaterial, q4Cost: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex gap-2 sticky bottom-0 bg-background pt-4 border-t">
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

      {/* Material Filters */}
      <Card className="p-3">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Material Filters</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setFilterGroup('all');
              }}
            >
              Clear
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                Search Materials
              </Label>
              <Input
                placeholder="Search by name, abbreviation, grade..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Material Group
              </Label>
              <Select value={filterGroup} onValueChange={setFilterGroup}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  {filterOptions?.materialGroups.map((group) => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Card>

      {/* Location & Cost Filters */}
      <Card className="p-3 bg-secondary/30">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Location & Cost Filters</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterLocation('all');
                setFilterYear('all');
              }}
            >
              Clear
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={filterLocation} onValueChange={setFilterLocation}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {filterOptions?.locations.filter(Boolean).map((location) => (
                    <SelectItem key={location} value={location!}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cost Year</Label>
              <Select value={filterYear} onValueChange={setFilterYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {filterOptions?.years.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Card>

      {/* Results Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {filteredCount} of {totalCount} materials
          {activeContainer !== 'all' && (
            <span className="ml-1">
              in {activeContainer === 'plastic-rubber' ? 'Plastic & Rubber' : 'Ferrous Materials'} container
            </span>
          )}
        </p>
      </div>

      {/* Data Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-card hover:bg-card">
                <TableHead className="cursor-pointer h-9 px-2 text-xs" onClick={() => toggleSort('material_group')}>
                  <div className="flex items-center font-semibold">
                    Group
                    <SortIcon column="material_group" />
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer h-9 px-2 text-xs" onClick={() => toggleSort('material')}>
                  <div className="flex items-center font-semibold">
                    Material
                    <SortIcon column="material" />
                  </div>
                </TableHead>
                <TableHead className="h-9 px-2 text-xs">Abbr</TableHead>
                <TableHead className="h-9 px-2 text-xs">Grade</TableHead>
                <TableHead className="h-9 px-2 text-xs">Stock Form</TableHead>
                <TableHead className="h-9 px-2 text-xs">State</TableHead>
                <TableHead className="h-9 px-2 text-xs">Application</TableHead>
                <TableHead className="h-9 px-2 text-xs">Regrind</TableHead>
                <TableHead className="text-right h-9 px-2 text-xs">Density</TableHead>
                <TableHead className="h-9 px-2 text-xs">Location</TableHead>
                <TableHead className="h-9 px-2 text-xs">Year</TableHead>
                <TableHead className="text-right h-9 px-2 text-xs">Q1</TableHead>
                <TableHead className="text-right h-9 px-2 text-xs">Q2</TableHead>
                <TableHead className="text-right h-9 px-2 text-xs">Q3</TableHead>
                <TableHead className="text-right h-9 px-2 text-xs">Q4</TableHead>
                <TableHead className="w-20 h-9 px-2 text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={16} className="text-center py-8 text-muted-foreground">
                    Loading materials...
                  </TableCell>
                </TableRow>
              ) : filteredMaterials.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} className="text-center py-8 text-muted-foreground">
                    {activeContainer !== 'all' 
                      ? `No materials found in ${activeContainer === 'plastic-rubber' ? 'Plastic & Rubber' : 'Ferrous Materials'} container. Upload an Excel file to get started.`
                      : 'No materials found. Upload an Excel file to get started.'
                    }
                  </TableCell>
                </TableRow>
              ) : (
                filteredMaterials.map((material) => (
                  <TableRow key={material.id} className="hover:bg-secondary/30">
                    <TableCell className="font-medium p-2 text-xs">
                      <Badge 
                        variant="outline" 
                        className={`text-[10px] px-1 py-0 h-5 ${
                          material.materialGroup?.toLowerCase().includes('plastic') || 
                          material.materialGroup?.toLowerCase().includes('rubber') 
                            ? 'border-blue-500 text-blue-700' 
                            : 'border-orange-500 text-orange-700'
                        }`}
                      >
                        {material.materialGroup}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium p-2 text-xs truncate max-w-[120px]" title={material.material}>
                      {material.material}
                    </TableCell>
                    <TableCell className="text-muted-foreground p-2 text-xs">
                      {material.materialAbbreviation || '-'}
                    </TableCell>
                    <TableCell className="p-2 text-xs truncate max-w-[100px]" title={material.materialGrade || ''}>
                      {material.materialGrade || '-'}
                    </TableCell>
                    <TableCell className="p-2 text-xs">{material.stockForm || '-'}</TableCell>
                    <TableCell className="p-2 text-xs">{material.matlState || '-'}</TableCell>
                    <TableCell className="max-w-[100px] truncate p-2 text-xs" title={material.application || ''}>
                      {material.application || '-'}
                    </TableCell>
                    <TableCell className="p-2 text-xs">
                      {material.regrinding === 'Yes' ? (
                        <Badge variant="default" className="bg-green-600 text-[10px] px-1 py-0 h-5">Yes</Badge>
                      ) : material.regrinding === 'No' ? (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-5">No</Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-right p-2 text-xs">
                      {material.densityKgM3?.toFixed(0) || '-'}
                    </TableCell>
                    <TableCell className="p-2 text-xs">{material.location || '-'}</TableCell>
                    <TableCell className="p-2 text-xs">{material.year || '-'}</TableCell>
                    <TableCell className="text-right p-2 text-xs">
                      {material.q1Cost ? `₹${material.q1Cost.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-right p-2 text-xs">
                      {material.q2Cost ? `₹${material.q2Cost.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-right p-2 text-xs">
                      {material.q3Cost ? `₹${material.q3Cost.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-right p-2 text-xs">
                      {material.q4Cost ? `₹${material.q4Cost.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="p-2 text-xs">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditMaterial(material)}
                          className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteMaterial(material.id, material.material)}
                          disabled={deleteMutation.isPending}
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}