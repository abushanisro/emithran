'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { useQualityInspections, useDeleteQualityInspection } from '@/lib/api/hooks/useQualityControl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Shield,
  Search,
  FileText,
  Calendar,
  User,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Trash2,
  MoreVertical,
  ArrowLeft
} from 'lucide-react';
import CreateQCInspectionDialog from '@/components/features/quality-control/CreateQCInspectionDialog';

export default function QualityControlPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [searchTerm, setSearchTerm] = useState('');
  const [authInitialized, setAuthInitialized] = useState(false);

  // Wait for auth to initialize before making API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthInitialized(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const { data: qualityInspectionsResponse = [], isLoading: loadingInspections, refetch: refetchInspections } = useQualityInspections(
    authInitialized ? projectId : undefined
  );

  const deleteInspection = useDeleteQualityInspection();

  // Handle the API response format
  const qualityInspections = Array.isArray(qualityInspectionsResponse)
    ? qualityInspectionsResponse
    : (qualityInspectionsResponse as any)?.data || [];

  // Filter inspections based on search
  const filteredInspections = qualityInspections.filter((inspection: any) =>
    inspection.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inspection.type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inspection.status?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inspection.inspector?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleInspectionCreated = (_newInspection: any) => {
    refetchInspections();
  };

  const handleInspectionCompleted = (_completedInspection: any) => {
    refetchInspections();
  };

  const openReportDialog = (inspection: any) => {
    // Navigate to the dedicated inspection page instead of opening dialog
    router.push(`/projects/${projectId}/quality-control/${inspection.id}`);
  };

  const handleDeleteInspection = async (inspection: any) => {
    if (window.confirm(`Are you sure you want to delete "${inspection.name}"? This action cannot be undone.`)) {
      try {
        await deleteInspection.mutateAsync(inspection.id);
      } catch (error) {
        console.error('Failed to delete inspection:', error);
      }
    }
  };

  const getStatusIcon = (status: string, result?: string) => {
    if (result === 'pass') return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (result === 'fail') return <XCircle className="h-4 w-4 text-red-600" />;
    if (result === 'conditional') return <AlertTriangle className="h-4 w-4 text-yellow-600" />;

    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'in_progress': return <Clock className="h-4 w-4 text-blue-600" />;
      case 'planned': return <Calendar className="h-4 w-4 text-gray-600" />;
      default: return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string, result?: string) => {
    if (result === 'pass') return 'bg-green-100 text-green-800 border-green-200';
    if (result === 'fail') return 'bg-red-100 text-red-800 border-red-200';
    if (result === 'conditional') return 'bg-yellow-100 text-yellow-800 border-yellow-200';

    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200';
      case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'planned': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (loadingInspections) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading quality inspections...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card text-card-foreground border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={() => router.push(`/projects/${projectId}`)}
                  className="flex items-center gap-2"
                  size="sm"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Project
                </Button>
                <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                  <Shield className="h-6 w-6 text-primary" />
                  Quality Control
                </h1>
              </div>
              <p className="text-sm text-muted-foreground ml-24">
                Manage quality inspections and reports for this project
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-sm">
                {filteredInspections.length} Inspections
              </Badge>
              <CreateQCInspectionDialog
                projectId={projectId}
                onInspectionCreated={handleInspectionCreated}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Search and Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search inspections by name, type, status, or inspector..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inspections List */}
        {filteredInspections.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Shield className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {qualityInspections.length === 0 ? 'No Quality Inspections' : 'No Matching Inspections'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {qualityInspections.length === 0
                  ? 'Get started by creating your first quality control inspection.'
                  : 'Try adjusting your search criteria to find inspections.'
                }
              </p>
              {qualityInspections.length === 0 && (
                <CreateQCInspectionDialog
                  projectId={projectId}
                  onInspectionCreated={handleInspectionCreated}
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredInspections.map((inspection: any) => (
              <Card key={inspection.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-lg">{inspection.name}</CardTitle>
                        <Badge className={`text-xs border ${getStatusBadge(inspection.status, inspection.overall_result)}`}>
                          <div className="flex items-center gap-1">
                            {getStatusIcon(inspection.status, inspection.overall_result)}
                            {inspection.overall_result?.toUpperCase() || inspection.status?.toUpperCase() || 'PLANNED'}
                          </div>
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          <span>{inspection.type || 'First Article'}</span>
                        </div>
                        {inspection.inspector && (
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            <span>{inspection.inspector}</span>
                          </div>
                        )}
                        {inspection.plannedDate && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>{new Date(inspection.plannedDate).toLocaleDateString()}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <Shield className="h-4 w-4" />
                          <span>{inspection.selectedItems?.length || 0} items</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openReportDialog(inspection)}
                        className="flex items-center gap-1"
                      >
                        <FileText className="h-4 w-4" />
                        Open Report
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            onClick={() => handleDeleteInspection(inspection)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Inspection
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {inspection.description && (
                      <p className="text-sm text-muted-foreground">{inspection.description}</p>
                    )}

                    {/* BOM Info */}
                    {inspection.bomName && (
                      <div className="text-sm">
                        <span className="font-medium">BOM:</span> {inspection.bomName}
                        {inspection.bomVersion && <span className="text-muted-foreground"> (v{inspection.bomVersion})</span>}
                      </div>
                    )}

                    {/* Quality Standards */}
                    {inspection.qualityStandards && inspection.qualityStandards.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Standards:</span>
                        <div className="flex gap-1 flex-wrap">
                          {inspection.qualityStandards.map((standard: string, index: number) => (
                            <Badge key={index} variant="secondary" className="text-xs">
                              {standard}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Checklist Summary */}
                    {inspection.checklist && inspection.checklist.length > 0 && (
                      <div className="text-sm text-muted-foreground">
                        {inspection.checklist.length} checklist item{inspection.checklist.length !== 1 ? 's' : ''}
                      </div>
                    )}

                    {/* Timestamps */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                      <span>Created: {new Date(inspection.createdAt).toLocaleDateString()}</span>
                      {inspection.completedAt && (
                        <span>Completed: {new Date(inspection.completedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}