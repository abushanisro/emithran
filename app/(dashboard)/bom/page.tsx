'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBOMs, useCreateBOM, useUpdateBOM, useDeleteBOM } from '@/lib/api/hooks/useBOM';
import { useProjects } from '@/lib/api/hooks/useProjects';
import { PageHeader } from '@/components/layout/PageHeader';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FileSpreadsheet,
  Search,
  Plus,
  Calendar,
  FolderKanban,
  ArrowUpDown,
  ArrowLeft,
  Download,
  Edit,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import { format } from 'date-fns';

export default function BOMManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedBOM, setSelectedBOM] = useState<any>(null);
  const [bomFormData, setBomFormData] = useState({
    name: '',
    description: '',
    version: '1.0',
    status: 'draft' as 'draft' | 'approved' | 'released' | 'obsolete',
  });

  // Use project-specific filtering when projectId is available
  const { data, refetch } = useBOMs({ 
    search: searchQuery,
    ...(projectId && { projectId })
  });
  const { data: projectsData } = useProjects();
  
  // Get current project data when in project context
  const currentProject = projectId && projectsData?.projects?.find(p => p.id === projectId);
  const createBOMMutation = useCreateBOM();
  const updateBOMMutation = useUpdateBOM();
  const deleteBOMMutation = useDeleteBOM();

  const handleCreateBOM = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!bomFormData.name) return;
    
    // Use current project ID if available, otherwise get first available project ID
    const targetProjectId = projectId || projectsData?.projects?.[0]?.id;
    if (!targetProjectId) return;
    
    try {
      await createBOMMutation.mutateAsync({
        name: bomFormData.name,
        description: bomFormData.description || undefined,
        projectId: targetProjectId,
        version: bomFormData.version,
        status: bomFormData.status,
      });
      
      setIsCreateDialogOpen(false);
      setBomFormData({
        name: '',
        description: '',
        version: '1.0',
        status: 'draft' as 'draft' | 'approved' | 'released' | 'obsolete',
      });
      refetch();
    } catch (error) {
      console.error('Failed to create BOM:', error);
    }
  };

  const resetCreateForm = () => {
    setBomFormData({
      name: '',
      description: '',
      version: '1.0',
      status: 'draft' as 'draft' | 'approved' | 'released' | 'obsolete',
    });
    setIsCreateDialogOpen(false);
  };

  const handleEditBOM = (bom: any) => {
    setSelectedBOM(bom);
    setBomFormData({
      name: bom.name,
      description: bom.description || '',
      version: bom.version,
      status: bom.status || 'draft',
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateBOM = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedBOM || !bomFormData.name) return;
    
    try {
      await updateBOMMutation.mutateAsync({
        id: selectedBOM.id,
        data: {
          name: bomFormData.name,
          description: bomFormData.description,
          version: bomFormData.version,
          status: bomFormData.status,
        },
      });
      
      setIsEditDialogOpen(false);
      setSelectedBOM(null);
      setBomFormData({
        name: '',
        description: '',
        version: '1.0',
        status: 'draft' as 'draft' | 'approved' | 'released' | 'obsolete',
      });
      refetch();
    } catch (error) {
      // Failed to update BOM
    }
  };

  const handleDeleteBOM = (bom: any) => {
    setSelectedBOM(bom);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteBOM = async () => {
    if (!selectedBOM) return;
    
    try {
      await deleteBOMMutation.mutateAsync(selectedBOM.id);
      setIsDeleteDialogOpen(false);
      setSelectedBOM(null);
      refetch();
    } catch (error) {
      // Failed to delete BOM
    }
  };

  const boms = data?.boms || [];

  const filteredBoms = searchQuery
    ? boms.filter((bom) =>
      bom.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (bom.version && bom.version.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    : boms;

  const stats = {
    totalBoms: boms.length,
    activeBoms: boms.filter((b) => b.status === 'approved' || b.status === 'released').length,
    draftBoms: boms.filter((b) => b.status === 'draft').length,
    totalValue: boms.reduce((sum, b) => sum + (b.totalCost || 0), 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => router.push(projectId ? `/projects/${projectId}` : '/projects')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Project
        </Button>
        <PageHeader
          title={projectId ? `BOM Management - ${currentProject?.name || 'Project'}` : "BOM Management"}
          description={projectId ? `Manage Bills of Materials for ${currentProject?.name || 'this project'}` : "Manage Bills of Materials across all projects"}
        >
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create BOM
            </Button>
          </div>
        </PageHeader>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total BOMs</CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalBoms}</div>
            <p className="text-xs text-muted-foreground">{projectId ? 'In this project' : 'Across all projects'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active BOMs</CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeBoms}</div>
            <p className="text-xs text-muted-foreground">Currently in use</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Draft BOMs</CardTitle>
            <FileSpreadsheet className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.draftBoms}</div>
            <p className="text-xs text-muted-foreground">In progress</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{stats.totalValue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Combined cost estimate</p>
          </CardContent>
        </Card>
      </div>

      {/* BOM List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{projectId ? 'Project BOMs' : 'All BOMs'}</CardTitle>
              <CardDescription>{projectId ? `View and manage BOMs for ${currentProject?.name || 'this project'}` : 'View and manage all Bills of Materials'}</CardDescription>
            </div>
          </div>
          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search BOMs by name, part number, or project..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredBoms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {searchQuery ? 'No BOMs found' : 'No BOMs Yet'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery
                  ? 'Try adjusting your search query'
                  : 'Create your first BOM from a project'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BOM Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBoms.map((bom) => (
                    <TableRow
                      key={bom.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/projects/${bom.projectId}/bom/${bom.id}`)}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">{bom.name}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground">{bom.description || 'No description'}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">v{bom.version}</p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={bom.status === 'released' || bom.status === 'approved' ? 'default' : 'secondary'}
                          className="capitalize"
                        >
                          {bom.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{bom.totalItems}</TableCell>
                      <TableCell className="text-right">
                        ₹{(bom.totalCost || 0).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(bom.updatedAt), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/projects/${bom.projectId}/bom/${bom.id}`);
                            }}
                          >
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditBOM(bom);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBOM(bom);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create BOM Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
        if (!open) resetCreateForm();
        else setIsCreateDialogOpen(true);
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleCreateBOM}>
            <DialogHeader>
              <DialogTitle>Create New BOM</DialogTitle>
              <DialogDescription>
                Create a new Bill of Materials for your project.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">BOM Name*</Label>
                <Input
                  id="name"
                  value={bomFormData.name}
                  onChange={(e) => setBomFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter BOM name"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="status">Status</Label>
                <Select 
                  value={bomFormData.status} 
                  onValueChange={(value: 'draft' | 'approved' | 'released' | 'obsolete') => setBomFormData(prev => ({ ...prev, status: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="released">Released</SelectItem>
                    <SelectItem value="obsolete">Obsolete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  value={bomFormData.version}
                  onChange={(e) => setBomFormData(prev => ({ ...prev, version: e.target.value }))}
                  placeholder="1.0"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={bomFormData.description}
                  onChange={(e) => setBomFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter BOM description (optional)"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={resetCreateForm}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={!bomFormData.name || createBOMMutation.isPending}
              >
                {createBOMMutation.isPending ? 'Creating...' : 'Create BOM'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit BOM Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleUpdateBOM}>
            <DialogHeader>
              <DialogTitle>Edit BOM</DialogTitle>
              <DialogDescription>
                Update the details of this Bill of Materials.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">BOM Name*</Label>
                <Input
                  id="edit-name"
                  value={bomFormData.name}
                  onChange={(e) => setBomFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter BOM name"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-status">Status</Label>
                <Select 
                  value={bomFormData.status} 
                  onValueChange={(value: 'draft' | 'approved' | 'released' | 'obsolete') => setBomFormData(prev => ({ ...prev, status: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="released">Released</SelectItem>
                    <SelectItem value="obsolete">Obsolete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-version">Version</Label>
                <Input
                  id="edit-version"
                  value={bomFormData.version}
                  onChange={(e) => setBomFormData(prev => ({ ...prev, version: e.target.value }))}
                  placeholder="1.0"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={bomFormData.description}
                  onChange={(e) => setBomFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter BOM description (optional)"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={!bomFormData.name || updateBOMMutation.isPending}
              >
                {updateBOMMutation.isPending ? 'Updating...' : 'Update BOM'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete BOM</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedBOM?.name}"? This action cannot be undone and will permanently remove the BOM and all its items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteBOM}
              disabled={deleteBOMMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBOMMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Workflow Navigation - Bottom */}
      {projectId && (
        <WorkflowNavigation 
          currentModuleId="bom" 
          projectId={projectId}
        />
      )}
    </div>
  );
}
