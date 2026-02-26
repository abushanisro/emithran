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
  Package,
  ArrowLeft
} from 'lucide-react';
import { toast } from 'sonner';
import { bomApi, BOM, BOMItem } from '@/lib/api/bom';
import { useProductionLots } from '@/lib/api/hooks/useProductionPlanning';
import { useCreateQualityInspection } from '@/lib/api/hooks/useQualityControl';
import Link from 'next/link';

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
  const createInspectionMutation = useCreateQualityInspection();

  // Filter production lots to only show those belonging to current project
  const filteredProductionLots = productionLots?.filter(lot => {
    // Check if lot has project association (either direct projectId or via BOM)
    const hasDirectProjectId = lot.projectId === projectId;
    const hasBomProjectId = lot.bom?.projectId === projectId;
    const hasProjectObjectId = lot.project?.id === projectId;
    
    // For now, let's also check if the BOM belongs to this project by checking available BOMs
    // This is a temporary workaround until the backend properly links lots to projects
    const matchesBomFromProject = bomOptions.some(bom => bom.id === lot.bomId);
    
    return hasDirectProjectId || hasBomProjectId || hasProjectObjectId || matchesBomFromProject;
  }) || [];



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
      // Create basic inspection requirements for each selected item
      checklist.push({
        id: `inspection-${item.id}-${index}`,
        category: 'dimensional',
        requirement: `Quality Inspection - ${item.partNumber || item.name}`,
        specification: `Inspection of ${item.description || item.name} per drawing requirements`,
        measurementType: 'measurement',
        criticalLevel: 'major',
        inspectionMethod: 'As Required',
        acceptanceCriteria: 'Per Drawing Specification',
        tools: ['As Required'],
        standardReference: standards.join(', ') || 'Per Engineering Drawing'
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

    if (!customChecklists || customChecklists.length === 0) {
      toast.error('Inspection checklist is required. Please ensure parts are selected to generate the checklist.');
      return;
    }

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

      // Create quality inspection using real API
      console.log('Creating inspection:', inspectionData);

      const apiPayload = {
        name: inspectionName,
        description: inspectionDescription || undefined,
        type: inspectionType,
        projectId: projectId,
        bomId: selectedBOM.id,
        inspector: inspector || undefined,
        plannedDate: plannedDate || undefined,
        selectedItems: selectedItems,
        qualityStandards: selectedStandards,
        checklist: customChecklists,
      };

      console.log('API Payload validation:', {
        name: !!apiPayload.name,
        type: !!apiPayload.type,
        projectId: !!apiPayload.projectId && typeof apiPayload.projectId === 'string',
        bomId: !!apiPayload.bomId && typeof apiPayload.bomId === 'string',
        selectedItems: Array.isArray(apiPayload.selectedItems) && apiPayload.selectedItems.length > 0,
        checklist: Array.isArray(apiPayload.checklist) && apiPayload.checklist.length > 0,
        actualChecklist: apiPayload.checklist
      });

      console.log('Sending API request to create inspection...');
      const newInspection = await createInspectionMutation.mutateAsync(apiPayload);
      console.log('API Response received:', newInspection);

      if (onInspectionCreated) {
        onInspectionCreated(newInspection);
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
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2 bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-800 hover:to-gray-900 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-200">
          <Shield className="h-4 w-4" />
          Create QC Inspection
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Quality Control
            </Button>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Create Quality Control Inspection
            </DialogTitle>
          </div>
          <DialogDescription className="ml-28">
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

              <div className="space-y-2">
                <Label htmlFor="inspection-description">Description</Label>
                <Textarea
                  id="inspection-description"
                  placeholder="Brief description of the inspection purpose and scope"
                  value={inspectionDescription}
                  onChange={(e) => setInspectionDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="inspection-type">Inspection Type</Label>
                  <Select value={inspectionType} onValueChange={setInspectionType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select inspection type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first-article">First Article Inspection</SelectItem>
                      <SelectItem value="in-process">In-Process Inspection</SelectItem>
                      <SelectItem value="final">Final Inspection</SelectItem>
                      <SelectItem value="receiving">Receiving Inspection</SelectItem>
                      <SelectItem value="audit">Quality Audit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="inspector">Inspector</Label>
                  <Input
                    id="inspector"
                    placeholder="Inspector name (optional)"
                    value={inspector}
                    onChange={(e) => setInspector(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="planned-date">Planned Date</Label>
                <Input
                  id="planned-date"
                  type="date"
                  value={plannedDate}
                  onChange={(e) => setPlannedDate(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Production Lot Number *</Label>
                  <Select
                    value={selectedLot}
                    onValueChange={(lotId) => {
                      setSelectedLot(lotId);
                      const lot = filteredProductionLots.find(l => l.id === lotId);
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
                      ) : !filteredProductionLots || filteredProductionLots.length === 0 ? (
                        <div className="p-4 text-center space-y-3">
                          <div className="space-y-1">
                            <p className="text-muted-foreground">No production lots found for this project</p>
                            <p className="text-xs text-muted-foreground">
                              Create production lots in the Production Planning module first to enable quality inspections.
                            </p>
                          </div>
                          <Link 
                            href={`/projects/${projectId}/production-planning`}
                            className="inline-flex items-center gap-2 text-xs text-blue-600 hover:text-blue-800 underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`/projects/${projectId}/production-planning`, '_blank');
                            }}
                          >
                            <Package className="h-3 w-3" />
                            Go to Production Planning
                          </Link>
                        </div>
                      ) : (
                        filteredProductionLots.map((lot) => (
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

                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>

                </div>
              )}
            </CardContent>
          </Card>

          {/* Create Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleCreateInspection}
              disabled={createInspectionMutation.isPending || !inspectionName || !selectedLot || selectedItems.length === 0}
              className="flex items-center gap-2"
            >
              {createInspectionMutation.isPending ? (
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