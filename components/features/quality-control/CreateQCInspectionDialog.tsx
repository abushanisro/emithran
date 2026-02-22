'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { 
  Shield, 
  Search, 
  Eye, 
  Layers, 
  FileText, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  Target,
  Ruler,
  Settings,
  Camera,
  User,
  Calendar,
  Package
} from 'lucide-react';
import { toast } from 'sonner';
import { bomApi, BOM, BOMItem } from '@/lib/api/bom';
import { useProductionLots } from '@/lib/api/hooks/useProductionPlanning';

interface CreateQCInspectionDialogProps {
  projectId: string;
  onInspectionCreated?: (inspection: any) => void;
}

interface InspectionChecklistItem {
  id: string;
  category: 'dimensional' | 'visual' | 'functional' | 'material' | 'surface' | 'performance';
  requirement: string;
  specification: string;
  measurementType: 'pass_fail' | 'measurement' | 'visual' | 'document';
  criticalLevel: 'critical' | 'major' | 'minor';
  inspectionMethod: string;
  acceptanceCriteria: string;
  tools?: string[];
  standardReference?: string;
}

interface QualityStandard {
  id: string;
  name: string;
  category: string;
  requirements: string[];
}

const INDUSTRY_STANDARDS: QualityStandard[] = [
  {
    id: 'iso-9001',
    name: 'ISO 9001:2015',
    category: 'Quality Management',
    requirements: ['Document Control', 'Management Review', 'Internal Audit', 'Corrective Action']
  },
  {
    id: 'as-9100',
    name: 'AS9100D',
    category: 'Aerospace',
    requirements: ['Configuration Management', 'Risk Management', 'First Article Inspection']
  },
  {
    id: 'iso-14001',
    name: 'ISO 14001',
    category: 'Environmental',
    requirements: ['Environmental Impact Assessment', 'Waste Management']
  }
];

const INSPECTION_METHODS = [
  { id: 'visual', name: 'Visual Inspection', tools: ['Magnifying Glass', 'Comparator'] },
  { id: 'dimensional', name: 'Dimensional Measurement', tools: ['Caliper', 'Micrometer', 'CMM', 'Gauge'] },
  { id: 'functional', name: 'Functional Test', tools: ['Test Equipment', 'Fixtures'] },
  { id: 'surface', name: 'Surface Finish', tools: ['Surface Roughness Tester', 'Profilometer'] },
  { id: 'material', name: 'Material Verification', tools: ['Spectrometer', 'Hardness Tester'] },
  { id: 'performance', name: 'Performance Test', tools: ['Load Tester', 'Environmental Chamber'] }
];

const CRITICAL_CHARACTERISTICS = [
  'Safety Critical',
  'Flight Critical', 
  'Function Critical',
  'Fit Critical',
  'Key Characteristic',
  'Major Characteristic',
  'Minor Characteristic'
];

export default function CreateQCInspectionDialog({ projectId, onInspectionCreated }: CreateQCInspectionDialogProps) {
  const [open, setOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState('basic');
  const [inspectionName, setInspectionName] = useState('');
  const [inspectionDescription, setInspectionDescription] = useState('');
  const [inspectionType, setInspectionType] = useState('first-article');
  const [inspector, setInspector] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [bomOptions, setBomOptions] = useState<BOM[]>([]);
  const [selectedBOM, setSelectedBOM] = useState<BOM | null>(null);
  const [selectedLot, setSelectedLot] = useState<string>('');
  const [bomItems, setBomItems] = useState<BOMItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedStandards, setSelectedStandards] = useState<string[]>([]);
  const [customChecklists, setCustomChecklists] = useState<InspectionChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { data: productionLots = [], isLoading: loadingLots, error: lotsError } = useProductionLots({ projectId });
  

  // Load BOMs for the project
  useEffect(() => {
    const loadBOMs = async () => {
      if (!projectId) return;
      try {
        const response = await bomApi.getAll({ projectId });
        setBomOptions(response.boms || []);
      } catch (error: any) {
        console.error('Failed to load BOMs:', error);
        toast.error('Failed to load available BOMs. Please refresh the page and try again.');
      }
    };
    loadBOMs();
  }, [projectId]);

  // Function to load BOM items for a selected lot
  const loadBOMItemsForLot = async (bomId: string) => {
    try {
      const bomWithItems = await bomApi.getById(bomId, true);
      const items = bomWithItems.items || bomWithItems.data?.items || bomWithItems.data || [];
      setBomItems(items);
      setSelectedItems([]);
    } catch (error: any) {
      console.error('Failed to load BOM items:', error);
      toast.error('Failed to load BOM items for the selected lot. Please try selecting a different lot.');
    }
  };


  const generateStandardChecklist = (items: BOMItem[], standards: string[]): InspectionChecklistItem[] => {
    const checklist: InspectionChecklistItem[] = [];
    
    items.forEach((item, index) => {
      // Enhanced dimensional checks with specific measurements
      const dimensionalChecks = [
        'Overall Length', 'Overall Width', 'Overall Height', 'Diameter', 'Thickness',
        'Hole Diameter', 'Thread Pitch', 'Surface Roughness', 'Flatness', 'Parallelism',
        'Perpendicularity', 'Concentricity', 'Roundness', 'Profile', 'Position'
      ];

      dimensionalChecks.forEach((dimension, dimIndex) => {
        checklist.push({
          id: `dim-${item.id}-${dimIndex}`,
          category: 'dimensional',
          requirement: `${dimension} - ${item.partNumber || item.name}`,
          specification: `${dimension} measurement per drawing specification for ${item.description || item.name}`,
          measurementType: 'measurement',
          criticalLevel: dimension.includes('Overall') || dimension.includes('Diameter') ? 'critical' : 'major',
          inspectionMethod: 'Dimensional Measurement',
          acceptanceCriteria: `Within drawing tolerances (±0.05mm for critical, ±0.1mm for major)`,
          tools: dimension.includes('Surface') ? ['Surface Roughness Tester'] : 
                dimension.includes('Thread') ? ['Thread Gauge', 'Pitch Gauge'] :
                ['Caliper', 'Micrometer', 'CMM', 'Height Gauge'],
          standardReference: 'ISO 1101, ASME Y14.5'
        });
      });

      // Visual inspection with detailed criteria
      checklist.push({
        id: `visual-${item.id}`,
        category: 'visual',
        requirement: `Visual Inspection - ${item.partNumber || item.name}`,
        specification: `Complete visual examination of ${item.description || item.name}`,
        measurementType: 'visual',
        criticalLevel: 'major',
        inspectionMethod: 'Visual Inspection',
        acceptanceCriteria: 'No visible defects: scratches, dents, porosity, discoloration, burrs, sharp edges',
        tools: ['Magnifying Glass (10x)', 'Surface Comparator', 'Borescope (if applicable)'],
        standardReference: 'ASME Y14.5, IPC Standards'
      });

      // Surface finish verification
      checklist.push({
        id: `surface-${item.id}`,
        category: 'surface',
        requirement: `Surface Finish - ${item.partNumber || item.name}`,
        specification: `Surface roughness and finish quality for ${item.description || item.name}`,
        measurementType: 'measurement',
        criticalLevel: 'major',
        inspectionMethod: 'Surface Roughness Measurement',
        acceptanceCriteria: 'Ra ≤ 1.6μm (or as specified on drawing)',
        tools: ['Surface Roughness Tester', 'Profilometer'],
        standardReference: 'ISO 4287, ISO 1302'
      });

      // Material verification with enhanced checks
      checklist.push({
        id: `material-${item.id}`,
        category: 'material',
        requirement: `Material Verification - ${item.partNumber || item.name}`,
        specification: `Material compliance and certification for ${item.materialGrade || item.material || 'specified material'}`,
        measurementType: 'document',
        criticalLevel: 'critical',
        inspectionMethod: 'Material Verification & Testing',
        acceptanceCriteria: 'Valid material certificate + hardness test (if req.) + chemical composition (if req.)',
        tools: ['Material Certificate', 'Hardness Tester', 'Spectrometer (if available)'],
        standardReference: 'ASTM Standards, Material Specifications'
      });

      // Functional testing for mechanical parts
      if (item.itemType?.toLowerCase().includes('assembly') || 
          item.description?.toLowerCase().includes('assembly') ||
          item.level === 0) {
        checklist.push({
          id: `func-${item.id}`,
          category: 'functional',
          requirement: `Functional Test - ${item.partNumber || item.name}`,
          specification: `Operational verification and performance test for ${item.description || item.name}`,
          measurementType: 'pass_fail',
          criticalLevel: 'critical',
          inspectionMethod: 'Functional Performance Test',
          acceptanceCriteria: 'Meets all functional requirements: fit, operation, performance as specified',
          tools: ['Test Fixtures', 'Gauges', 'Performance Test Equipment'],
          standardReference: 'Design Specification, Performance Requirements'
        });
      }

      // Marking and identification check
      checklist.push({
        id: `marking-${item.id}`,
        category: 'visual',
        requirement: `Marking & Identification - ${item.partNumber || item.name}`,
        specification: `Part marking, serial numbers, and identification for ${item.description || item.name}`,
        measurementType: 'visual',
        criticalLevel: 'minor',
        inspectionMethod: 'Visual Verification',
        acceptanceCriteria: 'All required markings present, legible, and correctly positioned',
        tools: ['Magnifying Glass', 'Ruler'],
        standardReference: 'Drawing Requirements, Company Standards'
      });
    });

    return checklist;
  };

  const handleItemSelection = (itemId: string, checked: boolean) => {
    const newSelectedItems = checked 
      ? [...selectedItems, itemId] 
      : selectedItems.filter(id => id !== itemId);
    
    setSelectedItems(newSelectedItems);
    
    // Auto-generate checklist when items are selected
    if (newSelectedItems.length > 0) {
      const selectedBOMItems = bomItems.filter(item => newSelectedItems.includes(item.id));
      const generatedChecklist = generateStandardChecklist(selectedBOMItems, selectedStandards);
      setCustomChecklists(generatedChecklist);
    } else {
      setCustomChecklists([]);
    }
  };

  const handleGenerateChecklist = () => {
    const selectedBOMItems = bomItems.filter(item => selectedItems.includes(item.id));
    const generatedChecklist = generateStandardChecklist(selectedBOMItems, selectedStandards);
    setCustomChecklists(generatedChecklist);
    setCurrentTab('checklist');
  };

  const handleCreateInspection = async () => {
    // Enhanced validation with specific error messages
    if (!inspectionName.trim()) {
      toast.error('Inspection name is required. Please enter a descriptive name for your quality inspection.');
      return;
    }

    if (!selectedLot) {
      toast.error('Please select a production lot for inspection. Choose from the available production lots.');
      return;
    }

    if (!selectedBOM) {
      toast.error('BOM information is missing. Please select a valid production lot with an associated BOM.');
      return;
    }

    if (selectedItems.length === 0) {
      toast.error('Please select at least one BOM part for inspection. Use the checkboxes to select parts that need quality control.');
      return;
    }

    setLoading(true);
    try {
      // Get the actual BOM items data for the selected items
      const selectedBOMItems = bomItems.filter(item => selectedItems.includes(item.id));
      
      const inspectionData = {
        name: inspectionName,
        description: inspectionDescription,
        type: inspectionType,
        status: 'planned',
        bomId: selectedBOM.id,
        bomName: selectedBOM.name,
        bomVersion: selectedBOM.version,
        projectId,
        inspector,
        plannedDate,
        selectedItems,
        bomItems: selectedBOMItems, // Include actual BOM item data
        qualityStandards: selectedStandards,
        checklist: customChecklists,
        createdAt: new Date().toISOString(),
      };

      // In a real implementation, this would call the quality inspection API
      console.log('Creating inspection:', inspectionData);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));

      if (onInspectionCreated) {
        onInspectionCreated(inspectionData);
      }

      toast.success('Quality inspection created successfully! Opening report dialog...');
      
      // Reset form
      setInspectionName('');
      setInspectionDescription('');
      setSelectedBOM(null);
      setSelectedLot('');
      setBomItems([]);
      setSelectedItems([]);
      setCustomChecklists([]);
      setSelectedStandards([]);
      setInspector('');
      setPlannedDate('');
      
      // Close dialog
      setOpen(false);
    } catch (error: any) {
      console.error('Failed to create inspection:', error);
      let errorMessage = 'Failed to create quality inspection. Please try again.';
      if (error?.message) {
        if (error.message.includes('permission')) {
          errorMessage = 'You do not have permission to create quality inspections. Please contact your administrator.';
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error occurred while creating inspection. Please check your connection and try again.';
        } else if (error.message.includes('validation')) {
          errorMessage = 'Invalid inspection data. Please check all required fields and try again.';
        } else if (error.message.includes('duplicate')) {
          errorMessage = 'An inspection with this name already exists. Please use a different name.';
        } else {
          errorMessage = `Failed to create inspection: ${error.message}`;
        }
      }
      toast.error(errorMessage, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Create QC Inspection
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Create Quality Control Inspection
          </DialogTitle>
          <DialogDescription>
            Create a comprehensive quality control inspection report for production lots and BOM items
          </DialogDescription>
        </DialogHeader>

        {/* Create Quality Inspection Report Form */}
        <div className="space-y-6">
          {/* Inspection Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Quality Inspection Report
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inspection-name">Inspection Name *</Label>
                <Input
                  id="inspection-name"
                  placeholder="e.g., First Article Inspection - Main Assembly"
                  value={inspectionName}
                  onChange={(e) => setInspectionName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Production Lot Number *</Label>
                  <Select
                    value={selectedLot}
                    onValueChange={(lotId) => {
                      setSelectedLot(lotId);
                      const lot = productionLots.find(l => l.id === lotId);
                      if (lot && lot.bom) {
                        setSelectedBOM({
                          id: lot.bom.id,
                          name: lot.bom.name,
                          version: lot.bom.version
                        });
                        // Use BOM items from the lot data if available
                        if (lot.bom.items && lot.bom.items.length > 0) {
                          setBomItems(lot.bom.items);
                          setSelectedItems([]);
                        } else {
                          // Fallback to loading separately if not in lot data
                          loadBOMItemsForLot(lot.bom.id);
                        }
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select production lot" />
                    </SelectTrigger>
                    <SelectContent>
                      {loadingLots ? (
                        <div className="p-2 text-center text-muted-foreground">Loading lots...</div>
                      ) : lotsError ? (
                        <div className="p-2 text-center text-muted-foreground text-red-500">Error: {lotsError.message}</div>
                      ) : !productionLots || productionLots.length === 0 ? (
                        <div className="p-2 text-center text-muted-foreground">No production lots found</div>
                      ) : (
                        productionLots.map((lot) => (
                          <SelectItem key={lot.id} value={lot.id}>
                            <div className="flex items-center justify-between w-full">
                              <span>{lot.lotNumber}</span>
                              <Badge variant="outline" className="ml-2">
                                {lot.status}
                              </Badge>
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>BOM Name</Label>
                  <Input
                    value={selectedBOM ? `${selectedBOM.name} (v${selectedBOM.version})` : ''}
                    placeholder="Select lot first to see BOM"
                    disabled
                  />
                </div>
              </div>


              {/* Enhanced BOM Parts Selection */}
              {selectedLot && selectedBOM && bomItems.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">BOM Parts for Quality Inspection ({selectedItems.length} of {bomItems.length} selected)</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const allIds = bomItems.map(item => item.id);
                          setSelectedItems(allIds);
                          // Auto-generate checklist for all items
                          const generatedChecklist = generateStandardChecklist(bomItems, selectedStandards);
                          setCustomChecklists(generatedChecklist);
                        }}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedItems([]);
                          setCustomChecklists([]);
                        }}
                      >
                        Clear All
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3 max-h-80 overflow-y-auto">
                    {bomItems.map((item, index) => (
                      <Card key={item.id} className={`p-4 transition-all ${selectedItems.includes(item.id) ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                        <div className="flex items-start space-x-3">
                          <Checkbox
                            checked={selectedItems.includes(item.id)}
                            onCheckedChange={(checked) => handleItemSelection(item.id, !!checked)}
                            className="mt-1"
                          />
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs font-mono">
                                  #{index + 1}
                                </Badge>
                                <span className="font-semibold text-sm">{item.partNumber || item.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {item.itemType}
                                </Badge>
                              </div>
                              <div className="flex gap-1">
                                {(item.file2dPath || item.drawingFile || item.cadFile2D || item.drawing2DFile) && (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => {
                                      const filePath = item.file2dPath || item.drawingFile || item.cadFile2D || item.drawing2DFile;
                                      if (filePath) {
                                        window.open(`${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(filePath)}`, '_blank');
                                      }
                                    }}
                                    className="h-7 px-2"
                                  >
                                    <Eye className="h-3 w-3 mr-1" />
                                    2D Drawing
                                  </Button>
                                )}
                                {(item.file3dPath || item.cadFile || item.cadFile3D || item.model3DFile || item.stepFile) && (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => {
                                      const filePath = item.file3dPath || item.cadFile || item.cadFile3D || item.model3DFile || item.stepFile;
                                      if (filePath) {
                                        window.open(`${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(filePath)}`, '_blank');
                                      }
                                    }}
                                    className="h-7 px-2"
                                  >
                                    <Layers className="h-3 w-3 mr-1" />
                                    3D Model
                                  </Button>
                                )}
                              </div>
                            </div>
                            
                            {item.description && (
                              <div className="text-sm text-muted-foreground">{item.description}</div>
                            )}
                            
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                              <div className="flex items-center gap-1">
                                <span className="font-medium">Qty:</span>
                                <span>{item.quantity} {item.unitOfMeasure || 'pcs'}</span>
                              </div>
                              {(item.materialGrade || item.material) && (
                                <div className="flex items-center gap-1">
                                  <span className="font-medium">Material:</span>
                                  <span className="truncate">{item.materialGrade || item.material}</span>
                                </div>
                              )}
                              {item.unitCost && (
                                <div className="flex items-center gap-1">
                                  <span className="font-medium">Cost:</span>
                                  <span>${item.unitCost.toFixed(2)}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="font-medium">Level:</span>
                                <span>{item.level || 0}</span>
                              </div>
                            </div>
                            
                            {selectedItems.includes(item.id) && (
                              <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
                                <div className="font-medium text-green-800 mb-1">Quality Inspection Plan:</div>
                                <div className="text-green-700">
                                  • 15 Dimensional checks (Length, Width, Height, Diameters, etc.)
                                  • Visual inspection for defects and surface quality
                                  • Surface finish measurement (Ra ≤ 1.6μm)
                                  • Material verification and certification
                                  • Functional testing {item.itemType?.toLowerCase().includes('assembly') ? '(Assembly level)' : ''}
                                  • Marking and identification verification
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                  
                  {customChecklists.length > 0 && (
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-800">Generated Quality Inspection Checklist</span>
                      </div>
                      <div className="text-sm text-blue-700">
                        {customChecklists.length} inspection points generated for {selectedItems.length} selected parts.
                        This includes dimensional measurements, visual inspections, material verification, and functional tests.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Create Button */}
          <div className="flex justify-end">
            <Button 
              onClick={handleCreateInspection}
              disabled={loading || !inspectionName || !selectedLot || selectedItems.length === 0}
              className="flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Clock className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Create Quality Inspection Report
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}