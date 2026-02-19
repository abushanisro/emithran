'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useProjects, useCreateProject, useUpdateProject, useDeleteProject } from '@/lib/api/hooks/useProjects';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus,
  FolderKanban,
  TrendingUp,
  Clock,
  CheckCircle2,
  Trash2,
  Calendar,
  ArrowRight,
  Pause,
  XCircle,
  Pencil
} from 'lucide-react';
import { format } from 'date-fns';

const PROJECT_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Projects() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<any>(null);
  const [projectToEdit, setProjectToEdit] = useState<any>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'completed' | 'on_hold' | 'cancelled'>('draft');

  // Open dialog if ?new=true in URL
  useEffect(() => {
    if (searchParams?.get('new') === 'true') {
      setCreateOpen(true);
      router.replace('/projects');
    }
  }, [searchParams, router]);

  const { data: projectsData, isLoading } = useProjects();
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();

  const projects = projectsData?.projects || [];

  const handleCreate = () => {
    createMutation.mutate(
      {
        name,
        description: description || undefined,
        status,
        targetPrice: targetPrice ? parseFloat(targetPrice) : undefined,
      },
      {
        onSuccess: (data) => {
          setCreateOpen(false);
          setName('');
          setDescription('');
          setTargetPrice('');
          router.push(`/projects/${data.id}`);
        },
      }
    );
  };

  const handleDelete = () => {
    if (!projectToDelete) return;

    deleteMutation.mutate(projectToDelete.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        setProjectToDelete(null);
      },
    });
  };

  const handleEditOpen = (project: any) => {
    setProjectToEdit(project);
    setName(project.name);
    setDescription(project.description || '');
    setTargetPrice(project.targetPrice ? project.targetPrice.toString() : '');
    setStatus(project.status);
    setEditOpen(true);
  };

  const handleUpdate = () => {
    if (!projectToEdit) return;

    updateMutation.mutate(
      {
        id: projectToEdit.id,
        data: {
          name,
          description: description || undefined,
          status,
          targetPrice: targetPrice ? parseFloat(targetPrice) : undefined,
        },
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          setProjectToEdit(null);
          setName('');
          setDescription('');
          setTargetPrice('');
          setStatus('draft');
        },
      }
    );
  };

  const stats = {
    total: projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    draft: projects.filter((p) => p.status === 'draft').length,
    completed: projects.filter((p) => p.status === 'completed').length,
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'draft':
        return <Clock className="h-4 w-4 text-orange-600" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-blue-600" />;
      case 'on_hold':
        return <Pause className="h-4 w-4 text-yellow-600" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <FolderKanban className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Projects"
        description="Manage manufacturing and costing projects"
      >
        <Button onClick={() => setCreateOpen(true)} size="lg" className="gap-2">
          <Plus className="h-5 w-5" />
          New Project
        </Button>
      </PageHeader>

      {/* Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <FolderKanban className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total Projects</p>
                <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Active Projects</p>
                <p className="text-2xl font-bold text-foreground">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Draft Projects</p>
                <p className="text-2xl font-bold text-foreground">{stats.draft}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Completed</p>
                <p className="text-2xl font-bold text-foreground">{stats.completed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Projects Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Projects</CardTitle>
          <CardDescription>
            View and manage your manufacturing cost analysis projects
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
              <p className="text-sm text-muted-foreground mt-4">Loading projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <FolderKanban className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Projects Yet</h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
                Create your first manufacturing project to start managing BOMs and costs
              </p>
              <Button onClick={() => setCreateOpen(true)} size="lg" className="gap-2">
                <Plus className="h-5 w-5" />
                Create First Project
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <Card
                  key={project.id}
                  className="cursor-pointer hover:shadow-lg transition-all border-l-4 border-l-primary/30 hover:border-l-primary group"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {getStatusIcon(project.status)}
                        <CardTitle className="text-base truncate">
                          {project.name}
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditOpen(project);
                          }}
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToDelete(project);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <StatusBadge status={project.status} />
                  </CardHeader>
                  <CardContent className="pb-4">
                    {project.description && (
                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                        {project.description}
                      </p>
                    )}
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Target Cost</span>
                        <span className="font-semibold">
                          {project.targetPrice
                            ? `₹${Number(project.targetPrice).toLocaleString()}`
                            : '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Should Cost</span>
                        <span className="font-semibold">
                          {project.shouldCost
                            ? `$${Number(project.shouldCost).toLocaleString()}`
                            : '-'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                        <Calendar className="h-3 w-3" />
                        Created {format(new Date(project.createdAt), 'MMM d, yyyy')}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-4 gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/projects/${project.id}`);
                      }}
                    >
                      Open Project
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Project Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Create a new manufacturing cost analysis project
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Project Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Engine Block Manufacturing"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the project scope and objectives..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="targetPrice">Target Cost (₹)</Label>
              <Input
                id="targetPrice"
                type="number"
                min="0"
                max="99999999.99"
                step="0.01"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                Maximum: ₹99,999,999.99
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(value: any) => setStatus(value)}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update project information and settings
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Project Name *</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Engine Block Manufacturing"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the project scope and objectives..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-targetPrice">Target Cost (₹)</Label>
              <Input
                id="edit-targetPrice"
                type="number"
                min="0"
                max="99999999.99"
                step="0.01"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                Maximum: ₹99,999,999.99
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select value={status} onValueChange={(value: any) => setStatus(value)}>
                <SelectTrigger id="edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setProjectToEdit(null);
                setName('');
                setDescription('');
                setTargetPrice('');
                setStatus('draft');
              }}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={!name || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Updating...' : 'Update Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{projectToDelete?.name}"? This action cannot be
              undone and will remove all associated BOMs and data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
