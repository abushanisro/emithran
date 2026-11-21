'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

import BalloonDiagramViewer from '@/components/features/project-reports/BalloonDiagramViewer';
import InspectionReportTable from '@/components/features/project-reports/InspectionReportTable';
import { ProjectNav } from '@/components/features/projects/ProjectNav';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { 
  FileText, 
  Download, 
  Plus, 
  Edit, 
  Printer,
  Settings,
  ArrowLeft,
  ChevronDown,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListSkeleton } from '@/components/ui/loading-skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBOMs } from '@/lib/api/hooks/useBOM';
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

  const { data: bomsData } = useBOMs({ projectId });
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
      ...(formData.cadFilePath ? { cad_file_path: formData.cadFilePath } : {}),
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
                {bomsData?.boms?.map((bom: any) => (
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
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

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
    <div className="flex items-start gap-3">
      <Button
        variant="outline"
        size="icon"
        className="mt-0.5 h-8 w-8 shrink-0"
        aria-label="Back to project"
        onClick={() => { router.push(`/projects/${projectId}`); }}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <PageHeader title="Project Report" description={projectName}>
          {inspectionReport && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success">
                <CheckCircle className="h-3 w-3" />
                Report Generated
              </Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                {inspectionReport.inspection_date}
              </span>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Export
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleExportPDF}>
                <Download className="mr-2 h-4 w-4" />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleExportExcel}>
                <Download className="mr-2 h-4 w-4" />
                Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PageHeader>
      </div>
    </div>
  );
}

export default function ProjectReportPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(null);
  const [isEditingDiagram, setIsEditingDiagram] = useState(false);

  const { data: projectData } = useProjects();
  const { data: balloonDiagrams, refetch: refetchDiagrams } = useBalloonDiagrams(projectId);
  const { data: inspectionReport, isLoading: isLoadingReport } = useInspectionReport(projectId);
  const { data: completeReport, isLoading: isLoadingComplete } = useCompleteReport(projectId);

  const addAnnotation = useAddAnnotation();
  const updateAnnotation = useUpdateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();

  const currentProject = Array.isArray(projectData) 
    ? projectData.find((p: any) => p.id === projectId) 
    : (projectData as any)?.projects?.find((p: any) => p.id === projectId);
  const selectedDiagram = balloonDiagrams?.find((d: any) => d.id === selectedDiagramId) || balloonDiagrams?.[0];

  useEffect(() => {
    if (balloonDiagrams && balloonDiagrams.length > 0 && !selectedDiagramId) {
      setSelectedDiagramId(balloonDiagrams[0]!.id);
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
      <Card>
        <EmptyState
          icon={AlertTriangle}
          title="Project Not Found"
          description="The requested project could not be found."
        />
      </Card>
    );
  }

  const overviewStats = [
    { label: 'Balloon Diagrams', icon: FileText, value: balloonDiagrams?.length || 0, tone: 'bg-primary/10 text-primary' },
    { label: 'Inspections', icon: CheckCircle, value: inspectionReport?.inspection_details?.length || 0, tone: 'bg-success/10 text-success' },
    { label: 'Annotations', icon: Settings, value: balloonDiagrams?.reduce((sum, d) => sum + (d.annotations?.length || 0), 0) || 0, tone: 'bg-primary/10 text-primary' },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <ReportHeader 
        projectName={currentProject.name}
        inspectionReport={inspectionReport}
      />

      {/* Project sections: shared tab bar, Reports is the active tab (hidden when printing the report) */}
      <ProjectNav projectId={projectId} className="print:hidden" />

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="h-10 w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="balloon-diagram">Balloon Diagram</TabsTrigger>
          <TabsTrigger value="inspection-report">Inspection Report</TabsTrigger>
          <TabsTrigger value="complete-report">Complete Report</TabsTrigger>
        </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {overviewStats.map(({ label, icon: Icon, value, tone }) => (
                <Card key={label}>
                  <div className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
                    </div>
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Card className="overflow-hidden">
              <div className="border-b bg-muted/40 px-6 py-3">
                <h3 className="text-sm font-semibold">Recent Activity</h3>
              </div>
              <ul className="divide-y text-sm">
                <li className="flex items-center justify-between gap-3 px-6 py-3">
                  <span>Project report generated</span>
                  <Badge variant="outline">{inspectionReport?.inspection_date || 'N/A'}</Badge>
                </li>
                <li className="flex items-center justify-between gap-3 px-6 py-3">
                  <span>Balloon diagrams created</span>
                  <Badge variant="outline">{balloonDiagrams?.length || 0} diagrams</Badge>
                </li>
                <li className="flex items-center justify-between gap-3 px-6 py-3">
                  <span>Quality inspections completed</span>
                  <Badge variant="outline">Latest: {inspectionReport?.inspection_date || 'N/A'}</Badge>
                </li>
              </ul>
            </Card>
          </TabsContent>

          <TabsContent value="balloon-diagram" className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <h2 className="text-lg font-semibold">Balloon Diagrams</h2>
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
              
              <div className="flex items-center gap-2">
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
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    icon={FileText}
                    title="No Balloon Diagrams"
                    description="Create your first balloon diagram to get started."
                  >
                    <CreateBalloonDiagramDialog
                      projectId={projectId}
                      onSuccess={refetchDiagrams}
                    />
                  </EmptyState>
                </div>
              )}
            </Card>
          </TabsContent>
          
          <TabsContent value="inspection-report">
            {isLoadingReport ? (
              <ListSkeleton rows={5} label="Loading inspection report..." />
            ) : inspectionReport ? (
              <InspectionReportTable report={inspectionReport} />
            ) : (
              <Card>
                <EmptyState
                  icon={AlertTriangle}
                  title="No Inspection Report"
                  description="Complete quality inspections to generate the report."
                />
              </Card>
            )}
          </TabsContent>
          
          <TabsContent value="complete-report">
            {isLoadingComplete ? (
              <ListSkeleton rows={5} label="Loading complete report..." />
            ) : completeReport ? (
              <div className="space-y-6">
                {completeReport.balloon_drawing && (
                  <Card className="p-6">
                    <h2 className="mb-4 text-lg font-semibold">1.3 BALLOON DRAWING</h2>
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Material</dt>
                        <dd className="mt-1 font-medium">{completeReport.balloon_drawing.material}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Surface Treatment</dt>
                        <dd className="mt-1 font-medium">{completeReport.balloon_drawing.surface_treatment}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Part Name</dt>
                        <dd className="mt-1 font-medium">{completeReport.balloon_drawing.part_name}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Drawing No.</dt>
                        <dd className="mt-1 font-medium">{completeReport.balloon_drawing.drawing_no}</dd>
                      </div>
                    </dl>
                  </Card>
                )}
                
                {completeReport.final_inspection_report && (
                  <InspectionReportTable report={completeReport.final_inspection_report} />
                )}
              </div>
            ) : (
              <Card>
                <EmptyState
                  icon={AlertTriangle}
                  title="Complete Report Not Available"
                  description="Complete balloon diagrams and inspections to generate the full report."
                />
              </Card>
            )}
          </TabsContent>
      </Tabs>
    </div>
  );
}