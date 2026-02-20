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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
import { Country, State, City } from 'country-state-city';

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
  const [status, setStatus] = useState<'draft' | 'active' | 'completed' | 'on_hold' | 'cancelled'>('draft');
  const [industry, setIndustry] = useState('');
  const [estimatedAnnualVolume, setEstimatedAnnualVolume] = useState('');
  const [targetBomCost, setTargetBomCost] = useState('');
  const [targetBomCostCurrency, setTargetBomCostCurrency] = useState('');
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [stateCode, setStateCode] = useState('');
  
  // Get available states and cities based on selection
  const availableStates = countryCode ? State.getStatesOfCountry(countryCode) : [];
  const availableCities = countryCode && stateCode ? City.getCitiesOfState(countryCode, stateCode) : [];

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

  // Handle country selection
  const handleCountryChange = (value: string) => {
    const selectedCountry = Country.getAllCountries().find(c => c.isoCode === value);
    if (selectedCountry) {
      setCountryCode(value);
      setCountry(selectedCountry.name);
      setState('');
      setCity('');
      setStateCode('');
    }
  };

  // Handle state selection  
  const handleStateChange = (value: string) => {
    const selectedState = availableStates.find(s => s.isoCode === value);
    if (selectedState) {
      setStateCode(value);
      setState(selectedState.name);
      setCity('');
    }
  };

  // Handle city selection
  const handleCityChange = (value: string) => {
    const selectedCity = availableCities.find(c => c.name === value);
    if (selectedCity) {
      setCity(selectedCity.name);
    }
  };

  const handleCreate = () => {
    createMutation.mutate(
      {
        name,
        description: description || undefined,
        status,
        industry: industry || undefined,
        estimatedAnnualVolume: estimatedAnnualVolume ? parseInt(estimatedAnnualVolume) : undefined,
        targetBomCost: targetBomCost ? parseFloat(targetBomCost) : undefined,
        targetBomCostCurrency: targetBomCostCurrency,
        country: country || undefined,
        state: state || undefined,
        city: city || undefined,
      },
      {
        onSuccess: (data) => {
          setCreateOpen(false);
          setName('');
          setDescription('');
          setIndustry('');
          setEstimatedAnnualVolume('');
          setTargetBomCost('');
          setTargetBomCostCurrency('');
          setCountry('');
          setState('');
          setCity('');
          setCountryCode('');
          setStateCode('');
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
    setStatus(project.status);
    setIndustry(project.industry || '');
    setEstimatedAnnualVolume(project.estimatedAnnualVolume ? project.estimatedAnnualVolume.toString() : '');
    setTargetBomCost(project.targetBomCost ? project.targetBomCost.toString() : '');
    setTargetBomCostCurrency(project.targetBomCostCurrency || '');
    setCountry(project.country || '');
    setState(project.state || '');
    setCity(project.city || '');
    
    // Set codes for dropdowns if data exists
    if (project.country) {
      const selectedCountry = Country.getAllCountries().find(c => c.name === project.country);
      if (selectedCountry) {
        setCountryCode(selectedCountry.isoCode);
      }
    }
    if (project.state && project.country) {
      const selectedCountry = Country.getAllCountries().find(c => c.name === project.country);
      if (selectedCountry) {
        const states = State.getStatesOfCountry(selectedCountry.isoCode);
        const selectedState = states.find(s => s.name === project.state);
        if (selectedState) {
          setStateCode(selectedState.isoCode);
        }
      }
    }
    
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
          industry: industry || undefined,
          estimatedAnnualVolume: estimatedAnnualVolume ? parseInt(estimatedAnnualVolume) : undefined,
          targetBomCost: targetBomCost ? parseFloat(targetBomCost) : undefined,
          targetBomCostCurrency: targetBomCostCurrency || undefined,
          country: country || undefined,
          state: state || undefined,
          city: city || undefined,
        },
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          setProjectToEdit(null);
          setName('');
          setDescription('');
          setStatus('draft');
          setIndustry('');
          setEstimatedAnnualVolume('');
          setTargetBomCost('');
          setTargetBomCostCurrency('');
          setCountry('');
          setState('');
          setCity('');
          setCountryCode('');
          setStateCode('');
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
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <Card
                  key={project.id}
                  className="cursor-pointer hover:shadow-lg transition-all border-l-4 border-l-primary/30 hover:border-l-primary group min-h-[280px] flex flex-col"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {getStatusIcon(project.status)}
                        <CardTitle className="text-base leading-tight break-words">
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
                  <CardContent className="pb-4 flex-1 flex flex-col">
                    {project.description && (
                      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                        {project.description}
                      </p>
                    )}
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Industry</span>
                        <span className="font-semibold">
                          {project.industry || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Annual Volume</span>
                        <span className="font-semibold">
                          {project.estimatedAnnualVolume
                            ? Number(project.estimatedAnnualVolume).toLocaleString()
                            : '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Target BOM Cost</span>
                        <span className="font-semibold">
                          {project.targetBomCost && project.targetBomCostCurrency
                            ? `${project.targetBomCostCurrency} ${Number(project.targetBomCost).toLocaleString()}`
                            : '-'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                        <Calendar className="h-3 w-3" />
                        Created {format(new Date(project.createdAt), 'MMM d, yyyy')}
                      </div>
                    </div>
                    <div className="mt-auto pt-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/projects/${project.id}`);
                        }}
                      >
                        Open Project
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Project Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[85vh] p-0 pointer-events-auto">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="text-xl font-semibold">Create New Project</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Set up a new manufacturing cost analysis project with all essential details
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto px-6 py-4 max-h-[60vh]">
            <div className="space-y-6">
              {/* Project Basic Information */}
              <div className="space-y-4">
                <div className="border-b border-border pb-2">
                  <h3 className="text-base font-medium text-foreground">Project Information</h3>
                  <p className="text-xs text-muted-foreground">Basic details about your project</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Label htmlFor="name" className="text-sm font-medium">Project Name *</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Engine Block Manufacturing"
                      className="mt-1"
                    />
                  </div>
                  
                  <div className="md:col-span-2">
                    <Label htmlFor="description" className="text-sm font-medium">Description</Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe the project scope and objectives..."
                      rows={2}
                      className="mt-1 resize-none"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="status" className="text-sm font-medium">Status</Label>
                    <Select value={status} onValueChange={(value: any) => setStatus(value)}>
                      <SelectTrigger id="status" className="mt-1">
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
                  
                  <div>
                    <Label htmlFor="industry" className="text-sm font-medium">Industry</Label>
                    <Select value={industry} onValueChange={setIndustry}>
                      <SelectTrigger id="industry" className="mt-1">
                        <SelectValue placeholder="Select industry" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="medical">Medical</SelectItem>
                        <SelectItem value="automotive">Automotive</SelectItem>
                        <SelectItem value="aerospace">Aerospace</SelectItem>
                        <SelectItem value="electronics">Electronics</SelectItem>
                        <SelectItem value="consumer-goods">Consumer Goods</SelectItem>
                        <SelectItem value="industrial">Industrial</SelectItem>
                        <SelectItem value="energy">Energy</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              {/* Project Metrics */}
              <div className="space-y-4">
                <div className="border-b border-border pb-2">
                  <h3 className="text-base font-medium text-foreground">Project Metrics</h3>
                  <p className="text-xs text-muted-foreground">Production volume and cost targets</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="estimatedAnnualVolume" className="text-sm font-medium">Estimated Annual Volume</Label>
                    <Input
                      id="estimatedAnnualVolume"
                      type="number"
                      min="1"
                      max="999999999"
                      value={estimatedAnnualVolume}
                      onChange={(e) => setEstimatedAnnualVolume(e.target.value)}
                      placeholder="e.g., 10,000"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Units per year</p>
                  </div>
                  
                  <div>
                    <Label htmlFor="targetBomCost" className="text-sm font-medium">Target BOM Cost</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        id="targetBomCost"
                        type="number"
                        min="0"
                        max="999999.99"
                        step="0.01"
                        value={targetBomCost}
                        onChange={(e) => setTargetBomCost(e.target.value)}
                        placeholder="0.00"
                        className="flex-1"
                      />
                      <Select value={targetBomCostCurrency} onValueChange={setTargetBomCostCurrency}>
                        <SelectTrigger className="w-20">
                          <SelectValue placeholder="USD" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="INR">INR</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Per unit cost target</p>
                  </div>
                </div>
              </div>

              {/* Location Information */}
              <div className="space-y-4">
                <div className="border-b border-border pb-2">
                  <h3 className="text-base font-medium text-foreground">Location</h3>
                  <p className="text-xs text-muted-foreground">Manufacturing location details</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="country" className="text-sm font-medium">Country</Label>
                    <Select value={countryCode} onValueChange={handleCountryChange}>
                      <SelectTrigger id="country" className="mt-1">
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto z-50">
                        {Country.getAllCountries()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((country) => (
                          <SelectItem 
                            key={country.isoCode} 
                            value={country.isoCode}
                            className="cursor-pointer hover:bg-accent focus:bg-accent transition-colors duration-150 select-none"
                          >
                            {country.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="state" className="text-sm font-medium">State/Province</Label>
                    <Select 
                      value={stateCode} 
                      onValueChange={handleStateChange}
                      disabled={!countryCode}
                    >
                      <SelectTrigger id="state" className="mt-1">
                        <SelectValue placeholder={countryCode ? "Select state" : "Select country first"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto z-50">
                        {availableStates
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((state) => (
                          <SelectItem 
                            key={state.isoCode} 
                            value={state.isoCode}
                            className="cursor-pointer hover:bg-accent focus:bg-accent transition-colors duration-150 select-none"
                          >
                            {state.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="city" className="text-sm font-medium">City</Label>
                    <Select 
                      value={city} 
                      onValueChange={handleCityChange}
                      disabled={!stateCode}
                    >
                      <SelectTrigger id="city" className="mt-1">
                        <SelectValue placeholder={stateCode ? "Select city" : "Select state first"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto z-50">
                        {availableCities
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((city) => (
                          <SelectItem 
                            key={city.name} 
                            value={city.name}
                            className="cursor-pointer hover:bg-accent focus:bg-accent transition-colors duration-150 select-none"
                          >
                            {city.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="border-t border-border bg-background px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground font-medium">
                * Required fields
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={createMutation.isPending}
                  className="h-9 px-4 font-medium border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors select-none"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  onClick={handleCreate}
                  disabled={!name || createMutation.isPending}
                  className="h-9 px-6 font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm select-none"
                >
                  {createMutation.isPending ? (
                    <div className="flex items-center gap-2">
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                      <span>Creating...</span>
                    </div>
                  ) : (
                    'Create Project'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[85vh] p-0 pointer-events-auto">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="text-xl font-semibold">Edit Project</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Update project information and settings
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto px-6 py-4 max-h-[60vh]">
            <div className="space-y-6">
              {/* Project Basic Information */}
              <div className="space-y-4">
                <div className="border-b border-border pb-2">
                  <h3 className="text-base font-medium text-foreground">Project Information</h3>
                  <p className="text-xs text-muted-foreground">Update basic project details</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Label htmlFor="edit-name" className="text-sm font-medium">Project Name *</Label>
                    <Input
                      id="edit-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Engine Block Manufacturing"
                      className="mt-1"
                    />
                  </div>
                  
                  <div className="md:col-span-2">
                    <Label htmlFor="edit-description" className="text-sm font-medium">Description</Label>
                    <Textarea
                      id="edit-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe the project scope and objectives..."
                      rows={2}
                      className="mt-1 resize-none"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="edit-status" className="text-sm font-medium">Status</Label>
                    <Select value={status} onValueChange={(value: any) => setStatus(value)}>
                      <SelectTrigger id="edit-status" className="mt-1">
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
                  
                  <div>
                    <Label htmlFor="edit-industry" className="text-sm font-medium">Industry</Label>
                    <Select value={industry} onValueChange={setIndustry}>
                      <SelectTrigger id="edit-industry" className="mt-1">
                        <SelectValue placeholder="Select industry" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="medical">Medical</SelectItem>
                        <SelectItem value="automotive">Automotive</SelectItem>
                        <SelectItem value="aerospace">Aerospace</SelectItem>
                        <SelectItem value="electronics">Electronics</SelectItem>
                        <SelectItem value="consumer-goods">Consumer Goods</SelectItem>
                        <SelectItem value="industrial">Industrial</SelectItem>
                        <SelectItem value="energy">Energy</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              
              {/* Project Metrics */}
              <div className="space-y-4">
                <div className="border-b border-border pb-2">
                  <h3 className="text-base font-medium text-foreground">Project Metrics</h3>
                  <p className="text-xs text-muted-foreground">Production volume and cost targets</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-estimatedAnnualVolume" className="text-sm font-medium">Estimated Annual Volume</Label>
                    <Input
                      id="edit-estimatedAnnualVolume"
                      type="number"
                      min="1"
                      max="999999999"
                      value={estimatedAnnualVolume}
                      onChange={(e) => setEstimatedAnnualVolume(e.target.value)}
                      placeholder="e.g., 10,000"
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Units per year</p>
                  </div>
                  
                  <div>
                    <Label htmlFor="edit-targetBomCost" className="text-sm font-medium">Target BOM Cost</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        id="edit-targetBomCost"
                        type="number"
                        min="0"
                        max="999999.99"
                        step="0.01"
                        value={targetBomCost}
                        onChange={(e) => setTargetBomCost(e.target.value)}
                        placeholder="0.00"
                        className="flex-1"
                      />
                      <Select value={targetBomCostCurrency} onValueChange={setTargetBomCostCurrency}>
                        <SelectTrigger className="w-20">
                          <SelectValue placeholder="USD" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="INR">INR</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Per unit cost target</p>
                  </div>
                </div>
              </div>

              {/* Location Information */}
              <div className="space-y-4">
                <div className="border-b border-border pb-2">
                  <h3 className="text-base font-medium text-foreground">Location</h3>
                  <p className="text-xs text-muted-foreground">Manufacturing location details</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="edit-country" className="text-sm font-medium">Country</Label>
                    <Select value={countryCode} onValueChange={handleCountryChange}>
                      <SelectTrigger id="edit-country" className="mt-1">
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto z-50">
                        {Country.getAllCountries()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((country) => (
                          <SelectItem 
                            key={country.isoCode} 
                            value={country.isoCode}
                            className="cursor-pointer hover:bg-accent focus:bg-accent transition-colors duration-150 select-none"
                          >
                            {country.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="edit-state" className="text-sm font-medium">State/Province</Label>
                    <Select 
                      value={stateCode} 
                      onValueChange={handleStateChange}
                      disabled={!countryCode}
                    >
                      <SelectTrigger id="edit-state" className="mt-1">
                        <SelectValue placeholder={countryCode ? "Select state" : "Select country first"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto z-50">
                        {availableStates
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((state) => (
                          <SelectItem 
                            key={state.isoCode} 
                            value={state.isoCode}
                            className="cursor-pointer hover:bg-accent focus:bg-accent transition-colors duration-150 select-none"
                          >
                            {state.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="edit-city" className="text-sm font-medium">City</Label>
                    <Select 
                      value={city} 
                      onValueChange={handleCityChange}
                      disabled={!stateCode}
                    >
                      <SelectTrigger id="edit-city" className="mt-1">
                        <SelectValue placeholder={stateCode ? "Select city" : "Select state first"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] overflow-y-auto z-50">
                        {availableCities
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((city) => (
                          <SelectItem 
                            key={city.name} 
                            value={city.name}
                            className="cursor-pointer hover:bg-accent focus:bg-accent transition-colors duration-150 select-none"
                          >
                            {city.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="border-t border-border bg-background px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground font-medium">
                * Required fields
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditOpen(false);
                    setProjectToEdit(null);
                    setName('');
                    setDescription('');
                    setStatus('draft');
                    setIndustry('');
                    setEstimatedAnnualVolume('');
                    setTargetBomCost('');
                    setTargetBomCostCurrency('');
                    setCountry('');
                    setState('');
                    setCity('');
                    setCountryCode('');
                    setStateCode('');
                  }}
                  disabled={updateMutation.isPending}
                  className="h-9 px-4 font-medium border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors select-none"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  onClick={handleUpdate}
                  disabled={!name || updateMutation.isPending}
                  className="h-9 px-6 font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm select-none"
                >
                  {updateMutation.isPending ? (
                    <div className="flex items-center gap-2">
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                      <span>Updating...</span>
                    </div>
                  ) : (
                    'Update Project'
                  )}
                </Button>
              </div>
            </div>
          </div>
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
