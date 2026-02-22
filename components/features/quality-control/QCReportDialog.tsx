'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { 
  Shield, 
  Eye, 
  Layers, 
  FileText, 
  CheckCircle, 
  XCircle,
  AlertTriangle,
  Camera,
  User,
  Calendar,
  Package,
  Ruler,
  Target,
  Save,
  Send
} from 'lucide-react';
import { toast } from 'sonner';

interface QCReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspection: any;
  onInspectionCompleted?: (completedInspection: any) => void;
}

interface InspectionResult {
  itemId: string;
  checkId: string;
  status: 'pass' | 'fail' | 'na';
  measurement?: string;
  notes?: string;
  images?: string[];
  inspector?: string;
  inspectionDate?: string;
}

export default function QCReportDialog({ open, onOpenChange, inspection, onInspectionCompleted }: QCReportDialogProps) {
  const [reportStatus, setReportStatus] = useState<'draft' | 'in_progress' | 'completed'>('draft');
  const [inspector, setInspector] = useState('');
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().split('T')[0]);
  const [overallResult, setOverallResult] = useState<'pass' | 'fail' | 'conditional'>('pass');
  const [generalNotes, setGeneralNotes] = useState('');
  const [inspectionResults, setInspectionResults] = useState<InspectionResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Debug logging
  console.log('QCReportDialog render:', { open, inspection: !!inspection });

  // Initialize inspection results when dialog opens
  useEffect(() => {
    if (open && inspection) {
      // Create initial results for each selected BOM item and generated checklist
      const initialResults: InspectionResult[] = [];
      
      if (inspection.selectedItems && inspection.checklist) {
        inspection.checklist.forEach((check: any) => {
          // Find which BOM item this check belongs to
          const itemId = inspection.selectedItems.find((id: string) => 
            check.id.includes(id) || check.requirement.includes(id)
          ) || inspection.selectedItems[0]; // fallback to first item
          
          initialResults.push({
            itemId: itemId,
            checkId: check.id,
            status: 'na',
            measurement: '',
            notes: '',
            images: [],
            inspector: '',
            inspectionDate: inspectionDate
          });
        });
      }
      
      setInspectionResults(initialResults);
      setReportStatus('draft');
      setInspector('');
      setGeneralNotes('');
      setOverallResult('pass');
    }
  }, [open, inspection, inspectionDate]);

  const updateInspectionResult = (itemId: string, checkId: string, field: keyof InspectionResult, value: any) => {
    setInspectionResults(prev => 
      prev.map(result => 
        result.itemId === itemId && result.checkId === checkId
          ? { ...result, [field]: value }
          : result
      )
    );
  };

  const calculateOverallStatus = () => {
    const failedItems = inspectionResults.filter(result => result.status === 'fail').length;
    const totalItems = inspectionResults.length;
    
    if (failedItems === 0) return 'pass';
    if (failedItems < totalItems * 0.1) return 'conditional'; // Less than 10% failed
    return 'fail';
  };

  const handleSaveReport = async (submitFinal: boolean = false) => {
    if (!inspector.trim()) {
      toast.error('Please enter the inspector name');
      return;
    }

    setLoading(true);
    try {
      const reportData = {
        inspectionId: inspection.id || 'temp-' + Date.now(),
        projectId: inspection.projectId,
        bomId: inspection.bomId,
        lotId: inspection.selectedLot,
        inspector,
        inspectionDate,
        status: submitFinal ? 'completed' : 'draft',
        overallResult: submitFinal ? calculateOverallStatus() : overallResult,
        generalNotes,
        results: inspectionResults,
        submittedAt: submitFinal ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
      };

      // Simulate API call
      console.log('Saving QC report:', reportData);
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (submitFinal) {
        toast.success('Quality inspection report submitted successfully!');
        onOpenChange(false);
      } else {
        toast.success('Report draft saved successfully!');
        setReportStatus('draft');
      }
      
    } catch (error) {
      console.error('Failed to save report:', error);
      toast.error('Failed to save report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!inspection) return null;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'fail': return <XCircle className="h-4 w-4 text-red-600" />;
      case 'conditional': return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      default: return <Target className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pass': return 'bg-green-100 text-green-800 border-green-200';
      case 'fail': return 'bg-red-100 text-red-800 border-red-200';
      case 'conditional': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto z-50 border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Quality Control Inspection Report
          </DialogTitle>
          <DialogDescription>
            Complete the quality inspection for {inspection?.name || 'Unknown'} - Record measurements, observations, and final results
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Part Files Display */}
          {inspection?.selectedItems && inspection.selectedItems.length > 0 && (
            <Card className="border-l-4 border-l-blue-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Part Files & Documentation
                </CardTitle>
                <CardDescription>
                  2D drawings and 3D models for selected BOM parts - Click to view during inspection
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {inspection.selectedItems.map((itemId: string) => {
                    // Find the BOM item details from the inspection data
                    const bomItem = inspection.bomItems?.find((item: any) => item.id === itemId);
                    if (!bomItem) return null;
                    
                    return (
                      <div key={itemId} className="p-4 border rounded-lg bg-muted/20">
                        <div className="flex items-center gap-2 mb-3">
                          <Badge variant="outline" className="text-xs font-mono">
                            {bomItem.partNumber || bomItem.name}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {bomItem.itemType}
                          </Badge>
                        </div>
                        
                        <div className="text-sm text-muted-foreground mb-3 line-clamp-2">
                          {bomItem.description || bomItem.name}
                        </div>
                        
                        <div className="flex gap-2">
                          {(bomItem.file2dPath || bomItem.drawingFile || bomItem.cadFile2D || bomItem.drawing2DFile) && (
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                const filePath = bomItem.file2dPath || bomItem.drawingFile || bomItem.cadFile2D || bomItem.drawing2DFile;
                                if (filePath) {
                                  window.open(`${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(filePath)}`, '_blank');
                                }
                              }}
                              className="flex-1 h-8"
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              2D Drawing
                            </Button>
                          )}
                          {(bomItem.file3dPath || bomItem.cadFile || bomItem.cadFile3D || bomItem.model3DFile || bomItem.stepFile) && (
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                const filePath = bomItem.file3dPath || bomItem.cadFile || bomItem.cadFile3D || bomItem.model3DFile || bomItem.stepFile;
                                if (filePath) {
                                  window.open(`${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(filePath)}`, '_blank');
                                }
                              }}
                              className="flex-1 h-8"
                            >
                              <Layers className="h-3 w-3 mr-1" />
                              3D Model
                            </Button>
                          )}
                        </div>
                        
                        {bomItem.materialGrade || bomItem.material ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            <span className="font-medium">Material:</span> {bomItem.materialGrade || bomItem.material}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Report Header */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Inspection Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Inspection Name</Label>
                <Input value={inspection.name} disabled />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Input value={inspection.type || 'First Article'} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inspector">Inspector *</Label>
                <Input
                  id="inspector"
                  placeholder="Enter inspector name"
                  value={inspector}
                  onChange={(e) => setInspector(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inspection-date">Inspection Date *</Label>
                <Input
                  id="inspection-date"
                  type="date"
                  value={inspectionDate}
                  onChange={(e) => setInspectionDate(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Inspection Checklist */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Quality Inspection Checklist
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inspection.checklist && inspection.checklist.length > 0 ? (
                <div className="space-y-4">
                  {inspection.checklist.map((checkItem: any, index: number) => {
                    const result = inspectionResults.find(r => r.checkId === checkItem.id);
                    
                    // Find the corresponding BOM item for this check
                    const bomItem = inspection.bomItems?.find((item: any) => 
                      checkItem.id.includes(item.id) || checkItem.requirement.includes(item.partNumber || item.name)
                    );
                    
                    return (
                      <div key={checkItem.id} className="p-4 border rounded-lg bg-muted/20">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">
                                {checkItem.category?.toUpperCase() || 'GENERAL'}
                              </Badge>
                              <Badge 
                                variant={checkItem.criticalLevel === 'critical' ? 'destructive' : 'secondary'}
                                className="text-xs"
                              >
                                {checkItem.criticalLevel?.toUpperCase() || 'NORMAL'}
                              </Badge>
                              {bomItem && (
                                <Badge variant="secondary" className="text-xs font-mono">
                                  {bomItem.partNumber || bomItem.name}
                                </Badge>
                              )}
                            </div>
                            <h4 className="font-medium text-sm">{checkItem.requirement}</h4>
                            <p className="text-xs text-muted-foreground mt-1">{checkItem.specification}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span>Method: {checkItem.inspectionMethod}</span>
                              <span>Tools: {checkItem.tools?.join(', ') || 'Visual'}</span>
                              {checkItem.standardReference && (
                                <span>Ref: {checkItem.standardReference}</span>
                              )}
                            </div>
                            {bomItem && bomItem.materialGrade && (
                              <div className="mt-1 text-xs text-blue-600">
                                Material: {bomItem.materialGrade}
                              </div>
                            )}
                          </div>
                          {/* Quick access to part files */}
                          {bomItem && (
                            <div className="flex gap-1 ml-2">
                              {(bomItem.file2dPath || bomItem.drawingFile) && (
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => {
                                    const filePath = bomItem.file2dPath || bomItem.drawingFile;
                                    if (filePath) {
                                      window.open(`${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(filePath)}`, '_blank');
                                    }
                                  }}
                                  className="h-6 px-2"
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              {(bomItem.file3dPath || bomItem.cadFile) && (
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => {
                                    const filePath = bomItem.file3dPath || bomItem.cadFile;
                                    if (filePath) {
                                      window.open(`${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(filePath)}`, '_blank');
                                    }
                                  }}
                                  className="h-6 px-2"
                                >
                                  <Layers className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
                          {/* Status Selection */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium">Result *</Label>
                            <RadioGroup
                              value={result?.status || 'na'}
                              onValueChange={(value) => 
                                updateInspectionResult(checkItem.itemId || 'unknown', checkItem.id, 'status', value as 'pass' | 'fail' | 'na')
                              }
                              className="flex gap-4"
                            >
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="pass" id={`pass-${checkItem.id}`} />
                                <Label htmlFor={`pass-${checkItem.id}`} className="text-xs text-green-700">Pass</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="fail" id={`fail-${checkItem.id}`} />
                                <Label htmlFor={`fail-${checkItem.id}`} className="text-xs text-red-700">Fail</Label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <RadioGroupItem value="na" id={`na-${checkItem.id}`} />
                                <Label htmlFor={`na-${checkItem.id}`} className="text-xs text-gray-600">N/A</Label>
                              </div>
                            </RadioGroup>
                          </div>

                          {/* Measurement Input (if applicable) */}
                          {checkItem.measurementType === 'measurement' && (
                            <div className="space-y-2">
                              <Label className="text-xs font-medium">Measurement</Label>
                              <Input
                                placeholder="Enter measurement"
                                value={result?.measurement || ''}
                                onChange={(e) => 
                                  updateInspectionResult(checkItem.itemId || 'unknown', checkItem.id, 'measurement', e.target.value)
                                }
                                className="text-xs"
                              />
                              <p className="text-xs text-muted-foreground">
                                Criteria: {checkItem.acceptanceCriteria}
                              </p>
                            </div>
                          )}

                          {/* Notes */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium">Notes</Label>
                            <Textarea
                              placeholder="Add inspection notes..."
                              rows={2}
                              value={result?.notes || ''}
                              onChange={(e) => 
                                updateInspectionResult(checkItem.itemId || 'unknown', checkItem.id, 'notes', e.target.value)
                              }
                              className="text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No inspection checklist generated.</p>
                  <p className="text-sm">The inspection was created without a detailed checklist.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Overall Assessment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Overall Assessment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Overall Result</Label>
                  <Select value={overallResult} onValueChange={(value: 'pass' | 'fail' | 'conditional') => setOverallResult(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pass">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          Pass - Meets All Requirements
                        </div>
                      </SelectItem>
                      <SelectItem value="conditional">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                          Conditional - Minor Issues
                        </div>
                      </SelectItem>
                      <SelectItem value="fail">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-600" />
                          Fail - Does Not Meet Requirements
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Report Status</Label>
                  <div className={`px-3 py-2 rounded-md border text-sm ${getStatusColor(reportStatus)}`}>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(reportStatus)}
                      {reportStatus.replace('_', ' ').toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>General Notes & Recommendations</Label>
                <Textarea
                  placeholder="Enter overall assessment, recommendations, and any additional notes..."
                  rows={4}
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button 
              variant="secondary"
              onClick={() => handleSaveReport(false)}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save Draft
            </Button>
            <Button 
              onClick={() => handleSaveReport(true)}
              disabled={loading || !inspector}
              className="flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              Submit Final Report
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}