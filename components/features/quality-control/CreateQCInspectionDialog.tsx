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
  const { data: productionLots = [], isLoading: loadingLots, error: lotsError } = useProductionLots();
  

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
      // Dimensional checks
      checklist.push({
        id: `dim-${item.id}`,
        category: 'dimensional',
        requirement: `Dimensional Verification - ${item.partNumber}`,
        specification: `Per Drawing/CAD Model for ${item.description}`,
        measurementType: 'measurement',
        criticalLevel: 'critical',
        inspectionMethod: 'Dimensional Measurement',
        acceptanceCriteria: 'Within drawing tolerances ±0.1mm',
        tools: ['Caliper', 'Micrometer', 'CMM'],
        standardReference: 'ISO 1101'
      });

      // Visual inspection
      checklist.push({
        id: `visual-${item.id}`,
        category: 'visual',
        requirement: `Visual Inspection - ${item.partNumber}`,
        specification: `Surface condition and workmanship for ${item.description}`,
        measurementType: 'visual',
        criticalLevel: 'major',
        inspectionMethod: 'Visual Inspection',
        acceptanceCriteria: 'No visible defects, scratches, or damage',
        tools: ['Magnifying Glass', 'Comparator'],
        standardReference: 'ASME Y14.5'
      });

      // Material verification
      if (item.description.toLowerCase().includes('metal') || 
          item.description.toLowerCase().includes('steel') || 
          item.description.toLowerCase().includes('aluminum')) {
        checklist.push({
          id: `material-${item.id}`,
          category: 'material',
          requirement: `Material Certification - ${item.partNumber}`,
          specification: `Material compliance verification for ${item.description}`,
          measurementType: 'document',
          criticalLevel: 'critical',
          inspectionMethod: 'Material Verification',
          acceptanceCriteria: 'Valid material certificate provided',
          tools: ['Material Certificate', 'Spectrometer'],
          standardReference: 'ASTM Standards'
        });
      }

      // Functional testing for assemblies
      if (item.level === 0 || item.description.toLowerCase().includes('assembly')) {
        checklist.push({
          id: `func-${item.id}`,
          category: 'functional',
          requirement: `Functional Test - ${item.partNumber}`,
          specification: `Operational verification for ${item.description}`,
          measurementType: 'pass_fail',
          criticalLevel: 'critical',
          inspectionMethod: 'Functional Test',
          acceptanceCriteria: 'Meets functional requirements as specified',
          tools: ['Test Equipment', 'Fixtures'],
          standardReference: 'Design Specification'
        });
      }
    });

    return checklist;
  };

  const handleItemSelection = (itemId: string, checked: boolean) => {
    if (checked) {
      setSelectedItems([...selectedItems, itemId]);
    } else {
      setSelectedItems(selectedItems.filter(id => id !== itemId));
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
      const inspectionData = {
        name: inspectionName,
        description: inspectionDescription,
        type: inspectionType,
        status: 'planned',
        bomId: selectedBOM.id,
        projectId,
        inspector,
        plannedDate,
        selectedItems,
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

      setOpen(false);
      // Reset form
      setInspectionName('');
      setInspectionDescription('');
      setSelectedBOM(null);
      setSelectedItems([]);
      setCustomChecklists([]);
      setSelectedStandards([]);
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


              {/* BOM Parts Selection */}
              {selectedLot && selectedBOM && bomItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Select BOM Parts for Inspection ({selectedItems.length} selected)</Label>
                    <div className="space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedItems(bomItems.map(item => item.id))}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedItems([])}
                      >
                        Clear All
                      </Button>
                    </div>
                  </div>
                  
                  <div className="border rounded-lg max-h-64 overflow-y-auto">
                    <div className="p-3 space-y-2">
                      {bomItems.map((item) => (
                        <div key={item.id} className="flex items-center space-x-3 p-2 border rounded hover:bg-muted/50">
                          <Checkbox
                            checked={selectedItems.includes(item.id)}
                            onCheckedChange={(checked) => handleItemSelection(item.id, !!checked)}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{item.partNumber || item.name}</span>
                              {item.partNumber && (
                                <Badge variant="outline" className="text-xs">
                                  {item.partNumber}
                                </Badge>
                              )}
                            </div>
                            {item.description && (
                              <div className="text-xs text-muted-foreground mt-1">{item.description}</div>
                            )}
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                              <span>Type: {item.itemType}</span>
                              {(item.materialGrade || item.material) && <span>Material: {item.materialGrade || item.material}</span>}
                              <span>Qty: {item.quantity} {item.unitOfMeasure || 'pcs'}</span>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            {(item.drawingFile || item.cadFile2D || item.drawing2DFile) && (
                              <Button variant="outline" size="sm">
                                <Eye className="h-3 w-3" />
                                2D
                              </Button>
                            )}
                            {(item.cadFile || item.cadFile3D || item.model3DFile || item.stepFile) && (
                              <Button variant="outline" size="sm">
                                <Layers className="h-3 w-3" />
                                3D
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
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