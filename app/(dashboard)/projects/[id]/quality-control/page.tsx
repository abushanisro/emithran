'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { useQualityInspections, useDeleteQualityInspection, useApproveQualityInspection, useRejectQualityInspection, useResetInspectionStatus } from '@/lib/api/hooks/useQualityControl';
import { usePageContext } from '@/lib/echo/PageContextProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  Loader2,
} from 'lucide-react';
import CreateQCInspectionDialog from '@/components/features/quality-control/CreateQCInspectionDialog';

export default function QualityControlPage() {
  const params = useParams();
  usePageContext({
    entityType: 'project',
    entityId: (params?.id as string) ?? '',
    breadcrumbs: ['Project', 'Quality control'],
  });
  const router = useRouter();
  const projectId = params.id as string;

  const [searchTerm, setSearchTerm] = useState('');
  const [authInitialized, setAuthInitialized] = useState(false);
  const [approveTarget, setApproveTarget] = useState<any>(null);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [resetTarget, setResetTarget] = useState<any>(null);

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
  const approveInspection = useApproveQualityInspection();
  const rejectInspection = useRejectQualityInspection();
  const resetInspection = useResetInspectionStatus();

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

  const openReportDialog = (inspection: any) => {
    // Navigate to the dedicated inspection page instead of opening dialog
    router.push(`/projects/${projectId}/quality-control/${inspection.id}`);
  };

  const handleDeleteInspection = (inspection: any) => setDeleteTarget(inspection);
  const handleApproveInspection = (inspection: any) => setApproveTarget(inspection);
  const handleRejectInspection = (inspection: any) => { setRejectTarget(inspection); setRejectReason(''); };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    try {
      await approveInspection.mutateAsync(approveTarget.id);
      refetchInspections();
    } finally {
      setApproveTarget(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    try {
      await rejectInspection.mutateAsync({ inspectionId: rejectTarget.id, reason: rejectReason });
      refetchInspections();
    } finally {
      setRejectTarget(null);
      setRejectReason('');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteInspection.mutateAsync(deleteTarget.id);
      refetchInspections();
    } finally {
      setDeleteTarget(null);
    }
  };

  const confirmReset = async () => {
    if (!resetTarget) return;
    try {
      await resetInspection.mutateAsync(resetTarget.id);
      refetchInspections();
    } finally {
      setResetTarget(null);
    }
  };

  const getStatusIcon = (status: string, result?: string) => {
    if (result === 'pass') return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (result === 'fail') return <XCircle className="h-4 w-4 text-red-600" />;
    if (result === 'conditional') return <AlertTriangle className="h-4 w-4 text-yellow-600" />;

    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'approved': return <ThumbsUp className="h-4 w-4 text-green-600" />;
      case 'rejected': return <ThumbsDown className="h-4 w-4 text-red-600" />;
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
      case 'approved': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
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
        <div className="max-w-7xl mx-auto p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={() => router.push(`/projects/${projectId}`)}
                  className="flex items-center gap-2"
                  size="sm"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden xs:inline">Back to Project</span>
                  <span className="xs:hidden">Back</span>
                </Button>
                <h1 className="text-xl sm:text-2xl font-semibold text-foreground flex items-center gap-2">
                  <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                  <span className="hidden sm:inline">Quality Control</span>
                  <span className="sm:hidden">QC</span>
                </h1>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground sm:ml-24">
                Manage quality inspections and reports for this project
              </p>
            </div>
            <div className="flex items-center gap-3 justify-end">
              <Badge variant="outline" className="text-xs sm:text-sm">
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
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Search and Filters */}
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search inspections..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inspections List */}
        {filteredInspections.length === 0 ? (
          <Card>
            <CardContent className="p-6 sm:p-12 text-center">
              <Shield className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">
                {qualityInspections.length === 0 ? 'No Quality Inspections' : 'No Matching Inspections'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
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
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                        <CardTitle className="text-base sm:text-lg truncate pr-2">{inspection.name}</CardTitle>
                        <Badge className={`text-xs border w-fit ${getStatusBadge(inspection.status, inspection.overall_result)}`}>
                          <div className="flex items-center gap-1">
                            {getStatusIcon(inspection.status, inspection.overall_result)}
                            <span className="hidden xs:inline">{inspection.overall_result?.toUpperCase() || inspection.status?.toUpperCase() || 'PLANNED'}</span>
                            <span className="xs:hidden">{(inspection.overall_result?.toUpperCase() || inspection.status?.toUpperCase() || 'PLANNED').substr(0, 4)}</span>
                          </div>
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <FileText className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                          <span className="truncate">{inspection.type || 'First Article'}</span>
                        </div>
                        {inspection.inspector && (
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                            <span className="truncate">{inspection.inspector}</span>
                          </div>
                        )}
                        {inspection.plannedDate && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                            <span className="truncate">{new Date(inspection.plannedDate).toLocaleDateString()}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <Shield className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                          <span>{inspection.selectedItems?.length || 0} items</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openReportDialog(inspection)}
                        className="flex items-center gap-1 text-xs sm:text-sm"
                      >
                        <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                        <span className="hidden xs:inline">Open Report</span>
                        <span className="xs:hidden">Report</span>
                      </Button>
                      
                      {/* Undo button - only for approved/rejected */}
                      {(inspection.status === 'approved' || inspection.status === 'rejected') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setResetTarget(inspection)}
                          className="flex items-center gap-1 text-orange-600 border-orange-200 hover:bg-orange-50 hover:text-orange-700 text-xs sm:text-sm"
                          disabled={resetInspection.isPending && resetTarget?.id === inspection.id}
                        >
                          {resetInspection.isPending && resetTarget?.id === inspection.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <span className="text-sm">↩</span>
                          }
                          <span className="hidden sm:inline">Undo</span>
                        </Button>
                      )}

                      {/* Approve/Reject buttons - show for any inspection not already approved/rejected */}
                      {inspection.status !== 'approved' && inspection.status !== 'rejected' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleApproveInspection(inspection)}
                            className="flex items-center gap-1 text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700 text-xs sm:text-sm"
                            disabled={approveInspection.isPending && approveTarget?.id === inspection.id}
                          >
                            {approveInspection.isPending && approveTarget?.id === inspection.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <ThumbsUp className="h-3 w-3 sm:h-4 sm:w-4" />
                            }
                            <span className="hidden sm:inline">Approve</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRejectInspection(inspection)}
                            className="flex items-center gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 text-xs sm:text-sm"
                            disabled={rejectInspection.isPending && rejectTarget?.id === inspection.id}
                          >
                            {rejectInspection.isPending && rejectTarget?.id === inspection.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <ThumbsDown className="h-3 w-3 sm:h-4 sm:w-4" />
                            }
                            <span className="hidden sm:inline">Decline</span>
                          </Button>
                        </>
                      )}
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 w-8 sm:h-9 sm:w-9 p-0">
                            <MoreVertical className="h-3 w-3 sm:h-4 sm:w-4" />
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
                <CardContent className="pt-0">
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
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <span className="text-sm font-medium flex-shrink-0">Standards:</span>
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

                    {/* Rejection Reason */}
                    {inspection.status === 'rejected' && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                        <div className="flex items-start gap-2">
                          <ThumbsDown className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-red-800 mb-1">Declined</p>
                            {(inspection.rejectionReason || inspection.rejection_reason) && (
                              <p className="text-sm text-red-700">{inspection.rejectionReason || inspection.rejection_reason}</p>
                            )}
                            {(inspection.rejectedBy || inspection.rejected_by) && (
                              <p className="text-xs text-red-600 mt-1">
                                By: {inspection.rejectedBy || inspection.rejected_by}
                                {(inspection.rejectedAt || inspection.rejected_at) && (
                                  <span className="ml-1">on {new Date(inspection.rejectedAt || inspection.rejected_at).toLocaleString()}</span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Approval Info */}
                    {inspection.status === 'approved' && (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                        <div className="flex items-start gap-2">
                          <ThumbsUp className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-green-800 mb-1">Approved</p>
                            {(inspection.approvedBy || inspection.approved_by) && (
                              <p className="text-xs text-green-600">
                                By: {inspection.approvedBy || inspection.approved_by}
                                {(inspection.approvedAt || inspection.approved_at) && (
                                  <span className="ml-1">on {new Date(inspection.approvedAt || inspection.approved_at).toLocaleString()}</span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Timestamps */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-muted-foreground pt-2 border-t">
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

      {/* Approve confirmation dialog */}
      <AlertDialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ThumbsUp className="h-5 w-5 text-green-600" />
              Approve Inspection
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to approve <span className="font-semibold text-foreground">"{approveTarget?.name}"</span>?
              Approved items will become available for delivery.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveInspection.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmApprove}
              disabled={approveInspection.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {approveInspection.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Approving...</>
              ) : 'Approve'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject dialog with reason input */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ThumbsDown className="h-5 w-5 text-red-600" />
              Decline Inspection
            </DialogTitle>
            <DialogDescription>
              Provide a reason for declining <span className="font-semibold text-foreground">"{rejectTarget?.name}"</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Reason for declining (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={rejectInspection.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={rejectInspection.isPending}
            >
              {rejectInspection.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Declining...</>
              ) : 'Decline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Undo (reset) confirmation dialog */}
      <AlertDialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="text-lg">↩</span>
              Undo {resetTarget?.status === 'approved' ? 'Approval' : 'Decline'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will reset <span className="font-semibold text-foreground">"{resetTarget?.name}"</span> back to{' '}
              <span className="font-semibold">Completed</span> status.
              {resetTarget?.status === 'approved' && (
                <span className="block mt-1 text-orange-700">
                  The quality-approved items created for delivery will also be removed.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetInspection.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmReset}
              disabled={resetInspection.isPending}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {resetInspection.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Resetting...</>
              ) : 'Undo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" />
              Delete Inspection
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-semibold text-foreground">"{deleteTarget?.name}"</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInspection.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteInspection.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteInspection.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Deleting...</>
              ) : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}