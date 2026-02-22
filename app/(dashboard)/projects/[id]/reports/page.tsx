'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { 
  FileText, 
  Download, 
  Plus, 
  Edit, 
  Eye, 
  Printer,
  Settings,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

import BalloonDiagramViewer from '@/components/features/project-reports/BalloonDiagramViewer';
import InspectionReportTable from '@/components/features/project-reports/InspectionReportTable';
import {
  useBalloonDiagrams,
  useCreateBalloonDiagram,
  useInspectionReport,
  useCompleteReport,
  useAddAnnotation,
  useUpdateAnnotation,
  useDeleteAnnotation,
} from '@/lib/api/hooks/useProjectReports';
import { useProjects } from '@/lib/api/hooks/useProjects';
import { useBOMs } from '@/lib/api/hooks/useBOM';

interface CreateDiagramFormData {
  name: string;
  bomId: string;
  cadFilePath: string;
}

function CreateBalloonDiagramDialog({ 
  projectId, 
  onSuccess 
}: { 
  projectId: string; 
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<CreateDiagramFormData>({
    name: '',
    bomId: '',
    cadFilePath: '',
  });

  const { data: boms } = useBOMs(projectId);
  const createBalloonDiagram = useCreateBalloonDiagram();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.bomId) {
      toast.error('Please fill in all required fields');
      return;
    }

    createBalloonDiagram.mutate({
      project_id: projectId,
      bom_id: formData.bomId,
      name: formData.name,
      cad_file_path: formData.cadFilePath || undefined,
    }, {
      onSuccess: () => {
        setOpen(false);
        setFormData({ name: '', bomId: '', cadFilePath: '' });
        onSuccess();
        toast.success('Balloon diagram created successfully');
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Balloon Diagram
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Balloon Diagram</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Diagram Name*</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Camera Holder - Main Assembly"
              required
            />
          </div>
          
          <div>
            <Label htmlFor="bomId">BOM*</Label>
            <Select
              value={formData.bomId}
              onValueChange={(value) => setFormData(prev => ({ ...prev, bomId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select BOM" />
              </SelectTrigger>
              <SelectContent>
                {boms?.map((bom) => (
                  <SelectItem key={bom.id} value={bom.id}>
                    {bom.name} - {bom.items?.length || 0} items
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label htmlFor="cadFilePath">CAD File Path</Label>
            <Input
              id="cadFilePath"
              value={formData.cadFilePath}
              onChange={(e) => setFormData(prev => ({ ...prev, cadFilePath: e.target.value }))}
              placeholder="/uploads/models/camera-holder.stl"
            />
          </div>
          
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createBalloonDiagram.isPending}>
              {createBalloonDiagram.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReportHeader({ 
  projectName, 
  inspectionReport 
}: { 
  projectName: string;
  inspectionReport: any;
}) {
  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = () => {
    toast.info('PDF export functionality would be implemented here');
  };

  const handleExportExcel = () => {
    toast.info('Excel export functionality would be implemented here');
  };

  return (
    <div className="flex items-center justify-between p-6 border-b">
      <div>
        <h1 className="text-2xl font-bold">Project Report</h1>
        <p className="text-gray-600 mt-1">{projectName}</p>
        {inspectionReport && (
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className="bg-green-100 text-green-800">
              <CheckCircle className="h-3 w-3 mr-1" />
              Report Generated
            </Badge>
            <span className="text-sm text-gray-500">
              {inspectionReport.inspection_date}
            </span>
          </div>
        )}
      </div>
      
      <div className="flex items-center space-x-2">
        <Button variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF}>
          <Download className="h-4 w-4 mr-2" />
          PDF
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportExcel}>
          <Download className="h-4 w-4 mr-2" />
          Excel
        </Button>
      </div>
    </div>
  );
}

export default function ProjectReportPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null);
  const [isEditingDiagram, setIsEditingDiagram] = useState(false);

  const { data: project } = useProjects();
  const { data: balloonDiagrams, refetch: refetchDiagrams } = useBalloonDiagrams(projectId);
  const { data: inspectionReport, isLoading: isLoadingReport } = useInspectionReport(projectId);
  const { data: completeReport, isLoading: isLoadingComplete } = useCompleteReport(projectId);

  const addAnnotation = useAddAnnotation();
  const updateAnnotation = useUpdateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();

  const currentProject = project?.find(p => p.id === projectId);
  const selectedDiagram = balloonDiagrams?.find(d => d.id === selectedDiagramId) || balloonDiagrams?.[0];

  useEffect(() => {
    if (balloonDiagrams?.length > 0 && !selectedDiagramId) {
      setSelectedDiagramId(balloonDiagrams[0].id);
    }
  }, [balloonDiagrams, selectedDiagramId]);

  const handleAnnotationAdd = (annotation: any) => {
    if (!selectedDiagram) return;
    
    addAnnotation.mutate({
      diagramId: selectedDiagram.id,
      data: annotation,
    });
  };

  const handleAnnotationUpdate = (annotationId: string, annotation: any) => {
    if (!selectedDiagram) return;
    
    updateAnnotation.mutate({
      diagramId: selectedDiagram.id,
      annotationId,
      data: annotation,
    });
  };

  const handleAnnotationDelete = (annotationId: string) => {
    if (!selectedDiagram) return;
    
    deleteAnnotation.mutate({
      diagramId: selectedDiagram.id,
      annotationId,
    });
  };

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
          <h3 className="text-lg font-semibold mb-2">Project Not Found</h3>
          <p className="text-gray-600">The requested project could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <ReportHeader 
        projectName={currentProject.name}
        inspectionReport={inspectionReport}
      />
      
      <div className="p-6">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="balloon-diagram">Balloon Diagram</TabsTrigger>
            <TabsTrigger value="inspection-report">Inspection Report</TabsTrigger>
            <TabsTrigger value="complete-report">Complete Report</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="p-6">
                <div className="flex items-center">
                  <FileText className="h-8 w-8 text-blue-500 mr-3" />
                  <div>
                    <h3 className="text-lg font-semibold">Balloon Diagrams</h3>
                    <p className="text-2xl font-bold text-blue-600">
                      {balloonDiagrams?.length || 0}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6">
                <div className="flex items-center">
                  <CheckCircle className="h-8 w-8 text-green-500 mr-3" />
                  <div>
                    <h3 className="text-lg font-semibold">Inspections</h3>
                    <p className="text-2xl font-bold text-green-600">
                      {inspectionReport?.inspection_details?.length || 0}
                    </p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6">
                <div className="flex items-center">
                  <Settings className="h-8 w-8 text-purple-500 mr-3" />
                  <div>
                    <h3 className="text-lg font-semibold">Annotations</h3>
                    <p className="text-2xl font-bold text-purple-600">
                      {balloonDiagrams?.reduce((sum, d) => sum + (d.annotations?.length || 0), 0) || 0}
                    </p>
                  </div>
                </div>
              </Card>
            </div>
            
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <span>Project report generated</span>
                  <Badge variant="outline">{inspectionReport?.inspection_date || 'N/A'}</Badge>
                </div>
                <div className="flex items-center justify-between py-2 border-b">
                  <span>Balloon diagrams created</span>
                  <Badge variant="outline">{balloonDiagrams?.length || 0} diagrams</Badge>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span>Quality inspections completed</span>
                  <Badge variant="outline">Latest: {inspectionReport?.inspection_date || 'N/A'}</Badge>
                </div>
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="balloon-diagram" className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h2 className="text-xl font-semibold">Balloon Diagrams</h2>
                {balloonDiagrams && balloonDiagrams.length > 1 && (
                  <Select value={selectedDiagramId || ''} onValueChange={setSelectedDiagramId}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Select diagram" />
                    </SelectTrigger>
                    <SelectContent>
                      {balloonDiagrams.map((diagram) => (
                        <SelectItem key={diagram.id} value={diagram.id}>
                          {diagram.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              
              <div className="flex items-center space-x-2">
                <Button
                  variant={isEditingDiagram ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsEditingDiagram(!isEditingDiagram)}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  {isEditingDiagram ? 'Editing' : 'Edit'}
                </Button>
                <CreateBalloonDiagramDialog
                  projectId={projectId}
                  onSuccess={refetchDiagrams}
                />
              </div>
            </div>
            
            <Card className="h-[600px]">
              {selectedDiagram ? (
                <BalloonDiagramViewer
                  diagram={selectedDiagram}
                  onAnnotationAdd={handleAnnotationAdd}
                  onAnnotationUpdate={handleAnnotationUpdate}
                  onAnnotationDelete={handleAnnotationDelete}
                  isEditing={isEditingDiagram}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <FileText className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No Balloon Diagrams</h3>
                    <p className="text-gray-600 mb-4">Create your first balloon diagram to get started.</p>
                    <CreateBalloonDiagramDialog
                      projectId={projectId}
                      onSuccess={refetchDiagrams}
                    />
                  </div>
                </div>
              )}
            </Card>
          </TabsContent>
          
          <TabsContent value="inspection-report">
            {isLoadingReport ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin mr-3" />
                <span>Loading inspection report...</span>
              </div>
            ) : inspectionReport ? (
              <InspectionReportTable report={inspectionReport} />
            ) : (
              <Card className="p-8 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Inspection Report</h3>
                <p className="text-gray-600">Complete quality inspections to generate the report.</p>
              </Card>
            )}
          </TabsContent>
          
          <TabsContent value="complete-report">
            {isLoadingComplete ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin mr-3" />
                <span>Loading complete report...</span>
              </div>
            ) : completeReport ? (
              <div className="space-y-6">
                {completeReport.balloon_drawing && (
                  <Card className="p-6">
                    <h2 className="text-xl font-semibold mb-4">1.3 BALLOON DRAWING</h2>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <strong>Material:</strong> {completeReport.balloon_drawing.material}
                      </div>
                      <div>
                        <strong>Surface Treatment:</strong> {completeReport.balloon_drawing.surface_treatment}
                      </div>
                      <div>
                        <strong>Part Name:</strong> {completeReport.balloon_drawing.part_name}
                      </div>
                      <div>
                        <strong>Drawing No.:</strong> {completeReport.balloon_drawing.drawing_no}
                      </div>
                    </div>
                  </Card>
                )}
                
                {completeReport.final_inspection_report && (
                  <InspectionReportTable report={completeReport.final_inspection_report} />
                )}
              </div>
            ) : (
              <Card className="p-8 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Complete Report Not Available</h3>
                <p className="text-gray-600">Complete balloon diagrams and inspections to generate the full report.</p>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}