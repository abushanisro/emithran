'use client';

import { useParams, useRouter } from 'next/navigation';
import { Fragment, useState, useEffect } from 'react';

import { ProjectNav } from '@/components/features/projects/ProjectNav';
import CreateQCInspectionDialog from '@/components/features/quality-control/CreateQCInspectionDialog';
import { PageHeader } from '@/components/layout/PageHeader';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { EmptyState } from '@/components/ui/empty-state';
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
  Undo2,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { PageSkeleton } from '@/components/ui/loading-skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useQualityInspections, useDeleteQualityInspection, useApproveQualityInspection, useRejectQualityInspection, useResetInspectionStatus } from '@/lib/api/hooks/useQualityControl';

export default function QualityControlPage() {
  const params = useParams();
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
    if (result === 'pass') return <CheckCircle className="h-3.5 w-3.5" />;
    if (result === 'fail') return <XCircle className="h-3.5 w-3.5" />;
    if (result === 'conditional') return <AlertTriangle className="h-3.5 w-3.5" />;

    switch (status) {
      case 'completed': return <CheckCircle className="h-3.5 w-3.5" />;
      case 'approved': return <ThumbsUp className="h-3.5 w-3.5" />;
      case 'rejected': return <ThumbsDown className="h-3.5 w-3.5" />;
      case 'in_progress': return <Clock className="h-3.5 w-3.5" />;
      case 'planned': return <Calendar className="h-3.5 w-3.5" />;
      default: return <Clock className="h-3.5 w-3.5" />;
    }
  };

  const getStatusBadge = (status: string, result?: string) => {
    if (result === 'pass') return 'bg-success/10 text-success border-success/30';
    if (result === 'fail') return 'bg-destructive/10 text-destructive border-destructive/30';
    if (result === 'conditional') return 'bg-warning/10 text-warning border-warning/30';

    switch (status) {
      case 'completed': return 'bg-success/10 text-success border-success/30';
      case 'approved': return 'bg-success/10 text-success border-success/30';
      case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/30';
      case 'in_progress': return 'bg-primary/10 text-primary border-primary/30';
      case 'planned': return 'bg-muted text-muted-foreground border-border';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  if (loadingInspections) {
    return (
      <div>
        <PageSkeleton label="Loading quality inspections..." />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          className="mt-0.5 h-8 w-8 shrink-0"
          aria-label="Back to project"
          onClick={() => router.push(`/projects/${projectId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader
            title="Quality Control"
            description="Manage quality inspections and reports for this project"
          >
            <Badge variant="outline" className="text-xs">
              {filteredInspections.length} Inspections
            </Badge>
            <CreateQCInspectionDialog
              projectId={projectId}
              onInspectionCreated={handleInspectionCreated}
            />
          </PageHeader>
        </div>
      </div>

      {/* Project sections: shared tab bar, Quality is the active tab */}
      <ProjectNav projectId={projectId} />

      {/* Search */}
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          aria-label="Search inspections"
          placeholder="Search inspections..."
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); }}
          className="h-9 pl-9 text-sm"
        />
      </div>

      {/* Inspections */}
      {filteredInspections.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Shield}
              title={qualityInspections.length === 0 ? 'No Quality Inspections' : 'No Matching Inspections'}
              description={qualityInspections.length === 0
                ? 'Get started by creating your first quality control inspection.'
                : 'Try adjusting your search criteria to find inspections.'}
            >
              {qualityInspections.length === 0 && (
                <CreateQCInspectionDialog
                  projectId={projectId}
                  onInspectionCreated={handleInspectionCreated}
                />
              )}
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Inspection</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Inspector</TableHead>
                <TableHead>Planned</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInspections.map((inspection: any) => (
                <Fragment key={inspection.id}>
                  <TableRow className="align-top">
                    <TableCell className="max-w-xs pl-4">
                      <button
                        type="button"
                        onClick={() => openReportDialog(inspection)}
                        className="block max-w-full truncate text-left font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {inspection.name}
                      </button>
                      {inspection.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{inspection.description}</p>
                      )}
                      {inspection.bomName && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">BOM:</span> {inspection.bomName}
                        </p>
                      )}
                      {inspection.qualityStandards && inspection.qualityStandards.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <span className="text-xs font-medium text-foreground/80">Standards:</span>
                          {inspection.qualityStandards.map((standard: string, index: number) => (
                            <Badge key={index} variant="secondary" className="text-[11px]">
                              {standard}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {inspection.checklist && inspection.checklist.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {inspection.checklist.length} checklist item{inspection.checklist.length !== 1 ? 's' : ''}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {inspection.type || 'First Article'}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {inspection.inspector ? (
                        <span className="inline-flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {inspection.inspector}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {inspection.plannedDate ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {new Date(inspection.plannedDate).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {inspection.selectedItems?.length || 0}
                    </TableCell>
                    <TableCell>
                      <Badge className={`gap-1 border text-xs font-medium hover:bg-transparent ${getStatusBadge(inspection.status, inspection.overall_result)}`}>
                        {getStatusIcon(inspection.status, inspection.overall_result)}
                        {inspection.overall_result?.toUpperCase() || inspection.status?.toUpperCase() || 'PLANNED'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      <div>Created: {new Date(inspection.createdAt).toLocaleDateString()}</div>
                      {inspection.completedAt && (
                        <div>Completed: {new Date(inspection.completedAt).toLocaleDateString()}</div>
                      )}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openReportDialog(inspection)}
                          className="gap-1 text-xs"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Open Report
                        </Button>

                        {/* Approve/Reject: any inspection not already approved/rejected */}
                        {inspection.status !== 'approved' && inspection.status !== 'rejected' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleApproveInspection(inspection)}
                              className="gap-1 border-success/40 text-xs text-success hover:bg-success/10 hover:text-success"
                              disabled={approveInspection.isPending && approveTarget?.id === inspection.id}
                            >
                              {approveInspection.isPending && approveTarget?.id === inspection.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <ThumbsUp className="h-3.5 w-3.5" />
                              }
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRejectInspection(inspection)}
                              className="gap-1 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={rejectInspection.isPending && rejectTarget?.id === inspection.id}
                            >
                              {rejectInspection.isPending && rejectTarget?.id === inspection.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <ThumbsDown className="h-3.5 w-3.5" />
                              }
                              Decline
                            </Button>
                          </>
                        )}

                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More actions for ${String(inspection.name)}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {/* Undo: only for approved/rejected */}
                            {(inspection.status === 'approved' || inspection.status === 'rejected') && (
                              <DropdownMenuItem
                                onClick={() => setResetTarget(inspection)}
                                disabled={resetInspection.isPending && resetTarget?.id === inspection.id}
                              >
                                {resetInspection.isPending && resetTarget?.id === inspection.id
                                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  : <Undo2 className="mr-2 h-4 w-4" />
                                }
                                Undo {inspection.status === 'approved' ? 'approval' : 'decline'}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDeleteInspection(inspection)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Inspection
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Decision details */}
                  {inspection.status === 'rejected' && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="bg-destructive/5 px-4 py-2.5">
                        <div className="flex items-start gap-2">
                          <ThumbsDown className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-destructive">Declined</p>
                            {(inspection.rejectionReason || inspection.rejection_reason) && (
                              <p className="text-sm text-foreground/80">{inspection.rejectionReason || inspection.rejection_reason}</p>
                            )}
                            {(inspection.rejectedBy || inspection.rejected_by) && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                By: {inspection.rejectedBy || inspection.rejected_by}
                                {(inspection.rejectedAt || inspection.rejected_at) && (
                                  <span className="ml-1">on {new Date(inspection.rejectedAt || inspection.rejected_at).toLocaleString()}</span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {inspection.status === 'approved' && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="bg-success/5 px-4 py-2.5">
                        <div className="flex items-start gap-2">
                          <ThumbsUp className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-success">Approved</p>
                            {(inspection.approvedBy || inspection.approved_by) && (
                              <p className="text-xs text-muted-foreground">
                                By: {inspection.approvedBy || inspection.approved_by}
                                {(inspection.approvedAt || inspection.approved_at) && (
                                  <span className="ml-1">on {new Date(inspection.approvedAt || inspection.approved_at).toLocaleString()}</span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Approve confirmation dialog */}
      <AlertDialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ThumbsUp className="h-5 w-5 text-success" />
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
              className="bg-success text-success-foreground hover:bg-success/90"
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
              <ThumbsDown className="h-5 w-5 text-destructive" />
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
              <Undo2 className="h-5 w-5 text-warning" />
              Undo {resetTarget?.status === 'approved' ? 'Approval' : 'Decline'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will reset <span className="font-semibold text-foreground">"{resetTarget?.name}"</span> back to{' '}
              <span className="font-semibold">Completed</span> status.
              {resetTarget?.status === 'approved' && (
                <span className="block mt-1 text-warning">
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
              className="bg-warning text-white hover:bg-warning/90"
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
              <Trash2 className="h-5 w-5 text-destructive" />
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
              className="bg-destructive text-white hover:bg-destructive/90"
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